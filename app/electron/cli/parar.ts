// `pa --parar <id>`: baja ESA corrida, esté corriendo (su `.running`) o en cola (el `pa` hijo de --async que espera puesto).
// Port de `cmd_parar` + `matar_run` + `matar_arbol` de `motor/bin/pa`. El matado va por `DepsParar`: los tests lo reemplazan;
// el real usa `/proc` en Linux y `procesos.matarArbol` (taskkill /T) en Windows.
import { readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { deStat, esWindows, matarArbol as matarArbolDe } from "../procesos.ts";
import type { CtxPa } from "./contexto.ts";
import { anotarFin, evento, leerCampo, proyectoDeId, rutaDe, leerTexto } from "./estado-archivos.ts";

export type DepsParar = {
  /** TERM a todo el árbol de los pids (más lo que lleve el sid), KILL a los 5 s. Devuelve los que quedaron vivos. */
  matar: (sid: string, paciente: string, pids: number[]) => Promise<number[]>;
};

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const esperar = async (cond: () => boolean, ms: number) => {
  for (let t = 0; t < ms && !cond(); t += 100) await dormir(100);
};

type Proc = { pid: number; ppid: number; args: string[] };

/** Los procesos de Linux: pid, ppid y argv (de `/proc/<pid>/stat` y `cmdline`). */
function procesosLinux(): Proc[] {
  const out: Proc[] = [];
  for (const n of readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(n)) continue;
    try {
      const ppid = deStat(readFileSync(`/proc/${n}/stat`, "utf8")).ppid;
      let args: string[] = [];
      try {
        args = readFileSync(`/proc/${n}/cmdline`, "utf8").split("\0");
      } catch {
        // se fue o no es nuestro
      }
      out.push({ pid: Number(n), ppid: ppid ?? 0, args });
    } catch {
      // se fue
    }
  }
  return out;
}

/** Los `claude -p` de UNA conversación (no un `--resume` interactivo del dueño): se mira argumento por argumento. */
const delSid = (procs: Proc[], sid: string): number[] =>
  sid
    ? procs
        .filter((p) => p.args.some((a, i) => (a === "--session-id" || a === "--resume") && p.args[i + 1] === sid) && p.args.some((a) => a === "-p" || a === "--print"))
        .map((p) => p.pid)
    : [];

function arbolDe(procs: Proc[], raices: number[]): number[] {
  const out: number[] = [];
  const cola = raices.filter((p) => p > 0);
  while (cola.length) {
    const p = cola.shift() as number;
    if (out.includes(p)) continue;
    out.push(p);
    for (const h of procs) if (h.ppid === p) cola.push(h.pid);
  }
  return out;
}

export function depsPararReales(ctx: CtxPa): DepsParar {
  const vive = (p: number) => ctx.existePid(p) && !ctx.esZombi(p);
  const senal = (pids: number[], s: NodeJS.Signals) => {
    for (const p of pids) {
      try {
        process.kill(p, s);
      } catch {
        // ya no está
      }
    }
  };
  return {
    matar: async (sid, paciente, pids) => {
      if (esWindows(ctx.plataforma)) {
        const todos = pids.filter((p) => p > 0);
        for (const p of todos) matarArbolDe(p, false);
        await esperar(() => !todos.some(vive), 5000);
        for (const p of todos.filter(vive)) matarArbolDe(p, true);
        await esperar(() => !todos.some(vive), 2000);
        return todos.filter(vive);
      }
      const antes = procesosLinux();
      const todos = [...new Set([...arbolDe(antes, pids), ...delSid(antes, sid)])];
      if (!todos.length) return [];
      senal(todos, "SIGTERM");
      senal(todos, "SIGCONT"); // uno parado no atiende el TERM
      // lo que alcanzó a nacer entre la lectura y el TERM: sólo a los NUEVOS (un segundo TERM al pa lo mataba sin su trap)
      const ahora = procesosLinux();
      const nuevos = [...arbolDe(ahora, todos.filter(vive)), ...delSid(ahora, sid)].filter((p) => !todos.includes(p));
      senal(nuevos, "SIGTERM");
      todos.push(...nuevos);
      const pac = Number(paciente) || 0;
      const otros = todos.filter((p) => p !== pac);
      await esperar(() => !otros.some(vive), 5000);
      senal(otros.filter(vive), "SIGKILL");
      if (pac) {
        await esperar(() => !vive(pac), 3000);
        if (vive(pac)) senal([pac], "SIGKILL");
      }
      const fin = () => [...new Set([...todos, ...delSid(procesosLinux(), sid)])].filter(vive);
      await esperar(() => fin().length === 0, 1000);
      return fin().sort((a, b) => a - b);
    },
  };
}

