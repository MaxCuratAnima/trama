// Lo que la app le pide a `pa`: la lista de hilos y el Cerrar. Node puro (sin
// `electron`) para poder probarlo con un `pa` falso desde la terminal:
//   HILOS_PA=scripts/pa-falso.sh node -e 'import("./dist-electron/pa.js").then(m => m.cerrar(…))'
// `pa` se busca en `HILOS_PA`, el PATH o `~/.local/bin` (ver binario.ts). La app nunca lee
// `$PA_STATE` a mano: sólo mira `eventos.jsonl` para saber cuándo releer.
import { execFileCmd } from "./procesos.js";
import { mkdirSync } from "node:fs";
import { mirarCarpeta } from "./mirar.ts";
import { open, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { entornoPa, resolverPa } from "./binario.js";
import { dirEstadoPa } from "./plataforma.ts";
import { completarCola } from "./cola-pa.js";
import { conLosResultados } from "./hilo-resultados.ts";
import { errorT } from "./errores.ts";
import { ESTADO } from "./estado.js";
import { silencio } from "./log.js";
import { eventosDe, podarFrenados, sumarFrenados, type EventoPa, type Frenados } from "./eventos-pa.js";
import { registro } from "./registro.js";
import { argvIntegrar, argvSettle, comoSettle } from "./settle.js";
import { verMuertes, type Muertes } from "./vigia.js";

export const PA = resolverPa(process.env, os.homedir());
/** `pa` necesita `claude` y `proyecto-ruta` (en ~/.local/bin, que el menú de apps no pone en el PATH). */
export const ENV = entornoPa(process.env, os.homedir()) as NodeJS.ProcessEnv;
export const PA_STATE = dirEstadoPa(process.platform, process.env, os.homedir());
export { ESTADO };
const GUARDADOS = path.join(ESTADO, "hilos.json");
const MUERTES = path.join(ESTADO, "muertes.json");
const FRENADOS = path.join(ESTADO, "frenados.json");

const DEBOUNCE_MS = 150;
/** El JSON de hoy pesa ~800 kB con ~780 hilos. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Corre `pa` y devuelve su stdout; si falla, rechaza con lo último que dijo por stderr. */
function correr(args: string[], env: NodeJS.ProcessEnv = ENV): Promise<string> {
  return new Promise((ok, mal) => {
    execFileCmd(PA, args, { maxBuffer: MAX_BUFFER, env }, (err, stdout, stderr) => {
      if (!err) return ok(stdout);
      const dijo = String(stderr).trim().split("\n").filter(Boolean).slice(-2).join(" · ");
      mal(new Error(dijo || `${path.basename(PA)} ${args[0]}: ${err.message}`));
    });
  });
}

/** La última escritura pendiente de cada archivo: se encadenan, de a una. */
const escribiendo = new Map<string, Promise<void>>();
let tmps = 0;

/**
 * Escritura atómica: nadie lee un archivo a medio escribir. Dos seguidas al
 * mismo archivo (un `fin` y un `modo` en el mismo trozo del stream) van en
 * orden y cada una con su tmp: con un tmp compartido, los dos `writeFile` se
 * pisaban y podía quedar un JSON mezclado (y `lideres.json` se leía vacío).
 */
export function escribirAtomico(archivo: string, texto: string): Promise<void> {
  const antes = escribiendo.get(archivo) ?? Promise.resolve();
  const esta = antes
    .catch(silencio("pa"))
    .then(async () => {
      mkdirSync(path.dirname(archivo), { recursive: true });
      const tmp = `${archivo}.${process.pid}.${++tmps}.tmp`;
      await writeFile(tmp, texto);
      await rename(tmp, archivo);
    });
  escribiendo.set(archivo, esta);
  void esta.finally(() => {
    if (escribiendo.get(archivo) === esta) escribiendo.delete(archivo);
  }).catch(silencio("pa"));
  return esta;
}

// --- Lista de hilos ----------------------------------------------------------
// `pa --hilos --json` tarda (~11 s con ~780 hilos, 2026-10-03): una sola
// corrida a la vez y, si `pa` avisa de algo mientras tanto, una más al terminar.
// Cada corrida lleva un número para que el frontend descarte lo repetido.

export type Lectura = { n: number; datos: unknown } | { n: number; error: string };

let corridas = 0;
let enCurso: Promise<Lectura> | null = null;
let otraVez = false;
let alLeer: (l: Lectura) => void = () => {};

/** El estado de cada hilo en la lectura anterior de este proceso (`null`: todavía no hubo). */
let estados: Map<string, string> | null = null;
let muertes: Muertes | null = null;
/** Los que frenó `pa --parar` (de los eventos): `pa --hilos` los lista como `murio` sin decir que fue a propósito. */
let frenados: Frenados | null = null;

async function frenadosGuardados(): Promise<Frenados> {
  if (frenados) return frenados;
  const g = await readFile(FRENADOS, "utf8").then((t) => JSON.parse(t), () => null);
  frenados = {};
  if (g?.version === 1 && g.frenados && typeof g.frenados === "object")
    for (const [id, ts] of Object.entries(g.frenados)) if (typeof ts === "number") frenados[id] = ts;
  return frenados;
}

async function guardarFrenados(f: Frenados): Promise<void> {
  frenados = f;
  await escribirAtomico(FRENADOS, JSON.stringify({ version: 1, frenados: f })).catch(silencio("pa"));
}

/** Anota los `parar` de una tanda de eventos (para la próxima lista). */
export async function anotarFrenados(eventos: readonly EventoPa[]): Promise<void> {
  const nuevos = sumarFrenados(await frenadosGuardados(), eventos);
  if (nuevos) await guardarFrenados(nuevos);
}

/**
 * Le pone `murio_en` a lo que la app vio morir (`verMuertes`): `pa` dice que murió, no cuándo.
 * Se guarda en `muertes.json` para que la hora sobreviva a un reinicio de la app.
 */
async function anotarMuertes(datos: any): Promise<void> {
  if (datos?.version !== 1 || !Array.isArray(datos.hilos)) return;
  const hilos = (datos.hilos as any[]).filter((h) => typeof h?.id === "string" && typeof h.estado === "string");
  if (!muertes) {
    const g = await readFile(MUERTES, "utf8").then((t) => JSON.parse(t), () => null);
    muertes = {};
    if (g?.version === 1 && g.muertes && typeof g.muertes === "object")
      for (const [id, ts] of Object.entries(g.muertes)) if (typeof ts === "number") muertes[id] = ts;
  }
  const nuevas = verMuertes(estados, hilos, muertes, Math.floor(Date.now() / 1000));
  estados = new Map(hilos.map((h) => [h.id, h.estado]));
  if (nuevas) {
    muertes = nuevas;
    await escribirAtomico(MUERTES, JSON.stringify({ version: 1, muertes })).catch(silencio("pa"));
  }
  for (const h of hilos) if (muertes[h.id] !== undefined) h.murio_en = muertes[h.id];
  // Lo que frenó `pa --parar` lleva la hora: la barra dice "frenado" y no "murió".
  const f = await frenadosGuardados();
  const podados = podarFrenados(f, hilos);
  if (podados) await guardarFrenados(podados);
  for (const h of hilos) if (h.estado === "murio" && (podados ?? f)[h.id] !== undefined) h.frenado_en = (podados ?? f)[h.id];
}

function unaCorrida(): Promise<Lectura> {
  const n = ++corridas;
  enCurso = correr(["--hilos", "--json"])
    .then(async (out): Promise<Lectura> => {
      const datos = JSON.parse(out);
      // En cola o muerto sin arrancar: la tarea, el líder y el motivo no están en `pa --hilos` (electron/cola-pa.ts).
      const cambio = Array.isArray(datos?.hilos) ? await completarCola(datos.hilos, PA_STATE).catch(() => 0) : 0;
      await escribirAtomico(GUARDADOS, cambio ? JSON.stringify(datos) : out).catch(silencio("pa"));
      await anotarMuertes(datos).catch(silencio("pa"));
      return { n, datos };
    })
    .catch((e): Lectura => ({ n, error: String(e?.message ?? e) }))
    .then((l) => {
      enCurso = null;
      alLeer(l);
      if (otraVez) {
        otraVez = false;
        void unaCorrida();
      }
      return l;
    });
  return enCurso;
}

/** `pa --hilos --json`: la corrida en curso o una nueva. */
export function leerHilos(): Promise<Lectura> {
  return enCurso ?? unaCorrida();
}

/** Hay una corrida sin terminar: la lista que se tiene puede estar vieja. */
export const leyendoHilos = () => enCurso !== null;

/** Algo cambió: otra corrida (o una más después de la que está en curso). */
export function releerHilos() {
  if (enCurso) otraVez = true;
  else void unaCorrida();
}

/** Recibe el resultado de cada corrida, la haya pedido quien la haya pedido. */
export function alLeerHilos(fn: (l: Lectura) => void) {
  alLeer = fn;
}

/** La última lista buena, para pintar algo al abrir mientras `pa` contesta. */
export async function hilosGuardados(): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(GUARDADOS, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Avisa cuando `pa` escribe en `eventos.jsonl` (arranque, fin, integrar…), con
 * debounce, y con los ids que nombran las líneas nuevas (se lee sólo la cola,
 * desde donde se leyó la vez anterior). Se mira el directorio y no el archivo:
 * si `pa` lo reescribe, el watch del archivo quedaría colgado del inodo viejo.
 * Nada de polling.
 */
export function mirarEventos(alCambiar: (ids: string[], eventos: EventoPa[]) => void): () => void {
  const archivo = path.join(PA_STATE, "eventos.jsonl");
  let timer: NodeJS.Timeout | null = null;
  let desde = 0;
  void stat(archivo).then(
    (s) => (desde = s.size),
    () => {},
  );
  const cola = async (): Promise<EventoPa[]> => {
    let fd;
    try {
      fd = await open(archivo, "r");
      const { size } = await fd.stat();
      // Reescrito (más corto que antes): no se sabe qué cambió, se relee igual sin ids.
      if (size < desde) desde = 0;
      if (size === desde) return [];
      const buf = Buffer.alloc(size - desde);
      await fd.read(buf, 0, buf.length, desde);
      // Sólo hasta la última línea completa: la que está a medio escribir va la próxima.
      const fin = buf.lastIndexOf(10);
      if (fin < 0) return [];
      desde += fin + 1;
      return eventosDe(buf.subarray(0, fin).toString("utf8"));
    } catch {
      return [];
    } finally {
      await fd?.close();
    }
  };
  // De a una: dos colas a la vez leían desde el mismo `desde` y lo avanzaban dos veces
  // (se salteaban líneas, o se pasaba del tamaño y se releía todo el archivo).
  let leyendo: Promise<void> = Promise.resolve();
  const programar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      leyendo = leyendo.then(() => cola().then((es) => alCambiar([...new Set(es.map((e) => e.id))], es))).catch(silencio("pa"));
    }, DEBOUNCE_MS);
  };
  // Sin directorio no hay nada que mirar (y no se reintenta: sería polling); si el watcher cae, se rearma
  // y lee lo que se escribió mientras estuvo ciego.
  const w = mirarCarpeta(PA_STATE, (_tipo, nombre) => {
    if (nombre === "eventos.jsonl") programar();
  }, { donde: "pa", alRearmar: programar });
  return () => w?.cerrar();
}

