// Las ocho escenas de 44 px de la tarjeta de actividad (dirección C, referencias/maquetas/actividad/c-tarjeta.html). Son
// dibujos quietos: el movimiento de cada pieza (`e-…`) lo pone `src/barra/latido-escenas.ts`; sin él (movimiento reducido)
// quedan en la pose que fija el CSS ("escenas" en src/index.css). El color sale de `currentColor` (`--c` del tipo).
import type { ReactNode } from "react";
import type { Tipo } from "./actividad-datos";

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** `data-d`: el atraso en ms de esa pieza (lo que en la maqueta era un `animation-delay`). */
const ESCENAS: Record<Tipo, () => ReactNode> = {
  pensando: () => (
    <Svg>
      <circle className="e-onda" cx="22" cy="22" r="6.5" />
      <circle className="e-onda" data-d="1100" cx="22" cy="22" r="6.5" />
      <circle className="e-nuc" cx="22" cy="22" r="5.5" fill="currentColor" stroke="none" />
    </Svg>
  ),
  web: () => (
    <Svg>
      <circle cx="22" cy="22" r="12.5" />
      <path d="M9.5 22h25M11.6 15.6h20.8M11.6 28.4h20.8" opacity=".55" />
      <ellipse className="e-mer" cx="22" cy="22" rx="5.6" ry="12.5" />
      <g className="e-orb vb">
        <circle cx="22" cy="3.4" r="2.1" fill="currentColor" stroke="none" />
      </g>
    </Svg>
  ),
  codigo: () => (
    <Svg>
      <rect x="8" y="6" width="28" height="32" rx="3.5" />
      <rect className="e-banda" x="9" y="9" width="26" height="5.4" fill="currentColor" fillOpacity=".2" stroke="none" />
      <g fill="currentColor" stroke="none" opacity=".55">
        <rect x="12" y="10.4" width="19" height="2.4" rx="1.2" />
        <rect x="12" y="15.4" width="12" height="2.4" rx="1.2" />
        <rect x="12" y="20.4" width="21" height="2.4" rx="1.2" />
        <rect x="12" y="25.4" width="9" height="2.4" rx="1.2" />
        <rect x="12" y="30.4" width="16" height="2.4" rx="1.2" />
      </g>
    </Svg>
  ),
  editando: () => (
    <Svg>
      <g className="e-viejo" stroke="none">
        <rect x="8" y="14.2" width="4.5" height="1.8" rx=".9" className="tv-quita" />
        <rect x="15" y="13.4" width="21" height="3.4" rx="1.7" className="tv-quita tv-quita-fondo" />
      </g>
      <g stroke="none">
        <rect x="8" y="27.2" width="4.5" height="1.8" rx=".9" fill="currentColor" />
        <rect x="9.35" y="25.85" width="1.8" height="4.5" rx=".9" fill="currentColor" />
        <rect className="e-nuevo izq" x="15" y="26.4" width="21" height="3.4" rx="1.7" fill="currentColor" />
      </g>
    </Svg>
  ),
  comando: () => (
    <Svg>
      <rect x="4" y="8" width="36" height="28" rx="4.5" />
      <path d="M10 17.5 15 21.5 10 25.5" />
      <g stroke="none" fill="currentColor">
        <rect className="e-tip izq" x="19" y="19.8" width="15" height="3.4" rx="1.7" />
        <rect className="e-cur" x="18.4" y="17.6" width="2" height="7.6" rx="1" />
        <rect className="e-sal" x="10" y="28" width="22" height="2.2" rx="1.1" />
        <rect className="e-sal" data-d="250" x="10" y="31.6" width="14" height="2.2" rx="1.1" />
      </g>
    </Svg>
  ),
  delegando: () => (
    <Svg>
      <path d="M22 14v7M22 21H11v9M22 21h11v9" opacity=".4" />
      <circle cx="22" cy="10" r="4.5" />
      <circle cx="11" cy="34" r="4.2" opacity=".5" />
      <circle cx="33" cy="34" r="4.2" opacity=".5" />
      <circle className="e-luz" cx="11" cy="34" r="2.2" fill="currentColor" stroke="none" />
      <circle className="e-luz" data-d="450" cx="33" cy="34" r="2.2" fill="currentColor" stroke="none" />
      <g fill="currentColor" stroke="none">
        <circle className="e-pa" cx="22" cy="14" r="1.9" />
        <circle className="e-pb" data-d="450" cx="22" cy="14" r="1.9" />
      </g>
    </Svg>
  ),
  permiso: () => (
    <Svg>
      <circle className="e-anillo" cx="22" cy="22" r="15" />
      <g className="e-pausa" fill="currentColor" stroke="none">
        <rect x="16.5" y="14.5" width="4" height="15" rx="1.2" />
        <rect x="23.5" y="14.5" width="4" height="15" rx="1.2" />
      </g>
    </Svg>
  ),
  escribiendo: () => (
    <Svg>
      <g fill="currentColor" stroke="none">
        <rect className="e-ln izq" x="8" y="9" width="28" height="3" rx="1.5" />
        <rect className="e-ln izq" data-d="500" x="8" y="16" width="28" height="3" rx="1.5" />
        <rect className="e-ln izq" data-d="1000" x="8" y="23" width="28" height="3" rx="1.5" />
        <rect className="e-ln izq" data-d="1500" x="8" y="30" width="14" height="3" rx="1.5" />
        <rect className="e-cursor" x="25" y="29" width="1.8" height="5" rx=".9" />
      </g>
    </Svg>
  ),
};

/** La escena de un tipo, en su cajita de 44 px. */
export function Escena({ tipo }: { tipo: Tipo }) {
  return <div className="esc">{ESCENAS[tipo]()}</div>;
}
