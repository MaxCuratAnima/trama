// Gestión de ramas de workers (`pa <proyecto> --integrar <id>`, `--descartar <id>`, `--archivar <id>`): mismas salidas, códigos
// y archivos de estado que `motor/bin/pa`. Integrar = rebase de la rama del worker sobre el HEAD del tree principal, dentro de
// un puesto (worktree de pa), y ff-only en el tree principal. Nunca fuerza nada.
// Códigos: 75 candado/puesto ocupado · 79 el tree principal tiene sin commitear algo que la rama toca · 80 el rebase choca ·
// 83 symlink peligroso · 86 la corrida dejó trabajo sin commitear en su worktree · 92 la corrida sigue viva.
// Sin portar todavía: `--tests`, el empuje de main al remoto, el aviso al tablero, y enlazar/desenlazar los caches de los puestos.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { tomarCandado, type Candado } from "./candado.ts";
import type { CtxPa } from "./contexto.ts";
import { conCandado } from "./candado.ts";
import { anotarFin, escribirAtomico, evento, hiloPoner, leerCampo, leerTexto, proyectoDeId, rutaDe, slugDe } from "./estado-archivos.ts";
import { runningDeId } from "./parar.ts";
import type { OpcionesProyecto } from "./args.ts";
import { resolver } from "./proyecto-ruta.ts";
import { caminos, esWindows, mismaRuta, restoDeRuta } from "../plataforma.ts";

// --- git ---

