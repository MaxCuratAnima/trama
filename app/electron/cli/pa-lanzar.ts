// Lanzar un worker (`pa <proyecto> "<tarea>"`, `--leer`, `--async`, `--aca`): port de la parte de lanzamiento de `motor/bin/pa`.
// Un worktree propio por puesto (`<estado>/worktrees/<slug>[@k]`) y una rama `pa/<slug>/<id>` desde el HEAD del tree principal,
// `claude -p` con el contrato y los hooks del worker (latido + guardia), y los mismos archivos de estado que el bash
// (`.corrida .hilo .sid .json .pid .puesto .jefe .log .running .ultimo .listo`). Sin bash ni `setsid`: los procesos van por `procesos.ts`.
// Todavía no: --seguir, --actualizar, --integrar/--descartar/--matar/--ramas, reparto, tope global y RAM, ollama, medicion.tsv,
// tablero, el auto-cierre por falta de turnos, el reintento por 529 y symlinks de caches (node_modules, target) al worktree.
// Gemini/agy sí: un modelo `gemini*` o `agy:*` se lanza con `agy -p` (`TRAMA_AGY`) en vez de `claude` (rama `esGemini`).
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirClaudeConfig, rutaModelos } from "../plataforma.ts";
import { modeloAgy } from "../modelos-config.ts";
import { comandoEjecutable, esWindows, estadoDeProceso, matarArbol } from "../procesos.ts";
import { enPath } from "./trama-estado.ts";
import type { OpcionesProyecto } from "./args.ts";
import type { CtxPa } from "./contexto.ts";
import { tomarCandado, type Candado } from "./candado.ts";
import {
  anotarFin, escribirAtomico, escribirCola, escribirCorrida, escribirHilo, escribirJefe, escribirPid, escribirPuesto, escribirRunning,
  escribirSid, evento, hiloPoner, leerCampo, leerTexto, planDe, rutaDe, slugDe, sufijoPuesto,
} from "./estado-archivos.ts";
import { decisionDe, decisionEsNada } from "./hilos.ts";
import { armarContrato, nombreDueno } from "./lanzar-contrato.ts";
import { leerModelos, resolverPolitica, TIPOS_VALIDOS } from "./lanzar-politica.ts";
import { hooksDeWorker } from "./hook-comando.ts";
import { shellDeHooks } from "./hook-comando.ts";
import { entornoConCuenta, resolverCuenta, type EntornoCuenta } from "./pa-cuenta.ts";
import { resolver } from "./proyecto-ruta.ts";

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dos = (n: number) => String(n).padStart(2, "0");

/** `date +%Y%m%d-%H%M%S-$$`: el id de la corrida (con el pid: dos corridas en el mismo segundo no se pisan). */
export function nuevoId(ctx: CtxPa): string {
  const d = new Date((ctx.ahora() + ctx.offsetSeg()) * 1000);
  return `${d.getUTCFullYear()}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}-${dos(d.getUTCHours())}${dos(d.getUTCMinutes())}${dos(d.getUTCSeconds())}-${process.pid}`;
}

