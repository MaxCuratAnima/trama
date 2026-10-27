// Trama como producto para un tercero (Windows sin Tailscale): el servidor web
// (remoto.ts) sirve en 127.0.0.1 y nada más, sin Tailscale ni `remoto.json`. Se prende con `TRAMA_LOCAL=1`
// (lo pone el lanzador del producto); sin esa variable todo sigue como siempre, por la tailnet.
// Sin `electron`: lo prueba tests/modo-local.test.ts.
import { crearRemoto, type OpcionesRemoto } from "./remoto.ts";

/** La única dirección en la que escucha el modo local: nunca 0.0.0.0, nunca la LAN. */
export const IP_LOCAL = "127.0.0.1";
export const PUERTO_LOCAL = 8791;

type Env = Record<string, string | undefined>;

/** ¿Está prendido el modo local (`TRAMA_LOCAL=1`)? */
export const modoLocal = (env: Env = process.env) => env.TRAMA_LOCAL === "1";

/** El puerto del modo local: `TRAMA_PUERTO` si es válido (1024–65535), si no 8791. */
export function puertoLocal(env: Env = process.env): number {
  const n = Number(env.TRAMA_PUERTO);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : PUERTO_LOCAL;
}

/** ¿Es una dirección de esta misma máquina (`127.x.y.z`, `::1`, o su forma v4-mapeada)? */
export const esLoopback = (ip: string) => /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(ip) || ip === "::1";

/**
 * El servidor del modo local: lo mismo que `crearRemoto`, pero entra quien se conecta desde esta máquina (no hay
 * Tailscale que lo identifique), el `Host` tiene que ser `localhost` o `127.0.0.1` (corta el DNS rebinding) y
 * `escuchar` sólo abre 127.0.0.1. Una cabecera `X-Forwarded-For` no cambia a quién se mira (`propias` vacío).
 */
export function crearRemotoLocal(o: Omit<OpcionesRemoto, "nombres" | "propias" | "entra">) {
  const remoto = crearRemoto({ ...o, nombres: ["localhost", IP_LOCAL], propias: [], entra: async (ip) => esLoopback(ip) });
  return { ...remoto, escuchar: (puerto: number) => remoto.escuchar(IP_LOCAL, puerto) };
}
