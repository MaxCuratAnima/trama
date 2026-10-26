// `pa --esperar <proyecto>` y `pa --esperar-todos`: entregan (y marcan `.entregado`) el resultado de una corrida async que
// lanzó este jefe. Port de `cmd_esperar`, `cmd_esperar_todos`, `mostrar_resultado`, `stats_resultado`, `linea_rama` y
// `claude_falla` de `motor/bin/pa`. Falta el aviso de solapamiento de `linea_rama` (`solapamiento`, que depende de
// `ramas_sin_integrar`, todavía sin portar). Los `exit N` del bash son `Salida(N)`; los códigos son los mismos.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { esWindows, deStat } from "../procesos.ts";
import type { CtxPa } from "./contexto.ts";
import { campoDe, slugDe } from "./estado-archivos.ts";
import { resolver } from "./proyecto-ruta.ts";

/** Corrida ya entregada por otra espera, dentro de `--esperar-todos` (interno: nunca sale de pa). */
const OTRA_ESPERA = 94;
const DIA_SEG = 86400;
const CLAUDE_ARREGLO = "node ~/.local/lib/node_modules/@anthropic-ai/claude-code/install.cjs";

/** `exit N` del bash: corta la espera con ese código. */
class Salida extends Error {
  rc: number;
  constructor(rc: number) {
    super(`salida ${rc}`);
    this.rc = rc;
  }
}

type Opciones = { id: string; timeout: number; todos: boolean };

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const leerOpt = (ruta: string): string | null => {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    return null;
  }
};
const campo = (ruta: string, c: string): string => {
  const t = leerOpt(ruta);
  return t === null ? "" : campoDe(t, c);
};
const listar = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
const esDir = (ruta: string): boolean => {
  try {
    return statSync(ruta).isDirectory();
  } catch {
    return false;
  }
};
const listarDirs = (dir: string): string[] => listar(dir).filter((n) => esDir(path.join(dir, n)));

/** `find <f> -mmin +1440`: el resultado tiene más de un día. */
const vencido = (ctx: CtxPa, ruta: string): boolean => {
  try {
    return ctx.ahora() - Math.floor(statSync(ruta).mtimeMs / 1000) > DIA_SEG;
  } catch {
    return false;
  }
};

/** `pid_vivo` + `kill -0`: el `pid=` de la corrida (o el `pa_pid=`) existe. */
const vivo = (ctx: CtxPa, ruta: string): boolean => {
  const p = campo(ruta, "pid") || campo(ruta, "pa_pid");
  return p !== "" && ctx.existePid(Number(p));
};

/** `jefe_id=` de la corrida, o el de su `.jefe` (que escribe el padre de --async antes del fork). */
const jefeDe = (d: string, t: string): string => campo(path.join(d, `${t}.corrida`), "jefe_id") || campo(path.join(d, `${t}.jefe`), "jefe_id");

/** ¿La corrida es de este jefe? Sin jefe (o sin jefe_id en la corrida) no se filtra. */
const esMia = (d: string, t: string, yo: string): boolean => {
  if (!yo) return true;
  const j = jefeDe(d, t);
  return !j || j === yo;
};

/**
 * `jefe_id` de esta sesión: `PA_JEFE_ID`, o `PA_JEFE`, o el `sessionId` del `~/.claude/sessions/<pid>.json` del
 * ancestro más cercano. Fuera de Linux no hay árbol de procesos por /proc: sale "" y no filtra.
 */
export function jefeId(ctx: CtxPa): string {
  if (ctx.env.PA_JEFE_ID !== undefined) return ctx.env.PA_JEFE_ID;
  if (ctx.env.PA_JEFE !== undefined) return ctx.env.PA_JEFE;
  if (esWindows(ctx.plataforma)) return "";
  let p = process.ppid;
  while (p > 1) {
    const f = path.join(ctx.home, ".claude", "sessions", `${p}.json`);
    if (existsSync(f)) {
      try {
        const sid = JSON.parse(readFileSync(f, "utf8")).sessionId;
        return typeof sid === "string" ? sid : "";
      } catch {
        return "";
      }
    }
    try {
      p = deStat(readFileSync(`/proc/${p}/stat`, "utf8")).ppid ?? 0;
    } catch {
      return "";
    }
  }
  return "";
}