function git(cwd: string, args: string[]): { rc: number; out: string; err: string } {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, timeout: 120000 });
  return { rc: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const sucios = (cwd: string) => git(cwd, ["status", "--porcelain"]).out.split("\n").filter(Boolean);

/** El jefe es la sesión de Claude que está arriba en el árbol de procesos: la que tiene `~/.claude/sessions/<pid>.json`. */
async function campoDeJefe(ctx: CtxPa, campo: "name" | "sessionId"): Promise<string> {
  const dir = path.join(dirClaudeConfig(ctx.plataforma, ctx.home), "sessions");
  let p: number | null = process.ppid;
  for (let i = 0; p && p > 1 && i < 12; i++) {
    const t = await leerTexto(path.join(dir, `${p}.json`));
    if (t !== null) {
      try {
        const v = (JSON.parse(t) as Record<string, unknown>)[campo];
        return typeof v === "string" ? v : "";
      } catch {
        return "";
      }
    }
    p = (await estadoDeProceso(p))?.ppid ?? null;
  }
  return "";
}

export async function jefeDe(ctx: CtxPa, sinJefe: boolean): Promise<{ nombre: string; id: string }> {
  if (sinJefe) return { nombre: "", id: "" };
  const e = ctx.env;
  const nombre = e.PA_JEFE !== undefined ? e.PA_JEFE : await campoDeJefe(ctx, "name");
  const id = e.PA_JEFE_ID !== undefined ? e.PA_JEFE_ID : e.PA_JEFE !== undefined ? e.PA_JEFE : await campoDeJefe(ctx, "sessionId");
  return { nombre, id };
}

/** `campo_de`: el texto de `SIGUE:` (o el encabezado que sea) en el resultado del worker. */
function sigueDe(res: string): string {
  const l = res.split("\n");
  let a = -1;
  for (let i = 0; i < l.length; i++) if (/^[*#> \t-]*SIGUE[*]*:/.test(l[i])) a = i;
  if (a < 0) return "";
  let t = l[a].replace(/^[*#> \t-]*SIGUE[*]*:[*]*/, "");
  if (/^[ \t]*$/.test(t)) {
    t = "";
    for (const x of l.slice(a + 1)) {
      if (/^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI(?:O|Ó)N|SIGUE)[*]*:/.test(x)) break;
      if (/^[ \t]*$/.test(x)) {
        if (t) break;
        continue;
      }
      t = t ? `${t} ${x}` : x;
    }
  }
  return Array.from(t.trim()).slice(0, 400).join("");
}

const NO_VA = (flag: string) => `pa: ${flag} todavía no está en la versión TypeScript de pa.\n`;

export async function lanzar(ctx: CtxPa, o: OpcionesProyecto): Promise<number> {
  const env = ctx.env;
  if (o.tipo && !TIPOS_VALIDOS.includes(o.tipo)) {
    ctx.err(`pa: --tipo '${o.tipo}' no existe. Válidos: ${TIPOS_VALIDOS.join(", ")}${env.PA_TIPO ? " (ojo: puede venir de PA_TIPO)" : ""}.\n`);
    return 2;
  }
  const { plan } = await planDe(ctx.estado, env);
  const dueno = nombreDueno(ctx.plataforma, env, ctx.home);

  // --- política de modelos ---
  const mj = leerModelos(rutaModelos(ctx.plataforma, env, ctx.home));
  if (mj && "error" in mj) ctx.err(`pa: ${rutaModelos(ctx.plataforma, env, ctx.home)} no va (${mj.error}); sigo con los modelos de siempre.\n`);
  let effortSettings = "";
  try {
    const cfg = env.PA_CLAUDE_SETTINGS ?? path.join(env.CLAUDE_CONFIG_DIR ?? dirClaudeConfig(ctx.plataforma, ctx.home), "settings.json");
    effortSettings = String((JSON.parse(readFileSync(cfg, "utf8")) as { effortLevel?: unknown }).effortLevel ?? "");
  } catch {
    // sin settings
  }
  const dec = resolverPolitica({
    modelo: o.modelo, esfuerzo: o.esfuerzo, esfuerzoFlag: o.esfuerzoFlag, tipo: o.tipo, leer: o.leer, seguir: o.seguir, okDueno: o.okDueno, plan,
    modelos: mj && !("error" in mj) ? mj : null, effortSettings, dueno, hijoAsync: !!env.PA_ASYNC,
  });
  if ("error" in dec) return ctx.err(dec.error + "\n"), 2;
  const { modelo, esfuerzo } = dec;
  // la cuenta de la suscripción (`--cuenta`; sin ella, la de siempre). Un `--seguir` retomaría la del hilo: todavía no hay `--seguir`.
  const rc = resolverCuenta(ctx, { modelo, flag: o.cuenta });
  if (!rc.ok) return ctx.err(rc.error + "\n"), 2;
  const { cuenta, entorno: cuentaEntorno } = rc;

  // --- el proyecto ---
  const r = resolver([o.proyecto], env, ctx.plataforma, ctx.home);
  if (r.codigo !== 0) {
    ctx.err(r.err);
    return r.codigo;
  }
  const ruta = r.out.trim();
  const slug = slugDe(ruta);
  const dir = path.join(ctx.estado, slug);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(ctx.estado, "lock"), { recursive: true });
  const sfile = path.join(ctx.estado, `${slug}.session`);

  for (const [activo, flag] of [[o.integrar, "--integrar"], [o.descartar, "--descartar"], [o.actualizar, "--actualizar"], [o.ramas, "--ramas"], [o.matar, "--matar"], [o.seguir, "--seguir"]] as const) {
    if (activo) return ctx.err(NO_VA(flag)), 2;
  }
  if (o.olvidar) {
    await rm(sfile, { force: true });
    ctx.out(`pa: sesión de '${slug}' descartada.\n`);
    return 0;
  }
  if (!o.tarea) return ctx.err("pa: falta la tarea.\n"), 2;

  const esGemini = modelo.toLowerCase().startsWith("gemini") || modelo.toLowerCase().startsWith("agy:");
  let ejecutableBin = "";
  if (esGemini) {
    const agyBin = enPath(env.TRAMA_AGY || "agy", { plataforma: ctx.plataforma, env, home: ctx.home });
    if (!agyBin) {
      ctx.err("pa: no encuentro agy en el PATH. Instalalo, o poné su ruta en TRAMA_AGY.\n");
      return 84;
    }
    ejecutableBin = agyBin;
  } else {
    const claudeBin = enPath(env.TRAMA_CLAUDE || "claude", { plataforma: ctx.plataforma, env, home: ctx.home });
    if (!claudeBin) {
      ctx.err("pa: no encuentro claude (ni en el PATH ni en ~/.local/bin). Instalalo, o poné su ruta en TRAMA_CLAUDE.\n");
      return 84;
    }
    ejecutableBin = claudeBin;
  }
  const limite = await leerTexto(path.join(ctx.estado, "limite.hasta"));
  if (limite !== null && /^\d+$/.test(limite.trim())) {
    if (Number(limite.trim()) > ctx.ahora()) {
      ctx.err(`pa: límite de sesión de la suscripción hasta las ${new Date(Number(limite.trim()) * 1000).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}. No lanzo.\n`);
      ctx.err(`pa: si creés que ya se liberó: borrá ${path.join(ctx.estado, "limite.hasta")}\n`);
      return 76;
    }
    await rm(path.join(ctx.estado, "limite.hasta"), { force: true });
  }

  if (cuenta && cuenta !== "claude" && cuenta !== "google") ctx.err(`pa: cuenta ${cuenta}.\n`);
  const base: Base = { ctx, o, plan, dueno, modelo, esfuerzo, ruta, slug, dir, sfile, claudeBin: ejecutableBin, cuenta, cuentaEntorno };
  return o.async ? lanzarAsync(base) : correr(base);
}

type Base = {
  ctx: CtxPa; o: OpcionesProyecto; plan: "pro" | "max"; dueno: string; modelo: string; esfuerzo: string; ruta: string; slug: string;
  dir: string; sfile: string; claudeBin: string;
  /** La cuenta con la que corre ("claude" = la de siempre) y las variables de entorno que le tocan al worker. */
  cuenta: string; cuentaEntorno: EntornoCuenta;
};

const SCRIPT_PA = () => fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./pa.ts" : "./pa.js", import.meta.url));

/** `--async`: relanza `pa` desacoplado (log aparte) y vuelve cuando el hijo tiene puesto o está en cola; imprime el id. */
async function lanzarAsync(b: Base): Promise<number> {
  const { ctx, o, dir, slug, modelo, esfuerzo, cuenta } = b;
  const ts = nuevoId(ctx);
  const log = rutaDe(dir, ts, "log");
  // las marcas van ANTES del fork: `--esperar --id` las lee aunque llegue antes de que el hijo escriba nada
  if (o.leer) await writeFile(rutaDe(dir, ts, "leer"), "");
  await writeFile(log, "");
  const jefe = await jefeDe(ctx, o.sinJefe);
  if (!o.leer) await escribirJefe(dir, ts, jefe.nombre, jefe.id);

  const a = [o.proyecto, "-m", modelo];
  if (o.leer) a.push("--leer");
  if (o.mcp) a.push("--mcp");
  a.push("--max-turns", o.maxTurns || "0");
  if (o.maxBudget) a.push("--max-budget-usd", o.maxBudget);
  if (o.id) a.push("--id", o.id);
  if (o.sucioMio) a.push("--sucio-mio");
  if (o.aca) a.push("--aca");
  if (o.tipo) a.push("--tipo", o.tipo);
  if (o.okDueno) a.push("--ok-dueno");
  if (cuenta) a.push("--cuenta", cuenta);
  a.push("--", o.tarea);

  const enElectron = !!process.versions.electron;
  const envHijo = {
    ...process.env, ...ctx.env, PA_TS: ts, PA_JEFE: jefe.nombre, PA_JEFE_ID: jefe.id, PA_ASYNC: "1", ...(esfuerzo ? { PA_EFFORT: esfuerzo } : {}),
    ...(enElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
  const fd = openSync(log, "a");
  let murio = false;
  const hijo = spawn(process.execPath, [SCRIPT_PA(), ...a], { detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: envHijo });
  closeSync(fd);
  hijo.on("exit", () => (murio = true));
  hijo.on("error", () => (murio = true));
  hijo.unref();
  if (hijo.pid) await escribirPid(dir, ts, hijo.pid);

  // no vuelve hasta que el hijo tenga puesto (o esté en cola): si no, un `--esperar` pegado atrás no ve nada vivo
  const hayListo = () => existsSync(rutaDe(dir, ts, "listo"));
  const runLeer = path.join(ctx.estado, `${slug}.leer-${ts}.running`);
  for (let i = 0; i < 100 && !murio && !hayListo(); i++) {
    if (o.leer) {
      if ((await leerCampo(runLeer, "pid")) || existsSync(rutaDe(dir, ts, "cola"))) break;
    } else if (existsSync(rutaDe(dir, ts, "puesto")) || existsSync(rutaDe(dir, ts, "cola"))) break;
    await dormir(100);
  }
  if (murio && !hayListo()) {
    ctx.err(o.leer ? `pa: '${slug}' (id: ${ts}) murió antes de arrancar. Mirá el log: ${log}\n` : `pa: '${slug}' (id: ${ts}) murió antes de tomar el lock de un puesto. Mirá el log: ${log}\n`);
    return 1;
  }
  const cola = await leerTexto(rutaDe(dir, ts, "cola"));
  const puesto = o.leer ? null : await leerTexto(rutaDe(dir, ts, "puesto"));
  if (!o.leer && puesto !== null) ctx.out(`pa: '${slug}' lanzado en background en ${puesto === "aca" ? "el tree principal" : `el puesto ${puesto}`} (id: ${ts}, log: ${log}).\n`);
  else if (cola !== null) ctx.out(`pa: '${slug}' lanzado en background, EN COLA: ${cola} (id: ${ts}, log: ${log}). Arranca solo cuando se libere.\n`);
  else ctx.out(`pa: '${slug}' lanzado en background (id: ${ts}, log: ${log}).\n`);
  ctx.out(`pa: para esperarlo: pa --esperar '${o.proyecto}' --id ${ts}\n`);
  return 0;
}

// --- puestos y worktree ---

type Puesto = { puesto: string; candado: Candado };

/** Un puesto libre (o el pedido). En primer plano sin ninguno sale `null`; con --async espera en cola (`.cola` dice por qué). */
async function tomarPuesto(b: Base, ts: string, pedido: string): Promise<Puesto | null> {
  const { ctx, o, dir, slug } = b;
  const n = Math.max(1, Number.parseInt(ctx.env.PA_PUESTOS ?? "3", 10) || 3);
  const cands = pedido ? [pedido] : Array.from({ length: n }, (_, i) => String(i + 1));
  for (;;) {
    for (const k of cands) {
      const c = await tomarCandado(path.join(ctx.estado, "lock", `${slug}${sufijoPuesto(k)}.lck`));
      if (c) {
        await escribirPuesto(dir, ts, k);
        await rm(rutaDe(dir, ts, "cola"), { force: true });
        return { puesto: k, candado: c };
      }
    }
    if (!ctx.env.PA_ASYNC) {
      ctx.err(pedido === "aca" ? `pa: ya hay un worker corriendo en el tree principal de '${slug}'.\n` : `pa: ya hay un worker corriendo en cada uno de los ${cands.length} puesto(s) de '${slug}'.\n`);
      ctx.err(`pa: esperá uno con: pa --esperar '${o.proyecto}' --id <id>   o lanzalo con --async (hace cola y arranca solo).\n`);
      return null;
    }
    await escribirCola(dir, ts, pedido === "aca" ? "esperando el tree principal" : `los ${cands.length} puestos ocupados`);
    await dormir(500 + Math.floor(Math.random() * 500));
  }
}

/** El worktree del puesto y una rama nueva desde el HEAD. Devuelve `null` (y lo dice) si no pudo: nunca cae al tree principal. */
async function prepararWorktree(b: Base, ts: string, puesto: string): Promise<{ rutaTrabajo: string; rama: string; base: string } | null> {
  const { ctx, ruta, slug } = b;
  const wt = path.join(ctx.estado, "worktrees", `${slug}${sufijoPuesto(puesto)}`);
  const lockGit = await tomarCandado(path.join(ctx.estado, "lock", `${slug}@git.lck`), { espera: 60000 });
  if (!lockGit) {
    ctx.err(`pa: el candado de git de '${slug}' sigue tomado después de 60s. No arranco.\n`);
    return null;
  }
  try {
    if (!existsSync(path.join(wt, ".git"))) {
      await mkdir(path.dirname(wt), { recursive: true });
      git(ruta, ["worktree", "prune"]);
      if (git(ruta, ["worktree", "add", "--detach", wt, "HEAD"]).rc !== 0) return ctx.err(`pa: no pude crear el worktree en ${wt}.\n`), null;
    }
    // un worker anterior que murió sin commitear: en un worktree de pa TODO es de pa, se commitea en la rama que estaba
    if (sucios(wt).length) {
      let anterior = git(wt, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
      if (anterior === "HEAD") {
        anterior = `pa/${slug}/huerfano-${ts}`;
        git(wt, ["checkout", "-qB", anterior]);
      }
      git(wt, ["add", "-A"]);
      if (git(wt, ["commit", "-qm", `pa: huérfano de ${anterior}`]).rc === 0) ctx.err(`pa: el worktree ${path.basename(wt)} tenía trabajo huérfano; quedó commiteado en '${anterior}'.\n`);
    }
    const base = git(ruta, ["rev-parse", "HEAD"]).out.trim();
    const rama = `pa/${slug}/${ts}`;
    if (git(wt, ["checkout", "-qB", rama, base]).rc !== 0) return ctx.err(`pa: no pude sacar la rama ${rama} en ${wt}. NO corro en el tree principal.\n`), null;
    return { rutaTrabajo: wt, rama, base };
  } finally {
    await lockGit.soltar();
  }
}

// --- la corrida ---

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function correr(b: Base): Promise<number> {
  const { ctx, o, plan, dueno, modelo, esfuerzo, ruta, slug, dir, sfile, claudeBin, cuenta, cuentaEntorno } = b;
  const env = ctx.env;
  const ts = env.PA_TS || nuevoId(ctx);
  const sid = randomUUID();
  const sinGit = git(ruta, ["rev-parse", "-q", "--verify", "HEAD"]).rc !== 0;
  const lanzo = /^[a-z0-9_-]+$/.test(env.PA_ORIGEN ?? "") ? (env.PA_ORIGEN as string) : "jefe";
  const tareaJefe = o.tarea;
  const jefe = await jefeDe(ctx, o.sinJefe);

  // puesto: --leer no toma ninguno (su estado va por corrida); el resto uno libre, o el tree principal con --aca
  let puesto = "";
  let candado: Candado | null = null;
  let run: string;
  let hb: string;
  if (o.leer) {
    run = path.join(ctx.estado, `${slug}.leer-${ts}.running`);
    hb = path.join(ctx.estado, `${slug}.leer-${ts}.heartbeat`);
    await writeFile(rutaDe(dir, ts, "leer"), "");
  } else {
    const t = await tomarPuesto(b, ts, sinGit ? "1" : o.aca ? "aca" : "");
    if (!t) return 75;
    puesto = t.puesto;
    candado = t.candado;
    run = path.join(ctx.estado, `${slug}${sufijoPuesto(puesto)}.running`);
    hb = path.join(ctx.estado, `${slug}${sufijoPuesto(puesto)}.heartbeat`);
    await rm(run, { force: true }); // de un worker anterior de este puesto que murió sin limpiar: tenemos el candado
    await rm(hb, { force: true });
    // el primer .running, ANTES de preparar el worktree (en Windows tarda segundos): sin él, --estado no ve un worker que ya tiene
    // puesto y --esperar/--parar tampoco. Sin pid del claude todavía: vale el de pa (`pa_pid`).
    await escribirRunning(run, { pa_pid: process.pid, inicio: ctx.ahora(), proyecto: slug, id: ts, ruta, ruta_trabajo: ruta, modelo, cuenta, leer: 0, puesto, tarea: o.tarea });
  }
  await rm(`${hb}.turnos`, { force: true });

  const out = rutaDe(dir, ts, "json");
  const err = rutaDe(dir, ts, "err");
  let rc = 1;
  let inicio = ctx.ahora();
  let tengoSalida = false;
  let hijoPid: number | undefined;
  let rutaTrabajo = ruta;
  let rama = "";
  let baseCommit = "";
  let iniciado = false;
  try {
    if (!o.leer && puesto !== "aca" && !sinGit) {
      const w = await prepararWorktree(b, ts, puesto);
      if (!w) return 87;
      ({ rutaTrabajo, rama, base: baseCommit } = w);
    }
    const usaWorktree = rama !== "";
    let tarea = o.tarea;
    if (!o.leer && !usaWorktree) {
      const previos = sucios(ruta);
      if (previos.length && !o.sucioMio) {
        tarea += `\n\nAVISO DEL ORQUESTADOR: cuando arrancaste, el repo YA tenía ${previos.length} archivos sin commitear\nde otra sesión. No son tuyos:\n${previos.slice(0, 20).map((l) => "  " + l).join("\n")}\nNo los toques ni los metas en tus commits: commiteá SOLO los archivos que tocaste vos, uno por\nuno. Si tu cambio cae encima de uno de esos, trabajá arriba de lo que hay y decilo en DECISION\nen vez de bundlearlo o revertirlo.`;
        ctx.err(`pa: '${slug}' arranca SUCIO: ${previos.length} archivo(s) sin commitear que NO son de este worker.\n`);
      }
    } else if (usaWorktree) {
      const previos = sucios(ruta).length;
      if (previos) ctx.err(`pa: el tree principal de '${slug}' tiene ${previos} archivo(s) sin commitear. El worker no los ve: trabaja aislado en su worktree.\n`);
    }

    const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const script = (n: string) => fileURLToPath(new URL(`./${n}.${ext}`, import.meta.url));
    const settings = JSON.stringify({
      crossSessionInbound: "accept",
      claudeMdExcludes: [ctx.home + "/CLAUDE.md"],
      enabledPlugins: { "caveman@caveman": false },
      hooks: hooksDeWorker({
        plataforma: ctx.plataforma, ejecutable: process.execPath, electron: !!process.versions.electron, shell: shellDeHooks(ctx.plataforma, env),
        scripts: { latido: script("hook-latido"), guardia: script("hook-guardia") }, hb, leer: o.leer,
      }),
    });
    const contrato = armarContrato({ dueno, jefe: jefe.nombre, plan, leer: o.leer, rama, rutaTrabajo });
    const nombreWorker = `pa/${slug}${o.leer ? "" : sufijoPuesto(puesto)}`;
    const autocompact = /^\d+$/.test(env.PA_AUTOCOMPACT ?? "") && Number(env.PA_AUTOCOMPACT) >= 100000 && Number(env.PA_AUTOCOMPACT) <= 1000000 ? env.PA_AUTOCOMPACT! : "180000";
    const esGemini = modelo.toLowerCase().startsWith("gemini") || modelo.toLowerCase().startsWith("agy:");
    const args: string[] = [];
    if (esGemini) {
      const mAgy = modeloAgy(modelo);
      args.push("-p", `${contrato}\n\n${tarea}`, "--model", mAgy, "--dangerously-skip-permissions", "--output-format", "json");
    } else {
      args.push(
        "-p", tarea, "--model", modelo, ...(esfuerzo ? ["--effort", esfuerzo] : []), "--output-format", "json", "--append-system-prompt", contrato,
        "--permission-mode", "bypassPermissions", "--autocompact", autocompact, "--settings", settings, "--name", nombreWorker,
      );
      if (!o.mcp) args.push("--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}');
      if (o.leer) args.push("--tools", "Read,Grep,Glob,Bash,ToolSearch,ListAgents,SendMessage");
      else if (plan === "pro") args.push("--disallowedTools", "Agent");
      if (o.maxTurns) args.push("--max-turns", o.maxTurns);
      if (o.maxBudget) args.push("--max-budget-usd", o.maxBudget);
      args.push("--session-id", sid);
    }

    // los registros de la corrida, antes de lanzar: una que muere a mitad es justo la que hay que poder retomar
    await escribirSid(dir, ts, sid);
    await escribirCorrida(rutaDe(dir, ts, "corrida"), {
      ruta_trabajo: rutaTrabajo, rama, base: baseCommit, proyecto: o.proyecto, origen: "", leer: o.leer ? 1 : 0, puesto, jefe: jefe.nombre, jefe_id: jefe.id,
    });
    inicio = ctx.ahora();
    await escribirHilo(rutaDe(dir, ts, "hilo"), {
      tarea: tareaJefe, modelo, effort: esfuerzo || "settings", inicio, proyecto: slug, ruta_trabajo: rutaTrabajo, rama, origen: "", leer: o.leer ? 1 : 0, puesto, lanzo,
      jefe: jefe.nombre, jefe_id: jefe.id, tipo: o.tipo, cuenta,
    });
    const transcript = path.join(ctx.proyectos, rutaTrabajo.replace(/[^A-Za-z0-9]/g, "-"), `${sid}.jsonl`);
    const registro = () =>
      escribirRunning(run, {
        pid: hijoPid ?? "", pa_pid: process.pid, inicio, proyecto: slug, id: ts, ruta, ruta_trabajo: rutaTrabajo, rama, modelo, cuenta, leer: o.leer ? 1 : 0,
        jefe: jefe.nombre, jefe_id: jefe.id, puesto, salida: out, sid, transcript, tarea,
      });
    await registro();
    await evento(ctx.estado, "inicio", ts, slug, ctx.ahora());
    iniciado = true;

    // el claude: stdout al .json, stderr al .err, en su propio grupo para poder bajarlo entero
    const fo = openSync(out, "w");
    const fe = openSync(err, "w");
    const orden = comandoEjecutable(claudeBin, args, ctx.plataforma);
    const hijo = spawn(orden.file, orden.args, {
      ...orden.opciones,
      cwd: rutaTrabajo, windowsHide: true, detached: !esWindows(ctx.plataforma), stdio: ["ignore", fo, fe],
      // la cuenta (sacar ANTHROPIC_API_KEY, poner CLAUDE_CONFIG_DIR…) va SÓLO en el proceso del worker
      env: entornoConCuenta({
        ...process.env, ...env, PA_WORKER: "1", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true",
        ...(o.maxTurns ? { PA_MAX_TURNS: o.maxTurns } : {}), PA_RECORTE: plan === "pro" ? (env.PA_RECORTE ?? "150") : "0",
      }, cuentaEntorno),
    });
    closeSync(fo);
    closeSync(fe);
    hijoPid = hijo.pid;
    await registro(); // ahora sí con el pid del claude
    let matado = false;
    const bajar = () => {
      matado = true;
      matarArbol(hijoPid, false);
    };
    process.once("SIGTERM", bajar);
    process.once("SIGINT", bajar);
    const codigo = await new Promise<number>((ok) => {
      hijo.on("error", (e) => {
        void writeFile(err, String(e), { flag: "a" }).finally(() => ok(127));
      });
      hijo.on("exit", (c, s) => ok(c ?? (s ? 128 : 1)));
    });
    process.removeListener("SIGTERM", bajar);
    process.removeListener("SIGINT", bajar);
    hijoPid = undefined;
    tengoSalida = true;
    if (matado) {
      ctx.err(`pa: matado; el worker de '${slug}' también.\n`);
      return (rc = 130);
    }

    // --- qué salió ---
    let j: Record<string, unknown> | null = null;
    try {
      const x = JSON.parse(await readFile(out, "utf8"));
      if (x && typeof x === "object" && !Array.isArray(x)) j = x as Record<string, unknown>;
    } catch {
      // sin JSON: murió antes de contestar
    }
    if (j && typeof j.response === "string" && j.result === undefined) {
      j.result = j.response;
      j.duration_ms = typeof j.duration_seconds === "number" ? j.duration_seconds * 1000 : 0;
      j.session_id = typeof j.conversation_id === "string" ? j.conversation_id : sid;
      j.total_cost_usd = 0;
      j.num_turns = typeof j.num_turns === "number" ? j.num_turns : 1;
    }
    const resultado = typeof j?.result === "string" ? j.result : "";
    const esError = j?.is_error === true;
    const errTxt = (await leerTexto(err)) ?? "";
    const guardarSesion = async () => {
      const nuevo = typeof j?.session_id === "string" ? j.session_id : "";
      if (nuevo && !o.leer) {
        await escribirAtomico(sfile, nuevo);
        await escribirAtomico(`${sfile}.ts`, ts);
      }
    };
    const stats = () =>
      `— ${num(j?.num_turns)} turnos · ${Math.floor(num(j?.duration_ms) / 1000)}s · US$${Math.round(num(j?.total_cost_usd) * 10000) / 10000}`;
    const quedaron = () => {
      const n = sucios(rutaTrabajo).length;
      return n ? `pa: quedaron ${n} archivo(s) sin commitear en ${rutaTrabajo}.\n` : "";
    };

    if (codigo !== 0 || esError) {
      if (resultado.includes("session limit")) {
        ctx.err(`pa: límite de sesión de la suscripción. Sesión de '${slug}' INTACTA.\n${resultado}\n`);
        return (rc = 76);
      }
      if (resultado.includes("529") || resultado.includes("Overloaded")) {
        ctx.err(`pa: API sobrecargada (529). Sesión de '${slug}' INTACTA, reintentá más tarde.\n${resultado}\n`);
        return (rc = 77);
      }
      if (j?.subtype === "error_max_turns") {
        await guardarSesion();
        ctx.err(`${resultado}\n${stats()}\npa: el worker de '${slug}' se quedó sin turnos (tope ${o.maxTurns || "?"}).\n${quedaron()}`);
        ctx.err(`pa: para cerrarlo a mano: pa '${o.proyecto}' --seguir --id ${ts} 'commiteá lo que hiciste y reportá'.\n`);
        return (rc = 78);
      }
      if (codigo === 127 || /command not found|ENOENT/.test(errTxt)) {
        ctx.err(`pa: no se pudo ejecutar claude (${claudeBin}).\n${errTxt.split("\n").slice(-5).join("\n")}\n`);
        return (rc = 81);
      }
      ctx.err(`pa: el worker de '${slug}' falló.\n${resultado || errTxt.split("\n").slice(-20).join("\n")}\n`);
      return (rc = 1);
    }

    // éxito: el resultado, las estadísticas y qué hacer con la rama
    ctx.out(`${resultado || "(sin resultado)"}\n${stats()}\n`);
    if (usaWorktree) {
      const mb = git(ruta, ["merge-base", "HEAD", rama]);
      const b0 = mb.rc === 0 ? mb.out.trim() : baseCommit;
      const n = Number(git(rutaTrabajo, ["rev-list", "--count", `${b0}..${rama}`]).out.trim() || "0");
      if (n === 0) {
        const previos = baseCommit && Number(git(rutaTrabajo, ["rev-list", "--count", `${baseCommit}..${rama}`]).out.trim() || "0") !== 0;
        ctx.out(previos ? `— rama ${rama}: sus commits ya están todos en el tree principal. Nada que integrar.\n` : `— rama ${rama} sin commits: no cambió nada. Se tira con: pa '${o.proyecto}' --descartar ${ts}\n`);
      } else ctx.out(`— rama ${rama}: ${n} commit(s) sobre ${b0.slice(0, 7)}. NO está en main hasta que la integres: pa '${o.proyecto}' --integrar ${ts}\n`);
    }
    await guardarSesion();
    if (!resultado.includes("RESULTADO:")) {
      ctx.err(`pa: el worker de '${slug}' terminó SIN el bloque RESULTADO (arriba está lo que dijo).\n${quedaron()}`);
      ctx.err(`pa: si hay trabajo sin cerrar: pa '${o.proyecto}' --seguir --id ${ts} 'commiteá lo que hiciste y reportá'.\n`);
      return (rc = 78);
    }
    return (rc = 0);
  } finally {
    await cierre();
  }

  /** `al_salir`: la hora de fin, DECISION/SIGUE al `.hilo`, `.ultimo` y `.listo` (que `--esperar` mira), y suelta puesto y rastros. */
  async function cierre(): Promise<void> {
    try {
      if (iniciado) {
        await anotarFin(dir, ts, ctx.ahora());
        if (tengoSalida) {
          let res = "";
          try {
            res = String((JSON.parse(await readFile(out, "utf8")) as { result?: unknown }).result ?? "");
          } catch {
            // sin JSON
          }
          const hilo = rutaDe(dir, ts, "hilo");
          const d = decisionDe(res);
          await hiloPoner(hilo, "decision", d).catch(() => {});
          await hiloPoner(hilo, "decision_nada", decisionEsNada(d) ? 1 : 0).catch(() => {});
          await hiloPoner(hilo, "sigue", sigueDe(res)).catch(() => {});
        }
      }
      const linea = `salida=${tengoSalida ? out : ""}\nrc=${rc}\nsid=${iniciado ? await leerTexto(rutaDe(dir, ts, "sid")) ?? "" : ""}\n`;
      if (candado) await escribirAtomico(path.join(ctx.estado, `${slug}.ultimo`), linea);
      if ((candado || o.leer) && env.PA_ASYNC) await escribirAtomico(rutaDe(dir, ts, "listo"), linea);
    } finally {
      await rm(run, { force: true });
      await rm(hb, { force: true });
      await rm(`${hb}.turnos`, { force: true });
      if (candado) await candado.soltar();
      if (iniciado) await evento(ctx.estado, "fin", ts, slug, ctx.ahora(), rc);
    }
  }
}