// --- Acciones ----------------------------------------------------------------

const RARO = { proyecto: "main.proyectoRaro", modelo: "main.modeloRaro", effort: "main.effortRaro" } as const;

export const ID = /^\d{8}-\d{6}-\d+$/;
export const PROYECTO = /^[a-z0-9._][a-z0-9._-]*$/;

export type Cerrable = { id: string; proyecto: string; rama: string | null; origen?: string | null };

function id(x: unknown): string {
  if (!ID.test(String(x))) throw errorT("main.idRaro", { v: String(x) });
  return String(x);
}

/**
 * Lo que va como argumento suelto (proyecto, modelo, effort): no vacío, sin
 * saltos y sin "-" adelante (sería un flag de `pa`).
 */
function suelto(que: "proyecto" | "modelo" | "effort", x: unknown): string {
  const v = String(x ?? "");
  if (!v || v.startsWith("-") || /[\n\r\0]/.test(v)) throw errorT(RARO[que], { v: String(x) });
  return v;
}

/**
 * `pa --hilos` nombra al proyecto por su carpeta ("llama.cpp"), pero `pa <proyecto>`
 * lo busca por el nombre del registry ("Local AI", con `proyecto-ruta`). Lo que no
 * está en el registry va como vino.
 */
export async function nombrePa(slug: unknown): Promise<string> {
  return (await proyectoPa(slug)).nombre;
}

