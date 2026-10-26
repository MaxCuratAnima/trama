// La cabecera de la barra. Arriba, sólo el logo de trama (sin la palabra: gana lugar), releer y
// ocultar la barra; abajo, el uso de cada suscripción conectada, un renglón cada una: su logo y nombre
// (Claude y las que dice `reparto --cupos`: Google AI Pro, y las que vengan, sin tocar esto) y, en columnas
// alineadas, una celda por ventana: a la izquierda, cuánto falta para que se reinicie ("4 h 23 min", exacto y
// corto; se repinta solo, una vez por minuto) y a la derecha el porcentaje, con un riel finito (ámbar desde
// 70 %, rojo desde 90 %). El tooltip de cada celda (CSS, con el mouse o con foco; no el title nativo) dice a
// qué proveedor y ventana pertenece, el porcentaje y cuándo se reinicia ("Claude · ventana de 5 horas · 62 % usado ·
// se reinicia hoy 23:40"); si el dato es viejo, cuándo se vio; el número de un dato de hace más de 15 min se apaga
// (`data-viejo`). Una suscripción con varios grupos (Google) va plegada en un renglón con el grupo más usado y se
// despliega al tocar el nombre. Un límite del que no se sabe ni el porcentaje lo dice: "sin dato" (Claude) o "—"
// (las demás), nunca una celda vacía. El botón de releer le pide a `claude` el uso como lo dice claude.ai
// (`get_usage`) y relee todo.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, PanelLeft, RotateCw } from "lucide-react";
import type { Uso, Ventana, VentanaCupo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { nivel } from "../hilo/contexto-datos";
import { LogoSuscripcion } from "../hilo/Logos";
import { filasDeCupos, type FilaSusc } from "../datos/cuentas";
import { MODO } from "../modo";
import { VIEJO_S, pintorCuando, pintorVisto } from "../tiempo";
import type { Pintor } from "../reloj";
import { columnas, masUsado } from "./cuposVista";
import { Marca } from "./Marca";
import { filaDe, formatearFalta, formatearHasta, type Unidades } from "./usoFila";
import { Reloj } from "./piezas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";

/** Después de un clic el botón de releer descansa esto. */
const PAUSA_MS = 5000;

/** Mientras el uso no llegó: reserva el renglón (invisible) para que la lista no salte. */
const ESPERA: Ventana = { pct: 0, resets_at: 0 };

/** Las capturas `uso*` y `hover` dejan abierto el tip de la primera celda: se ve qué dice y que no tapa nada. */
const VER_TIP = MODO.captura === "hover" || !!MODO.captura?.startsWith("uso");

/**
 * Una ventana lista para pintar: `pct` null = sin dato; `hasta` en epoch s (0: no se sabe cuándo se reinicia);
 * `cupo`: viene de `reparto` (sin dato dice "—"), no de la statusline de Claude.
 */
type Celda = { clave: string; ventana: string; pct: number | null; hasta: number; cupo?: boolean };

/** Cómo se llama una ventana en el tooltip (`5h`, `7d`; una desconocida, su id). */
function ventanaDe(id: string): string {
  if (id === "5h") return t("uso.5hLargo");
  if (id === "7d" || id === "sem") return t("uso.semLargo");
  return id;
}

export function Cabecera({ alOcultar }: { alOcultar: () => void }) {
  useIdioma();
  // `undefined`: todavía no llegó. `null`: llegó y no hay de dónde sacarlo.
  const [uso, setUso] = useState<Uso | null | undefined>(undefined);
  const [pausa, setPausa] = useState(false);
  const reloj = useRef(0);

  useEffect(() => {
    let vivo = true;
    void fuente.uso().then((u) => vivo && setUso(u));
    const soltar = fuente.alCambiarUso(setUso);
    return () => {
      vivo = false;
      soltar();
      clearTimeout(reloj.current);
    };
  }, []);

  const releer = () => {
    setPausa(true);
    reloj.current = window.setTimeout(() => setPausa(false), PAUSA_MS);
    void fuente.releerUso().then(setUso, () => {});
  };

  const datos = uso && !("error" in uso) ? uso : null;
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, t("cuentas.principal"));

  return (
    <>
      <div className="cab">
        <Marca className="logo" />
        <span className="oculto">trama</span>
        {/* Releer vive acá, en la fila de arriba: ya no le roba ancho a las celdas. */}
        <button type="button" className="releer" aria-label={t("uso.releer")} data-tip={t("uso.releer")} disabled={pausa || uso === undefined} onClick={releer}>
          <RotateCw size={13} strokeWidth={2} />
        </button>
        {/* Con la barra abierta el botón vive acá; cerrada, el de la vista (`.migas .lado`). */}
        <button type="button" className="lado" aria-label={t("comun.ocultarBarra")} data-tip={t("comun.ocultarBarra")} onClick={alOcultar}>
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
      </div>
      {uso === undefined ? (
        <div className="usos" data-espera="" aria-hidden="true">
          <div className="usos-l">
            <Grupo logo={<LogoSuscripcion id="claude" nombre="Claude" />} id="claude" nombre={t("uso.claude")} celdas={[celdaDe("5h", ESPERA), celdaDe("7d", ESPERA)]} ts={0} />
          </div>
        </div>
      ) : uso && "error" in uso ? (
        <div className="usos">
          <div className="usos-l">
            <span data-tip={textoMain(uso.error)} className="uso-error">
              {textoMain(uso.error)}
            </span>
          </div>
        </div>
      ) : (
        <div className="usos">
          <div className="usos-l">
            <Grupo
              logo={<LogoSuscripcion id="claude" nombre="Claude" />}
              id="claude"
              nombre={cupos.claudeCorto ?? t("uso.claude")}
              quien={cupos.claude ?? undefined}
              celdas={[celdaDe("5h", uso?.five_hour ?? null), celdaDe("7d", uso?.seven_day ?? null)]}
              ts={uso?.ts ?? 0}
              ver={VER_TIP}
            />
            {cupos.filas.map((f) => (
              <Suscripcion key={f.s.id} f={f} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** La ventana de Claude (statusline / stream) como celda. */
function celdaDe(clave: "5h" | "7d", v: Ventana | null): Celda {
  const f = filaDe(v);
  return { clave, ventana: ventanaDe(clave), pct: f.pct, hasta: f.hasta ?? 0 };
}

/** Una ventana de `reparto` como celda. */
function celdaCupo(v: VentanaCupo | null): Celda | null {
  return v && { clave: v.id, ventana: ventanaDe(v.id), pct: v.pct, hasta: v.vuelve ?? 0, cupo: true };
}

const celdasCupo = (ventanas: VentanaCupo[]) => columnas(ventanas).map(celdaCupo);

/**
 * Una suscripción de `reparto` (todas menos Claude): con ventanas propias, un renglón; con grupos, un renglón con el más
 * usado, que se despliega al tocar el nombre en un renglón por grupo (con "hasta d/m" si el cupo vence).
 */
function Suscripcion({ f }: { f: FilaSusc }) {
  const { s } = f;
  const [abierto, setAbierto] = useState(false);
  const logo = <LogoSuscripcion id={f.proveedor} nombre={s.nombre} />;
  const grupos = s.grupos ?? [];
  const arriba = grupos.length > 0 ? masUsado(grupos) : null;
  const plegable = grupos.length > 1;
  return (
    <>
      {f.primera && <div className="usos-sep" aria-hidden="true" />}
      <div className="susc" data-susc={s.id}>
        <Grupo
          logo={logo}
          id={s.id}
          nombre={f.corto}
          sub={arriba?.nombre}
          quien={arriba ? `${f.nombre} · ${arriba.nombre}` : f.nombre}
          celdas={celdasCupo(s.ventanas?.length ? s.ventanas : (arriba?.ventanas ?? []))}
          ts={s.ts}
          plegable={plegable ? { abierto, alternar: () => setAbierto((a) => !a), n: grupos.length } : undefined}
        />
        {plegable &&
          abierto &&
          grupos.map((g) => {
            const h = formatearHasta(g.hasta);
            return (
              <Grupo
                key={g.id}
                id={`${s.id}:${g.id}`}
                nombre={g.nombre}
                quien={`${f.nombre} · ${g.nombre}`}
                hasta={h ? t("uso.hasta", h) : undefined}
                celdas={celdasCupo(g.ventanas)}
                ts={s.ts}
                hijo
              />
            );
          })}
      </div>
    </>
  );
}

/**
 * Un renglón: logo y nombre, y las celdas en dos columnas fijas (5 h, semana). Un grupo sin 5 h deja la primera
 * columna vacía: las semanas quedan alineadas. `plegable`: el nombre es el botón que despliega los grupos;
 * `hijo`: un grupo ya desplegado (sin logo, con el nombre en hasta dos líneas).
 */
function Grupo({
  logo,
  id,
  nombre,
  sub,
  quien,
  hasta,
  celdas,
  ts,
  ver,
  plegable,
  hijo,
}: {
  logo?: ReactNode;
  id: string;
  nombre: string;
  /** El grupo que muestran las celdas de un renglón plegado. */
  sub?: string;
  /** A quién pertenecen las celdas (tooltips); por defecto, el nombre. */
  quien?: string;
  hasta?: string;
  celdas: (Celda | null)[];
  ts: number;
  ver?: boolean;
  plegable?: { abierto: boolean; alternar: () => void; n: number };
  hijo?: boolean;
}) {
  const dueno = quien ?? nombre;
  const cuerpo = (
    <>
      {logo}
      <span className="g-n">{nombre}</span>
      {plegable && (plegable.abierto ? <ChevronDown className="g-flecha" size={11} strokeWidth={2} /> : <ChevronRight className="g-flecha" size={11} strokeWidth={2} />)}
      {sub && <span className="g-sub">{sub}</span>}
      {hasta && <span className="g-hasta">{hasta}</span>}
    </>
  );
  return (
    <div className="grupo" data-grupo={id} data-hijo={hijo ? "" : undefined}>
      {plegable ? (
        <button
          type="button"
          className="g-id g-plegar"
          aria-expanded={plegable.abierto}
          data-tip={`${dueno} · ${plegable.abierto ? t("uso.ocultarGrupos") : t("uso.verGrupos", { n: plegable.n })}`}
          onClick={plegable.alternar}
        >
          {cuerpo}
        </button>
      ) : (
        <span className="g-id" data-tip={hasta ? `${dueno} · ${hasta}` : dueno}>
          {cuerpo}
        </span>
      )}
      {celdas.map((c, i) =>
        c ? <UsoCelda key={c.clave} c={c} quien={dueno} ts={ts} ver={ver && i === 0} /> : <span key={`v${i}`} className="uso-vacio" aria-hidden="true" />,
      )}
    </div>
  );
}

/** Las unidades de lo que falta, ya en el idioma de ahora (el reloj las repinta al cambiarlo). */
const unidades = (): Unidades => ({
  d: t("tiempo.unidadD"),
  h: t("tiempo.unidadH"),
  min: t("tiempo.unidadMin"),
  s: t("tiempo.unidadS"),
  ya: t("tiempo.ya"),
});

/** Lo que falta para el reinicio, en el renglón: `formatearFalta`, repintado por el reloj solo cuando cambia. */
const pintorFalta =
  (hasta: number): Pintor =>
  (a) =>
    formatearFalta(hasta - a, unidades());

/** El número de la celda: se apaga (`data-viejo`) cuando el dato tiene más de 15 min (en el tip dice de cuándo es). */
const pintorPct =
  (pct: number, ts: number): Pintor =>
  (a) => {
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    return { texto: `${pct}%`, en: ts && !viejo ? VIEJO_S - d : Infinity, attrs: { "data-viejo": viejo ? "" : null } };
  };

/** `ts`: cuándo se vio el dato (0: no se sabe). */
function UsoCelda({ c, quien, ts, ver }: { c: Celda; quien: string; ts: number; ver?: boolean }) {
  const largo = `${quien} · ${c.ventana}`;
  const hasta = c.hasta;
  const pct = c.pct;
  const falta = useMemo(() => pintorFalta(hasta), [hasta]);
  const cuando = useMemo(() => pintorCuando(hasta), [hasta]);
  // Una sola línea: "Claude · ventana de 5 horas · 62 % usado · se reinicia hoy 23:40" (y "visto hace…" si el dato es viejo).
  const explica = useMemo(
    () =>
      pintorVisto(
        ts,
        (a) => {
          const reinicio = hasta > 0 ? cuando(a) : { texto: t("uso.sinHoraLinea"), en: Infinity };
          return { texto: t("uso.tipLinea", { quien, ventana: c.ventana, pct: pct ?? 0, reinicio: reinicio.texto }), en: reinicio.en };
        },
        true,
      ),
    [ts, hasta, cuando, quien, c.ventana, pct],
  );
  const numero = useMemo(() => pintorPct(pct ?? 0, ts), [pct, ts]);
  const n = pct === null ? "normal" : nivel(pct);
  return (
    <div
      className="uso"
      tabIndex={0}
      aria-label={pct === null ? t("uso.ariaSinDato", { largo }) : t("uso.aria", { largo, pct })}
      data-nivel={n === "normal" ? undefined : n}
      data-sin={pct === null ? "" : undefined}
      data-ver={ver ? "" : undefined}
    >
      <div className="r">
        {hasta > 0 ? <Reloj pintor={falta} className="n" /> : <span className="n">—</span>}
        {pct === null ? <span className="sd">{c.cupo ? "—" : t("uso.sinDato")}</span> : <Reloj pintor={numero} className="pct" />}
      </div>
      <div className="riel">{pct !== null && <i style={{ transform: `scaleX(${pct / 100})` }} />}</div>
      <span className="tip" role="tooltip">
        {pct === null ? (
          <>
            <span className="tip-t">{largo}</span>
            <span className="tip-l">{c.cupo ? t("uso.sinDatoCupo") : t("uso.sinDatoTip")}</span>
          </>
        ) : (
          <Reloj pintor={explica} className="tip-t" />
        )}
      </span>
    </div>
  );
}
