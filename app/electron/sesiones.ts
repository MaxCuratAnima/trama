// Las sesiones vivas de Claude Code: `~/.claude/sessions/<pid>.json`, una por
// proceso (las borra al salir bien). De ahí salen los líderes (statusline.ts) y
// el "¿hay otro proceso con esta sesión?" antes de escribirle a un líder de la
// app (lider.ts). Sin imports locales: lo usan los dos sin ciclo.
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { estadoDeProceso } from "./procesos.js";

export const SESIONES =
  process.env.HILOS_SESIONES ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "sessions");

/** Lo que importa de un `sessions/<pid>.json`. */
export type Sesion = {
  id: string;
  pid: number;
  nombre: string;
  cwd: string;
  /** "interactive" para todo lo de hoy (terminal, `-p` y workers de `pa`). */
  kind: string;
  /** "cli" en una terminal; "sdk-cli" con `-p` (workers de `pa` y líderes de la app). */
  entrypoint: string;
  /** "busy" mientras responde. */
  status: string;
  /** Espera una respuesta del usuario (un permiso, una pregunta): Claude Code lo anota en `waitingFor` (o status "waiting"). */
  pide: boolean;
  /** Última actividad (epoch). */
  actividad: number;
  /** Cuándo arrancó este proceso (epoch; 0 si no lo dice). Con `--resume` es el del proceso nuevo, no el de la conversación. */
  inicio: number;
  /** El arranque que anotó Claude Code (`inicioDeProceso`): distingue un pid reusado. */
  procStart: string | null;
};

/** Del proceso (procesos.ts): su estado y su arranque; `null` si no se puede leer. */
const deProc = estadoDeProceso;
/** Ya murió y falta que el padre lo recoja: existe el pid, pero no hay nadie adentro. */
const zombi = (estado: string) => estado === "Z" || estado === "X";

/**
 * ¿Vive el proceso de esta sesión? El archivo sobrevive a un cuelgue, así que
 * con `procStart` se descarta un pid reusado por otro proceso (y un zombi).
 */
export async function vive(pid: number, procStart: unknown): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (typeof procStart !== "string") return true;
  const p = await deProc(pid);
  return p === null || p.arranque === null || (p.arranque === procStart && !zombi(p.estado));
}

/**
 * ¿Es este pid, con certeza, el proceso que anotó la sesión? Para mandarle una señal no
 * alcanza con `vive` (que da por bueno lo que no puede leer): hace falta el `procStart`
 * de la sesión y que sea el del proceso de ahora. Un zombi (ya murió, falta que lo
 * recojan) no cuenta.
 */
export async function esElProceso(pid: number, procStart: string | null): Promise<boolean> {
  if (typeof procStart !== "string" || !Number.isInteger(pid) || pid <= 1) return false;
  const p = await deProc(pid);
  return p !== null && p.arranque === procStart && !zombi(p.estado);
}

/** Las vivas de la última lectura: lo que mira el vigía (vigia.ts) sin volver a leer la carpeta. */
let vistas: Sesion[] = [];
export const sesionesVistas = (): readonly Sesion[] => vistas;

/** Todas las sesiones con el proceso vivo, sin filtrar. */
export async function sesionesVivas(): Promise<Sesion[]> {
  return (await sesiones()).vivas;
}

/**
 * Las sesiones de la carpeta: las que tienen el proceso vivo y las que no. A una
 * `muerta` la mataron (OOM, kill -9) o se colgó la máquina: Claude Code no llegó a
 * borrar su archivo (lo barre recién el próximo `claude` que arranca).
 */
export async function sesiones(): Promise<{ vivas: Sesion[]; muertas: Sesion[] }> {
  let nombres: string[];
  try {
    nombres = (await readdir(SESIONES)).filter((n) => n.endsWith(".json"));
  } catch {
    return { vivas: (vistas = []), muertas: [] };
  }
  const leidas = await Promise.all(
    nombres.map(async (n): Promise<(Sesion & { vive: boolean }) | null> => {
      try {
        const s = JSON.parse(await readFile(path.join(SESIONES, n), "utf8"));
        if (typeof s?.sessionId !== "string" || typeof s.pid !== "number") return null;
        const ms = typeof s.updatedAt === "number" ? s.updatedAt : typeof s.startedAt === "number" ? s.startedAt : 0;
        return {
          id: s.sessionId,
          pid: s.pid,
          nombre: typeof s.name === "string" ? s.name : "",
          cwd: typeof s.cwd === "string" ? s.cwd : "",
          kind: String(s.kind ?? ""),
          entrypoint: String(s.entrypoint ?? ""),
          status: String(s.status ?? ""),
          pide: (typeof s.waitingFor === "string" && s.waitingFor !== "") || s.status === "waiting",
          actividad: Math.floor(ms / 1000),
          inicio: typeof s.startedAt === "number" ? Math.floor(s.startedAt / 1000) : 0,
          procStart: typeof s.procStart === "string" ? s.procStart : null,
          vive: await vive(s.pid, s.procStart),
        };
      } catch {
        return null;
      }
    }),
  );
  const vivas: Sesion[] = [];
  const muertas: Sesion[] = [];
  for (const l of leidas) {
    if (!l) continue;
    const { vive: v, ...s } = l;
    (v ? vivas : muertas).push(s);
  }
  vistas = vivas;
  return { vivas, muertas };
}
