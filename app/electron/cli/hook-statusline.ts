// Statusline de Claude Code (puerto de motor/hooks/statusline-espejo.sh): envuelve el statusline que ya haya y deja una copia de
// los datos que Claude Code sólo le pasa al statusline (uso del plan, caché de la sesión) para la app. Uso en settings.json:
//   "statusLine": {"type": "command", "command": "node hook-statusline.js <statusline original…>"}
// Escribe `<PA_STATE>/statusline/<session_id>.json` (atómico) y suma a `historial.jsonl` {ts, h5, h5_reset, sem, sem_reset[,
// config_dir]} cuando cambian. `config_dir` es `CLAUDE_CONFIG_DIR` de la sesión (null = la cuenta de siempre). Nunca rompe el
// statusline: si algo falla, sigue y muestra lo del original (stdin se le reenvía tal cual, y su salida es la de este proceso).
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { caminos, dirEstadoPa, type Env, type Plataforma } from "../plataforma.ts";
import { comandoEjecutable } from "../procesos.ts";

export type ContextoStatusline = { plataforma: Plataforma; env: Env; home: string; ahora: () => number };

const ID_VALIDO = /^[A-Za-z0-9_-]+$/;
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const o = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

/** El espejo de una entrada del statusline (`version: 1`), o null si no trae un `session_id` usable. */
export function espejoDe(entrada: string, ctx: ContextoStatusline): { id: string; espejo: Record<string, unknown> } | null {
  let j: Record<string, any>;
  try {
    j = obj(JSON.parse(entrada));
  } catch {
    return null;
  }
  const id = typeof j.session_id === "string" ? j.session_id : "";
  if (!ID_VALIDO.test(id)) return null;
  const rl = obj(j.rate_limits);
  const cd = ctx.env.CLAUDE_CONFIG_DIR ?? "";
  return {
    id,
    espejo: {
      version: 1,
      ts: Math.floor(ctx.ahora()),
      session_id: id,
      cwd: o(obj(j.workspace).current_dir ?? j.cwd),
      modelo: o(obj(j.model).id),
      prompt_cache: o(j.prompt_cache),
      config_dir: cd === "" ? null : cd,
      rate_limits: { five_hour: o(rl.five_hour), seven_day: o(rl.seven_day) },
    },
  };
}

/** La fila del historial de la cuota, o null si no hay ningún porcentaje. */
export function filaHistorial(espejo: Record<string, any>): Record<string, unknown> | null {
  const rl = obj(espejo.rate_limits);
  const h5 = o(obj(rl.five_hour).used_percentage);
  const sem = o(obj(rl.seven_day).used_percentage);
  if (h5 === null && sem === null) return null;
  return {
    ts: espejo.ts,
    h5,
    h5_reset: o(obj(rl.five_hour).resets_at),
    sem,
    sem_reset: o(obj(rl.seven_day).resets_at),
    ...(espejo.config_dir ? { config_dir: espejo.config_dir } : {}),
  };
}

const sinTs = (fila: unknown) => {
  const { ts: _ts, ...resto } = obj(fila);
  return JSON.stringify(resto);
};

/** Deja el espejo y, si cambió algo respecto de la última fila, la fila del historial. Devuelve el espejo escrito, o null. */
export function guardarEspejo(entrada: string, ctx: ContextoStatusline): Record<string, unknown> | null {
  const r = espejoDe(entrada, ctx);
  if (!r) return null;
  const dir = caminos(ctx.plataforma).join(dirEstadoPa(ctx.plataforma, ctx.env, ctx.home), "statusline");
  const destino = caminos(ctx.plataforma).join(dir, `${r.id}.json`);
  const tmp = caminos(ctx.plataforma).join(dir, `.${r.id}.${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(r.espejo) + "\n");
    renameSync(tmp, destino);
  } catch {
    rmSync(tmp, { force: true });
    return null;
  }
  const fila = filaHistorial(r.espejo);
  if (fila) {
    try {
      const archivo = caminos(ctx.plataforma).join(dir, "historial.jsonl");
      let ultima: unknown = null;
      try {
        ultima = JSON.parse(readFileSync(archivo, "utf8").trimEnd().split("\n").pop() ?? "null");
      } catch {
        // sin historial todavía (o la última línea quedó a medias): se escribe la fila igual
      }
      if (sinTs(fila) !== sinTs(ultima)) appendFileSync(archivo, JSON.stringify(fila) + "\n");
    } catch (e) {
      console.error(`[hook-statusline] no pude anotar el historial: ${(e as Error).message}`);
    }
  }
  return r.espejo;
}

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entrada = await leerStdin();
  try {
    guardarEspejo(entrada, { plataforma: process.platform, env: process.env as Env, home: os.homedir(), ahora: () => Date.now() / 1000 });
  } catch (e) {
    console.error(`[hook-statusline] no pude guardar el espejo: ${(e as Error).message}`);
  }
  const [bin, ...args] = process.argv.slice(2);
  if (bin) {
    const c = comandoEjecutable(bin, args, process.platform, process.env);
    const r = spawnSync(c.file, c.args, { input: entrada, stdio: ["pipe", "inherit", "inherit"], windowsHide: true, ...c.opciones });
    process.exitCode = r.status ?? 0;
  }
}
