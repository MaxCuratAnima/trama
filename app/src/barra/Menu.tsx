// El menú del clic derecho de la barra (B20) y el campo para renombrar en
// línea. Dibujados a mano (nada de menú nativo), en un portal con posición
// fija: flechas, Inicio/Fin, Enter o Espacio; Esc vuelve un nivel o cierra; un
// clic afuera, Tab, irse de la ventana o que la fila se corra (scroll) también
// cierran. Qué ofrece cada fila lo decide `menu-datos.ts`.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t as tr } from "../i18n";

export type ItemMenu = {
  clave: string;
  texto: string;
  /** Lo que dice armado: el primer Enter/clic sólo pregunta, el segundo hace. */
  seguro?: string;
  peligro?: boolean;
  /** Abre otro nivel (Mover a proyecto…): lleva la flecha. */
  sub?: boolean;
  /** Marcado (la carpeta actual en Mover a…). */
  marcado?: boolean;
  /** Un dato corto y apagado a la derecha (el lugar donde está ahora, si no está marcado). */
  nota?: string;
  /** Siempre se ve, aunque lo escrito en el buscador no lo nombre (Automático). */
  fijo?: boolean;
  alElegir: () => void;
};

type Props = {
  x: number;
  y: number;
  items: ItemMenu[];
  /** Qué nivel se ve (el menú de la fila o un submenú): al cambiar, el foco vuelve al primero. */
  nivel: string;
  /** Cerrar sin elegir. */
  alCerrar: () => void;
  /** En un submenú: Esc o ← vuelven al de antes. */
  alVolver?: () => void;
  /** Lo que lo abrió (la fila): si un scroll la corre, se cierra. */
  ancla?: HTMLElement | null;
  /** Con muchos ítems, un campo para filtrarlos escribiendo (los `fijo` quedan). */
  buscable?: boolean;
};

const MARGEN = 8;
/** Desde cuántos ítems vale la pena el buscador. */
const MUCHOS = 8;

/**
 * Un scroll que corre a `ancla` (o la saca del DOM) llama a `alMoverse`. Uno que
 * no la mueve (el anclaje de scroll de Chromium cuando cambia algo de arriba al
 * llegar datos nuevos) no: el menú sigue en su lugar.
 */
function useAncla(ancla: HTMLElement | null | undefined, propio: RefObject<HTMLElement | null>, alMoverse: () => void) {
  const fn = useRef(alMoverse);
  fn.current = alMoverse;
  useEffect(() => {
    const y0 = ancla?.getBoundingClientRect().top ?? 0;
    const scroll = (e: Event) => {
      if (propio.current?.contains(e.target as Node)) return;
      if (!ancla?.isConnected || Math.abs(ancla.getBoundingClientRect().top - y0) > 1) fn.current();
    };
    document.addEventListener("scroll", scroll, true);
    return () => document.removeEventListener("scroll", scroll, true);
  }, [ancla, propio]);
}

