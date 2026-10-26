// El panel de consumo: a la derecha, ocultable (botón del pie, tecla `t`, o su ×). Arriba, lo que
// consumió hoy cada modelo, en líderes y en workers; abajo, una fila por líder y por worker vivo
// (colgados de su líder, o de su proyecto si no lo tienen a la vista): modelo, esfuerzo, estado,
// contexto, tokens y compactaciones. Los números los lee el main de los transcripts
// (electron/consumo.ts) y sólo mientras el panel está a la vista; lo que no se sabe dice "sin dato".
// En el celular no existe (lo decide la barra: `useAngosto`).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as TeclaReact, type PointerEvent as PunteroReact } from "react";
import { PanelRightClose } from "lucide-react";
import type { Hilo, Lider } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { contextoFila, resumen, totalSesion, type Consumo as Datos, type FilaConsumo, type Suma } from "../datos/consumo";
import { tareaDe, tipoDe } from "../barra/piezas";
import { claveConsumo, modeloDe, nombreModelo } from "../hilo/opciones";
import { locale, t } from "../i18n";
import { MODO } from "../modo";
import { useIdioma } from "../i18n/react";
import "./consumo-estilos.css";

type Props = {
  /** Los líderes de la barra y todos los workers: el panel se queda con los vivos. */
  lideres: Lider[];
  hilos: Hilo[];
  /** Cómo se ve una carpeta (el título del registry, o el slug). */
  carpeta: (proyecto: string) => string;
  alCerrar: () => void;
};

// El ancho del panel lo elige el usuario arrastrando su borde izquierdo (igual que el de la barra, src/barra/Barra.tsx):
// en rem, entre estos límites, guardado en `localStorage`. Sin valor, el del CSS. Con ancho intermedio (67rem) el panel
// ocupa toda la pantalla y el tirador no existe.
const CLAVE_ANCHO = "hilos:consumo:ancho";
const REM_MIN = 20;
const REM_MAX = 60;
const acotar = (r: number) => Math.max(REM_MIN, Math.min(REM_MAX, Math.round(r * 4) / 4));
const remEnPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function anchoGuardado(): number | null {
  if (MODO.datosFijos) return null;
  try {
    const n = Number(localStorage.getItem(CLAVE_ANCHO));
    return Number.isFinite(n) && n > 0 ? acotar(n) : null;
  } catch {
    return null;
  }
}

const vivo = (h: Hilo) => h.estado === "trabajando" || h.estado === "colgado";
const miles = (n: number) => n.toLocaleString(locale());
const lindo = (modelo: string) => nombreModelo(modeloDe(modelo) ?? modelo);

const desglose = (s: Suma | undefined) =>
  s ? t("consumo.desglose", { e: miles(s.entrada), c: miles(s.cacheCreado), l: miles(s.cacheLeido), s: miles(s.salida) }) : undefined;

/** Las cuatro clases de tokens de una sesión, sumados sus modelos (para el detalle al pasar el mouse). */
function sumado(total: Record<string, Suma>): Suma {
  const r: Suma = { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 };
  for (const s of Object.values(total)) {
    r.entrada += s.entrada;
    r.cacheCreado += s.cacheCreado;
    r.cacheLeido += s.cacheLeido;
    r.salida += s.salida;
  }
  return r;
}

type PropsFila = {
  /** El session_id del líder o el id del worker. */
  id: string;
  nombre: string;
  estado: string;
  tipo: string;
  modelo: string | null;
  effort: string | null;
  /** `undefined`: todavía no contestó el main. `null`: sin transcript. */
  fila: FilaConsumo | null | undefined;
  worker?: boolean;
};

function Fila({ id, nombre, estado, tipo, modelo, effort, fila, worker }: PropsFila) {
  const m = modelo ?? fila?.modelo ?? null;
  const e = effort ?? fila?.effort ?? null;
  const ctx = contextoFila(fila, m);
  // `undefined`: el main todavía no contestó, no es que falte el dato.
  const leyendo = fila === undefined;
  const sinDato = t(leyendo ? "consumo.leyendo" : "comun.sinDato");
  const falta = leyendo ? { "data-cargando": "" } : { "data-falta": "" };
  return (
    <li className="cs-fila" data-consumo={id} data-worker={worker ? "" : undefined}>
      <div className="cs-quien">
        <span className="cs-nom">{nombre}</span>
        <span className="cs-est" data-tipo={tipo}>
          {estado}
        </span>
      </div>
      <div className="cs-modelo">
        <span {...(m ? {} : falta)}>{m ? lindo(m) : sinDato}</span>
        <i>·</i>
        <span {...(e ? {} : falta)}>{e ?? sinDato}</span>
      </div>
      <dl className="cs-datos">
        <dt>{t("consumo.contexto")}</dt>
        {ctx ? (
          <>
            <dd data-campo="contexto">
              <b>{ctx.pct}%</b>
              <span className="cs-de">{t("consumo.de", { a: miles(ctx.usados), b: miles(ctx.ventana) })}</span>
            </dd>
            <dd className="cs-barra" data-nivel={ctx.nivel} aria-hidden="true">
              <i style={{ transform: `scaleX(${ctx.pct / 100})` }} />
            </dd>
          </>
        ) : (
          <dd data-campo="contexto" {...falta}>
            {sinDato}
          </dd>
        )}
        <dt>{t("consumo.tokens")}</dt>
        {fila ? (
          <dd data-campo="tokens" data-tip={desglose(sumado(fila.total))}>
            {miles(totalSesion(fila.total))}
          </dd>
        ) : (
          <dd data-campo="tokens" {...falta}>
            {sinDato}
          </dd>
        )}
        <dt>{t("consumo.compactaciones")}</dt>
        {fila ? (
          <dd data-campo="compactaciones">{fila.compactaciones}</dd>
        ) : (
          <dd data-campo="compactaciones" {...falta}>
            {sinDato}
          </dd>
        )}
      </dl>
    </li>
  );
}

