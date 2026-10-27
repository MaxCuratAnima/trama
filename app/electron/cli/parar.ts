// `pa --parar <id>`: baja ESA corrida, esté corriendo (su `.running`) o en cola (el `pa` hijo de --async que espera puesto).
// Port de `cmd_parar` + `matar_run` + `matar_arbol` de `motor/bin/pa`. El matado va por `DepsParar`: los tests lo reemplazan;
// el real usa `procesos.matarArbol` (taskkill /T).
import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { matarArbol as matarArbolDe } from "../procesos.ts";
import type { CtxPa } from "./contexto.ts";
import { anotarFin, evento, leerCampo, proyectoDeId, rutaDe, leerTexto } from "./estado-archivos.ts";

export type DepsParar = {
  /** Baja el árbol de los pids (taskkill /T) y fuerza a los 5 s. Devuelve los que quedaron vivos. */
  matar: (sid: string, paciente: string, pids: number[]) => Promise<number[]>;
};

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const esperar = async (cond: () => boolean, ms: number) => {
  for (let t = 0; t < ms && !cond(); t += 100) await dormir(100);
};

export function depsPararReales(ctx: CtxPa): DepsParar {
  const vive = (p: number) => ctx.existePid(p) && !ctx.esZombi(p);
  return {
    matar: async (_sid, _paciente, pids) => {
      const todos = pids.filter((p) => p > 0);
      for (const p of todos) matarArbolDe(p, false);
      await esperar(() => !todos.some(vive), 5000);
      for (const p of todos.filter(vive)) matarArbolDe(p, true);
      await esperar(() => !todos.some(vive), 2000);
      return todos.filter(vive);
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
