// Un texto entero que se pliega desde 200 caracteres con "Ver todo" (nunca se corta con «…»): el resultado, el prompt y la respuesta de
// un worker (Worker.tsx). La regla de cuándo se pliega es `muyLargo` (worker-datos.ts); el estilo, entero.css. Pensado para que la
// tarjeta de actividad lo use igual.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../barra/piezas";
import { t } from "../i18n";
import "./entero-estilos.css";
import { muyLargo } from "./worker-datos";

type Props = { texto: string; tag?: "p" | "blockquote"; className?: string };

export function Entero({ texto, tag: Tag = "p", className }: Props) {
  const [abierto, setAbierto] = useState(false);
  const pliega = muyLargo(texto);
  return (
    <div className="ent">
      <Tag className={cn(className, pliega && !abierto && "ent-pliega")}>{texto}</Tag>
      {pliega ? (
        <button type="button" className="ent-mas" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {abierto ? t("wk.menos") : t("wk.todo")}
          <ChevronDown className="ent-fl" size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