export type SalidaGit = { rc: number; out: string; err: string };
export function git(cwd: string, args: string[]): SalidaGit {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" },
  });
  return { rc: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const gitOk = (cwd: string, args: string[]) => git(cwd, args).rc === 0;
const gitSal = (cwd: string, args: string[]) => git(cwd, args).out.trim();
const lineas = (s: string) => s.split("\n").filter(Boolean);
const enteroODefecto = (s: string, d = 0) => (/^\d+$/.test(s.trim()) ? Number(s) : d);

/** El tree principal de un repo, visto desde cualquiera de sus worktrees (el primero que lista git). */
export function treePrincipal(ruta: string): string {
  const l = git(ruta, ["worktree", "list", "--porcelain"]).out.split("\n")[0] ?? "";
  return l.startsWith("worktree ") ? l.slice(9) : "";
}

/** Cuántos commits de la rama le faltan al HEAD del tree principal: LA medida de "trabajo sin integrar". */
export function commitsPendientes(repo: string, rama: string): number {
  const ppal = treePrincipal(repo) || repo;
  const r = git(ppal, ["rev-list", "--count", `HEAD..${rama}`]);
  return r.rc === 0 ? enteroODefecto(r.out) : 0;
}

/** El worktree donde está checkouteada la rama, o `""`. */
export function wtDeRama(ruta: string, rama: string): string {
  let w = "";
  for (const l of git(ruta, ["worktree", "list", "--porcelain"]).out.split("\n")) {
    if (l.startsWith("worktree ")) w = l.slice(9);
    else if (l === `branch refs/heads/${rama}`) return w;
  }
  return "";
}

/** Ruta de una línea porcelain: en un rename vale el destino, y las rutas con caracteres raros vienen entre comillas. */
export function rutaPorcelain(linea: string): string {
  let l = linea.slice(3);
  if (l.includes(" -> ")) l = l.slice(l.lastIndexOf(" -> ") + 4);
  return l.replace(/^"/, "").replace(/"$/, "");
}

const DIRS_BUILD = new Set(["target", "target-wt", "node_modules", ".venv", "dist", "__pycache__"]);

/**
 * `sucios_de`: las líneas de `git status --porcelain` que son trabajo. No cuentan los symlinks sueltos que apuntan FUERA del
 * repo (cache enlazada a mano) ni, dentro de un worktree de pa, los dirs de build sueltos.
 */
export function suciosDe(ruta: string, estado: string): string[] {
  const enPa = (restoDeRuta(process.platform, ruta, path.join(estado, "worktrees")) ?? "") !== "";
  const real = (() => {
    try {
      return realpathSync(ruta);
    } catch {
      return ruta;
    }
  })();
  return lineas(git(ruta, ["status", "--porcelain"]).out).filter((l) => {
    const p = rutaPorcelain(l);
    if (!l.startsWith("??")) return true;
    if (enPa && DIRS_BUILD.has(path.basename(p.replace(/\/$/, "")))) return false;
    try {
      const abs = path.join(ruta, p.replace(/\/$/, ""));
      if (lstatSync(abs).isSymbolicLink()) {
        const dest = realpathSync(abs);
        if (dest !== real && !dest.startsWith(real + path.sep)) return false;
      }
    } catch {
      // no existe o el symlink está roto: cuenta
    }
    return true;
  });
}

// --- el proyecto ---

export type Proy = { slug: string; ruta: string; nombre: string; dir: string };

const proyDe = (ctx: CtxPa, slug: string, ruta: string, nombre: string): Proy => ({ slug, ruta, nombre, dir: path.join(ctx.estado, slug) });

/** `usar_id`: el proyecto de una corrida por su id (la carpeta de estado donde está, o `integradas.tsv`). */
async function proyectoPorId(ctx: CtxPa, id: string): Promise<Proy | null> {
  const slug = await proyectoDeId(ctx.estado, id);
  if (!slug) return ctx.err(`pa: no encuentro la corrida '${id}' en ${ctx.estado}.\n`), null;
  const ruta = ctx.rutaDeSlug(slug);
  if (!ruta) return ctx.err(`pa: la corrida '${id}' es de '${slug}', y no encuentro ese proyecto en el registry.\n`), null;
  return proyDe(ctx, slug, ruta, slug);
}

function proyectoPorNombre(ctx: CtxPa, nombre: string): Proy | null {
  const r = resolver([nombre], ctx.env, ctx.plataforma, ctx.home);
  if (r.codigo !== 0) return ctx.err(r.err), null;
  const ruta = r.out.trim();
  return proyDe(ctx, slugDe(ruta), ruta, nombre);
}

// --- puestos y candados ---

const sufPuesto = (p: string | number) => (String(p) === "1" || String(p) === "" ? "" : `@${p}`);
const wtDePuesto = (ctx: CtxPa, p: Proy, k: string | number) => path.join(ctx.estado, "worktrees", p.slug + sufPuesto(k));
const lockDePuesto = (ctx: CtxPa, p: Proy, k: string | number) => path.join(ctx.estado, "lock", p.slug + sufPuesto(k));
const lockGit = (ctx: CtxPa, p: Proy) => path.join(ctx.estado, "lock", `${p.slug}@git`);
const puestosMax = (ctx: CtxPa) => enteroODefecto(ctx.env.PA_PUESTOS ?? "", 3) || 3;

/** El puesto de un worktree por su ruta: `worktrees/<slug>` → 1, `worktrees/<slug>@k` → k, otra → `aca` (tree principal / ajeno). */
export function puestoDeRuta(ctx: CtxPa, p: Proy, wt: string): string {
  const resto = restoDeRuta(ctx.plataforma, wt, caminos(ctx.plataforma).join(ctx.estado, "worktrees"));
  if (resto === null || /[\\/]/.test(resto)) return "aca";
  const slug = p.slug.toLowerCase(); // el slug va en minúscula; git/Windows pueden devolver la carpeta con otra capitalización
  const r = esWindows(ctx.plataforma) ? resto.toLowerCase() : resto;
  if (r === slug) return "1";
  return r.startsWith(slug + "@") ? resto.slice(slug.length + 1) : "aca";
}

async function puestoDeCorrida(ctx: CtxPa, p: Proy, corrida: string): Promise<string> {
  const pu = await leerCampo(corrida, "puesto");
  if (pu) return pu;
  return puestoDeRuta(ctx, p, await leerCampo(corrida, "ruta_trabajo"));
}

// --- integradas.tsv ---

const HEADER_INTEGRADAS = "fecha\tid\tproyecto\trama\trama_ppal\thead_antes\thead_despues\tcommits\tauto\taccion";
const pad = (n: number) => String(n).padStart(2, "0");

/** `date -Iseconds`. */
export function isoLocal(epochSeg: number, offsetSeg: number): string {
  const d = new Date((epochSeg + offsetSeg) * 1000);
  const s = Math.abs(offsetSeg);
  const z = `${offsetSeg < 0 ? "-" : "+"}${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${z}`;
}

export type Accion = "integrada" | "revertida" | "descartada";
export async function anotarIntegrada(
  ctx: CtxPa, id: string, slug: string, rama: string, ramaPpal: string, antes: string, despues: string, commits: number, accion: Accion,
): Promise<void> {
  if (accion === "integrada") await evento(ctx.estado, "integrar", id, slug, ctx.ahora());
  else if (accion === "revertida") await evento(ctx.estado, "revertir", id, slug, ctx.ahora());
  const ruta = path.join(ctx.estado, "integradas.tsv");
  const auto = ctx.env.PA_AUTO === "1" ? 1 : 0;
  try {
    await conCandado(`${ruta}.lock`, async () => {
      mkdirSync(ctx.estado, { recursive: true });
      const hay = (await leerTexto(ruta)) ?? "";
      const fila = [isoLocal(ctx.ahora(), ctx.offsetSeg()), id, slug, rama, ramaPpal, antes, despues, commits, auto, accion].join("\t");
      appendFileSync(ruta, (hay === "" ? HEADER_INTEGRADAS + "\n" : "") + fila + "\n");
    }, { espera: 10000 });
  } catch {
    ctx.err(`pa: OJO: no pude anotar ${id} en ${ruta}.\n`);
  }
}

async function filaIntegrada(ctx: CtxPa, id: string): Promise<string[] | null> {
  const t = (await leerTexto(path.join(ctx.estado, "integradas.tsv"))) ?? "";
  let f: string[] | null = null;
  for (const l of t.split("\n").slice(1)) if (l.split("\t")[1] === id) f = l.split("\t");
  return f;
}

/** Un `--integrar` que no encuentra la corrida o la rama: ¿ya está en `integradas.tsv`? true = ya integrada (no es error). */
async function yaResuelta(ctx: CtxPa, id: string): Promise<boolean> {
  const f = await filaIntegrada(ctx, id);
  if (!f) return false;
  switch (f[9]) {
    case "integrada": return ctx.out(`pa: ${id} ya integrada (¿desde la app?): ${f[3]} entró a ${f[4]} el ${f[0]}.\n`), true;
    case "revertida": ctx.err(`pa: ${id} se integró y después se revirtió (pa --revertir); no hay rama que integrar.\n`); break;
    case "descartada": ctx.err(`pa: ${id} se descartó; no hay rama que integrar.\n`); break;
  }
  return false;
}

// --- ramas sin integrar / solapamiento ---

/** Las corridas con rama propia que todavía tienen trabajo fuera del tree principal: `{id, rama, n, subject}`. */
export async function ramasSinIntegrar(dir: string): Promise<{ id: string; rama: string; n: number; subject: string }[]> {
  let nombres: string[] = [];
  try {
    nombres = readdirSync(dir).filter((f) => f.endsWith(".corrida")).sort();
  } catch {
    return [];
  }
  const r: { id: string; rama: string; n: number; subject: string }[] = [];
  for (const f of nombres) {
    const c = path.join(dir, f);
    if (await leerCampo(c, "origen")) continue;
    const rama = await leerCampo(c, "rama");
    const repo = await leerCampo(c, "ruta_trabajo");
    if (!rama || !repo || !existsSync(repo)) continue;
    if (!gitOk(repo, ["rev-parse", "-q", "--verify", `refs/heads/${rama}`])) continue;
    const n = commitsPendientes(repo, rama);
    if (n <= 0) continue;
    r.push({ id: f.slice(0, -".corrida".length), rama, n, subject: gitSal(repo, ["log", "-1", "--format=%s", rama]) });
  }
  return r;
}

/** Otras ramas sin integrar del mismo proyecto que tocan los mismos archivos. Sólo avisa, no frena. */
export async function solapamiento(ctx: CtxPa, p: Proy, propio: string, mios: string[], verbo: "toca" | "entró a main" = "toca"): Promise<void> {
  if (mios.length === 0) return;
  for (const o of await ramasSinIntegrar(p.dir)) {
    if (o.id === propio) continue;
    const b = git(p.ruta, ["merge-base", "HEAD", o.rama]);
    if (b.rc !== 0) continue;
    const suyos = new Set(lineas(gitSal(p.ruta, ["diff", "--name-only", b.out.trim(), o.rama])));
    const comun = mios.filter((m) => suyos.has(m)).slice(0, 5).join(" ");
    if (!comun) continue;
    ctx.out(verbo === "entró a main"
      ? `— ojo: la corrida ${o.id} (sin integrar) toca lo mismo que acaba de entrar (${comun}): al integrarla puede chocar; si da 80, pa '${p.nombre}' --actualizar ${o.id}.\n`
      : `— ojo: la corrida ${o.id} (sin integrar) también toca ${comun}: la que se integre segunda puede chocar.\n`);
  }
}

/** Symlinks que la rama agrega o modifica y que son peligrosos (destino absoluto, sale del repo, o pisaría un dir ignorado). */
function symlinksPeligrosos(ruta: string, base: string, rama: string): string[] {
  const out: string[] = [];
  for (const l of lineas(git(ruta, ["diff", "--raw", base, rama]).out)) {
    const [meta, p] = l.split("\t");
    if (!p) continue;
    const [, modo, , hash, status] = meta.split(/\s+/);
    if (modo !== "120000" || (status !== "A" && status !== "M")) continue;
    const destino = git(ruta, ["cat-file", "-p", hash]).out.replace(/\n$/, "");
    if (path.isAbsolute(destino) || destino.startsWith("/")) {
      out.push(`${p}: destino absoluto (${destino})`);
      continue;
    }
    const abs = path.resolve(ruta, path.dirname(p), destino);
    if (abs !== path.resolve(ruta) && !abs.startsWith(path.resolve(ruta) + path.sep)) {
      out.push(`${p}: sale del repo (${destino})`);
      continue;
    }
    const real = path.join(ruta, p);
    try {
      if (lstatSync(real).isDirectory() && gitOk(ruta, ["check-ignore", "-q", "--", p])) out.push(`${p}: pisaría un directorio gitignoreado del tree principal`);
    } catch {
      // no existe en el tree principal
    }
  }
  return out;
}

// --- vivo ---

const viveId = (ctx: CtxPa, pid: string) => /^\d+$/.test(pid.trim()) && ctx.existePid(Number(pid)) && !ctx.esZombi(Number(pid));

/** Viva = corriendo (su `.running`) o en cola (el pid de `<id>.pid` vive). */
export async function corridaViva(ctx: CtxPa, p: Proy, id: string): Promise<boolean> {
  if (await runningDeId(ctx, p.slug, id)) return true;
  const pid = ((await leerTexto(rutaDe(p.dir, id, "pid"))) ?? "").trim();
  return viveId(ctx, pid);
}

async function negarSiViva(ctx: CtxPa, p: Proy, id: string, verbo: string): Promise<number> {
  if (!(await corridaViva(ctx, p, id))) return 0;
  ctx.err(`pa: la corrida ${id} de '${p.slug}' sigue viva (corriendo o en cola); no la ${verbo} debajo de un worker. Paralo primero: pa --parar ${id}\n`);
  return 92;
}

// --- integrar ---

function asegurarWorktree(ctx: CtxPa, p: Proy, wt: string): boolean {
  if (existsSync(path.join(wt, ".git"))) return true;
  mkdirSync(path.dirname(wt), { recursive: true });
  git(p.ruta, ["worktree", "prune"]);
  if (gitOk(p.ruta, ["worktree", "add", "--detach", wt, "HEAD"])) return true;
  ctx.err(`pa: no pude crear el worktree en ${wt}.\n`);
  return false;
}

/** Lo que un puesto prestado tenga sin commitear (restos de otra corrida) se commitea como huérfano antes de cualquier checkout. */
function commitearHuerfano(ctx: CtxPa, p: Proy, wt: string, id: string): void {
  if (suciosDe(wt, ctx.estado).length === 0) return;
  let anterior = gitSal(wt, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (anterior === "HEAD") {
    anterior = `pa/${p.slug}/huerfano-${id}`;
    git(wt, ["checkout", "-qB", anterior]);
  }
  const fuera = [...DIRS_BUILD].map((d) => `:(exclude,glob)**/${d}`);
  git(wt, ["add", "-A", "--", ".", ...fuera]);
  if (git(wt, ["diff", "--cached", "--quiet"]).rc !== 0) {
    git(wt, ["commit", "-qm", `pa: huérfano de ${anterior}`]);
    ctx.err(`pa: el worktree ${path.basename(wt)} tenía trabajo huérfano; quedó commiteado en '${anterior}'.\n`);
  }
}

export async function integrarCorrida(ctx: CtxPa, p: Proy, t: string): Promise<number> {
  const c = rutaDe(p.dir, t, "corrida");
  if ((await leerTexto(c)) === null) {
    if (await yaResuelta(ctx, t)) return 0;
    return ctx.err(`pa: no hay corrida '${t}' de '${p.slug}' (falta ${c}).\n`), 1;
  }
  const r = await leerCampo(c, "rama");
  if (!r) return ctx.err(`pa: la corrida '${t}' corrió en el tree principal, no hay rama que integrar.\n`), 1;
  if (!gitOk(p.ruta, ["rev-parse", "-q", "--verify", `refs/heads/${r}`])) {
    rmSync(c, { force: true });
    if (await yaResuelta(ctx, t)) return 0;
    return ctx.err(`pa: la rama ${r} ya no existe (¿ya integrada o descartada?).\n`), 1;
  }
  const tomados: Candado[] = [];
  const soltarTodo = async () => {
    for (const k of tomados.splice(0).reverse()) await k.soltar();
  };
  try {
    const cg = await tomarCandado(lockGit(ctx, p), { espera: 60000 });
    if (!cg) return ctx.err(`pa: el candado de git de '${p.slug}' sigue ocupado después de 60s (otro --integrar/--descartar o un worker arrancando). Reintentá.\n`), 75;
    tomados.push(cg);
    // el tree principal se toma mientras dure: ningún --aca arranca a mitad del ff-only
    const ca = await tomarCandado(lockDePuesto(ctx, p, "aca"));
    if (!ca) return ctx.err(`pa: hay un worker --aca corriendo en el tree principal de '${p.slug}'; integrar le movería los archivos abajo. Esperalo y volvé a correr --integrar.\n`), 75;
    tomados.push(ca);
    // --- el puesto donde rebasear
    const wr = wtDeRama(p.ruta, r);
    let pu = "";
    let prestado = false;
    if (wr) {
      pu = puestoDeRuta(ctx, p, wr);
      if (pu === "aca") return ctx.err(`pa: la rama ${r} está checkouteada en ${wr}, fuera de los puestos de pa. No la toco: sacala de ahí (git -C '${wr}' checkout --detach) y volvé a correr --integrar.\n`), 1;
      const cp = await tomarCandado(lockDePuesto(ctx, p, pu));
      if (!cp) return ctx.err(`pa: la rama ${r} la está usando un worker en el puesto ${pu} (¿un --seguir o --actualizar?). Esperalo y volvé a correr --integrar.\n`), 75;
      tomados.push(cp);
    } else {
      const n = puestosMax(ctx);
      const orden = [await puestoDeCorrida(ctx, p, c), ...Array.from({ length: n }, (_, i) => String(i + 1))];
      for (const k of [...new Set(orden)]) {
        if (k === "aca") continue;
        const cp = await tomarCandado(lockDePuesto(ctx, p, k));
        if (cp) {
          tomados.push(cp);
          pu = k;
          break;
        }
      }
      if (!pu) return ctx.err(`pa: los ${n} puestos de '${p.slug}' están ocupados y --integrar necesita uno libre para rebasear. Esperá uno y volvé a correr.\n`), 75;
      prestado = true;
    }
    const wt = wtDePuesto(ctx, p, pu);
    if (!asegurarWorktree(ctx, p, wt)) return 1;

    const headPpal = gitSal(p.ruta, ["rev-parse", "HEAD"]);
    const ramaPpal = gitSal(p.ruta, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const mb = git(p.ruta, ["merge-base", headPpal, r]);
    if (mb.rc !== 0) return ctx.err(`pa: la rama ${r} no comparte historia con ${ramaPpal}. No la integro.\n`), 1;
    const b = mb.out.trim();
    const n = enteroODefecto(gitSal(p.ruta, ["rev-list", "--count", `${b}..${r}`]));
    if (n === 0) {
      const bc = await leerCampo(c, "base");
      if (bc && enteroODefecto(gitSal(p.ruta, ["rev-list", "--count", `${bc}..${r}`])) !== 0) {
        // tiene commits propios y están todos en main: alguien la integró a mano
        if (wr) git(wr, ["checkout", "-q", "--detach"]);
        await soltarTodo();
        await anotarIntegrada(ctx, t, p.slug, r, ramaPpal, headPpal, headPpal, 0, "integrada");
        if (gitOk(p.ruta, ["branch", "-q", "-d", r])) rmSync(c, { force: true });
        ctx.out(`pa: ${r} ya estaba entera en ${ramaPpal} de '${p.slug}'; no había nada que integrar.\n`);
        return 0;
      }
      return ctx.err(`pa: la rama ${r} no tiene commits; no hay nada que integrar. Tirala con: pa '${p.nombre}' --descartar ${t}\n`), 1;
    }
    // 0. lo que la corrida dejó sin commitear en su worktree (murió, o cortó sin commitear)
    const sucioWt = suciosDe(wt, ctx.estado);
    if (wr && sucioWt.length) {
      const lista = sucioWt.slice(0, 5).map((l) => rutaPorcelain(l) + " ").join("");
      ctx.err(`pa: NO integro: la corrida ${t} dejó trabajo SIN COMMITEAR en su worktree (${wt}): ${lista}\n`);
      ctx.err(`    Cerrala con: pa '${p.nombre}' --seguir --id ${t} 'commiteá lo que hiciste y reportá'  (o tirala: --descartar ${t}).\n`);
      return 86;
    }
    // 1. lo sin commitear del tree principal no puede cruzarse con lo que trae la rama
    const tocados = lineas(gitSal(p.ruta, ["diff", "--name-only", b, r]));
    const sucios = suciosDe(p.ruta, ctx.estado).map(rutaPorcelain);
    const choque = sucios.filter((s) => tocados.includes(s));
    if (choque.length) {
      ctx.err(`pa: NO integro: el tree principal de '${p.slug}' tiene sin commitear archivos que la rama ${r} toca:\n`);
      for (const x of choque) ctx.err(`    ${x}\n`);
      ctx.err("    Commitealos, movelos o tiralos, y volvé a correr --integrar. No fuerzo nada.\n");
      return 79;
    }
    // 1b. la rama no puede traer un symlink peligroso
    const peligrosos = symlinksPeligrosos(p.ruta, b, r);
    if (peligrosos.length) {
      ctx.err(`pa: NO integro: la rama ${r} trae symlink(s) peligrosos:\n`);
      for (const x of peligrosos) ctx.err(`    ${x}\n`);
      ctx.err("    Suelen ser cache de pa (node_modules/.venv/.env): sacalos de la rama y volvé a correr --integrar. No toqué nada.\n");
      return 83;
    }
    // 2. rebase adentro del puesto (es de pa; el tree principal no se toca)
    if (headPpal !== b) {
      if (prestado) commitearHuerfano(ctx, p, wt, t);
      if (!gitOk(wt, ["checkout", "-q", r])) return ctx.err(`pa: no pude entrar a ${r} en ${wt}.\n`), 1;
      if (!gitOk(wt, ["rebase", "-q", headPpal])) {
        git(wt, ["rebase", "--abort"]);
        if (prestado) git(wt, ["checkout", "-q", "--detach"]);
        ctx.err(`pa: el rebase de ${r} sobre ${ramaPpal} (${headPpal.slice(0, 7)}) tiene conflictos: otro cambio que ya entró toca lo mismo.\n`);
        ctx.err(`    Que lo resuelva un worker que entienda los dos cambios: pa '${p.nombre}' --actualizar ${t}   (y después --integrar ${t} de nuevo).\n`);
        return 80;
      }
    }
    // 3. ff-only en el tree principal, y la rama se va
    if (!gitOk(p.ruta, ["merge", "-q", "--ff-only", r])) {
      if (prestado) git(wt, ["checkout", "-q", "--detach"]);
      return ctx.err(`pa: el merge ff-only de ${r} en ${ramaPpal} falló (¿HEAD se movió mientras tanto?). Nada se tocó.\n`), 1;
    }
    git(wt, ["checkout", "-q", "--detach"]);
    if (wr && !mismaRuta(ctx.plataforma, wr, wt)) git(wr, ["checkout", "-q", "--detach"]);
    await soltarTodo();
    const headNuevo = gitSal(p.ruta, ["rev-parse", "HEAD"]);
    await anotarIntegrada(ctx, t, p.slug, r, ramaPpal, headPpal, headNuevo, n, "integrada");
    ctx.out(`pa: integrada ${r} en ${ramaPpal} de '${p.slug}' (${n} commit(s)).\n`);
    // -d y nunca -D: si se niega es que algo no quedó en el tree principal, y eso se avisa, no se fuerza
    if (gitOk(p.ruta, ["branch", "-q", "-d", r])) rmSync(c, { force: true });
    else ctx.err(`pa: OJO: \`git branch -d ${r}\` se negó a borrarla (¿quedó algo sin mergear?). No la forcé: git -C '${p.ruta}' log ${ramaPpal}..${r}\n`);
    const entraron = lineas(gitSal(p.ruta, ["diff", "--name-only", b, headPpal]));
    await solapamiento(ctx, p, t, [...entraron, ...tocados], "entró a main");
    return 0;
  } finally {
    await soltarTodo();
  }
}

// --- descartar ---

export async function descartarCorrida(ctx: CtxPa, p: Proy, t: string): Promise<number> {
  const c = rutaDe(p.dir, t, "corrida");
  if ((await leerTexto(c)) === null) return ctx.err(`pa: no hay corrida '${t}' de '${p.slug}'.\n`), 1;
  const r = await leerCampo(c, "rama");
  if (!r) return ctx.err(`pa: la corrida '${t}' no tiene rama.\n`), 1;
  const cg = await tomarCandado(lockGit(ctx, p), { espera: 60000 });
  if (!cg) return ctx.err(`pa: el candado de git de '${p.slug}' sigue ocupado después de 60s. Reintentá.\n`), 75;
  let cp: Candado | null = null;
  try {
    const wr = wtDeRama(p.ruta, r);
    if (wr) {
      const pu = puestoDeRuta(ctx, p, wr);
      if (pu === "aca") return ctx.err(`pa: la rama ${r} está checkouteada en ${wr}, fuera de los puestos de pa. No la toco.\n`), 1;
      cp = await tomarCandado(lockDePuesto(ctx, p, pu));
      if (!cp) return ctx.err(`pa: la rama ${r} la está usando un worker en el puesto ${pu}. Matalo o esperalo primero.\n`), 75;
      git(wr, ["checkout", "-q", "--detach"]);
      await cp.soltar();
      cp = null;
    }
    // la punta de la rama queda en integradas.tsv (head_despues): con eso se recupera si hizo falta
    const punta = gitSal(p.ruta, ["rev-parse", "-q", "--verify", `refs/heads/${r}`]);
    const pend = commitsPendientes(p.ruta, r);
    git(p.ruta, ["branch", "-q", "-D", r]);
    await cg.soltar();
    rmSync(c, { force: true });
    if (punta) {
      await anotarIntegrada(ctx, t, p.slug, r, gitSal(p.ruta, ["rev-parse", "--abbrev-ref", "HEAD"]), gitSal(p.ruta, ["rev-parse", "HEAD"]), punta, pend, "descartada");
    }
    await evento(ctx.estado, "descartar", t, p.slug, ctx.ahora());
    ctx.out(`pa: descartada ${r} de '${p.slug}'.\n`);
    return 0;
  } finally {
    await cp?.soltar();
    await cg.soltar();
  }
}

// --- comandos ---

/** `pa --descartar <id>` (sin proyecto): se niega (92) con el worker vivo. */
export async function cmdDescartar(ctx: CtxPa, args: string[]): Promise<number> {
  const t = args[0] ?? "";
  if (!t) return ctx.err("uso: pa --descartar <id-de-corrida>   (o pa <proyecto> --descartar <id>)\n"), 2;
  const p = await proyectoPorId(ctx, t);
  if (!p) return 1;
  const v = await negarSiViva(ctx, p, t, "descarto");
  return v || descartarCorrida(ctx, p, t);
}

/** `pa --archivar <id>`: la saca de la vista de la app (`archivado=<fecha>` en el `.hilo`). No toca `.listo`/`.entregado`. */
export async function cmdArchivar(ctx: CtxPa, args: string[]): Promise<number> {
  const t = args[0] ?? "";
  if (!t) return ctx.err("uso: pa --archivar <id-de-corrida>\n"), 2;
  const p = await proyectoPorId(ctx, t);
  if (!p) return 1;
  const v = await negarSiViva(ctx, p, t, "archivo");
  if (v) return v;
  mkdirSync(p.dir, { recursive: true });
  await hiloPoner(rutaDe(p.dir, t, "hilo"), "archivado", isoLocal(ctx.ahora(), ctx.offsetSeg()));
  await evento(ctx.estado, "archivar", t, p.slug, ctx.ahora());
  ctx.out(`pa: corrida ${t} de '${p.slug}' archivada.\n`);
  return 0;
}

/** `pa --integrar <id>` (el proyecto sale de la corrida) o `pa <proyecto> --integrar <id>`. */
export async function cmdIntegrar(ctx: CtxPa, args: string[], proyecto?: string): Promise<number> {
  const t = args[0] ?? "";
  if (!t) return ctx.err("uso: pa <proyecto> --integrar <id-de-corrida>\n"), 2;
  const p = proyecto ? proyectoPorNombre(ctx, proyecto) : await proyectoPorId(ctx, t);
  if (!p) return 1;
  mkdirSync(p.dir, { recursive: true });
  return integrarCorrida(ctx, p, t);
}

/** Los `pa <proyecto> --integrar|--descartar <id>`: los despacha pa.ts antes de lanzar un worker. */
export async function gestionDeProyecto(ctx: CtxPa, o: OpcionesProyecto): Promise<number | null> {
  if (!o.integrar && !o.descartar) return null;
  if (o.integrar && o.tests) return ctx.err("pa: --integrar --tests todavía no está en el pa de TypeScript. Integrá sin --tests y corré los tests a mano.\n"), 2;
  const p = proyectoPorNombre(ctx, o.proyecto);
  if (!p) return 1;
  mkdirSync(p.dir, { recursive: true });
  return o.integrar ? integrarCorrida(ctx, p, o.integrar) : descartarCorrida(ctx, p, o.descartar);
}

export { anotarFin, escribirAtomico, readFileSync, readlinkSync };
