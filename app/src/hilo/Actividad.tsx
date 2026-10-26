// La tarjeta de actividad del chat (dirección C, referencias/maquetas/actividad): mientras un líder de la app responde, una
// escena de 2.75rem que actúa lo que hace, el estado (punto de color + verbo), qué modelo y esfuerzo corre, lo concreto, el tiempo,
// los tokens y los pasos de atrás con su icono (los últimos tres; el resto, tras "+N pasos"), y Parar.
// Qué evento da cada tipo y cómo se limpia el detalle: src/hilo/actividad-datos.ts. El movimiento: src/barra/latido-escenas.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bot, Brain, Check, ChevronDown, FilePlus, FileText, Globe, Hand, MessageSquare, Pencil, Search, Terminal, Wrench, X, type LucideIcon } from "lucide-react";
import { latir } from "../barra/latido";
import { Reloj } from "../barra/piezas";
import { t, type Clave } from "../i18n";
import { pintorDura } from "../tiempo";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import { estadoDe, iconoDe, muyLargo, PASOS, textoPaso, type Actividad as Act, type Icono, type Paso } from "./actividad-datos";
import { Escena } from "./Escenas";
import { Tierno } from "./Tierno";

/** Una clave de `actividad-datos.ts` (viaja como texto) ya traducida. */
const tx = (clave: string, vars?: Record<string, string | number>) => (t as (k: Clave, v?: Record<string, string | number>) => string)(clave as Clave, vars);

const ICONO: Record<Icono, LucideIcon> = {
  pensar: Brain,
  leer: FileText,
  buscar: Search,
  editar: Pencil,
  escribir: FilePlus,
  correr: Terminal,
  web: Globe,
  delegar: Bot,
  texto: MessageSquare,
  permiso: Hand,
  otro: Wrench,
};

/** Lo concreto: una frase fija (con su variable, si la lleva, y con mayúscula) o el comando / archivo / patrón tal cual. */
export const textoDetalle = (a: Act) => {
  if (!a.detalleClave) return a.detalle;
  const x = tx(a.detalleClave, { d: a.detalle });
  return x.charAt(0).toUpperCase() + x.slice(1);
};

/** Un paso ya pasado en palabras, o `null` si no vale la pena mostrarlo. */
export function lineaPaso(p: Paso): string | null {
  const x = textoPaso(p);
  return x ? tx(x.clave, { d: x.d, s: x.s ?? 0 }) : null;
}

