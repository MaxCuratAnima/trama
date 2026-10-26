// Los mensajes tiernos (B17): donde decía "Trabajando" / "Pensando", una frase
// con carita que va cambiando. Cada cambio sale en uno de tres formatos: frase y
// carita (60 %), sólo la frase (20 %) o sólo la carita (20 %). La elige el tiempo, no un estado: cada semilla
// (el id del worker o del líder) tiene su ritmo (4 a 6 s) y su desfase, así las
// filas no cambian todas juntas, y la fila y el chat de un mismo líder dicen lo
// mismo. La escribe el reloj compartido (src/reloj.ts): rotar no re-renderiza nada.
//
// Sin React ni DOM a la fuerza: lo prueba `node --test` (tests/tierno.test.ts).
import { en } from "../i18n/en.ts";
import { t, type Clave } from "../i18n/index.ts";
import type { Pintor } from "../reloj";

type ClaveTierna = Extract<Clave, `tierno.${string}`>;
type ClaveCara = Extract<Clave, `cara.${string}`>;

/** Las frases, sin carita: las claves `tierno.NN` de los diccionarios (src/i18n). */
export const FRASES = (Object.keys(en) as Clave[]).filter((k): k is ClaveTierna => k.startsWith("tierno."));
/** Las caritas sueltas (`cara.NN`, iguales en los dos idiomas). */
export const CARAS = (Object.keys(en) as Clave[]).filter((k): k is ClaveCara => k.startsWith("cara."));

const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
/** En bench y captura la frase no rota: fotos repetibles y un reposo sin nada que se mueva. */
const fijo = !!q && (q.has("captura") || q.has("guion"));
/** Lo pone el main en la query (preferencias.json o `HILOS_TIERNOS`); default, prendidos. */
let prendidos = q?.get("tiernos") !== "0";
const oyentes = new Set<() => void>();

export const tiernos = () => prendidos;

export function cambiarTiernos(si: boolean) {
  if (si === prendidos) return;
  prendidos = si;
  for (const f of oyentes) f();
}

export function alCambiarTiernos(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** FNV-1a de 32 bits. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: un azar chico y repetible. */
function azar(semilla: number) {
  let a = semilla;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Las `n` frases barajadas para la vuelta `vuelta` de una semilla. */
function baraja(semilla: string, vuelta: number, n: number) {
  const r = azar(hash(`${semilla}:${vuelta}`));
  const b = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/**
 * Qué frase toca en el paso `paso`: cada vuelta de `n` pasos las recorre todas
 * en un orden propio, y nunca sale la misma dos veces seguidas (si una vuelta
 * arranca con la que cerró la anterior, cambia sus dos primeras de lugar).
 */
export function fraseIdx(semilla: string, paso: number, n: number): number {
  if (n < 2) return 0;
  // Con dos no hay nada que barajar: se alternan.
  if (n === 2) return (((paso + hash(semilla)) % 2) + 2) % 2;
  const vuelta = Math.floor(paso / n);
  const i = paso - vuelta * n;
  const b = baraja(semilla, vuelta, n);
  if (i < 2 && b[0] === baraja(semilla, vuelta - 1, n)[n - 1]) [b[0], b[1]] = [b[1], b[0]];
  return b[i];
}

export type Formato = "ambas" | "frase" | "cara";

/** El formato del paso `paso`: un azar propio de la semilla y el paso (60 / 20 / 20). */
export function formato(semilla: string, paso: number): Formato {
  const x = azar(hash(`${semilla}#${paso}`))();
  return x < 0.6 ? "ambas" : x < 0.8 ? "frase" : "cara";
}

/**
 * El texto del paso `paso`. La frase y la carita llevan cada una su baraja (la
 * de la carita, con otra semilla): dos pasos seguidos del mismo formato nunca
 * repiten, y de formatos distintos ya son textos distintos.
 */
export function textoTierno(semilla: string, paso: number): string {
  const f = formato(semilla, paso);
  const frase = () => t(FRASES[fraseIdx(semilla, paso, FRASES.length)]);
  const cara = () => t(CARAS[fraseIdx(`${semilla}~`, paso, CARAS.length)]);
  return f === "frase" || !CARAS.length ? frase() : f === "cara" ? cara() : `${frase()} ${cara()}`;
}

/** Cada cuánto cambia la frase de una semilla (4 a 6 s) y cuán corrida va. */
export function ritmo(semilla: string) {
  const h = hash(semilla);
  const periodo = 4 + (h % 2001) / 1000;
  return { periodo, desfase: ((h >>> 11) % 1000) / 1000 * periodo };
}

/**
 * La frase de una semilla, como pintor del reloj. `data-par` alterna en cada
 * cambio: el CSS relanza con eso la entrada (una vez, opacity y transform).
 * Apagados (Ajustes), dice `generico` y no cambia más.
 */
export const pintorTierno =
  (semilla: string, generico: () => string): Pintor =>
  (ahora) => {
    if (!prendidos || !FRASES.length) return { texto: generico(), en: Infinity, attrs: { "data-par": null } };
    if (fijo) return { texto: textoTierno(semilla, 0), en: Infinity };
    const { periodo, desfase } = ritmo(semilla);
    const paso = Math.floor((ahora + desfase) / periodo);
    return {
      texto: textoTierno(semilla, paso),
      en: (paso + 1) * periodo - (ahora + desfase),
      attrs: { "data-par": String(paso % 2) },
    };
  };