/** `<slug>.running` (y `<slug>@<puesto>.running`) o, con `leer`, los `<slug>.leer-<id>.running` de las consultas --leer. */
function runningDe(ctx: CtxPa, slug: string, leer: boolean): string[] {
  return listar(ctx.estado)
    .filter((n) => {
      if (!n.endsWith(".running")) return false;
      if (leer) return n.startsWith(`${slug}.leer-`);
      return n === `${slug}.running` || n.startsWith(`${slug}@`);
    })
    .map((n) => path.join(ctx.estado, n));
}

/** `compgen`: el proyecto ya corrió algo (lock, o una consulta --leer con su marca `.leer`). */
function yaCorrio(ctx: CtxPa, slug: string): boolean {
  const lock = path.join(ctx.estado, "lock");
  return (
    existsSync(path.join(lock, slug)) ||
    listar(lock).some((n) => n.startsWith(`${slug}@`)) ||
    listar(path.join(ctx.estado, slug)).some((n) => n.endsWith(".leer"))
  );
}

function gitOut(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 15000 });
  } catch {
    return null;
  }
}

/** `tree_principal`: la primera entrada de `git worktree list`. */
function treePrincipal(repo: string): string {
  const l0 = (gitOut(repo, ["worktree", "list", "--porcelain"]) ?? "").split("\n")[0] ?? "";
  return l0.startsWith("worktree ") ? l0.slice("worktree ".length) : "";
}

/** `claude_falla`: 84 = claude no está en el PATH; cualquier otro (81) = la instalación está rota. */
function claudeFalla(ctx: CtxPa, rc: string): void {
  if (rc === "84") {
    const conocido = ctx.env.CLAUDE_CONOCIDO || path.join(ctx.home, ".local", "bin", "claude");
    ctx.err(`pa: claude no está en el PATH de este proceso (PATH=${ctx.env.PATH ?? ""}). No está roto: existe en ${conocido}.\n`);
    ctx.err(`pa: agregá ${path.dirname(conocido)} al PATH del servicio/timer/cron que llama a pa. NO hace falta reinstalar claude.\n`);
    return;
  }
  ctx.err("pa: la instalación de claude está ROTA. No es un fallo del worker ni del proyecto.\n");
  ctx.err('pa: si fue un auto-update ("native binary not installed"), se arregla con:\n');
  ctx.err(`    ${CLAUDE_ARREGLO}\n`);
  ctx.err("pa: no relances workers hasta que `claude --version` ande.\n");
}

/** `transcript_de`: el `.jsonl` de la sesión del worker, buscado en cada carpeta de proyecto. */
function transcriptDe(ctx: CtxPa, sesion: Record<string, unknown>): string {
  const sid = typeof sesion.session_id === "string" ? sesion.session_id : "";
  if (!sid) return "";
  for (const p of listarDirs(ctx.proyectos)) {
    const f = path.join(ctx.proyectos, p, `${sid}.jsonl`);
    if (existsSync(f)) return f;
  }
  return "";
}

/** `contar_compactaciones`: líneas del transcript con el marcador de compactación. */
function compactaciones(f: string): number {
  if (!f) return 0;
  const t = leerOpt(f);
  if (t === null) return 0;
  return t.split("\n").filter((l) => l.includes('"subtype":"compact_boundary"')).length;
}

