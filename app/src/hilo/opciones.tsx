// Lo que ofrecen los selectores de modelo y esfuerzo (Vista y Nueva tarea).
// Se ofrece todo (directiva 3): `pa` rechaza lo que no va y la app muestra su
// mensaje. "default" es la tabla de routing de ~/CLAUDE.md para un worker que
// escribe código. `clave` es lo que se busca en el id de modelo de un hilo.
import { t, type ClaveSola } from "../i18n";
import type { Opcion } from "./Selector";
import { GENERAL, type Lider } from "../datos/contrato";
import { parsearModelo } from "../datos/modelo-id.ts";
import { defDe, effortDeModelo, effortsDe, EMPRESAS, ponerConfig, TABLA, type ConfigModelos, type ModeloDef } from "./modelos";
import { Logo } from "./Logos";

// La descripción se dice al leerla: cambia con el idioma sin rearmar las listas.
// (Un spread `{ ...o }` copia el texto del momento: hacerlo al pintar.)
const desc = <T extends object>(o: T, clave: ClaveSola) =>
  Object.defineProperty(o, "desc", { get: () => t(clave), enumerable: true }) as T & { desc: string };

/** Cada modelo, bajo el divisor de su empresa y con su logo delante; los locales, además, con el chip de la GPU (`local`). */
const opcionDe = (m: ModeloDef) =>
  desc({ id: m.id, clave: m.clave, nombre: m.nombre, grupo: m.empresaNombre ?? EMPRESAS[m.empresa], marca: <Logo empresa={m.empresa} />, ...(m.rec ? { rec: true } : {}), ...(m.local ? { local: true } : {}) }, m.desc);
export const MODELOS: (Opcion & { clave: string })[] = TABLA.map(opcionDe);

/** Los modelos de un worker de `pa` (`-m`): los mismos, sin los que sólo corren en un líder (los locales, Gemini, Ollama). */
export const MODELOS_WORKER: (Opcion & { clave: string })[] = MODELOS.filter((m) => !m.local);

/**
 * `modelos.json` (src/datos/modelos-config.ts): las filas de Gemini y de Ollama que pide, y el líder por defecto. Cambia los arreglos
 * en su lugar (quien los importó los sigue viendo) y se llama una sola vez, antes de pintar. Sin el archivo no cambia nada.
 */
export function aplicarModelos(c: ConfigModelos | null) {
  const lider = ponerConfig(c);
  MODELOS.splice(0, MODELOS.length, ...TABLA.map(opcionDe));
  MODELOS_WORKER.splice(0, MODELOS_WORKER.length, ...MODELOS.filter((m) => !defDe(m.id)?.local && !defDe(m.id)?.soloLider));
  MODELO_DEFAULT = lider?.modelo ?? "claude-opus-5-5";
}

const Nivel = ({ n }: { n: number }) => (
  <span className="nivel" aria-hidden="true">
    {[1, 2, 3, 4].map((k) => (
      <i key={k} data-on={k <= n ? "" : undefined} />
    ))}
  </span>
);

const DESC_EFFORT: Record<string, ClaveSola> = {
  off: "effort.off",
  low: "effort.low",
  medium: "effort.medium",
  high: "effort.high",
  xhigh: "effort.xhigh",
  max: "effort.max",
};

/**
 * Los niveles de esfuerzo de un modelo (src/hilo/modelos.ts): los suyos y en su orden, con las barritas según el
 * lugar que ocupa cada uno en su lista. El de arranque del modelo lleva la marca de default.
 */
export function effortsOpciones(modelo: string | null | undefined): Opcion[] {
  const def = defDe(modelo);
  return effortsDe(modelo).map((id, i) => desc({ id, nombre: id, marca: <Nivel n={i} />, ...((def?.effortDefecto ?? "high") === id ? { rec: true } : {}) }, DESC_EFFORT[id]!));
}

export let MODELO_DEFAULT = "claude-opus-5-5";
export const EFFORT_DEFAULT = "high";

/** El id del selector para el modelo de un hilo ("claude-sonnet-5-5[1m]" → Sonnet). */
export const modeloDe = (m: string | null | undefined) => defDe(m)?.id ?? null;

/** Lo que junta las filas del consumo: la fila del selector o, si no hay, el id sin fecha ni nivel (`agy:claude-opus-5-5-high` y `-low` son uno). */
export const claveConsumo = (m: string) => modeloDe(m) ?? (parsearModelo(m).id || m);

/** El esfuerzo si es un nivel del modelo (sin modelo, de cualquiera); si no, `null`. */
export const effortDe = (e: string | null | undefined, modelo?: string | null) =>
  modelo ? effortDeModelo(modelo, e) : (Object.keys(DESC_EFFORT).find((x) => x === e) ?? null);

/** Cómo se llama un modelo: el de la tabla o, si no está, el que dice su id ("Claude Opus 5.5 · por Google"). */
export const nombreModelo = (id: string) => MODELOS.find((m) => m.id === id)?.nombre ?? (parsearModelo(id).etiqueta || id);

/** Un líder recién lanzado, hasta que el statusline lo lista. */
export function fantasma(sid: string, e: { modelo: string; effort: string; modo?: string; texto?: string; maquina?: string }, proyecto: string = GENERAL): Lider {
  const ahora = Math.floor(Date.now() / 1000);
  return {
    id: sid,
    // Como lo nombra el main (B20): la primera línea de su primer mensaje.
    nombre: primeraLinea(e.texto ?? ""),
    proyecto,
    titulo: nombreModelo(e.modelo),
    actividad: ahora,
    creado: ahora,
    cache_ttl_s: null,
    cache_vence: 0,
    origen: "app",
    pid: null,
    vivo: true,
    ocupado: true,
    modelo: e.modelo,
    effort: e.effort,
    modo: e.modo,
    ...(e.maquina ? { maquina: e.maquina } : {}),
  };
}

/** Lo primero que dice un texto, en una línea (el título de un líder sin otro). */
export const primeraLinea = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x !== "")
    ?.replace(/\s+/g, " ") ?? "";
