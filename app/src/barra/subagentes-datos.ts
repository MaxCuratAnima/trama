// Los subagentes que lanza cada sesión con su herramienta Agent (electron/subagentes.ts, por src/datos/fuente.ts):
// se piden una sola vez, cuando alguien pregunta por primera vez, y después llega cada cambio. Cada fila se suscribe
// sólo a su sesión: que otra lance un subagente no la repinta.
import { useSyncExternalStore } from "react";
import type { Subagente, Subagentes } from "../../electron/subagentes";
import { fuente } from "../datos/fuente";

let actual: Subagentes = {};
let pedido = false;
const oyentes = new Set<() => void>();
const SIN: readonly Subagente[] = [];

/**
 * Un subagente "corriendo" que no escribe nada hace tanto es de una sesión que se reinició o lo perdió (sus
 * mensajes quedan en disco para siempre): no cuenta como activo. Una herramienta larga (un build) cabe de sobra.
 */
export const OBSOLETO_S = 30 * 60;

export const activo = (u: Subagente, ahora = Math.floor(Date.now() / 1000)) => u.estado === "corriendo" && ahora - u.ultimo_en < OBSOLETO_S;

/** Los que corren de verdad ahora. */
export const corriendo = (lista: readonly Subagente[], ahora?: number) => lista.filter((u) => activo(u, ahora));

function poner(s: Subagentes) {
  actual = s;
  oyentes.forEach((f) => f());
}

function suscribir(fn: () => void) {
  if (!pedido) {
    pedido = true;
    // Si un cambio llega antes que la primera lectura, la lectura ya es vieja.
    let llego = false;
    fuente.alCambiarSubagentes((s) => {
      llego = true;
      poner(s);
    });
    void fuente.subagentes().then((s) => !llego && poner(s), () => {});
  }
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

/** Los subagentes de una sesión (el más nuevo primero), o ninguno. */
export const useSubagentes = (sid: string | null): readonly Subagente[] =>
  useSyncExternalStore(suscribir, () => (sid ? (actual[sid] ?? SIN) : SIN));

/** Los de todas las sesiones: la barra suma cuántos corren por líder. */
export const useTodosSubagentes = (): Subagentes => useSyncExternalStore(suscribir, () => actual);
