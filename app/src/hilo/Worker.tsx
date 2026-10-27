// La vista de un worker (al tocarlo en la barra): el resultado en una frase con sus chips, el mapa de la corrida, los pasos y el detalle
// del elegido (docs/estado/worker-vista.md). Los pasos los arma el main de su transcript (src/hilo/usePasos.ts); lo que se saca de ellos
// (nombre corto, grupos, resumen, chip de tests, diff) es de worker-datos.ts. A un worker no se le escribe: acá sólo se mira, y se lo para.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bot, Brain, Check, ChevronRight, FilePlus, FileText, Info, MessageSquare, Pencil, Search, Square, Terminal, Wrench, type LucideIcon } from "lucide-react";
import type { Subagente } from "../../electron/subagentes";
import { comoSettle, type Estado, type Hilo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import type { Detalle, Paso, TipoPaso, VistaPasos } from "../datos/pasos";
import { useAngosto } from "../angosto";
import { latir } from "../barra/latido";
import { AccionesWorker } from "../barra/Fila";
import type { Como, Salida } from "../barra/arbol";
import { Reloj } from "../barra/piezas";
import { locale, t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { pintorDura } from "../tiempo";
import "./worker-estilos.css";
import { Entero } from "./Entero";
import { Filas } from "./Diff";
import { defDe } from "./modelos";
import { Compactando } from "./Posta";
import { Texto } from "./Texto";
import { useCompactando } from "./compactando";
import { partirDecision } from "./turnos";
import { useSeguir } from "./useSeguir";
import {
  chipsDe,
  corto,
  cuenta,
  diffDe,
  durCorta,
  durLenta,
  extension,
  filas,
  filasEscritas,
  filasLeidas,
  nombreDeArchivo,
  pesos,
  resumenDe,
  testsDe,
  textoFinal,
  visibles,
} from "./worker-datos";

const ICONO: Record<TipoPaso, LucideIcon> = {
  pensar: Brain,
  leer: FileText,
  buscar: Search,
  editar: Pencil,
  escribir: FilePlus,
  correr: Terminal,
  delegar: Bot,
  texto: MessageSquare,
  otro: Wrench,
};

const verbo = (p: Paso) => t(`wk.${p.estado === "corriendo" ? "e" : "v"}.${p.tipo}` as ClaveSola);
const nombreLargo = (p: Paso) => `${verbo(p)} ${corto(p)}`.trim();
const compacto = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Cursor() {
  useLayoutEffect(latir, []);
  return <span className="parpadea wk-cursor" aria-hidden="true" />;
}

// ---- La cabecera: la hora y el ⓘ con lo que no cambia una decisión ------------------------------------------------------

/** Lo que va a la derecha de las migas de un worker: cuánto lleva o cuánto tardó, y el ⓘ (modelo, turnos, tokens y rama). */
export function WorkerExtras({ h, vista, vive }: { h: Hilo; vista: VistaPasos; vive: boolean }) {
  useIdioma();
  const e = vista.encabezado;
  const pintor = useMemo(() => pintorDura(h.inicio), [h.inicio]);
  const dur = e.dur ?? (h.duracion_s !== null ? h.duracion_s * 1000 : null);
  const modelo = e.modelo ?? h.modelo;
  const filasInfo: [string, string, boolean?][] = [
    [t("wk.infoModelo"), `${defDe(modelo)?.nombre ?? modelo}${e.effort ?? h.effort ? ` ${e.effort ?? h.effort}` : ""}`],
    [t("wk.infoTurnos"), String(e.turnos)],
    [t("wk.infoTokens"), `${compacto(e.total)}${e.cache !== null ? ` · ${Math.round(e.cache * 100)} %` : ""}`],
    [t("wk.infoRama"), h.rama ?? t("comun.sinRama"), true],
  ];
  return (
    <>
      <span className="wk-tiempo">{vive ? <Reloj pintor={pintor} /> : dur !== null ? durCorta(dur) : null}</span>
      <div className="wk-info">
        <button type="button" aria-label={t("wk.info")}>
          <Info size={16} strokeWidth={1.8} />
        </button>
        <div className="wk-pop" role="tooltip">
          <dl>
            {filasInfo.map(([k, v, mono]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={mono ? "mono" : undefined}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}

// ---- El detalle del paso elegido -----------------------------------------------------------------------------------------

const Nota = ({ c }: { c: { recortado: boolean; total: number } | null | undefined }) => (c?.recortado ? <div className="wk-nota">{t("wk.recortado", { n: c.total })}</div> : null);

const Mas = ({ mas, menos }: { mas?: number; menos?: number }) => (
  <span className="wk-cnt">
    {mas ? <span className="wk-mas">+{mas}</span> : null}
    {menos ? <span className="wk-menos">−{menos}</span> : null}
  </span>
);

/** La cabecera (archivo y +/−, o el nombre) y el cuerpo (sólo el diff, lo escrito o la salida) de un paso. */
function armar(p: Paso): { ru: ReactNode; cuerpo: ReactNode } {
  const d: Detalle = p.detalle;
  const Ico = ICONO[p.tipo];
  const ico = <Ico size={15} strokeWidth={1.8} />;
  const ruta = (r: string) => <span data-tip={r}>{nombreDeArchivo(r)}</span>;
  switch (d.clase) {
    case "editar":
      return {
        ru: (
          <>
            {ico}
            {ruta(d.ruta)}
            <Mas mas={d.mas} menos={d.menos} />
          </>
        ),
        cuerpo: d.cambios.map((c, i) => <Filas key={i} filas={diffDe(c)} lang={extension(d.ruta)} />),
      };
    case "escribir":
      return {
        ru: (
          <>
            {ico}
            {ruta(d.ruta)}
            <Mas mas={d.mas} />
          </>
        ),
        cuerpo: (
          <>
            <Filas filas={filasEscritas(d.contenido.t)} lang={extension(d.ruta)} />
            <Nota c={d.contenido} />
          </>
        ),
      };
    case "leer":
      return {
        ru: (
          <>
            {ico}
            {ruta(d.ruta)}
          </>
        ),
        cuerpo: d.imagen ? (
          <div className="wk-ag">
            <p className="wk-vacio">{t("wk.sinSalida")}</p>
          </div>
        ) : (
          <>
            <Filas filas={filasLeidas(d.texto?.t ?? "", d.desde)} lang={extension(d.ruta)} />
            <Nota c={d.texto} />
          </>
        ),
      };
    case "buscar":
      return {
        ru: (
          <>
            {ico}
            <span>{d.resultados ? t("wk.coincidencias", { n: d.resultados }) : t("wk.sinCoincidencias")}</span>
          </>
        ),
        cuerpo: (
          <>
            <pre className="wk-term">{d.texto?.t || t("wk.sinSalida")}</pre>
            <Nota c={d.texto} />
          </>
        ),
      };
    case "correr": {
      const sale = p.estado === "fallo" || (d.codigo !== null && d.codigo !== 0);
      return {
        ru: (
          <>
            {ico}
            <span>{corto(p)}</span>
            {p.estado === "corriendo" ? null : (
              <span className="wk-cnt">{sale ? <span className="wk-mal">{t("wk.exit", { n: d.codigo ?? 1 })}</span> : <Check size={14} strokeWidth={2.4} className="wk-bien" />}</span>
            )}
          </>
        ),
        cuerpo: (
          <>
            <pre className="wk-term">
              <span className="wk-pr">$ </span>
              <span className="wk-cmd">{d.comando.t}</span>
              {"\n"}
              {d.salida?.t || (p.estado === "corriendo" ? "" : t("wk.sinSalida"))}
              {p.estado === "corriendo" ? <Cursor /> : null}
            </pre>
            <Nota c={d.salida} />
          </>
        ),
      };
    }
    case "delegar":
      return {
        ru: (
          <>
            {ico}
            <span>{corto(p) || d.agente}</span>
          </>
        ),
        cuerpo: (
          <div className="wk-ag">
            <Entero texto={d.prompt.t} tag="blockquote" />
            {d.pasos.length ? (
              <ul className="wk-sub">
                {d.pasos.map((s) => {
                  const S = ICONO[s.tipo];
                  return (
                    <li key={s.id}>
                      <S size={13} strokeWidth={1.8} />
                      <span>{nombreLargo(s)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {d.tokens ? <p className="wk-nota">{t("wk.delegaTokens", { n: compacto(d.tokens) })}</p> : null}
            {d.respuesta?.t ? <Entero texto={d.respuesta.t} className="wk-resp" /> : null}
          </div>
        ),
      };
    case "texto":
      return {
        ru: (
          <>
            {ico}
            <span>{verbo(p)}</span>
          </>
        ),
        cuerpo: (
          <div className="wk-ag">
            <Texto texto={d.texto.t} />
          </div>
        ),
      };
    case "pensar":
      return {
        ru: (
          <>
            {ico}
            <span>{verbo(p)}</span>
          </>
        ),
        cuerpo: (
          <div className="wk-ag">
            <p className="wk-vacio">{t("wk.pensoOculto")}</p>
          </div>
        ),
      };
    default:
      return {
        ru: (
          <>
            {ico}
            <span>{p.titulo || verbo(p)}</span>
          </>
        ),
        cuerpo: (
          <div className="wk-ag">
            <p className="wk-vacio">{p.titulo}</p>
          </div>
        ),
      };
  }
}

function Detalle({ p, dentro }: { p: Paso; dentro?: boolean }) {
  const a = useMemo(() => armar(p), [p]);
  return (
    <>
      <div className={dentro ? "wk-ru" : "wk-ru wk-ru-panel"}>{a.ru}</div>
      <div className="wk-cuerpo">{a.cuerpo}</div>
    </>
  );
}

// ---- El mapa y la lista --------------------------------------------------------------------------------------------------

function Mapa({ pasos, fin, sel, alElegir }: { pasos: readonly Paso[]; fin: number | null; sel: number | null; alElegir: (n: number) => void }) {
  const ws = useMemo(() => pesos(pasos, fin), [pasos, fin]);
  return (
    <div className="wk-mapa" role="group" aria-label={t("wk.mapa")}>
      {pasos.map((p, i) => {
        const n = p.estado === "corriendo" ? `${verbo(p)} ${corto(p)}`.trim() : nombreLargo(p);
        return (
          <button
            key={p.n}
            type="button"
            className="wk-seg"
            data-t={p.tipo}
            data-sel={p.n === sel ? "" : undefined}
            data-fallo={p.estado === "fallo" ? "" : undefined}
            data-vivo={p.estado === "corriendo" ? "" : undefined}
            data-n={n}
            aria-label={n}
            style={{ "--w": ws[i] } as CSSProperties}
            onClick={() => alElegir(p.n)}
          />
        );
      })}
    </div>
  );
}

type PropsFila = { p: Paso; sel: boolean; angosto: boolean; alElegir: (n: number) => void };

const FilaPaso = memo(function FilaPaso({ p, sel, angosto, alElegir }: PropsFila) {
  const Ico = ICONO[p.tipo];
  const nombre = corto(p);
  const corre = p.estado === "corriendo";
  const lenta = durLenta(p);
  const pintor = useMemo(() => (corre && p.t !== null ? pintorDura(p.t / 1000) : null), [corre, p.t]);
  const sale = p.estado === "fallo" && p.detalle.clase === "correr";
  return (
    <li className="wk-li">
      <button type="button" className="wk-it" data-t={p.tipo} data-sel={sel ? "" : undefined} aria-pressed={sel} onClick={() => alElegir(p.n)}>
        <span className="wk-ico">
          <Ico size={16} strokeWidth={1.8} />
        </span>
        <span className="wk-tx">
          {verbo(p)}
          {nombre ? <span> {nombre}</span> : null}
        </span>
        {sale ? <span className="wk-ex">{t("wk.exit", { n: p.detalle.clase === "correr" ? (p.detalle.codigo ?? 1) : 1 })}</span> : null}
        {pintor ? <Reloj pintor={pintor} className="wk-dur" /> : lenta ? <span className="wk-dur">{lenta}</span> : null}
      </button>
      {sel && angosto ? (
        <div className="wk-dentro" data-t={p.tipo}>
          <Detalle p={p} dentro />
        </div>
      ) : null}
    </li>
  );
});

const GrupoFila = memo(function GrupoFila({ ps, abierto, alAlternar, elegido, angosto, alElegir }: { ps: Paso[]; abierto: boolean; alAlternar: () => void; elegido: number | null; angosto: boolean; alElegir: (n: number) => void }) {
  const c = cuenta(ps);
  const a = c.leer === 1 ? t("wk.arch1") : t("wk.archN", { n: c.leer });
  const v = c.buscar === 1 ? t("wk.vez1") : t("wk.vezN", { n: c.buscar });
  const rotulo = c.buscar && c.leer ? t("wk.gBuscoLeyo", { v, a }) : c.buscar ? t("wk.gBusco", { v }) : t("wk.gLeyo", { a });
  const Ico = ICONO[c.leer ? "leer" : "buscar"];
  return (
    <li className="wk-li wk-grupo" data-abierto={abierto ? "" : undefined}>
      <button type="button" className="wk-it" data-t="leer" aria-expanded={abierto} onClick={alAlternar}>
        <span className="wk-ico">
          <Ico size={16} strokeWidth={1.8} />
        </span>
        <span className="wk-tx">{rotulo}</span>
        <ChevronRight size={12} strokeWidth={2} className="wk-caret" aria-hidden="true" />
      </button>
      {abierto ? (
        <ul>
          {ps.map((p) => (
            <FilaPaso key={p.n} p={p} sel={p.n === elegido} angosto={angosto} alElegir={alElegir} />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

// ---- El resultado --------------------------------------------------------------------------------------------------------

function Chips({ resultado, vista, pasos, vive, alElegir }: { resultado: string | null; vista: VistaPasos; pasos: readonly Paso[]; vive: boolean; alElegir: (n: number) => void }) {
  const tests = useMemo(() => testsDe(pasos), [pasos]);
  const archivos = useMemo(() => chipsDe(vista.encabezado), [vista.encabezado]);
  const { supuestos } = useMemo(() => resumenDe(textoFinal(vista.pasos) ?? resultado), [vista.pasos, resultado]);
  const del = (ruta: string) => [...pasos].reverse().find((p) => (p.detalle.clase === "editar" || p.detalle.clase === "escribir") && p.detalle.ruta === ruta)?.n;
  return (
    <div className="wk-chips">
      {tests ? (
        <button type="button" className="ui-chip wk-chip" data-ok={tests.ok ? "" : undefined} data-mal={tests.ok ? undefined : ""} data-tip={t("wk.testsTip", { que: corto(tests.paso) })} onClick={() => alElegir(tests.paso.n)}>
          {tests.ok ? <Check size={13} strokeWidth={2.4} /> : null}
          {!tests.ok ? t("wk.testsFallan") : tests.n !== null ? t("wk.testsN", { n: tests.n }) : t("wk.tests")}
        </button>
      ) : null}
      {archivos.map((c) => (
        <button key={c.ruta} type="button" className="ui-chip wk-chip" data-tip={c.ruta} onClick={() => { const n = del(c.ruta); if (n !== undefined) alElegir(n); }}>
          {c.nombre}
          {c.mas ? <b className="wk-mas">+{c.mas}</b> : null}
          {c.menos ? <b className="wk-menos">−{c.menos}</b> : null}
        </button>
      ))}
      {!vive && supuestos.length ? (
        <span className="wk-sup">
          <button type="button" className="ui-chip wk-chip">
            {supuestos.length === 1 ? t("wk.supuestos1") : t("wk.supuestosN", { n: supuestos.length })}
          </button>
          <div className="wk-pop" role="tooltip">
            <ul>
              {supuestos.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </span>
      ) : null}
    </div>
  );
}

// ---- La vista ------------------------------------------------------------------------------------------------------------

/** Qué paso se ve sin que el usuario haya elegido: el que está corriendo, el último que editó o escribió, el primero que falló o el último. */
function porDefecto(ps: readonly Paso[], vive: boolean): number | null {
  if (!ps.length) return null;
  const ult = ps[ps.length - 1];
  if (vive) return ult.n;
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i].tipo === "editar" || ps[i].tipo === "escribir") return ps[i].n;
  return ps.find((p) => p.estado === "fallo")?.n ?? ult.n;
}

type Props = {
  h: Hilo;
  estado: Estado;
  vista: VistaPasos;
  settle: Salida | null;
  alCerrar: (id: string, como?: Como) => void;
  alRetomar: (id: string) => void;
  alPasar: (h: Hilo) => Promise<void>;
};

export function VistaWorker({ h, estado, vista, settle, alCerrar, alRetomar, alPasar }: Props) {
  useIdioma();
  const angosto = useAngosto();
  const vive = estado === "trabajando" || estado === "colgado";
  const decide = estado === "decision";
  const compacta = useCompactando(vive ? h.id : null);
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Mientras trabaja, la lista sigue su fondo (src/hilo/seguir.ts); en el celular la zona que se mueve es toda la vista.
  const seg = useSeguir(angosto ? raiz : lista);

  const pasos = useMemo(() => visibles(vista.pasos), [vista.pasos]);
  const [elegido, setElegido] = useState<number | "ninguno" | null>(null);
  const [abiertos, setAbiertos] = useState<ReadonlySet<number>>(() => new Set());
  const porDef = useMemo(() => porDefecto(pasos, vive), [pasos, vive]);
  const selN = elegido === "ninguno" ? null : (elegido ?? porDef);
  const sel = pasos.find((p) => p.n === selN) ?? null;
  const fs = useMemo(() => filas(pasos), [pasos]);
  const alElegir = (n: number) => setElegido((e) => (e === n && angosto ? "ninguno" : n));
  const alternar = (n: number) =>
    setAbiertos((s) => {
      const x = new Set(s);
      if (!x.delete(n)) x.add(n);
      return x;
    });

  // Terminado, la lista no baja sola al fondo: se queda en el paso que se ve.
  useLayoutEffect(() => {
    if (vive) return;
    seg.pegado = false;
    raiz.current?.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  }, []);

  const [parando, setParando] = useState(false);
  const [pasando, setPasando] = useState(false);
  const [errorPie, setErrorPie] = useState<string | null>(null);
  const parar = () => {
    if (parando) return;
    setParando(true);
    setErrorPie(null);
    fuente.parar(h).catch((e) => {
      setParando(false);
      setErrorPie(mensaje(e));
    });
  };
  const pasar = () => {
    if (pasando) return;
    setPasando(true);
    setErrorPie(null);
    alPasar(h).catch((e) => {
      setPasando(false);
      setErrorPie(mensaje(e));
    });
  };

  const final = textoFinal(vista.pasos) ?? (vive ? null : h.resultado);
  const { resultado } = useMemo(() => resumenDe(final), [final]);
  // La pregunta de un worker que espera una decisión (sin líder): entera, de su último mensaje.
  const partida = decide && final ? partirDecision(final) : null;
  const pregunta = partida?.decision ?? h.decision;
  const e = vista.encabezado;

  return (
    <div className="wk" ref={raiz}>
      <div className="wk-in">
        <section className="wk-fin" aria-label={t("wk.resultado")}>
          <div className="wk-fila">
            {resultado ? <Entero texto={resultado} className="wk-txt" /> : <p className="wk-txt espera">{vive ? t("wk.espera") : t("wk.sinResultado")}</p>}
            <div className="wk-acc">
              {vive ? (
                <Boton className="wk-parar" data-parar disabled={parando} onClick={parar}>
                  <Square size={12} strokeWidth={2.4} fill="currentColor" />
                  {parando ? t("accion.parando") : t("accion.parar")}
                </Boton>
              ) : decide ? (
                <Boton className="wk-parar" data-pasar data-tip={t("vista.pasarTip")} disabled={pasando} onClick={pasar}>
                  {pasando ? t("vista.pasando") : t("vista.pasar")}
                </Boton>
              ) : null}
              {settle && !vive ? <AccionesWorker key={h.id} id={h.id} salida={settle} como={comoSettle(h)} alCerrar={alCerrar} alRetomar={alRetomar} className="btn2" /> : null}
            </div>
          </div>
          {errorPie ? (
            <div className="caja-error" role="alert">
              {errorPie}
            </div>
          ) : null}
          {decide && pregunta ? (
            <div className="pregunta">
              <div className="q">{t("estado.decision")}</div>
              <Texto texto={pregunta} />
            </div>
          ) : null}
          <Chips resultado={h.resultado} vista={vista} pasos={pasos} vive={vive} alElegir={alElegir} />
        </section>

        {pasos.length ? <Mapa pasos={pasos} fin={vive ? null : e.fin} sel={selN} alElegir={alElegir} /> : null}

        <div className="wk-paneles">
          <div className="wk-lista" ref={lista}>
            <ol aria-label={t("wk.pasos")}>
              {vista.omitidos > 0 ? <li className="wk-nota wk-omit">{t("wk.anteriores", { n: vista.omitidos })}</li> : null}
              {!pasos.length ? <li className="wk-nota">{t("wk.sinPasos")}</li> : null}
              {fs.map((f) =>
                f.grupo ? (
                  <GrupoFila key={f.ps[0].n} ps={f.ps} abierto={abiertos.has(f.ps[0].n) || f.ps.some((p) => p.n === selN)} alAlternar={() => alternar(f.ps[0].n)} elegido={selN} angosto={angosto} alElegir={alElegir} />
                ) : (
                  <FilaPaso key={f.p.n} p={f.p} sel={f.p.n === selN} angosto={angosto} alElegir={alElegir} />
                ),
              )}
              {compacta !== null ? (
                <li className="wk-li">
                  <Compactando desde={compacta} />
                </li>
              ) : null}
            </ol>
          </div>
          {!angosto ? (
            <section className="wk-panel" data-t={sel?.tipo}>
              {sel ? <Detalle key={sel.n} p={sel} /> : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---- Un subagente (lo que lanza una sesión con su herramienta Agent) --------------------------------------------------------

/** Cada cuánto se vuelve a leer lo que hizo un subagente que sigue corriendo. */
const REPASO_MS = 2500;

/** Sus pasos, del transcript del subagente: se piden al abrirlo y se repiten mientras corre. `undefined`: leyendo; `null`: no se pudo. */
function usePasosSubagente(u: Subagente): VistaPasos | null | undefined {
  const [e, setE] = useState<{ k: string; vista: VistaPasos | null } | null>(null);
  const k = `${u.sid}:${u.id}`;
  const corre = u.estado === "corriendo";
  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const pedir = () =>
      fuente.pasosSubagente(u.sid, u.id).then(
        (v) => v,
        () => null,
      ).then((v) => {
        if (!vivo) return;
        setE({ k, vista: v && v.hay ? v : null });
        if (corre) reloj = setTimeout(pedir, REPASO_MS);
      });
    void pedir();
    return () => {
      vivo = false;
      if (reloj) clearTimeout(reloj);
    };
  }, [k, corre, u.ultimo_en]);
  return e && e.k === k ? e.vista : undefined;
}

/** Al tocar un subagente en la barra: lo que hizo paso a paso (comandos, cuánto tardó cada uno, si pensó) y lo que informó. */
export function VistaSubagente({ u }: { u: Subagente }) {
  useIdioma();
  const angosto = useAngosto();
  const vista = usePasosSubagente(u);
  const vive = u.estado === "corriendo";
  const lista = useRef<HTMLDivElement>(null);
  const seg = useSeguir(lista);
  const pasos = useMemo(() => visibles(vista?.pasos ?? []), [vista?.pasos]);
  const [elegido, setElegido] = useState<number | "ninguno" | null>(null);
  const [abiertos, setAbiertos] = useState<ReadonlySet<number>>(() => new Set());
  const porDef = useMemo(() => porDefecto(pasos, vive), [pasos, vive]);
  const selN = elegido === "ninguno" ? null : (elegido ?? porDef);
  const sel = pasos.find((p) => p.n === selN) ?? null;
  const fs = useMemo(() => filas(pasos), [pasos]);
  const alElegir = (n: number) => setElegido((x) => (x === n && angosto ? "ninguno" : n));
  const alternar = (n: number) =>
    setAbiertos((s) => {
      const x = new Set(s);
      if (!x.delete(n)) x.add(n);
      return x;
    });
  useLayoutEffect(() => {
    if (!vive) seg.pegado = false;
  }, []);
  const final = (vista ? textoFinal(vista.pasos) : null) ?? (vive ? null : u.resultado);
  const { resultado } = useMemo(() => resumenDe(final), [final]);

  return (
    <div className="wk">
      <div className="wk-in">
        <section className="wk-fin" aria-label={t("wk.resultado")}>
          <div className="wk-fila">
            {resultado ? <Entero texto={resultado} className="wk-txt" /> : <p className="wk-txt espera">{vive ? t("wk.espera") : t("wk.sinResultado")}</p>}
          </div>
          {vista ? <Chips resultado={u.resultado} vista={vista} pasos={pasos} vive={vive} alElegir={alElegir} /> : null}
        </section>
        {vista && pasos.length ? <Mapa pasos={pasos} fin={vive ? null : vista.encabezado.fin} sel={selN} alElegir={alElegir} /> : null}
        <div className="wk-paneles">
          <div className="wk-lista" ref={lista}>
            <ol aria-label={t("wk.pasos")}>
              {vista === undefined ? <li className="wk-nota">{t("vista.leyendo")}</li> : null}
              {vista === null ? <li className="wk-nota">{t("sub.sinPasos")}</li> : null}
              {vista && vista.omitidos > 0 ? <li className="wk-nota wk-omit">{t("wk.anteriores", { n: vista.omitidos })}</li> : null}
              {vista && !pasos.length ? <li className="wk-nota">{t("wk.sinPasos")}</li> : null}
              {fs.map((f) =>
                f.grupo ? (
                  <GrupoFila key={f.ps[0].n} ps={f.ps} abierto={abiertos.has(f.ps[0].n) || f.ps.some((p) => p.n === selN)} alAlternar={() => alternar(f.ps[0].n)} elegido={selN} angosto={angosto} alElegir={alElegir} />
                ) : (
                  <FilaPaso key={f.p.n} p={f.p} sel={f.p.n === selN} angosto={angosto} alElegir={alElegir} />
                ),
              )}
            </ol>
          </div>
          {!angosto ? (
            <section className="wk-panel" data-t={sel?.tipo}>
              {sel ? <Detalle key={sel.n} p={sel} /> : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
