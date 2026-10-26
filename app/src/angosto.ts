// El celular: Trama por el navegador, unos 400 px de ancho y con el dedo. Dos preguntas
// distintas: si la ventana es angosta (se ve una cosa a la vez, la lista o lo abierto) y si se
// maneja con el dedo (no hay hover ni atajos). El CSS de las dos está al final de src/index.css.
import { useCallback, useEffect, useSyncExternalStore } from "react";

/** La misma consulta que el bloque angosto de src/index.css (35rem de media query: 560 px, sea cual sea la letra). */
const ANGOSTO = "(max-width: 35rem)";
const DEDO = "(pointer: coarse)";

const consulta = (q: string) => (typeof matchMedia === "function" ? matchMedia(q) : null);
const angosto = consulta(ANGOSTO);
const dedo = consulta(DEDO);

export const esAngosto = () => angosto?.matches ?? false;
/** Con el dedo: sin hover, sin atajos, y enfocar un campo abre el teclado en pantalla. */
export const esTactil = () => dedo?.matches ?? false;

const suscribir = (fn: () => void) => {
  angosto?.addEventListener("change", fn);
  return () => angosto?.removeEventListener("change", fn);
};

export function useAngosto() {
  return useSyncExternalStore(suscribir, esAngosto, () => false);
}

/**
 * El ancho intermedio: entre el celular y el escritorio holgado (67rem = 1072 px; misma consulta que el bloque de
 * src/paneles/consumo-estilos.css). Con la barra y el panel de consumo a la vez, la conversación quedaría de menos de 450 px.
 */
const MEDIO = "(max-width: 67rem)";
const medio = consulta(MEDIO);
const suscribirMedio = (fn: () => void) => {
  medio?.addEventListener("change", fn);
  return () => medio?.removeEventListener("change", fn);
};
export function useMedio() {
  return useSyncExternalStore(suscribirMedio, () => medio?.matches ?? false, () => false);
}

const MARCA = "abierto";

/**
 * El "atrás" del celular (el gesto o el botón de Android): con algo abierto hay una entrada de más
 * en el historial, y volver la gasta en vez de irse de Trama. Devuelve el volver del botón de la app,
 * que va por el mismo camino.
 */
export function useAtras(abierto: boolean, volver: () => void) {
  useEffect(() => {
    if (!abierto) return;
    if (history.state?.trama !== MARCA) history.pushState({ trama: MARCA }, "");
    addEventListener("popstate", volver);
    return () => removeEventListener("popstate", volver);
  }, [abierto, volver]);
  return useCallback(() => (history.state?.trama === MARCA ? history.back() : volver()), [volver]);
}