/** `linea_rama`: qué pasó con la rama de la corrida (si el `.corrida` dice dónde está) y cómo integrarla. */
function lineaRama(ctx: CtxPa, json: string): void {
  const c = json.replace(/\.json$/, ".corrida");
  if (!existsSync(c)) return;
  const r = campo(c, "rama");
  const bc = campo(c, "base");
  const repo = campo(c, "ruta_trabajo");
  if (!r || !esDir(repo)) return;
  if (gitOut(repo, ["rev-parse", "-q", "--verify", `refs/heads/${r}`]) === null) return;
  const ppal = treePrincipal(repo) || repo;
  // la base real es el merge-base con el HEAD (una rama rebaseada no sale de `base=`)
  const mb = gitOut(ppal, ["merge-base", "HEAD", r]);
  const b = mb === null ? bc : mb.trim();
  const n = Number((gitOut(repo, ["rev-list", "--count", `${b}..${r}`]) ?? "0").trim());
  const t = campo(c, "origen") || path.basename(json, ".json");
  const p = campo(c, "proyecto") || path.basename(path.dirname(json));
  if (n === 0) {
    const sinIntegrar = bc && (gitOut(repo, ["rev-list", "--count", `${bc}..${r}`]) ?? "").trim() !== "0";
    if (sinIntegrar) ctx.out(`— rama ${r}: sus commits ya están todos en el tree principal. Nada que integrar.\n`);
    else ctx.out(`— rama ${r} sin commits: no cambió nada. Se tira con: pa '${p}' --descartar ${t}\n`);
    return;
  }
  ctx.out(`— rama ${r}: ${n} commit(s) sobre ${b.slice(0, 7)}. NO está en main hasta que la integres: pa '${p}' --integrar ${t}\n`);
}

/** `mostrar_resultado`: el texto del worker, la línea de stats y la rama. Sin JSON legible sólo sale la rama. */
function mostrarResultado(ctx: CtxPa, json: string): void {
  const t = leerOpt(json);
  let sesion: Record<string, unknown> | null = null;
  try {
    sesion = t === null ? null : (JSON.parse(t) as Record<string, unknown>);
  } catch {
    sesion = null;
  }
  if (sesion) {
    const res = sesion.result;
    const texto = typeof res === "string" ? res : res === undefined || res === null || res === false ? "(sin resultado)" : JSON.stringify(res, null, 2);
    ctx.out(`${texto}\n`);
    const cost = Math.round(Number(sesion.total_cost_usd ?? 0) * 10000) / 10000;
    const seg = Math.floor(Number(sesion.duration_ms ?? 0) / 1000);
    const comp = compactaciones(transcriptDe(ctx, sesion));
    const extra = comp > 0 ? ` · ${comp} compactación(es)` : "";
    ctx.out(`— ${sesion.num_turns ?? 0} turnos · ${seg}s · US$${cost}${extra}\n`);
    if (extra) ctx.out("  (compactó: la tarea no entró en un contexto. Partila en varias la próxima; un worker que compactó ya no sabe bien qué tocó él.)\n");
  }
  lineaRama(ctx, json);
}

/** `pa --esperar <proyecto> [--timeout N] [--id <corrida>]`. Sale con el rc del worker, o 1/2/75/82 como el bash. */
export async function esperar(ctx: CtxPa, args: string[]): Promise<number> {
  const proy = args[0] ?? "";
  let timeout = 0;
  let id = "";
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--timeout") {
      timeout = Number(args[i + 1] ?? 0) || 0;
      i++;
    } else if (a === "--id") {
      id = args[i + 1] ?? "";
      i++;
    } else {
      ctx.err(`pa --esperar: opción desconocida: ${a}\n`);
      return 2;
    }
  }
  if (!proy) {
    ctx.err("uso: pa --esperar <proyecto> [--timeout SEGUNDOS] [--id <id-de-corrida>]\n");
    return 2;
  }
  return correr(() => esperarProyecto(ctx, proy, { id, timeout, todos: false }));
}

