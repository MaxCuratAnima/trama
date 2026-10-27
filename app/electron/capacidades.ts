// Detectar en vez de configurar: qué herramientas de esta máquina existen (Tailscale), para no
// ofrecer lo que no hay (el acceso por la tailnet). Sin `electron` ni imports locales salvo
// binario.ts: lo prueba tests/modo-local.test.ts.
import os from "node:os";
import { resolverAgy, resolverBinario } from "./binario.ts";
import { esEjecutable } from "./plataforma.ts";

type Env = Record<string, string | undefined>;

export type Capacidades = {
  /** Hay `tailscale`: tiene sentido el acceso desde el celular por la tailnet. */
  tailscale: boolean;
  /** Se puede ubicar la ventana de un líder de terminal (volver.ts lo mira). */
  hyprctl: boolean;
  /** Lo mismo, por otra vía. */
  kitten: boolean;
};

const ejecutable = (f: string) => esEjecutable(f);

/**
 * Qué herramientas hay en esta máquina: la variable de entorno que la nombra (`HILOS_TAILSCALE`…) o el PATH. Se mira cada vez que se pregunta (unos `access`): instalar una después la activa sin reiniciar.
 */
export function capacidades(env: Env = process.env, home = os.homedir(), existe: (f: string) => boolean = ejecutable): Capacidades {
  const hay = (nombre: string, variable: string) => !!env[variable] || resolverBinario(nombre, variable, env, home, existe) !== nombre;
  return { tailscale: hay("tailscale", "HILOS_TAILSCALE"), hyprctl: hay("hyprctl", "HILOS_HYPRCTL"), kitten: hay("kitten", "HILOS_KITTEN") };
}

/**
 * ¿Está instalado `agy` (Antigravity CLI)? Si `HILOS_AGY` está definido, vale si apunta a un ejecutable (las pruebas
 * ponen un camino inexistente para apagarlo, o `scripts/agy-falso.mjs` para prenderlo). En una captura sin `HILOS_AGY`
 * no se prende solo para no alterar las referencias visuales.
 */
export function hayAgy(env: Env = process.env, home = os.homedir(), existe: (f: string) => boolean = ejecutable): boolean {
  if (env.HILOS_AGY !== undefined) return !!env.HILOS_AGY && existe(env.HILOS_AGY);
  if (env.HILOS_CAPTURA) return false;
  return resolverAgy(env, home, existe) !== "agy";
}

/**
 * ¿Está instalado `claude` (Claude Code)? Sin él, con `agy`, Trama es de Gemini solo. `HILOS_CLAUDE` (el falso de las
 * pruebas) vale si apunta a un ejecutable; en una captura se supone que sí, para no alterar las referencias visuales.
 */
export function hayClaude(env: Env = process.env, home = os.homedir(), existe: (f: string) => boolean = ejecutable): boolean {
  if (env.HILOS_CLAUDE !== undefined) return !!env.HILOS_CLAUDE && existe(env.HILOS_CLAUDE);
  if (env.HILOS_CAPTURA) return true;
  return resolverBinario("claude", "HILOS_CLAUDE", env, home, existe) !== "claude";
}
