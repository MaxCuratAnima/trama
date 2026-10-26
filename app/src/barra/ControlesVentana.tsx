import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { main } from "../puente";

export function ControlesVentana() {
  const [maximizada, setMaximizada] = useState(false);
  const ventana = main?.ventana;

  useEffect(() => {
    if (!ventana) return;
    const chequear = () => {
      void ventana.esMaximizada().then((max: boolean) => {
        if (typeof max === "boolean") setMaximizada(max);
      });
    };
    chequear();
    window.addEventListener("resize", chequear);
    return () => window.removeEventListener("resize", chequear);
  }, [ventana]);

  if (!ventana) return null;

  return (
    <div className="controles-ventana" aria-label="Controles de ventana">
      <button
        type="button"
        className="control-btn"
        aria-label="Minimizar"
        title="Minimizar"
        onClick={() => void ventana.minimizar()}
      >
        <Minus size={13} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="control-btn"
        aria-label={maximizada ? "Restaurar" : "Maximizar"}
        title={maximizada ? "Restaurar" : "Maximizar"}
        onClick={() => {
          void ventana.maximizar().then((max: boolean) => {
            if (typeof max === "boolean") setMaximizada(max);
          });
        }}
      >
        {maximizada ? <Copy size={11} strokeWidth={1.75} /> : <Square size={11} strokeWidth={1.75} />}
      </button>
      <button
        type="button"
        className="control-btn cerrar"
        aria-label="Cerrar"
        title="Cerrar"
        onClick={() => void ventana.cerrar()}
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
