// El tablero de pendientes del usuario (el CLI `tablero`). La app lo lee de `vista.json`, que el CLI
// regenera en cada escritura, y de `tablero listar` / `tablero proyectos` para lo que la vista no
// trae (lo hecho, los proyectos, los pospuestos). Todo lo que escribe lo escribe el CLI (execFile, sin shell): la
// app nunca toca `items.jsonl`. Node puro, como pa.ts, para probarlo con un tablero temporal:
//   $env:TABLERO_DIR = <carpeta temporal>; node --test tests/tablero.test.ts
import { execFileCmd } from "./procesos.ts";
import { mirarCarpeta, type Mirada } from "./mirar.ts";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { entornoPa, resolverBinario } from "./binario.ts";
import { errorT } from "./errores.ts";
import { caminos, dirTablero, type Plataforma } from "./plataforma.ts";

type Env = Record<string, string | undefined>;

/** `HILOS_TABLERO` o el `tablero` del PATH. */
export const TABLERO = resolverBinario("tablero", "HILOS_TABLERO", process.env, os.homedir());
const ENV = entornoPa(process.env, os.homedir()) as NodeJS.ProcessEnv;

/** Dónde deja el CLI la vista: la misma regla que él (`TABLERO_VISTA`, `$TABLERO_DIR/vista.json`, el estado). */
export function rutaVista(env: Env, home: string, plataforma: Plataforma = process.platform): string {
  if (env.TABLERO_VISTA) return env.TABLERO_VISTA;
  return caminos(plataforma).join(dirTablero(plataforma, env, home), "vista.json");
}

export const VISTA = rutaVista(process.env, os.homedir());

const DEBOUNCE_MS = 150;
const TOPE_MS = 15_000;
/** Lo hecho que se manda: lo cerrado en estos días. */
export const DIAS_HECHO = 7;

/** Las columnas a las que se puede mover una tarjeta (`hecho` y `tirado` van por `cerrar` y `tirar`). */
export const COLUMNAS = ["bandeja", "sigue", "en-curso", "espera-dueno", "espera-externo", "ideas"] as const;
/** Lo que entiende `--hasta`: una fecha, `hoy`, `mañana`, `+3d`, `+2s` o `ya` (lo trae de vuelta). */
const HASTA = /^(\d{4}-\d{2}-\d{2}|hoy|mañana|ya|\+\d{1,3}[ds])$/;
const LARGO_TITULO = 500;

/** Corre `tablero` y devuelve su stdout; si falla, rechaza con lo último que dijo por stderr. */
function correr(args: string[]): Promise<string> {
  return new Promise((ok, mal) => {
    execFileCmd(TABLERO, args, { env: ENV, maxBuffer: 32 * 1024 * 1024, timeout: TOPE_MS }, (err, stdout, stderr) => {
      if (!err) return ok(stdout);
      const dijo = String(stderr).trim().split("\n").filter(Boolean).slice(-2).join(" · ");
      mal(new Error(dijo || `tablero ${args[0]}: ${err.message}`));
    });
  });
}

// --- Argumentos ------------------------------------------------------------------
// Todo va validado: son argumentos de un CLI. Los valores van pegados a su flag (`--x=v`) y el
// título después de `--`: un "-" adelante no puede pasar por flag.

function idItem(x: unknown): string {
  // Llega sin el prefijo de su máquina (maquinas.ts lo saca al enrutar): `"12"` vale como 12.
  const n = Number(x);
  if (!Number.isInteger(n) || n <= 0) throw errorT("main.tableroIdRaro", { v: String(x) });
  return String(n);
}

export function argvMover(id: unknown, columna: unknown): string[] {
  if (!(COLUMNAS as readonly string[]).includes(String(columna))) throw errorT("main.tableroColumnaRara", { v: String(columna) });
  return ["mover", idItem(id), `--columna=${columna}`];
}

export const argvCerrar = (id: unknown): string[] => ["cerrar", idItem(id)];

export const argvTirar = (id: unknown): string[] => ["tirar", idItem(id)];

export function argvPosponer(id: unknown, hasta: unknown): string[] {
  const h = String(hasta ?? "").trim().toLowerCase();
  if (!HASTA.test(h)) throw errorT("main.tableroHastaRaro", { v: String(hasta) });
  return ["mover", idItem(id), `--hasta=${h}`];
}

