// Volver como estaba en TODO arranque (un Ctrl+Q, un apagón, el reinicio del cartel de la actualización):
// `$HILOS_STATE/volver.json` guarda cómo está la ventana (tamaño; y, si el usuario tocó Reiniciar, a la vista,
// con el foco) y lo que cada vista tiene abierto (conversación, panel,
// scroll). Se reescribe con cada cambio (demorado, `crearGuardadoVolver`) y no se gasta al leerlo: la trama
// que arranca lo lee y lo deja. Lo escrito sin mandar no va acá: `electron/borradores.ts`.
// Sin `electron` ni imports locales: lo prueba tests/volver.test.ts. Lo arman main.ts e ipc.ts (la ventana).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Lo más grande que se guarda de una vista. */
const VISTA_MAX = 2 * 1024 * 1024;
/** Cuánto se espera, tras un cambio, antes de escribir (los cambios seguidos, como un scroll, hacen una sola escritura). */
export const DEMORA_MS = 500;

export type Ventana = { ancho: number; alto: number; visible: boolean; foco: boolean };
/** `vistas`: lo que mandó cada vista (la ventana: "ventana"), tal cual; lo entiende el renderer (src/volver.ts). */
export type Volver = { version: 1; cuando: number; ventana: Ventana | null; vistas: Record<string, unknown> };

const entero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Lo que dejó la trama anterior. Roto, de otra versión o ausente: `null` (se abre como siempre). */
export function leerVolver(archivo: string): Volver | null {
  try {
    const j = JSON.parse(readFileSync(archivo, "utf8")) as Partial<Volver> | null;
    if (j?.version !== 1 || !entero(j.cuando)) return null;
    const v = j.ventana as Partial<Ventana> | null | undefined;
    const ventana = v && entero(v.ancho) && entero(v.alto) && v.ancho >= 200 && v.alto >= 200
      ? { ancho: Math.round(v.ancho), alto: Math.round(v.alto), visible: v.visible === true, foco: v.foco === true }
      : null;
    const vistas = j.vistas && typeof j.vistas === "object" && !Array.isArray(j.vistas) ? (j.vistas as Record<string, unknown>) : {};
    return { version: 1, cuando: j.cuando, ventana, vistas };
  } catch {
    return null;
  }
}

/** Escribe sin que nadie lea el archivo a medias (tmp + rename). */
export function guardarVolver(archivo: string, v: Omit<Volver, "version" | "cuando">, ahora = Date.now()) {
  mkdirSync(path.dirname(archivo), { recursive: true });
  const vistas: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v.vistas)) {
    try {
      if (JSON.stringify(x).length <= VISTA_MAX) vistas[k] = x;
    } catch {}
  }
  const tmp = `${archivo}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, cuando: ahora, ventana: v.ventana, vistas }));
  renameSync(tmp, archivo);
}

/**
 * Mantiene `volver.json` al día sin que nadie lo pida: la ventana avisa lo que tiene abierto (`vista`) y
 * el main que cambió su tamaño (`tocar`); cada aviso programa una escritura a los `demoraMs` (los seguidos
 * hacen una). `ahora` escribe ya (al salir). `congelar` la deja quieta: el reinicio del cartel escribe lo suyo
 * y no quiere que la salida le pise el archivo.
 */
export function crearGuardadoVolver(o: { archivo: string; ventana: () => Ventana | null; vistaInicial?: unknown; demoraMs?: number }) {
  let vista: unknown = o.vistaInicial ?? null;
  let t: NodeJS.Timeout | null = null;
  let quieto = false;
  const escribir = () => {
    if (t) clearTimeout(t);
    t = null;
    if (quieto) return;
    try {
      guardarVolver(o.archivo, { ventana: o.ventana(), vistas: vista === null ? {} : { ventana: vista } });
    } catch {
      // Sin disco no hay con qué volver; la app sigue.
    }
  };
  const programar = () => {
    if (quieto || t) return;
    t = setTimeout(escribir, o.demoraMs ?? DEMORA_MS);
    t.unref();
  };
  return {
    /** Lo que la ventana tiene abierto ahora. */
    vista(v: unknown) {
      vista = v;
      programar();
    },
    /** La ventana cambió de tamaño. */
    tocar: programar,
    ahora: escribir,
    congelar() {
      quieto = true;
      if (t) clearTimeout(t);
      t = null;
    },
  };
}