export const Consumo = memo(function Consumo({ lideres, hilos, carpeta, alCerrar }: Props) {
  useIdioma();
  const vivos = useMemo(() => hilos.filter(vivo), [hilos]);
  // Lo que se le pide al main: cambia sólo cuando entra o sale alguien, no con cada lista.
  const clave = useMemo(() => JSON.stringify({ lideres: lideres.map((l) => l.id), workers: vivos.map((h) => h.id) }), [lideres, vivos]);
  const [datos, setDatos] = useState<Datos | null>(null);
  // El main no pudo leer: deja de ser "leyendo" y pasa a "sin dato".
  const [fallo, setFallo] = useState(false);
  // La respuesta a un pedido y los avisos del main no llegan en orden entre sí: vale lo más nuevo.
  const poner = useCallback((c: Datos) => setDatos((a) => (a && a.n > c.n ? a : c)), []);

  // El ancho elegido (rem); `null`: el del CSS.
  const [ancho, setAncho] = useState<number | null>(anchoGuardado);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (MODO.datosFijos) return;
    try {
      if (ancho === null) localStorage.removeItem(CLAVE_ANCHO);
      else localStorage.setItem(CLAVE_ANCHO, String(ancho));
    } catch {}
  }, [ancho]);
  const anchoAhora = () => (panel.current ? panel.current.getBoundingClientRect().width / remEnPx() : REM_MIN);

  // Arrastrar el borde: mientras dura se escribe directo en el DOM (ni un render por movimiento); el estado se asienta al soltar.
  const arrastrar = (e: PunteroReact<HTMLDivElement>) => {
    const el = panel.current;
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    const tirador = e.currentTarget;
    const app = el.closest(".app");
    const x0 = e.clientX;
    const w0 = anchoAhora();
    const rem = remEnPx();
    let w = w0;
    tirador.setPointerCapture(e.pointerId);
    app?.setAttribute("data-arr-cs", "");
    const mover = (ev: PointerEvent) => {
      // El borde es el izquierdo: arrastrar hacia la izquierda ensancha.
      w = acotar(w0 + (x0 - ev.clientX) / rem);
      el.style.setProperty("--ancho-consumo", `${w}rem`);
    };
    const soltar = () => {
      tirador.removeEventListener("pointermove", mover);
      tirador.removeEventListener("pointerup", soltar);
      tirador.removeEventListener("pointercancel", soltar);
      app?.removeAttribute("data-arr-cs");
      setAncho(w);
    };
    tirador.addEventListener("pointermove", mover);
    tirador.addEventListener("pointerup", soltar);
    tirador.addEventListener("pointercancel", soltar);
  };
  const teclaTirador = (e: TeclaReact) => {
    const paso = ({ ArrowLeft: 1, ArrowRight: -1 } as Record<string, number>)[e.key];
    if (paso) setAncho(acotar((ancho ?? anchoAhora()) + paso));
    else if (e.key === "Home") setAncho(REM_MIN);
    else if (e.key === "End") setAncho(REM_MAX);
    else return;
    e.preventDefault();
  };

  useEffect(() => {
    let sigue = true;
    fuente
      .consumoMirar(JSON.parse(clave))
      .then((c) => sigue && (setFallo(false), poner(c)))
      .catch(() => sigue && setFallo(true));
    return () => {
      sigue = false;
    };
  }, [clave, poner]);
  useEffect(() => {
    const soltar = fuente.alCambiarConsumo(poner);
    return () => {
      soltar();
      fuente.consumoSoltar();
    };
  }, [poner]);

  const r = useMemo(() => (datos ? resumen(datos, claveConsumo) : null), [datos]);
  // Los workers vivos, colgados de su líder; los que no lo tienen a la vista, de su proyecto.
  const { deLider, sueltos } = useMemo(() => {
    const ids = new Set(lideres.map((l) => l.id));
    const deLider = new Map<string, Hilo[]>();
    const sueltos = new Map<string, Hilo[]>();
    for (const h of vivos) {
      const [en, k] = h.jefe_id && ids.has(h.jefe_id) ? [deLider, h.jefe_id] : [sueltos, h.proyecto];
      en.set(k, [...(en.get(k) ?? []), h]);
    }
    return { deLider, sueltos };
  }, [lideres, vivos]);

  const filaWorker = (h: Hilo) => (
    <Fila
      key={h.id}
      id={h.id}
      worker
      nombre={tareaDe(h)}
      estado={h.en_cola ? t("consumo.enCola") : (tipoDe(h, h.estado)?.texto ?? h.estado)}
      tipo={h.en_cola ? "cola" : (tipoDe(h, h.estado)?.tipo ?? "")}
      modelo={h.modelo}
      effort={h.effort}
      fila={datos ? (datos.filas[h.id] ?? null) : fallo ? null : undefined}
    />
  );

  return (
    <aside ref={panel} className="cs" aria-label={t("consumo.titulo")} style={ancho === null ? undefined : ({ "--ancho-consumo": `${ancho}rem` } as CSSProperties)}>
      <div
        role="separator"
        tabIndex={0}
        className="cs-tirador"
        aria-orientation="vertical"
        aria-label={t("consumo.anchoAjustar")}
        aria-valuemin={REM_MIN}
        aria-valuemax={REM_MAX}
        aria-valuenow={ancho ?? undefined}
        onPointerDown={arrastrar}
        onDoubleClick={() => setAncho(null)}
        onKeyDown={teclaTirador}
      />
      <header className="cs-cab">
        <b>{t("consumo.titulo")}</b>
        <button type="button" className="lado" aria-label={t("consumo.ocultar")} data-tip={t("consumo.ocultar")} onClick={alCerrar}>
          <PanelRightClose size={16} strokeWidth={1.8} />
        </button>
      </header>
      <div className="cs-cuerpo">
        <section>
          <h3 className="pn-h">
            {t("consumo.porModelo")}
            <span data-tip={t("consumo.hoyTip")}>{t("consumo.hoy")}</span>
          </h3>
          {!r ? (
            <p className="cs-nada">{t(fallo ? "comun.sinDato" : "consumo.leyendo")}</p>
          ) : r.renglones.length === 0 ? (
            <p className="cs-nada">{t("consumo.nada")}</p>
          ) : (
            <table className="cs-tabla">
              <thead>
                <tr>
                  <th>{t("comun.modelo")}</th>
                  <th>{t("consumo.lideres")}</th>
                  <th>{t("consumo.workers")}</th>
                  <th>{t("consumo.total")}</th>
                </tr>
              </thead>
              <tbody>
                {r.renglones.map((x) => (
                  <tr key={x.modelo} data-modelo={x.modelo}>
                    <th>{nombreModelo(x.modelo)}</th>
                    <td data-tip={desglose(x.deLideres)}>{miles(x.lideres)}</td>
                    <td data-tip={desglose(x.deWorkers)}>{miles(x.workers)}</td>
                    <td className="cs-total" data-tip={t("consumo.totalTip", { l: miles(x.lideres), w: miles(x.workers) })}>
                      {miles(x.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t("consumo.total")}</th>
                  <td colSpan={3} className="cs-total" data-tip={t("consumo.totalTip", { l: miles(r.lideres), w: miles(r.workers) })}>
                    {miles(r.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
        <section>
          <h3 className="pn-h">{t("consumo.sesiones")}</h3>
          {lideres.length === 0 && vivos.length === 0 ? <p className="cs-nada">{t("consumo.sinSesiones")}</p> : null}
          <ul className="cs-lista">
            {lideres.map((l) => (
              <li key={l.id} className="cs-grupo">
                <ul>
                  <Fila
                    id={l.id}
                    nombre={l.nombre || t("lider.sesionJefe")}
                    estado={l.caido ? t(l.caido === "murio" ? "estado.fallo" : "lider.cerrado") : l.ocupado ? t("estado.trabajando") : t("consumo.reposo")}
                    tipo={l.caido === "murio" ? "fallo" : l.caido ? "" : l.ocupado ? "trab" : ""}
                    modelo={l.modelo}
                    effort={l.effort}
                    fila={datos ? (datos.filas[l.id] ?? null) : fallo ? null : undefined}
                  />
                  {deLider.get(l.id)?.map(filaWorker)}
                </ul>
              </li>
            ))}
            {[...sueltos].map(([proyecto, hs]) => (
              <li key={`p:${proyecto}`} className="cs-grupo">
                <h4 className="cs-proy">{carpeta(proyecto)}</h4>
                <ul>{hs.map(filaWorker)}</ul>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
});
