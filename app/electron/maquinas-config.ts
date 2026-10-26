// Las otras máquinas con trama (el Dell): `$HILOS_STATE/maquinas.json`. Sin el archivo no hay ninguna
// y trama es la de siempre: nadie lo lee hasta que lo pide quien junta (costo cero). Sin `electron`
// ni estado propio: lo prueba tests/maquinas-config.test.ts. Contrato: docs/estado/maquinas.md.
import { readFileSync } from "node:fs";

/**
 * Otra máquina: su id (el prefijo de sus filas, `dell:…`), cómo se la nombra y dónde escucha su motor.
 * `prender`: el comando que la prende (`prender-pc`, Wake-on-LAN). Con él es una máquina sólo para prender: el Dell la tiene para
 * mostrar "PC apagada · Prender" (electron/pc-estado.ts) y nunca se conecta a su motor (la confianza va en un solo sentido).
 */
export type Maquina = { id: string; nombre: string; url: string; prender?: string };

/** Dónde vive `prender-pc` en el Dell (`"prender": true`). */
export const PRENDER_DEFECTO = "~/.local/bin/prender-pc";

/**
 * `esta`: el id de esta máquina para las demás (lo que ponen en sus filas). `maquinas`: las otras, sin
 * repetir ni ser `esta`. `malas`: lo que no se entendió, una línea por entrada (al log, no rompe al resto).
 */
export type ConfigMaquinas = {
  esta: string;
  /** Cómo se llama esta máquina y su color (`#rrggbb`) en el celular: el título y el ícono de su entrada (electron/identidad.ts). Sólo si el archivo los trae. */
  nombre?: string;
  color?: string;
  maquinas: Maquina[];
  malas: string[];
};

/** Sin archivo: sólo esta máquina. */
export const SOLA: ConfigMaquinas = { esta: "pc", maquinas: [], malas: [] };

/** Un id corto, sin `:` (separa máquina e id) y en minúsculas: va en cada id de fila y en la URL. */
const ID = /^[a-z][a-z0-9-]{0,15}$/;

/** `{ version: 1, esta, nombre?, color?, maquinas: [{ id, nombre, url }] }`. Versión desconocida o JSON roto: error, no se adivina. */
export function parsearMaquinas(j: unknown): ConfigMaquinas | { error: string } {
  const o = (j ?? {}) as { version?: unknown; esta?: unknown; nombre?: unknown; color?: unknown; maquinas?: unknown };
  if (typeof j !== "object" || j === null) return { error: "maquinas.json no es un objeto" };
  if (o.version !== 1) return { error: `maquinas.json: versión desconocida ${JSON.stringify(o.version)}` };
  const esta = o.esta === undefined ? SOLA.esta : o.esta;
  if (typeof esta !== "string" || !ID.test(esta)) return { error: `maquinas.json: "esta" no es un id (${JSON.stringify(o.esta)})` };
  if (o.maquinas !== undefined && !Array.isArray(o.maquinas)) return { error: 'maquinas.json: "maquinas" no es una lista' };
  const maquinas: Maquina[] = [];
  const malas: string[] = [];
  const vistos = new Set([esta]);
  for (const [i, m] of ((o.maquinas ?? []) as unknown[]).entries()) {
    const { id, nombre, url, prender } = (m ?? {}) as { id?: unknown; nombre?: unknown; url?: unknown; prender?: unknown };
    if (typeof id !== "string" || !ID.test(id)) {
      malas.push(`#${i}: id inválido`);
      continue;
    }
    if (vistos.has(id)) {
      malas.push(`${id}: repetido`);
      continue;
    }
    let u: URL | null = null;
    try {
      u = typeof url === "string" ? new URL(url) : null;
    } catch {}
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) {
      malas.push(`${id}: url inválida`);
      continue;
    }
    // Una ruta absoluta (`/…` o `C:\…`) o bajo `~/`, sin argumentos: el comando se corre solo, nunca con algo que venga de afuera.
    let cmd: string | undefined;
    if (prender === true) cmd = PRENDER_DEFECTO;
    else if (prender !== undefined && prender !== false) {
      if (typeof prender === "string" && /^(~[\\/]|\/|[A-Za-z]:[\\/])[^\0\n]{1,300}$/.test(prender)) cmd = prender;
      else {
        malas.push(`${id}: prender no es una ruta`);
        continue;
      }
    }
    vistos.add(id);
    const n = typeof nombre === "string" ? nombre.trim().slice(0, 40) : "";
    maquinas.push({ id, nombre: n || id, url: u.origin, ...(cmd ? { prender: cmd } : {}) });
  }
  const yo: { nombre?: string; color?: string } = {};
  if (typeof o.nombre === "string" && o.nombre.trim()) yo.nombre = o.nombre.trim().slice(0, 40);
  if (o.color !== undefined) {
    if (typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color)) yo.color = o.color.toLowerCase();
    else malas.push("color: no es #rrggbb");
  }
  return { esta, ...yo, maquinas, malas };
}

/** Lee `maquinas.json`; si no está, `SOLA`. */
export function leerMaquinas(archivo: string): ConfigMaquinas | { error: string } {
  let texto: string;
  try {
    texto = readFileSync(archivo, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return SOLA;
    return { error: `maquinas.json: ${(e as Error).message}` };
  }
  try {
    return parsearMaquinas(JSON.parse(texto));
  } catch {
    return { error: "maquinas.json: JSON roto" };
  }
}