/** El nombre para `pa <proyecto>` y si tiene `tests` en el registry (lo que no está, sin tests). */
export async function proyectoPa(slug: unknown): Promise<{ nombre: string; tests: boolean }> {
  const p = suelto("proyecto", slug);
  const r = (await registro()).find((x) => x.slug === p || x.nombre === p);
  return { nombre: r?.nombre ?? p, tests: !!r?.tests };
}

/** `pa <proy> --integrar <id> [--tests]`: `--tests` sólo si el registry le da `tests` al proyecto. */
export async function argvIntegrarPa(proyecto: unknown, id: string): Promise<string[]> {
  const p = await proyectoPa(proyecto);
  return argvIntegrar(p.nombre, id, p.tests);
}

/**
 * Settle (ver settle.ts): de la app y con rama, `pa <proy> --integrar <id> [--tests]`;
 * de un líder o sin rama, `pa --archivar <id>`.
 * Todo va validado: son argumentos y un "-" adelante sería un flag.
 */
export async function cerrar(h: Cerrable): Promise<void> {
  const x = { id: id(h.id), origen: h.origen, rama: h.rama };
  await correr(comoSettle(x) === "integrar" ? await argvIntegrarPa(h.proyecto, x.id) : argvSettle(x, ""));
}

/** `pa --hilo <id> --json -n <n> [--antes <antes>]`: una página de la conversación (sólo lectura). */
export async function conversacion(x: { id: string; n?: number; antes?: number | null }): Promise<unknown> {
  const args = ["--hilo", id(x.id), "--json", "-n", String(Math.max(1, Math.min(500, Math.floor(Number(x.n) || 50))))];
  if (x.antes != null) args.push("--antes", String(Math.max(0, Math.floor(Number(x.antes) || 0))));
  return conLosResultados(args[1], JSON.parse(await correr(args)));
}

/** `pa --parar <id>`. */
export async function parar(x: { id: string }): Promise<void> {
  await correr(["--parar", id(x.id)]);
}