/** `pa --esperar-todos [--timeout N]`: cobra TODAS las corridas async vivas o sin cobrar de este jefe, de todos los proyectos. */
export async function esperarTodos(ctx: CtxPa, args: string[]): Promise<number> {
  let timeout = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--timeout") {
      ctx.err(`pa --esperar-todos: opción desconocida: ${args[i]}\n`);
      return 2;
    }
    timeout = Number(args[i + 1] ?? 0) || 0;
    i++;
  }
  const yo = jefeId(ctx);
  const fin = timeout > 0 ? ctx.ahora() + timeout : 0;
  const cola: { slug: string; id: string }[] = [];
  for (const slug of listarDirs(ctx.estado).sort()) {
    if (slug === "lock" || slug === "worktrees") continue;
    const d = path.join(ctx.estado, slug);
    for (const n of listar(d).sort()) {
      if (!n.endsWith(".pid")) continue;
      const t = n.slice(0, -4);
      if (existsSync(path.join(d, `${t}.entregado`))) continue;
      const listo = path.join(d, `${t}.listo`);
      if (existsSync(listo)) {
        if (vencido(ctx, listo)) continue;
      } else if (!ctx.existePid(Number((leerOpt(path.join(d, n)) ?? "").trim()))) {
        continue; // ni resultado ni vivo
      }
      if (yo) {
        const j = jefeDe(d, t);
        if (j && j !== yo) continue;
      }
      cola.push({ slug, id: t });
    }
  }
  if (!cola.length) {
    ctx.err("pa: nada pendiente tuyo (ninguna corrida async viva ni sin cobrar).\n");
    return 1;
  }
  ctx.err(`pa: esperando ${cola.length} corrida(s)…\n`);
  let n = 0;
  let otras = 0;
  let rc = 0;
  for (const { slug, id } of cola) {
    const resto = fin ? Math.max(1, fin - ctx.ahora()) : 0;
    // El stdout de cada espera se junta y sale con su encabezado; el stderr va directo, como en el bash.
    let sal = "";
    const hijo: CtxPa = { ...ctx, out: (s) => void (sal += s) };
    const rc1 = await correr(() => esperarProyecto(hijo, slug, { id, timeout: resto, todos: true }));
    if (rc1 === OTRA_ESPERA) {
      otras++;
      continue;
    }
    n++;
    ctx.out(`\n══ ${slug} (corrida ${id}) ══\n`);
    const limpia = sal.replace(/\n+$/, "");
    if (limpia) ctx.out(`${limpia}\n`);
    if (rc === 0 && rc1 !== 0) rc = rc1;
  }
  ctx.out(`\n— ${n} corrida(s) cobradas${otras ? ` (${otras} ya las había entregado otra espera)` : ""} · rc=${rc}\n`);
  return rc;
}

/** Corre una espera y traduce sus `Salida` a código de retorno. */
async function correr(f: () => Promise<number>): Promise<number> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof Salida) return e.rc;
    throw e;
  }
}

