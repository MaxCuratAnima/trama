// Los paneles del pie de la barra (Ajustes, Ramas, Estadísticas, Tablero): ocupan
// el lado derecho, donde va la conversación. Esc o otro clic en el botón del pie los cierra.
import { useRef } from "react";
import { useFoco } from "../foco";
import { Ajustes } from "./Ajustes";
import { Estadisticas } from "./Estadisticas";
import { Ramas, type PropsRamas } from "./Ramas";
import { Tablero, type PropsTablero } from "./Tablero";
import { TableroNuevo } from "./TableroNuevo";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Lado } from "../hilo/Lado";
import "./paneles.css";
import "./lavado.css";

export type CualPanel = "ajustes" | "ramas" | "estadisticas" | "tablero";

export const PANELES: Record<CualPanel, ClaveSola> = {
  ajustes: "panel.ajustes",
  ramas: "panel.ramas",
  estadisticas: "panel.estadisticas",
  tablero: "panel.tablero",
};

type Props = {
  cual: CualPanel;
  barraAbierta: boolean;
  alAlternarBarra: () => void;
  alVolver: () => void;
  ramas: PropsRamas;
  tablero: PropsTablero;
};

export function Panel({ cual, barraAbierta, alAlternarBarra, ramas, tablero }: Props) {
  useIdioma();
  // El foco entra al panel al abrirlo (Tab sigue por su contenido) y, al cerrarlo, vuelve al botón del pie que lo abrió; Esc lo maneja la barra.
  const raiz = useRef<HTMLElement>(null);
  useFoco(raiz, { atrapar: false, enfocar: "raiz" });
  const lado = barraAbierta ? t("panel.ocultarBarra") : t("panel.mostrarBarra");
  return (
    <main ref={raiz} className="hilo pn-main" tabIndex={-1} aria-label={t(PANELES[cual])}>
      <header className="migas">
        <Lado etq={lado} alAlternar={alAlternarBarra} />
        <div className="ruta" data-desliza>
          <b>{t(PANELES[cual])}</b>
        </div>
      </header>
      <div className="conv-zona">
        {/* La clave: al cambiar de panel el contenido entra de nuevo. */}
        <div key={cual} className={cual === "tablero" ? "pn pn-tablero" : cual === "ajustes" ? "pn pn-ajustes" : "pn"} data-desliza>
          {cual === "ajustes" ? (
            <Ajustes />
          ) : cual === "ramas" ? (
            <Ramas {...ramas} />
          ) : cual === "estadisticas" ? (
            <Estadisticas />
          ) : (
            // El tablero nuevo (lo que le toca al usuario); el kanban de siempre es su pestaña "Todo".
            <TableroNuevo todo={<Tablero {...tablero} />} carpetas={tablero.carpetas} lideres={tablero.lideres} alRedactar={tablero.alRedactar} avisar={tablero.avisar} />
          )}
        </div>
      </div>
    </main>
  );
}
