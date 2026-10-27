// El subagente que se está mirando en el panel derecho (sus pasos: comandos, tiempos, razonamiento). Al tocar uno en la barra se
// elige; al abrir cualquier otra cosa (un worker, un líder, un panel) se suelta. Uno solo a la vez, como el hilo activo.
import { useSyncExternalStore } from "react";
import type { Subagente } from "../../electron/subagentes";

let visto: Subagente | null = null;
const oyentes = new Set<() => void>();

const avisar = () => oyentes.forEach((f) => f());

/** Mirar los pasos de este subagente (la fila se actualiza sola mientras corre: se repite con la versión nueva). */
export function verSubagente(u: Subagente): void {
  visto = u;
  avisar();
}

/** Dejar de mirar (se abrió otra cosa). */
export function soltarSubagente(): void {
  if (!visto) return;
  visto = null;
  avisar();
}

/** Mantiene el subagente visto al día con lo que dice la barra de él (estado, último mensaje). */
export function refrescarSubagente(u: Subagente): void {
  if (visto && visto.id === u.id && visto.sid === u.sid && visto !== u) {
    visto = u;
    avisar();
  }
}

export const useSubagenteVisto = (): Subagente | null =>
  useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => void oyentes.delete(fn);
    },
    () => visto,
  );
