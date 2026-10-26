// El logo de cada proyecto para el encabezado de su carpeta. Sale, en orden:
// del campo `icono` (o `icon`) del registry, o de un ícono que ya esté en el
// repo, buscado en unos pocos lugares fijos (nada de recorrer el repo). Lo que
// no tiene ninguno lleva un monograma, que arma el frontend (src/barra/logo-datos.ts).
// Sin imports de Electron: el achicado de los PNG lo pasa ipc.ts.
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Dónde se busca adentro del repo, de lo más chico a lo más grande. */
export const LUGARES = [
  "public/favicon.svg",
  "public/favicon.png",
  "public/favicon.ico",
  "src-tauri/icons/32x32.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "icon.svg",
  "icon.png",
  "logo.svg",
  "logo.png",
];

const TIPOS: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Más que esto no se lee: un ícono de carpeta no pesa megas. */
const TOPE = 512 * 1024;
/** Lo que no se puede achicar (SVG, ICO) va entero al frontend: que sea chico. */
const TOPE_ENTERO = 96 * 1024;

/** Achica un PNG/JPG/WebP y lo devuelve como data URL; `null` si no lo pudo leer. */
export type Achicar = (crudo: Buffer) => string | null;

type Origen = { ruta: string; icono: string | null };

/** Las rutas a probar para un proyecto, en orden. */
export function candidatos(p: Origen): string[] {
  const propio = p.icono
    ? [p.icono === "~" || p.icono.startsWith("~/") ? path.join(os.homedir(), p.icono.slice(1)) : path.resolve(p.ruta, p.icono)]
    : [];
  return [...propio, ...LUGARES.map((l) => path.join(p.ruta, l))];
}

// Por archivo (con su fecha y tamaño): releer los íconos no vuelve a abrir nada.
const leidos = new Map<string, string | null>();

async function leer(archivo: string, achicar: Achicar | null): Promise<string | null> {
  const tipo = TIPOS[path.extname(archivo).toLowerCase()];
  if (!tipo) return null;
  const s = await stat(archivo).catch(() => null);
  if (!s?.isFile() || s.size === 0 || s.size > TOPE) return null;
  const clave = `${archivo}:${s.mtimeMs}:${s.size}`;
  const ya = leidos.get(clave);
  if (ya !== undefined) return ya;
  const crudo = await readFile(archivo).catch(() => null);
  let url: string | null = null;
  if (crudo) {
    const entero = tipo === "image/svg+xml" || tipo === "image/x-icon" || !achicar;
    if (!entero) url = achicar(crudo);
    else if (crudo.length <= TOPE_ENTERO) url = `data:${tipo};base64,${crudo.toString("base64")}`;
  }
  leidos.set(clave, url);
  return url;
}

/** El ícono de un proyecto como data URL, o `null` si no tiene (va el monograma). */
export async function iconoDe(p: Origen, achicar: Achicar | null = null): Promise<string | null> {
  for (const c of candidatos(p)) {
    const url = await leer(c, achicar);
    if (url) return url;
  }
  return null;
}

/** slug → data URL, sólo de los proyectos que tienen ícono. */
export async function iconosDe(proyectos: (Origen & { slug: string })[], achicar: Achicar | null = null): Promise<Record<string, string>> {
  const pares = await Promise.all(proyectos.map(async (p) => [p.slug, await iconoDe(p, achicar)] as const));
  return Object.fromEntries(pares.filter((x): x is [string, string] => x[1] !== null));
}
