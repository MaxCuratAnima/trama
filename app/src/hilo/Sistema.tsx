// Lo de sistema en la conversación (B18, src/hilo/sistema-datos.ts), en la vista de
// un worker y en el chat de un líder: lo que dice Claude Code, una línea chica
// con su ícono (rojo el límite y los errores, gris lo demás); lo que inyecta
// como si fuera del usuario, una tarjeta centrada y plegada que al abrirse
// muestra el texto crudo. Compactar y venir de un relevo (B19), un divisor gris
// que se abre al resumen o al pedido del relevo.
import { memo, useState } from "react";
import {
  BellRing,
  ChevronRight,
  CircleSlash,
  FileText,
  FoldVertical,
  Hourglass,
  Image,
  Info,
  LifeBuoy,
  MessagesSquare,
  Puzzle,
  Repeat,
  RotateCw,
  ScrollText,
  Settings2,
  SquareSlash,
  SquareTerminal,
  TriangleAlert,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { hora } from "./Hace";
import type { ClaseTarjeta, Linea, Sistema as S, Tarjeta } from "./sistema-datos";

const ICONO: Record<ClaseTarjeta, LucideIcon> = {
  skill: Puzzle,
  tarea: BellRing,
  mensaje: MessagesSquare,
  comando: SquareSlash,
  salida: SquareTerminal,
  caveat: Info,
  recordatorio: ScrollText,
  resumen: FileText,
  hook: Webhook,
  continua: RotateCw,
  imagen: Image,
  meta: Settings2,
};

const ESTADO: Record<string, ClaveSola> = {
  completed: "sistema.tareaOk",
  failed: "sistema.tareaFallo",
  error: "sistema.tareaFallo",
  killed: "sistema.tareaParada",
  stopped: "sistema.tareaParada",
  cancelled: "sistema.tareaParada",
};

type LineaChica = Exclude<Linea, { clase: "compacto" | "viene" | "destrabo" }>;

function textoLinea(s: LineaChica): { texto: string; grave: boolean; Icono: LucideIcon } {
  switch (s.clase) {
    case "limite":
      return {
        texto: s.hasta !== null ? t(s.semana ? "sistema.limiteSemana" : "sistema.limite", { h: hora(s.hasta) }) : s.texto,
        grave: true,
        Icono: Hourglass,
      };
    case "error":
      return { texto: s.texto, grave: true, Icono: TriangleAlert };
    case "nota":
      return { texto: s.texto, grave: false, Icono: Info };
    case "interrumpido":
      return { texto: t(/tool use/.test(s.texto) ? "sistema.interrumpidoHerr" : "sistema.interrumpido"), grave: false, Icono: CircleSlash };
  }
}

/** Un divisor gris a lo ancho; con `crudo`, se abre a él (lo de adentro se arma al abrir). */
function Divisor({ Icono, texto, crudo }: { Icono: LucideIcon; texto: string; crudo: string | null }) {
  const [abierta, setAbierta] = useState(false);
  if (!crudo?.trim())
    return (
      <div className="sis-div">
        <span className="sis-div-t">
          <Icono size={12} strokeWidth={2} />
          <span>{texto}</span>
        </span>
      </div>
    );
  return (
    <details className="sis-div" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary className="sis-div-t">
        <Icono size={12} strokeWidth={2} />
        <span>{texto}</span>
        <ChevronRight className="sis-f" size={11} strokeWidth={2} />
      </summary>
      {abierta ? <pre>{crudo.trim()}</pre> : null}
    </details>
  );
}

function etiqueta(s: Tarjeta): string {
  const d = s.dato;
  switch (s.clase) {
    case "skill":
      return d ? t("sistema.skill", { n: d }) : t("sistema.skillSin");
    case "tarea": {
      const base = d ? t("sistema.tarea", { d }) : t("sistema.tareaSin");
      const e = s.estado ? (ESTADO[s.estado] ? t(ESTADO[s.estado]) : s.estado) : null;
      return e ? `${base} (${e})` : base;
    }
    case "mensaje":
      return d ? t("sistema.mensaje", { n: d }) : t("sistema.mensajeSin");
    case "comando":
      return d ? t("sistema.comando", { c: d }) : t("sistema.comandoSin");
    case "salida":
      return d ? t("sistema.salida", { d }) : t("sistema.salidaSin");
    default:
      return t(SOLA[s.clase]);
  }
}

const SOLA: Record<Exclude<ClaseTarjeta, "skill" | "tarea" | "mensaje" | "comando" | "salida">, ClaveSola> = {
  caveat: "sistema.caveat",
  recordatorio: "sistema.recordatorio",
  resumen: "sistema.resumen",
  hook: "sistema.hook",
  continua: "sistema.continua",
  imagen: "sistema.imagen",
  meta: "sistema.meta",
};

function Tarjeta_({ s }: { s: Tarjeta }) {
  // Captura con `HILOS_VARIANTE=abierta`: la de la skill, abierta.
  const [abierta, setAbierta] = useState(() => MODO.captura !== null && MODO.variante === "abierta" && s.clase === "skill");
  const Icono = ICONO[s.clase];
  return (
    <details className="sis-t" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>
        <Icono size={12} strokeWidth={2} />
        <span>{etiqueta(s)}</span>
        <ChevronRight className="sis-f" size={11} strokeWidth={2} />
      </summary>
      {/* El texto crudo se arma recién al abrir: el resumen de compactar pesa. */}
      {abierta ? <pre>{s.crudo.trim()}</pre> : null}
    </details>
  );
}

/** `nombre`: el del líder, para "Viene de …" (los workers no tienen relevo). */
type Props = { s: S; nombre?: string | null };

/** Cada pasada de `turnos()` arma objetos nuevos: lo de un mismo mensaje no cambia (el crudo, sin serializar: pesa). */
const igual = ({ s: a, nombre: na }: Props, { s: b, nombre: nb }: Props) =>
  na === nb &&
  (a === b ||
  (a.tipo === "tarjeta" && b.tipo === "tarjeta"
    ? a.clase === b.clase && a.dato === b.dato && a.estado === b.estado && a.crudo === b.crudo
    : a.tipo === "linea" && b.tipo === "linea" && JSON.stringify(a) === JSON.stringify(b)));

/** Una línea o una tarjeta de sistema. */
export const Sistema = memo(function Sistema({ s, nombre }: Props) {
  useIdioma();
  if (s.tipo === "tarjeta") return <Tarjeta_ s={s} />;
  if (s.clase === "compacto") {
    const k = s.antes ? t("aviso.antes", { k: Math.max(1, Math.round(s.antes / 1000)) }) : "";
    return <Divisor Icono={FoldVertical} texto={t(s.auto ? "sistema.compactadaAuto" : "sistema.compactada") + k} crudo={s.resumen ?? null} />;
  }
  if (s.clase === "destrabo")
    return <Divisor Icono={LifeBuoy} texto={t(s.agotado ? "hz.destraboTope" : "hz.destrabo", { que: s.que })} crudo={null} />;
  if (s.clase === "viene")
    return <Divisor Icono={Repeat} texto={nombre ? t("relevo.viene", { n: nombre }) : t("relevo.vieneSin")} crudo={s.texto} />;
  const { texto, grave, Icono } = textoLinea(s);
  // El límite dice la hora en palabras de la app; el texto de `claude`, al pasar el mouse.
  const crudo = s.clase === "limite" && s.hasta !== null ? s.texto : undefined;
  return (
    <div className="sis" data-tono={grave ? "grave" : undefined} data-tip={crudo}>
      <Icono size={12} strokeWidth={2} />
      <span>{texto}</span>
    </div>
  );
}, igual);