/** El `.running` vivo de una corrida (writer en cualquier puesto, o `--leer`), o `null`. */
export async function runningDeId(ctx: CtxPa, slug: string, id: string): Promise<string | null> {
  let nombres: string[] = [];
  try {
    nombres = readdirSync(ctx.estado);
  } catch {
    // sin estado
  }
  const candidatos = [
    path.join(ctx.estado, `${slug}.running`),
    ...nombres.filter((n) => n.startsWith(`${slug}@`) && n.endsWith(".running")).sort().map((n) => path.join(ctx.estado, n)),
    path.join(ctx.estado, `${slug}.leer-${id}.running`),
  ];
  for (const r of candidatos) {
    if ((await leerCampo(r, "id")) !== id) continue;
    const pid = (await leerCampo(r, "pid")) || (await leerCampo(r, "pa_pid"));
    if (pid && ctx.existePid(Number(pid))) return r;
  }
  return null;
}

async function matarRun(ctx: CtxPa, d: DepsParar, run: string): Promise<number> {
  const slug = await leerCampo(run, "proyecto");
  const pid = await leerCampo(run, "pid");
  const paPid = await leerCampo(run, "pa_pid");
  const sid = await leerCampo(run, "sid");
  const id = await leerCampo(run, "id");
  const que = (await leerCampo(run, "leer")) === "1" ? `worker --leer ${id}` : "worker";
  const quedan = await d.matar(sid, paPid, [paPid, pid].map(Number).filter((n) => n > 0));
  if (quedan.length === 0) {
    await anotarFin(path.join(ctx.estado, slug), id, ctx.ahora());
    const base = run.replace(/\.running$/, "");
    for (const f of [run, `${base}.heartbeat`, `${base}.heartbeat.turnos`]) await rm(f, { force: true });
    ctx.out(`pa: ${que} de '${slug}' matado (claude ${pid} y su árbol).\n`);
    return 0;
  }
  ctx.err(`pa: NO pude bajar el ${que} de '${slug}': siguen vivos ${quedan.join(" ")}.\n`);
  return 85;
}

export async function cmdParar(ctx: CtxPa, args: string[], d: DepsParar = depsPararReales(ctx)): Promise<number> {
  const t = args[0] ?? "";
  if (!t) return ctx.err("uso: pa --parar <id-de-corrida>\n"), 2;
  const slug = await proyectoDeId(ctx.estado, t);
  if (!slug) return ctx.err(`pa: no encuentro la corrida '${t}' en ${ctx.estado}.\n`), 1;
  const r = await runningDeId(ctx, slug, t);
  if (r) {
    const rc = await matarRun(ctx, d, r);
    if (rc === 0) await evento(ctx.estado, "parar", t, slug, ctx.ahora());
    return rc;
  }
  const dir = path.join(ctx.estado, slug);
  const p = ((await leerTexto(rutaDe(dir, t, "pid"))) ?? "").trim();
  if (p && ctx.existePid(Number(p)) && !ctx.esZombi(Number(p))) {
    const quedan = await d.matar("", "", [Number(p)]);
    if (quedan.length === 0) {
      await anotarFin(dir, t, ctx.ahora());
      await evento(ctx.estado, "parar", t, slug, ctx.ahora());
      ctx.out(`pa: corrida ${t} de '${slug}' bajada (estaba en cola).\n`);
      return 0;
    }
    ctx.err(`pa: NO pude bajar la corrida ${t} de '${slug}': siguen vivos ${quedan.join(" ")}.\n`);
    return 85;
  }
  ctx.err(`pa: la corrida ${t} de '${slug}' no está corriendo ni en cola.\n`);
  return 1;
}
