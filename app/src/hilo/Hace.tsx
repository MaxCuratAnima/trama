// Lo que un líder de la app está haciendo mientras responde (B12): la tarjeta
// del chat (src/hilo/Actividad.tsx) y el de su fila en la barra, y los avisos en línea del turno (reintentos, límite,
// errores, compactar, el proceso que se muere). Cada pieza se suscribe sólo a
// lo suyo de src/hilo/vivo.ts: el texto que llega no las repinta.
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { HaceLider } from "../datos/contrato";
import { Reloj } from "../barra/piezas";
import { pintorDura } from "../tiempo";
import { coma, diaSemana, locale, t, textoError } from "../i18n";
import { useIdioma } from "../i18n/react";
import type { AvisoVisto } from "./avisos";
import { MODO } from "../modo";
import { nombreModelo } from "./opciones";
import { Tierno, useTiernos } from "./Tierno";
import { Compactando, Hojas } from "./Posta";
import { Actividad } from "./Actividad";
import { clasificar, clasificarPedido } from "./actividad-datos";
import { enCurso, indicador, razonDelTurno, razona, suscribir, type Indicador } from "./vivo";

const LEER = new Set(["Read", "WebFetch", "NotebookRead"]);
const EDITAR = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const BUSCAR = new Set(["Grep", "Glob", "WebSearch", "ToolSearch"]);
const DELEGAR = new Set(["Task", "Agent"]);
/** Lo que no dice nada concreto: con los mensajes tiernos prendidos lo reemplaza la frase. */
const GENERICO = new Set<HaceLider["que"]>(["pidiendo", "pensando", "escribiendo"]);

/** "Thinking", "Running Bash: git status", "Reading /x/y.ts"… */
export function textoHace(h: HaceLider): string {
  if (h.que !== "herramienta") return t(`hace.${h.que}`);
  const { nombre: n, detalle: d } = h;
  if (n === "Bash") return t("hace.correr", { h: d ? `Bash: ${d}` : "Bash" });
  if (!d) return t("hace.usar", { h: n });
  if (LEER.has(n)) return t("hace.leer", { d });
  if (EDITAR.has(n)) return t("hace.editar", { d });
  if (BUSCAR.has(n)) return t("hace.buscar", { d });
  if (DELEGAR.has(n)) return t("hace.delegar", { d });
  return t("hace.usar", { h: `${n}: ${d}` });
}

const miles = (n: number) => (n < 1000 ? String(n) : coma(`${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`));

/** La hora en que se reinicia un límite: "19:00", o con el día si falta más de un día. */
export function hora(hasta: number) {
  const f = new Date(hasta * 1000);
  // es-AR da "04:50 p. m.": en español, 24 h ("16:50").
  const l = locale();
  const h = f.toLocaleTimeString(l, { hour: "2-digit", minute: "2-digit", ...(l === "en-US" ? {} : { hourCycle: "h23" as const }) });
  return hasta - Date.now() / 1000 > 86_400 ? `${diaSemana(f)} ${h}` : h;
}

const ventana = (v: string | null) =>
  v === "five_hour" ? t("aviso.v5h") : v?.startsWith("seven_day") ? t("aviso.vSemana") : t("aviso.vOtro");

/** El aviso en palabras. `grave`: en rojo; `ojo`: en ámbar; si no, gris. */
export function textoAviso(a: AvisoVisto): { texto: string; tono: "grave" | "ojo" | null } {
  switch (a.clase) {
    case "reintento": {
      const s = Math.max(1, Math.round(a.espera_ms / 1000));
      const vars = { i: a.intento, max: a.max, s };
      if (a.estado === 529 || a.error === "overloaded") return { texto: t("aviso.sobrecarga", vars), tono: "ojo" };
      return { texto: t("aviso.reintento", { ...vars, e: a.estado ? ` ${a.estado}` : "" }), tono: "ojo" };
    }
    case "limite": {
      const v = ventana(a.ventana);
      const h = a.hasta ? hora(a.hasta) : null;
      if (a.rechazado)
        return { texto: h ? t("aviso.limite", { v, h }) : t("aviso.limiteSinHora", { v }), tono: "grave" };
      if (a.uso === null) return { texto: v, tono: "ojo" };
      const p = Math.round(a.uso <= 1 ? a.uso * 100 : a.uso);
      return { texto: h ? t("aviso.limiteCerca", { v, p, h }) : t("aviso.limiteCercaSinHora", { v, p }), tono: "ojo" };
    }
    case "error":
      return { texto: textoError(a.texto), tono: "grave" };
    case "compacto":
      return {
        texto: t(a.auto ? "aviso.compactoAuto" : "aviso.compacto") + (a.antes ? t("aviso.antes", { k: Math.max(1, Math.round(a.antes / 1000)) }) : ""),
        tono: null,
      };
    case "nota":
      return { texto: a.texto, tono: a.grave ? "grave" : "ojo" };
    case "modelo":
      return { texto: t("aviso.modelo", { de: nombreModelo(a.de), a: nombreModelo(a.a) }), tono: "ojo" };
    case "salio": {
      const base = a.codigo ? t("aviso.salio", { c: a.codigo }) : t("aviso.murio");
      return { texto: a.texto ? `${base}: ${textoError(a.texto)}` : base, tono: "grave" };
    }
  }
}

