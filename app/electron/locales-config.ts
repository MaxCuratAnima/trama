// Los modelos locales de llama-server que el usuario declara en `%APPDATA%\Trama\locales.json` (`HILOS_LOCALES_JSON`). Sin ese
// archivo no hay locales de llama-server: ningún modelo viene fijo en el código. Sin `electron` y síncrono (lo lee también
// `lider.ts` para saber si un modelo es local): el archivo es chico y se relee cada vez, así que editarlo rige sin reiniciar.
//
//   { "version": 1,
//     "conmutador": "mi-conmutador",              // opcional: programa que se llama con la `clave` y vuelve cuando el modelo cargó
//     "modelos": [ { "id": "modelo-local-ejemplo", "nombre": "Modelo local de ejemplo", "empresa": "Mi empresa",
//                    "clave": "ejemplo", "alias": "ejemplo-27b",
//                    "archivos": ["models/ejemplo/ejemplo.gguf"], "pesosMiB": 6000, "capasKv": 16, "ctxDefecto": 32768,
//                    "url": "http://127.0.0.1:8080",  // opcional
//                    "fijoMiB": 2048, "ctxMin": 4096, "ctxMax": 262144, "paso": 1024 } ] }
//
// Lo que no se entiende de una entrada la descarta (las demás siguen); un archivo que no es de esta versión no da ninguna.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirConfigTrama } from "./plataforma.ts";

/** Una fila por modelo local: lo que hace falta saber de su carga y de su peso. */
export type LocalDef = {
  /** El id con que viaja a `claude --model` y se guarda en `lideres.json`. */
  id: string;
  /** Cómo se ve en los menús. */
  nombre: string;
  /** El divisor del menú (quién lo hace); un nombre propio, no se traduce. */
  empresa: string;
  /** Lo que se le pasa al conmutador (qué modelo carga). */
  clave: string;
  /** El `--alias` con que llama-server lo sirve (y el `id` de su entrada en `~/.dsh/settings.yaml`). */
  dshId: string;
  /** Adónde escucha llama-server; sin dato, `HILOS_LLAMA_URL` o 127.0.0.1:8080. */
  url?: string;
  /** Los archivos que van a la GPU (relativos a `~`); su tamaño real se mide al estimar. */
  archivos: readonly string[];
  /** Lo que pesan si el archivo no se puede medir. */
  pesosMiB: number;
  /** Lo que no crece con `-c`: buffers de cómputo, estado recurrente y contexto CUDA. */
  fijoMiB: number;
  /** Capas con atención completa (las que guardan KV). */
  capasKv: number;
  /** El `-c` con que arranca si nada se guardó. */
  ctxDefecto: number;
  ctxMin: number;
  /** Hasta donde entrena el modelo. */
  ctxMax: number;
  paso: number;
};

export type ConfigLocales = { conmutador: string | null; modelos: LocalDef[] };

const VACIO: ConfigLocales = { conmutador: null, modelos: [] };

export const rutaLocales = (env: NodeJS.ProcessEnv = process.env, home = os.homedir()) =>
  env.HILOS_LOCALES_JSON || path.win32.join(dirConfigTrama(process.platform, env, home), "locales.json");

const esObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** Un valor que va a una línea de comandos o a un archivo: sin espacios ni nulos y que no empiece con guion. */
const sano = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 120 && !/[\s\0]/.test(v) && !v.startsWith("-");
const entero = (v: unknown, min: number, max = 10_000_000): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const PREFIJOS_AJENOS = /^(?:claude-|gemini-|agy:|ollama:)/;

function modeloDe(x: unknown): LocalDef | null {
  if (!esObj(x) || !sano(x.id) || PREFIJOS_AJENOS.test(x.id) || !/^[A-Za-z0-9][\w.-]*$/.test(x.id)) return null;
  if (!Array.isArray(x.archivos) || !x.archivos.length) return null;
  const archivos = x.archivos.filter((a): a is string => typeof a === "string" && !!a && !path.isAbsolute(a) && !a.split(/[\\/]/).includes(".."));
  if (archivos.length !== x.archivos.length) return null;
  if (!entero(x.pesosMiB, 1) || !entero(x.capasKv, 1, 1000) || !entero(x.ctxDefecto, 1)) return null;
  const ctxMin = x.ctxMin === undefined ? 4096 : x.ctxMin;
  const ctxMax = x.ctxMax === undefined ? 262144 : x.ctxMax;
  const paso = x.paso === undefined ? 1024 : x.paso;
  const fijoMiB = x.fijoMiB === undefined ? 2048 : x.fijoMiB;
  if (!entero(ctxMin, 1) || !entero(ctxMax, ctxMin) || !entero(paso, 1) || !entero(fijoMiB, 0)) return null;
  const clave = x.clave === undefined ? x.id : x.clave;
  const dshId = x.alias === undefined ? x.id : x.alias;
  if (!sano(clave) || !sano(dshId)) return null;
  let url: string | undefined;
  if (x.url !== undefined) {
    try {
      const u = new URL(String(x.url));
      if (u.protocol !== "http:" || !u.hostname || u.username || u.password || u.search || u.hash) return null;
      url = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
  }
  const nombre = typeof x.nombre === "string" && x.nombre.trim() ? x.nombre.trim().slice(0, 80) : x.id;
  const empresa = typeof x.empresa === "string" && x.empresa.trim() ? x.empresa.trim().slice(0, 40) : "Local";
  return { id: x.id, nombre, empresa, clave, dshId, ...(url ? { url } : {}), archivos, pesosMiB: x.pesosMiB, fijoMiB, capasKv: x.capasKv, ctxDefecto: x.ctxDefecto, ctxMin, ctxMax, paso };
}

/** El texto del archivo → lo que declara. `modelos` queda vacío si no es de esta versión, no se entiende o no hay nada. */
export function parsearLocales(texto: string): ConfigLocales {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return VACIO;
  }
  if (!esObj(j) || j.version !== 1 || !Array.isArray(j.modelos)) return VACIO;
  const modelos: LocalDef[] = [];
  for (const x of j.modelos) {
    const m = modeloDe(x);
    if (m && !modelos.some((o) => o.id === m.id)) modelos.push(m);
  }
  return { conmutador: sano(j.conmutador) ? j.conmutador : null, modelos };
}

/** El archivo de verdad; sin él (o roto) no hay locales de llama-server. */
export function leerConfigLocales(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): ConfigLocales {
  try {
    return parsearLocales(readFileSync(rutaLocales(env, home), "utf8"));
  } catch {
    return VACIO;
  }
}

export const localesDeclarados = (env?: NodeJS.ProcessEnv, home?: string): readonly LocalDef[] => leerConfigLocales(env, home).modelos;

export const localDe = (id: string, env?: NodeJS.ProcessEnv, home?: string): LocalDef | undefined => localesDeclarados(env, home).find((l) => l.id === id);

/** Lo que sabe el renderer de cada uno: sólo para mostrarlo (ni rutas, ni url). */
export const vistaLocales = (env?: NodeJS.ProcessEnv, home?: string) => localesDeclarados(env, home).map((l) => ({ id: l.id, nombre: l.nombre, empresa: l.empresa }));
