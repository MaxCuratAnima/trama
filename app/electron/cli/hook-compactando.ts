// Hook de Claude Code para que Trama sepa quién está compactando su contexto (puerto de scripts/hook-compactando.sh; lo lee
// electron/compactando.ts). Se registra en PreCompact y PostCompact con el mismo comando:
//   node hook-compactando.js [empieza|termina]
// Qué evento es lo dice el `hook_event_name` del JSON por stdin (PreCompact = empieza, otro = termina). La marca es un archivo
// vacío `<HILOS_STATE>/compactando/<id>`; <id> es PA_TS en un worker de `pa` (PA_WORKER=1) y si no el `session_id`.
// Nunca falla ni imprime nada: un hook que sale mal no puede frenar un compactado.
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { caminos, dirEstadoApp, type Env, type Plataforma } from "../plataforma.ts";

export type ContextoCompactando = { plataforma: Plataforma; env: Env; home: string };

const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Qué hacer con la marca: `empieza` la deja, `termina` la saca, `null` si no hay un id usable. */
export function decidir(args: string[], entrada: string, env: Env): { accion: "empieza" | "termina"; id: string } | null {
  const accion: "empieza" | "termina" =
    args[0] === "empieza" || args[0] === "termina" ? args[0] : /"hook_event_name"\s*:\s*"PreCompact"/.test(entrada) ? "empieza" : "termina";
  const id = env.PA_WORKER === "1" && env.PA_TS ? env.PA_TS : (/"session_id"\s*:\s*"([A-Za-z0-9._-]+)"/.exec(entrada)?.[1] ?? "");
  return ID_VALIDO.test(id) && id.length <= 128 ? { accion, id } : null;
}

export function aplicar(args: string[], entrada: string, ctx: ContextoCompactando): void {
  const d = decidir(args, entrada, ctx.env);
  if (!d) return;
  const dir = caminos(ctx.plataforma).join(dirEstadoApp(ctx.plataforma, ctx.env, ctx.home), "compactando");
  const marca = caminos(ctx.plataforma).join(dir, d.id);
  try {
    if (d.accion === "empieza") {
      mkdirSync(dir, { recursive: true });
      closeSync(openSync(marca, "w"));
    } else rmSync(marca, { force: true });
  } catch (e) {
    console.error(`[hook-compactando] no pude actualizar la marca ${marca}: ${(e as Error).message}`);
  }
}

async function leerStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    aplicar(process.argv.slice(2), await leerStdin(), { plataforma: process.platform, env: process.env as Env, home: os.homedir() });
  } catch (e) {
    console.error(`[hook-compactando] falló el hook: ${(e as Error).message}`);
  }
  process.exitCode = 0;
}