export function argvAgregar(texto: unknown, proyecto: unknown): string[] {
  const titulo = String(texto ?? "")
    .replace(/[\r\n\0]+/g, " ")
    .trim()
    .slice(0, LARGO_TITULO);
  if (!titulo) throw errorT("main.tableroTextoVacio");
  const p = String(proyecto ?? "")
    .replace(/[\r\n\0]+/g, " ")
    .trim();
  return ["agregar", "--origen=trama", ...(p ? [`--proyecto=${p}`] : []), "--", titulo];
}

/** Lo que el usuario contestó, ya mirado: una pregunta (un botón, o texto libre), una prueba, o `null` (sacar la respuesta). */
export type RespuestaCli = { tipo: "pregunta"; opcion?: string; texto?: string } | { tipo: "prueba"; anda: boolean; nota?: string } | null;

const unaLinea = (x: unknown) =>
  String(x ?? "")
    .replace(/[\r\n\0]+/g, " ")
    .trim()
    .slice(0, LARGO_TITULO);

/** `tablero responder <id> …`: la respuesta queda en el item, que no se cierra ni se mueve. Valores pegados a su flag. */
export function argvResponder(id: unknown, r: unknown): string[] {
  const base = ["responder", idItem(id)];
  if (r === null) return [...base, "--borrar"];
  const x = r as Partial<{ tipo: unknown; opcion: unknown; texto: unknown; anda: unknown; nota: unknown }> | undefined;
  if (x?.tipo === "prueba") {
    if (typeof x.anda !== "boolean") throw errorT("main.tableroRespuestaRara");
    const nota = unaLinea(x.nota);
    return [...base, x.anda ? "--anda" : "--no-anda", ...(nota ? [`--nota=${nota}`] : [])];
  }
  if (x?.tipo === "pregunta") {
    const opcion = x.opcion == null ? "" : String(x.opcion);
    if (opcion && !/^[a-z0-9]{1,3}$/i.test(opcion)) throw errorT("main.tableroRespuestaRara");
    const texto = unaLinea(x.texto);
    if (!opcion && !texto) throw errorT("main.tableroRespuestaRara");
    return [...base, ...(texto ? [`--respuesta=${texto}`] : []), ...(opcion ? [`--opcion=${opcion}`] : [])];
  }
  throw errorT("main.tableroRespuestaRara");
}

// --- Leer ------------------------------------------------------------------------

/** Cuántos items esperan al usuario sin respuesta (el número del botón del pie), de `vista.json`: sin correr el CLI. */
export function esperanEnVista(vista: unknown): number {
  const col = (vista as { columnas?: Record<string, unknown> } | null)?.columnas?.["espera-dueno"];
  return Array.isArray(col) ? col.filter((i) => i && typeof i === "object" && !(i as { respuesta?: unknown }).respuesta).length : 0;
}

/** El número del botón del pie; `null` si no hay vista (sin tablero no hay número). */
export async function contarEsperan(): Promise<number | null> {
  try {
    return esperanEnVista(JSON.parse(await readFile(VISTA, "utf8")));
  } catch {
    return null;
  }
}

/** De lo hecho, lo cerrado en los últimos `dias`, lo más nuevo primero. */
export function recientes(items: unknown, ahora: number, dias = DIAS_HECHO): unknown[] {
  if (!Array.isArray(items)) return [];
  const desde = ahora - dias * 86_400_000;
  const cuando = (x: unknown) => Date.parse(String((x as { cerrado?: unknown })?.cerrado ?? "")) || 0;
  return items.filter((x) => cuando(x) >= desde).sort((a, b) => cuando(b) - cuando(a));
}

/** Lo que cruza al frontend, sin validar (lo mira src/datos/tablero.ts). */
export type TableroCrudo = { version: 1; vista: unknown; hecho: unknown[]; proyectos: unknown; pospuestosLista: unknown[]; aviso: string | null };

/**
 * `vista.json` más lo hecho de estos días, los proyectos (con los retirados al final) y los items pospuestos, a la vez. Sin vista
 * (`vista: null`) no hay tablero todavía: el CLI la crea con el primer pendiente, así que no se corre nada más. Otra falla al leerla
 * rechaza; si falla una de las otras, el tablero sale igual y `aviso` dice qué pasó.
 */