/** Los avisos del turno, uno por línea. */
export function Avisos({ avisos }: { avisos: AvisoVisto[] }) {
  useIdioma();
  const vis = avisos.filter((a) => !a.oculto);
  if (!vis.length) return null;
  return (
    <div className="avisos" role="status">
      {vis.map((a, i) => {
        const { texto, tono } = textoAviso(a);
        return (
          <div key={`${a.clase}:${i}`} className="aviso" data-tono={tono ?? undefined}>
            {texto}
          </div>
        );
      })}
    </div>
  );
}

const useIndicador = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => indicador(sid),
  );

/** Los pedidos de permiso sin contestar de un líder: mientras hay uno, la tarjeta dice "Te necesita". */
const usePide = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => enCurso(sid).pide,
  );

/** ¿Este líder deja ver su razonamiento (ya llegó alguno)? Si sí, la tarjeta lo muestra en vez de la frase tierna. */
export const useRazona = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => razona(sid),
  );

/** El razonamiento del turno en curso (un texto: el snapshot es estable mientras no llega más). */
const useRazon = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => razonDelTurno(sid),
  );

/** Debajo de la conversación, mientras responde: la tarjeta viva (src/hilo/Actividad.tsx) con qué hace, el tiempo y los pasos de atrás. */
export function HaceChat({ sid, modelo, effort, alParar, parando, piensa = false }: { sid: string; modelo?: string | null; effort?: string | null; alParar?: () => void; parando?: boolean; piensa?: boolean }) {
  useIdioma();
  const ind = useIndicador(sid);
  const pide = usePide(sid);
  const tierno = useTiernos();
  // Un motor que deja ver su razonamiento (Gemini; se sabe por el modelo o porque ya llegó uno): su última línea y el razonamiento
  // entero del turno en la tarjeta, en vez de la frase tierna. Claude y los que no lo traen siguen como siempre.
  const razonaYa = useRazona(sid);
  const veRazon = piensa || razonaYa;
  const razon = useRazon(sid);
  // Captura `lider-trabajando` con `HILOS_VARIANTE=listo`: la tarjeta de un turno que terminó (en vivo se va con el turno).
  if (MODO.captura === "lider-trabajando" && MODO.variante === "listo")
    return <Actividad act={clasificar({ que: "herramienta", nombre: "Bash", detalle: "npm test -- --reporter dot" })} pasos={ind.pasos} pasosN={ind.pasosN} desde={ind.desde} tokens={ind.salida > 0 ? t("hace.tokens", { n: miles(ind.salida) }) : null} modelo={modelo} effort={effort} fin="listo" />;
  if (!ind.hace) return null;
  // Compactar (B19): su figurita, no la tarjeta.
  if (ind.hace.que === "compactando") return <Compactando />;
  // Un permiso sin contestar manda: el líder está parado esperando al usuario.
  const act = pide.length ? clasificarPedido(pide[0]) : clasificar(ind.hace);
  const generico = !pide.length && GENERICO.has(ind.hace.que);
  return (
    <Actividad
      act={act}
      pasos={ind.pasos}
      pasosN={ind.pasosN}
      desde={ind.desde}
      tokens={ind.salida > 0 ? t("hace.tokens", { n: miles(ind.salida) }) : null}
      tierno={tierno && generico && !veRazon ? sid : undefined}
      razon={veRazon ? razon : undefined}
      modelo={modelo}
      effort={effort}
      alParar={alParar}
      parando={parando}
    />
  );
}

/** La segunda línea de la fila de un líder mientras compacta: las hojas, "Compactando" y, si se sabe, hace cuánto. */
export function CompactaFila({ desde }: { desde: number | null }) {
  useIdioma();
  const dura = useMemo(() => (desde !== null ? pintorDura(desde, " · ") : null), [desde]);
  return (
    <span className="s hace-s" data-compactando>
      <Hojas chica className="hojas-s" />
      <span className="hace-v">{t("hace.compactando")}</span>
      {dura ? <Reloj pintor={dura} /> : null}
    </span>
  );
}

/** La segunda línea de la fila de un líder de la app: qué hace, o `quieto` (el "hace X" de siempre). */
export function HaceFila({ sid, quieto }: { sid: string; quieto: ReactNode }) {
  useIdioma();
  const ind: Indicador = useIndicador(sid);
  const tierno = useTiernos();
  const dura = useMemo(() => (ind.desde !== null ? pintorDura(ind.desde, " · ") : null), [ind.desde]);
  if (!ind.hace) return <>{quieto}</>;
  // Compactar: las hojas, no el verbo de siempre.
  if (ind.hace.que === "compactando") return <CompactaFila desde={null} />;
  return (
    <span className="s hace-s">
      {/* Una sola línea: la frase cuando no hay nada concreto que decir; con herramienta, la herramienta. */}
      {tierno && GENERICO.has(ind.hace.que) ? <Tierno semilla={sid} className="hace-v" /> : <span className="hace-v">{textoHace(ind.hace)}</span>}
      {dura ? <Reloj pintor={dura} /> : null}
    </span>
  );
}