export function Menu({ x, y, items, nivel, alCerrar, alVolver, ancla, buscable }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [armado, setArmado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  const conBuscador = !!buscable && items.length > MUCHOS;
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return q ? items.filter((it) => it.fijo || it.texto.toLowerCase().includes(q)) : items;
  }, [items, filtro]);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;

  // Que entre en la ventana, y el foco al primer ítem (también al cambiar de nivel;
  // no cuando la barra re-renderiza con datos nuevos).
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGEN, Math.min(x, innerWidth - r.width - MARGEN)),
      top: Math.max(MARGEN, y + r.height > innerHeight - MARGEN ? y - r.height : y),
    });
    // Con el dedo el campo no se enfoca solo (levantaría el teclado).
    if (conBuscador && !matchMedia("(pointer: coarse)").matches) campo.current?.focus();
    else el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    // La carpeta marcada a la vista aunque la lista sea larga.
    el.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    setArmado(null);
  }, [x, y, nivel]);

  useAncla(ancla, caja, () => cerrar.current());

  // Afuera, ventana sin foco o cambiar de tamaño: se cierra.
  useEffect(() => {
    const afuera = (e: Event) => {
      if (!caja.current?.contains(e.target as Node)) cerrar.current();
    };
    const fuera = () => cerrar.current();
    document.addEventListener("pointerdown", afuera, true);
    window.addEventListener("blur", fuera);
    window.addEventListener("resize", fuera);
    return () => {
      document.removeEventListener("pointerdown", afuera, true);
      window.removeEventListener("blur", fuera);
      window.removeEventListener("resize", fuera);
    };
  }, []);

  const tecla = (e: KeyboardEvent) => {
    const ops = [...(caja.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = ops.indexOf(document.activeElement as HTMLElement);
    // En el buscador: ↓ baja a la lista, Enter elige la primera coincidencia, Esc borra lo escrito (y, vacío, vuelve); lo demás es escribir.
    if (e.target === campo.current) {
      e.stopPropagation();
      if (e.key === "ArrowDown") ops[0]?.focus();
      else if (e.key === "ArrowUp") ops.at(-1)?.focus();
      else if (e.key === "Enter") caja.current?.querySelector<HTMLElement>('[role="menuitem"][data-accion]:not([data-fijo])')?.click();
      else if (e.key === "Escape" && filtro) setFiltro("");
      else if (e.key === "Escape" || e.key === "Tab") return void (e.key === "Tab" || !alVolver ? alCerrar() : alVolver());
      else return;
      e.preventDefault();
      return;
    }
    const ir = (k: number) => ops[(k + ops.length) % ops.length]?.focus();
    // Nada de lo que pasa en el menú llega a la barra (j/k, Esc, Enter).
    e.stopPropagation();
    switch (e.key) {
      case "ArrowDown":
        ir(i + 1);
        break;
      case "ArrowUp":
        if (i === 0 && conBuscador) campo.current?.focus();
        else ir(i < 0 ? -1 : i - 1);
        break;
      case "Home":
        ir(0);
        break;
      case "End":
        ir(-1);
        break;
      case "ArrowRight":
        if (i >= 0 && ops[i].dataset.sub !== undefined) ops[i].click();
        break;
      case "ArrowLeft":
        if (!alVolver) return;
        alVolver();
        break;
      case "Escape":
        if (alVolver) alVolver();
        else alCerrar();
        break;
      case "Tab":
        alCerrar();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return createPortal(
    <motion.div
      ref={caja}
      role="menu"
      aria-label={tr("menu.aria")}
      className="cmenu"
      style={{ left: pos.left, top: pos.top } as CSSProperties}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
      onKeyDown={tecla}
      onContextMenu={(e) => e.preventDefault()}
    >
      {alVolver ? (
        <button type="button" role="menuitem" className="cmenu-op cmenu-volver" onClick={alVolver}>
          <ChevronLeft size={12} strokeWidth={2} />
          {tr("menu.volver")}
        </button>
      ) : null}
      {conBuscador ? (
        <input
          ref={campo}
          className="cmenu-buscar"
          type="text"
          value={filtro}
          placeholder={tr("menu.buscar")}
          aria-label={tr("menu.buscar")}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setFiltro(e.target.value)}
        />
      ) : null}
      {visibles.map((it, k) => (
        <Fragment key={it.clave}>
          <button
            type="button"
            role="menuitem"
            className="cmenu-op"
            data-accion={it.clave}
            data-fijo={it.fijo ? "" : undefined}
            data-peligro={it.peligro ? "" : undefined}
            data-armado={armado === it.clave ? "" : undefined}
            data-sub={it.sub ? "" : undefined}
            aria-checked={it.marcado}
            onFocus={() => armado !== it.clave && setArmado(null)}
            onClick={() => (it.seguro && armado !== it.clave ? setArmado(it.clave) : it.alElegir())}
          >
            <span className="cmenu-t">{armado === it.clave ? it.seguro : it.texto}</span>
            {it.nota && !it.marcado ? <span className="cmenu-nota">{it.nota}</span> : null}
            {it.sub ? <ChevronRight size={12} strokeWidth={2} /> : it.marcado ? <span className="cmenu-ok">✓</span> : null}
          </button>
          {it.fijo && !visibles[k + 1]?.fijo ? <div className="cmenu-sep" role="separator" /> : null}
        </Fragment>
      ))}
      {conBuscador && visibles.every((it) => it.fijo) ? <div className="cmenu-vacio">{tr("menu.sinResultados")}</div> : null}
    </motion.div>,
    document.body,
  );
}

type PropsRenombre = {
  /** Dónde va: encima del título de la fila. */
  caja: { left: number; top: number; width: number; height: number };
  /** La letra del título, para que no salte al editar. */
  letra: string;
  valor: string;
  /** La fila: si un scroll la corre, el campo se va (y guarda). */
  ancla?: HTMLElement | null;
  alGuardar: (texto: string) => void;
  alCancelar: () => void;
};

/**
 * Renombrar en línea: un campo encima del título de la fila (no adentro del
 * botón). Enter guarda, Esc cancela; irse del campo o que la fila se corra, guarda.
 */
export function Renombre({ caja, letra, valor, ancla, alGuardar, alCancelar }: PropsRenombre) {
  const campo = useRef<HTMLInputElement>(null);
  const listo = useRef(false);
  const fin = (f: () => void) => {
    if (listo.current) return;
    listo.current = true;
    f();
  };
  useLayoutEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);
  useAncla(ancla, campo, () => campo.current?.blur());
  return createPortal(
    <input
      ref={campo}
      className="renombre"
      aria-label={tr("menu.renombrarAria")}
      defaultValue={valor}
      spellCheck={false}
      style={{ left: caja.left, top: caja.top, width: caja.width, height: caja.height, font: letra }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") fin(() => alGuardar(e.currentTarget.value));
        else if (e.key === "Escape") fin(alCancelar);
        else return;
        e.preventDefault();
      }}
      onBlur={(e) => fin(() => alGuardar(e.currentTarget.value))}
    />,
    document.body,
  );
}