async function esperarProyecto(ctx: CtxPa, proy: string, op: Opciones): Promise<number> {
  // El slug es el basename de la ruta REAL y no siempre es un nombre del registry ("Tab Reaper" vive en
  // chrome-tab-reaper). Si ya corrió algo con ese nombre, es ése, sin pasar por el registry.
  let slug = proy.toLowerCase().replace(/[^A-Za-z0-9._-]/g, "-");
  if (!yaCorrio(ctx, slug)) {
    const r = resolver([proy], ctx.env, ctx.plataforma, ctx.home);
    if (r.codigo !== 0) {
      ctx.err(r.err);
      throw new Salida(1);
    }
    slug = slugDe(r.out.trim());
  }
  if (!yaCorrio(ctx, slug)) {
    ctx.err(`pa: nunca corrió un worker en '${slug}'.\n`);
    throw new Salida(1);
  }

  // Cada corrida deja su `<ts>.listo`; acá se entrega el más viejo sin cobrar, renombrándolo a `.entregado`. Un
  // `.listo` de más de un día se saltea (se avisa). `--esperar <proy>` pelado sólo entrega lo del que escribe: las
  // corridas --leer (marca `.leer`) se cobran con `--id`. Y sólo lo de SU jefe (`jefe_id=`).
  const d = path.join(ctx.estado, slug);
  const yo = jefeId(ctx);
  const { id, todos, timeout } = op;
  const fin = timeout > 0 ? ctx.ahora() + timeout : 0;
  let vencidos = 0;

  // El más viejo sin cobrar; con --id, ése listo. Devuelve la ruta del `.listo` o "".
  const pendiente = (): string => {
    if (id) return existsSync(path.join(d, `${id}.listo`)) ? path.join(d, `${id}.listo`) : "";
    vencidos = 0;
    for (const n of listar(d).sort()) {
      if (!n.endsWith(".listo")) continue;
      const t = n.slice(0, -".listo".length);
      if (existsSync(path.join(d, `${t}.leer`))) continue;
      if (!esMia(d, t, yo)) continue;
      if (vencido(ctx, path.join(d, n))) {
        vencidos++;
        continue;
      }
      return path.join(d, n);
    }
    return "";
  };
  const avisoVencidos = () => {
    if (vencidos <= 0) return;
    ctx.err(`pa: (salteé ${vencidos} resultado(s) de '${slug}' de más de un día; están en ${d}, traelos con --esperar --id <corrida> si los querés)\n`);
    vencidos = 0;
  };
  // Ya la entregó otra espera. Dentro de `--esperar-todos` sale OTRA_ESPERA para saltearla sin contarla como fallo.
  const yaEntregada = (t: string): never => {
    ctx.err(`pa: la corrida ${t} de '${slug}' ya se entregó (${d}/${t}.entregado): la cobró otra espera, no la entrego de nuevo.\n`);
    throw new Salida(todos ? OTRA_ESPERA : 1);
  };
  const entregar = (listo: string): number => {
    // El rename es el que decide quién la entrega: con dos esperas sobre el mismo `.listo`, la que pierde no muestra nada.
    let f = listo;
    let e = f.replace(/\.listo$/, ".entregado");
    for (;;) {
      try {
        renameSync(f, e);
        break;
      } catch (err) {
        if (existsSync(f)) throw err; // falló por otra cosa, no por carrera
        if (id) yaEntregada(id);
        // sin --id: el más viejo se lo llevó otra espera; va el que sigue, si hay
        f = pendiente();
        if (!f) {
          ctx.err(`pa: nada pendiente en '${slug}': el resultado que había se lo llevó otra espera.\n`);
          throw new Salida(1);
        }
        e = f.replace(/\.listo$/, ".entregado");
      }
    }
    const rc = campo(e, "rc") || "0";
    const salida = campo(e, "salida");
    if (salida && existsSync(salida)) mostrarResultado(ctx, salida);
    if (rc === "81" || rc === "84") claudeFalla(ctx, rc);
    // el id va visible: si este resultado ya te había llegado por mensaje, acá se nota
    ctx.out(`— corrida ${path.basename(f).slice(0, -".listo".length)} · rc=${rc}\n`);
    return Number(rc) || 0;
  };

  pendiente();
  avisoVencidos();
  if (id) {
    if (existsSync(path.join(d, `${id}.entregado`))) yaEntregada(id);
    if (!["log", "corrida", "puesto"].some((x) => existsSync(path.join(d, `${id}.${x}`)))) {
      ctx.err(`pa: no existe la corrida ${id} de '${slug}' (sin ${d}/${id}.log).\n`);
      throw new Salida(1);
    }
  }

  // Las corridas --leer que el pelado no entrega: se avisan, con el comando para cobrarlas.
  const notaLeer = () => {
    const ids: string[] = [];
    for (const n of listar(d).sort()) {
      if (n.endsWith(".listo") && existsSync(path.join(d, `${n.slice(0, -".listo".length)}.leer`))) {
        ids.push(`${n.slice(0, -".listo".length)} (terminada)`);
      }
    }
    for (const r of runningDe(ctx, slug, true)) if (vivo(ctx, r)) ids.push(`${campo(r, "id")} (corriendo)`);
    if (!ids.length) return;
    ctx.err(`pa: '${slug}' tiene ${ids.length} corrida(s) --leer que \`--esperar\` sin --id no entrega (es del que escribe):\n`);
    for (const x of ids) {
      const sp = x.indexOf(" ");
      ctx.err(`    pa --esperar '${proy}' --id ${x.slice(0, sp)}   # ${x.slice(sp + 1)}\n`);
    }
  };
  // Viva = su `.pid` (en cola o corriendo) vive, o hay un `.running` vivo con ese id.
  const corridaViva = (t: string): boolean => {
    const p = path.join(d, `${t}.pid`);
    const pid = existsSync(p) ? (leerOpt(p) ?? "").trim() : "";
    if (pid && ctx.existePid(Number(pid))) return true;
    return [...runningDe(ctx, slug, false), ...runningDe(ctx, slug, true)].some((r) => campo(r, "id") === t && vivo(ctx, r));
  };
  // Writers de MI jefe que siguen vivos (corriendo o en cola). Es lo que el pelado espera.
  const hayWritersMios = (): boolean => {
    for (const r of runningDe(ctx, slug, false)) {
      if (!vivo(ctx, r)) continue;
      const t = campo(r, "id");
      if (yo) {
        const j = campo(r, "jefe_id") || jefeDe(d, t);
        if (j && j !== yo) continue;
      }
      return true;
    }
    for (const n of listar(d)) {
      if (!n.endsWith(".pid")) continue;
      const t = n.slice(0, -4);
      if (existsSync(path.join(d, `${t}.leer`)) || existsSync(path.join(d, `${t}.listo`)) || existsSync(path.join(d, `${t}.entregado`))) continue;
      if (!ctx.existePid(Number((leerOpt(path.join(d, n)) ?? "").trim()))) continue;
      if (!esMia(d, t, yo)) continue;
      return true;
    }
    return false;
  };

  if (id) {
    for (;;) {
      const f = pendiente();
      if (f) return entregar(f);
      if (!corridaViva(id)) {
        await dormir(200);
        const g = pendiente();
        if (g) return entregar(g); // alcanzó a terminar entre el chequeo y acá
        // Terminó y otra espera se llevó el `.listo` mientras ésta esperaba.
        if (existsSync(path.join(d, `${id}.entregado`))) yaEntregada(id);
        if (existsSync(path.join(d, `${id}.pid`))) {
          if (existsSync(path.join(d, `${id}.leer`))) {
            ctx.err(`pa: la corrida --leer ${id} de '${slug}' murió sin dejar resultado (el proceso ya no vive). Mirá ${d}/${id}.log.\n`);
          } else if (existsSync(path.join(d, `${id}.puesto`)) || existsSync(path.join(d, `${id}.corrida`))) {
            ctx.err(`pa: la corrida ${id} de '${slug}' murió corriendo (ya había tomado puesto) sin dejar resultado. Mirá ${d}/${id}.log.\n`);
          } else {
            ctx.err(`pa: la corrida ${id} de '${slug}' murió en cola (el proceso ya no vive) sin dejar resultado. Mirá ${d}/${id}.log.\n`);
          }
          throw new Salida(82);
        }
        // sin .pid: corrió en primer plano (su resultado salió por stdout, no deja .listo)
        ctx.err(`pa: la corrida ${id} de '${slug}' no dejó resultado para entregar (¿corrió en primer plano? mirá ${d}/${id}.json).\n`);
        throw new Salida(1);
      }
      if (fin > 0 && ctx.ahora() >= fin) {
        ctx.err(`pa: la corrida ${id} de '${slug}' sigue trabajando después de ${timeout}s.\n`);
        throw new Salida(75);
      }
      await dormir(500);
    }
  }

  for (;;) {
    const f = pendiente();
    if (f) return entregar(f);
    if (!hayWritersMios()) {
      await dormir(500);
      const g = pendiente();
      if (g) return entregar(g);
      ctx.err(`pa: nada pendiente en '${slug}': ni worker tuyo corriendo ni resultado tuyo sin entregar.\n`);
      avisoVencidos();
      notaLeer();
      throw new Salida(1);
    }
    if (fin > 0 && ctx.ahora() >= fin) {
      ctx.err(`pa: '${slug}' sigue trabajando después de ${timeout}s.\n`);
      throw new Salida(75);
    }
    await dormir(500);
  }
}
