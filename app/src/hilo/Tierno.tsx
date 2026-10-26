// La frase tierna que rota donde decía "Trabajando" / "Pensando" (B17,
// src/hilo/tierno-datos.ts). La escribe el reloj: cambiar de frase no re-renderiza.
// Quien la usa pregunta `useTiernos()` y, apagados, pinta lo de siempre.
import { useMemo, useSyncExternalStore } from "react";
import { Reloj } from "../barra/piezas";
import { t } from "../i18n";
import { alCambiarTiernos, pintorTierno, tiernos } from "./tierno-datos";

/** Prendidos o apagados (Ajustes): quien lo usa se vuelve a pintar al cambiar. */
export const useTiernos = () => useSyncExternalStore(alCambiarTiernos, tiernos);

const trabajando = () => t("estado.trabajando");

/** `semilla`: el id del worker o del líder; cada una rota a su ritmo. `limpia`: sin los `*asteriscos` de las acciones ("*nibbles the bug*" → "nibbles the bug"). */
export function Tierno({ semilla, className, limpia }: { semilla: string; className?: string; limpia?: boolean }) {
  const pintor = useMemo(() => {
    const p = pintorTierno(semilla, trabajando);
    return limpia ? (ahora: number) => {
          const x = p(ahora);
          return { ...x, texto: x.texto.replace(/\*/g, "") };
        } : p;
  }, [semilla, limpia]);
  return <Reloj pintor={pintor} className={className ? `tierno ${className}` : "tierno"} />;
}
