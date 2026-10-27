// Las imágenes que el usuario adjunta en la caja de un líder (B26): pegadas (Ctrl+V,
// p. ej. una captura de pantalla), soltadas sobre el chat o elegidas con el clip.
// Viven fuera de la vista, por caja (como los borradores): cambiar de hilo no
// las pierde, y lo que la cola no pudo mandar vuelve acá. Antes de guardarlas se
// achican si hace falta (lado más largo ≤ LADO_MAX, base64 ≤ BASE64_MAX: los
// topes de electron/imagenes.ts, que el main vuelve a validar).
// Lo que no es imagen de la API (.md, .pdf, código, un SVG…) es un archivo: el
// main lo guarda al adjuntarlo (electron/archivos.ts) y el mensaje lleva su ruta.
import { huboCambio } from "./cambios";
import { ARCHIVO_MAX, BASE64_MAX, escala, IMAGENES_MAX, LADO_MAX, TIPOS_IMAGEN, type Imagen } from "../../electron/imagenes";

/** Un archivo ya guardado por el main: Claude lo lee de `ruta`. */
export type Archivo = { nombre: string; ruta: string };
export type Adjunto = (Imagen | Archivo) & { id: number };

export const esArchivo = (a: Imagen | Archivo): a is Archivo => "ruta" in a;

const VACIO: readonly Adjunto[] = [];
const cajas = new Map<string, readonly Adjunto[]>();
const oyentes = new Map<string, Set<() => void>>();
let n = 0;

export const leerAdjuntos = (clave: string) => cajas.get(clave) ?? VACIO;

/** Los archivos adjuntos de todas las cajas, por su ruta (las imágenes pegadas no: son base64 en memoria), para guardarlos (src/volver.ts). */
export function fotoArchivos(): Record<string, Archivo[]> {
  const r: Record<string, Archivo[]> = {};
  for (const [clave, l] of cajas) {
    const a = archivosDe(l);
    if (a.length) r[clave] = a;
  }
  return r;
}

function poner(clave: string, l: readonly Adjunto[]) {
  if (l.length) cajas.set(clave, l);
  else cajas.delete(clave);
  oyentes.get(clave)?.forEach((f) => f());
  huboCambio();
}

export function escucharAdjuntos(clave: string, fn: () => void) {
  const s = oyentes.get(clave) ?? new Set();
  oyentes.set(clave, s.add(fn));
  return () => void s.delete(fn);
}

/** Agrega al final (las imágenes que pasen del tope por mensaje, no). Devuelve cuántas no entraron. */
export function agregarAdjuntos(clave: string, nuevos: readonly (Imagen | Archivo)[]): number {
  const antes = leerAdjuntos(clave);
  let lugar = IMAGENES_MAX - antes.filter((a) => !esArchivo(a)).length;
  const entran = nuevos.filter((a) => esArchivo(a) || lugar-- > 0);
  if (entran.length) poner(clave, [...antes, ...entran.map((a) => (esArchivo(a) ? { nombre: a.nombre, ruta: a.ruta, id: ++n } : { tipo: a.tipo, datos: a.datos, id: ++n }))]);
  return nuevos.length - entran.length;
}

export const quitarAdjunto = (clave: string, id: number) => poner(clave, leerAdjuntos(clave).filter((a) => a.id !== id));
export const vaciarAdjuntos = (clave: string) => poner(clave, VACIO);

/** Para el IPC: sólo las imágenes, sin el id. */
export const imagenesDe = (l: readonly Adjunto[]): Imagen[] => l.flatMap((a) => (esArchivo(a) ? [] : [{ tipo: a.tipo, datos: a.datos }]));
/** Los archivos, sin el id. */
export const archivosDe = (l: readonly Adjunto[]): Archivo[] => l.flatMap((a) => (esArchivo(a) ? [{ nombre: a.nombre, ruta: a.ruta }] : []));

/** El texto del mensaje con una línea por archivo (`linea` arma cada una con la ruta). */
export const textoConArchivos = (texto: string, archivos: readonly Archivo[], linea: (ruta: string) => string) =>
  archivos.length ? [texto, archivos.map((a) => linea(a.ruta)).join("\n")].filter(Boolean).join("\n\n") : texto;