export async function leerTablero(): Promise<TableroCrudo> {
  const vista = await readFile(VISTA, "utf8").then(
    (s) => JSON.parse(s) as unknown,
    (e: NodeJS.ErrnoException) => {
      if (e?.code === "ENOENT") return null;
      throw errorT("main.tableroNoLee", { que: e?.code ?? "error" });
    },
  );
  if (vista === null) return { version: 1, vista, hecho: [], proyectos: [], pospuestosLista: [], aviso: null };
  let aviso: string | null = null;
  const o = (args: string[]) =>
    correr(args)
      .then((out) => JSON.parse(out) as unknown)
      .catch((e) => {
        aviso ??= String(e?.message ?? e);
        return [];
      });
  const [hecho, proyectos, pospuestosLista] = await Promise.all([
    o(["listar", "--columna", "hecho", "--json"]),
    o(["proyectos", "--retirados", "--json"]),
    o(["listar", "--pospuestos", "--json"]),
  ]);
  return { version: 1, vista, hecho: recientes(hecho, Date.now()), proyectos, pospuestosLista: Array.isArray(pospuestosLista) ? pospuestosLista : [], aviso };
}

/**
 * Avisa (con debounce) cada vez que el CLI reescribe la vista: un item cargado por voz aparece
 * sin recargar. Se mira el directorio y no el archivo: el CLI escribe un temporal y lo renombra.
 * Nada de polling.
 */
export function mirarTablero(alCambiar: () => void): () => void {
  const carpeta = path.dirname(VISTA);
  const nombre = path.basename(VISTA);
  let timer: NodeJS.Timeout | null = null;
  const programar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(alCambiar, DEBOUNCE_MS);
  };
  // Si el watcher cae, se rearma (mirar.ts).
  const mirarVista = () =>
    mirarCarpeta(carpeta, (_tipo, cual) => {
      if (cual === nombre) programar();
    }, { donde: "tablero", alRearmar: programar });
  let w: Mirada | null = mirarVista();
  // Sin carpeta todavía (el primer pendiente la crea): se mira la de arriba y, cuando aparece la del tablero, se arma ésa.
  // Un evento por carpeta, no polling. Lo que se escribió mientras tanto no llega, así que al armarse se relee.
  let arriba: Mirada | null = null;
  const armarSiAparecio = () => {
    if (w) return;
    const nueva = mirarVista();
    if (!nueva) return;
    w = nueva;
    arriba?.cerrar();
    arriba = null;
    programar();
  };
  if (!w) {
    const nombreCarpeta = path.basename(carpeta);
    arriba = mirarCarpeta(path.dirname(carpeta), (_tipo, cual) => {
      if (cual === nombreCarpeta) armarSiAparecio();
    }, { donde: "tablero" });
    armarSiAparecio();
  }
  return () => {
    if (timer) clearTimeout(timer);
    arriba?.cerrar();
    w?.cerrar();
  };
}

// --- Acciones --------------------------------------------------------------------

/** `tablero mover <id> --columna <columna>`. */
export async function mover(id: unknown, columna: unknown): Promise<void> {
  await correr(argvMover(id, columna));
}

/** `tablero cerrar <id>`: pasa a hecho. */
export async function cerrar(id: unknown): Promise<void> {
  await correr(argvCerrar(id));
}

/** `tablero tirar <id>`: no se va a hacer. */
export async function tirar(id: unknown): Promise<void> {
  await correr(argvTirar(id));
}

/** `tablero mover <id> --hasta <fecha>`: no aparece hasta ese día; con `ya` vuelve (despostergar). */
export async function posponer(id: unknown, hasta: unknown): Promise<void> {
  await correr(argvPosponer(id, hasta));
}

/** `tablero responder <id> …` (o `--borrar` con `null`). */
export async function responder(id: unknown, r: unknown): Promise<void> {
  await correr(argvResponder(id, r));
}

/** `tablero agregar "<texto>" [--proyecto P]`: cae en bandeja; devuelve el id que imprime. */
export async function agregar(texto: unknown, proyecto: unknown): Promise<number | null> {
  const n = Number((await correr(argvAgregar(texto, proyecto))).trim().split(/\s+/)[0]);
  return Number.isInteger(n) ? n : null;
}