/** Un texto entero: lo muy largo se pliega (con fundido abajo) y "Ver todo" lo despliega. Nunca se corta con "…". */
function Entero({ texto, className }: { texto: string; className: string }) {
  const [abierto, setAbierto] = useState(false);
  const pliega = muyLargo(texto);
  return (
    <div className="tv-ent">
      <span className={pliega && !abierto ? `${className} tv-pliega` : className}>{texto}</span>
      {pliega ? (
        <button type="button" className="tv-mas" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {abierto ? t("hz.menos") : t("hz.todo")}
          <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** El último paso de un razonamiento: su última línea con texto, sin las marcas de markdown de los títulos (`**Leyendo el repo**`). */
export const ultimoPensado = (texto: string): string => {
  const ls = texto.split("\n").map((l) => l.trim().replace(/^#+\s*/, "").replace(/^\*\*(.+?)\*\*:?$/, "$1")).filter(Boolean);
  return ls.at(-1) ?? "";
};

/**
 * El razonamiento de un motor que lo deja ver (Gemini), discreto: su último paso en una línea y, plegado, el del turno entero
 * (una ventana que sigue lo que llega hasta que se sube). No tapa la respuesta: vive dentro de la tarjeta.
 */
function Razon({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const seg = useRef(seguidor()).current;
  const abrio = useRef(false);
  useLayoutEffect(() => {
    const u = caja.current;
    if (!u) return void (abrio.current = false);
    if (!abrio.current) {
      abrio.current = true;
      bajar(u, seg);
    } else seguir(u, seg);
  });
  const ultimo = ultimoPensado(texto);
  return (
    <div className="tv-raz">
      <div className="tv-rz-l">
        <Brain className="tv-ic" size={13} strokeWidth={1.9} aria-hidden="true" />
        <Entero texto={ultimo} className="tv-rz-p" />
      </div>
      <button type="button" className="tv-mas" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        {abierto ? t("hz.razonMenos") : t("hz.razonTodo")}
        <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {abierto ? (
        <div className="tv-rz-t" ref={caja} onScroll={(e) => alScroll(e.currentTarget, seg)}>
          {texto}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  act: Act;
  pasos: Paso[];
  /** Cuántos pasos lleva el turno (`pasos` guarda los últimos). */
  pasosN?: number;
  /** Desde cuándo responde el líder (s), o `null`. */
  desde: number | null;
  /** Los tokens de salida del turno, ya escritos ("1,2k"), o `null`. */
  tokens: string | null;
  /** Con los mensajes tiernos prendidos, la frase de siempre en vez del verbo genérico (pensando / escribiendo). */
  tierno?: string;
  /** Un motor que deja ver su razonamiento: lo que lleva el turno (puede estar vacío). `undefined`: no lo deja ver, y no se muestra nada. */
  razon?: string;
  /** Qué modelo y esfuerzo corre ("Sonnet 5.5", "high"), cuando se saben. */
  modelo?: string | null;
  effort?: string | null;
  /** Parar el turno (la misma acción que el botón de la caja). */
  alParar?: () => void;
  parando?: boolean;
  /** El turno ya terminó (`listo`) o falló (`error`): sin escena que se mueva ni Parar. */
  fin?: "listo" | "error";
};

export function Actividad({ act, pasos, pasosN, desde, tokens, tierno, razon, modelo, effort, alParar, parando, fin }: Props) {
  // La tarjeta existe sólo mientras hay actividad: el latido de las escenas corre mientras está montada.
  useEffect(() => (fin ? undefined : latir()), [fin]);
  const [todos, setTodos] = useState(false);
  const dura = useMemo(() => (desde !== null ? pintorDura(desde) : null), [desde]);
  const detalle = textoDetalle(act);
  const lineas = pasos.map((p) => ({ l: lineaPaso(p), i: iconoDe(p.hace) })).filter((x): x is { l: string; i: Icono } => x.l !== null);
  const vis = todos ? lineas : lineas.slice(0, PASOS);
  const ocultos = lineas.length - PASOS;
  const estado = fin ?? estadoDe(act);
  const verbo = fin ? t(fin === "listo" ? "hz.t.listo" : "hz.t.error") : tx(act.verbo);
  const Det = ICONO[act.icono];
  return (
    // El `key` hace que el cambio de tipo entre con su fundido (`tv-entra`); dentro de un tipo sólo cambia el texto.
    <div className="tv" key={fin ?? act.tipo} data-t={fin ? "fin" : act.tipo} data-e={estado} role="status">
      <div className="tv-tar">
        {fin ? (
          <span className="esc tv-fin" aria-hidden="true">
            {fin === "listo" ? <Check size={22} strokeWidth={2} /> : <X size={22} strokeWidth={2} />}
          </span>
        ) : (
          <Escena tipo={act.tipo} />
        )}
        <div className="tv-cu">
          <div className="tv-t1">
            <span className="tv-punto" aria-hidden="true" />
            {tierno && !fin ? <Tierno semilla={tierno} className="tv-v" limpia /> : <span className="tv-v">{verbo}</span>}
            {modelo ? (
              <span className="tv-modelo" aria-label={t("hz.modelo")}>
                {modelo}
                {effort ? <span className="tv-ef">{effort}</span> : null}
              </span>
            ) : null}
            <span className="tv-meta">
              {dura ? <Reloj pintor={dura} className="tv-x" /> : null}
              {tokens ? <span className="tv-x">{tokens}</span> : null}
              {pasosN ? <span className="tv-x">{t("hz.pasos", { n: pasosN })}</span> : null}
            </span>
          </div>
          {detalle && !fin ? (
            <div className="tv-det" data-fija={act.detalleClave ? "" : undefined}>
              {act.detalleClave ? null : <Det className="tv-ic" size={13} strokeWidth={1.9} aria-hidden="true" />}
              <Entero texto={detalle} className="tv-dt" />
              <span className="tv-vivo">{t("hz.enCurso")}</span>
            </div>
          ) : null}
          {razon && !fin ? <Razon texto={razon} /> : null}
          {vis.length ? (
            <ul className="tv-pasos">
              {vis.map((p, i) => {
                const I = ICONO[p.i];
                return (
                  <li key={i}>
                    <I className="tv-ic" size={12} strokeWidth={1.9} aria-hidden="true" />
                    <Entero texto={p.l} className="tv-pt" />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {ocultos > 0 || alParar ? (
            <div className="tv-pie">
              {ocultos > 0 ? (
                <button type="button" className="tv-mas" aria-expanded={todos} onClick={() => setTodos((x) => !x)}>
                  {todos ? t("hz.menos") : t("hz.mas", { n: ocultos })}
                  <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
              {alParar && !fin ? (
                <button type="button" className="btn2 tv-parar" disabled={parando} onClick={alParar}>
                  {parando ? t("accion.parando") : t("accion.parar")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