export const esImagen = (tipo: string) => (TIPOS_IMAGEN as readonly string[]).includes(tipo);

export const urlDe = (i: Imagen) => `data:${i.tipo};base64,${i.datos}`;

/** Cuántos caracteres de base64 ocupan `bytes` bytes. */
export const largoBase64 = (bytes: number) => 4 * Math.ceil(bytes / 3);

/** Lo que no se pudo adjuntar: un archivo de más de ARCHIVO_MAX (`grande`) o una imagen que no se pudo leer. */
export class ErrorAdjunto extends Error {
  readonly grande: string | null;
  constructor(grande: string | null = null) {
    super(grande ?? "imagen");
    this.grande = grande;
  }
}

const base64 = (b: Blob) =>
  new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(b);
  });

/**
 * Un archivo de imagen listo para mandar. Si entra (tipo, lado y peso), tal
 * cual (un GIF sigue animado); si no, redibujado más chico: PNG si era PNG y
 * entra, si no JPEG bajando la calidad y, al final, el tamaño.
 */
export async function prepararImagen(f: Blob): Promise<Imagen> {
  let bm: ImageBitmap;
  try {
    bm = await createImageBitmap(f, { imageOrientation: "from-image" });
  } catch {
    throw new ErrorAdjunto();
  }
  try {
    if (Math.max(bm.width, bm.height) <= LADO_MAX && largoBase64(f.size) <= BASE64_MAX) return { tipo: f.type, datos: await base64(f) };
    let { ancho, alto } = escala(bm.width, bm.height);
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const c = document.createElement("canvas");
      c.width = ancho;
      c.height = alto;
      c.getContext("2d")!.drawImage(bm, 0, 0, ancho, alto);
      const intentos: [string, number | undefined][] =
        f.type === "image/png" && vuelta === 0 ? [["image/png", undefined], ["image/jpeg", 0.85]] : [["image/jpeg", 0.85], ["image/jpeg", 0.7]];
      for (const [tipo, q] of intentos) {
        const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, tipo, q));
        if (b && largoBase64(b.size) <= BASE64_MAX) return { tipo, datos: await base64(b) };
      }
      ancho = Math.max(1, Math.round(ancho * 0.7));
      alto = Math.max(1, Math.round(alto * 0.7));
    }
    throw new ErrorAdjunto();
  } finally {
    bm.close();
  }
}

/**
 * Un archivo pegado, soltado o elegido, listo para la caja: una imagen de la
 * API va como imagen; cualquier otro, hasta ARCHIVO_MAX, lo guarda `guardar`.
 */
export async function prepararAdjunto(f: File, guardar: (nombre: string, datos: Uint8Array) => Promise<string>): Promise<Imagen | Archivo> {
  if (esImagen(f.type)) return prepararImagen(f);
  if (f.size > ARCHIVO_MAX) throw new ErrorAdjunto(f.name);
  const nombre = f.name || "archivo";
  return { nombre, ruta: await guardar(nombre, new Uint8Array(await f.arrayBuffer())) };
}

/** Los archivos de un pegado o de algo soltado (el texto sigue su camino). */
export function archivosDeDatos(d: DataTransfer | null): File[] {
  if (!d) return [];
  const fs: File[] = [];
  for (const it of Array.from(d.items ?? []))
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) fs.push(f);
    }
  if (!fs.length) fs.push(...Array.from(d.files ?? []));
  return fs;
}

/**
 * Un pegado sin archivos y sin texto que el navegador pueda poner: una app de origen que lo ofrece en un
 * formato que no entiende deja `clipboardData` sin `text/plain` ni `text/html`. Entonces
 * el Ctrl+V no hace nada y el texto se pide al main (`portapapeles.texto`).
 */
export function pegadoSinTexto(d: DataTransfer | null): boolean {
  if (!d) return false;
  if (archivosDeDatos(d).length) return false;
  if (Array.from(d.types ?? []).includes("text/html")) return false;
  return !d.getData("text/plain");
}
