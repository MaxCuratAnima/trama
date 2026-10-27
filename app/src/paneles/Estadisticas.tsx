// Estadísticas de los WORKERS (`medicion.tsv`; los líderes no se anotan) y la
// cuota de toda la cuenta (`statusline/historial.jsonl`). Barras finas sin
// librerías de gráficos; cada sección nombra su ventana de tiempo, porque hay
// cuatro (ver resumen.ts). La plata no se muestra: El usuario paga suscripción.
import { useEffect, useMemo, useState } from "react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Corrida, type Muestra } from "../datos/paneles";
import { MODO } from "../modo";
import { coma, diaSemana, locale, t } from "../i18n";
import { duracion } from "../tiempo";
import { ErrorCarga } from "./ErrorCarga";
import { Historial } from "./Historial";
import { Vacio } from "./Vacio";
import { mensaje } from "../puente";
import {
  cambio,
  cuota,
  diario,
  etiquetas,
  FAMILIAS,
  inicioDia,
  resumir,
  semanas,
  tendencia,
  tokens,
  type Dia,
  type Familia,
  type Suma,
} from "./resumen";

const RANGOS = [7, 30] as const;

/** "dom 4/10" en español, "Sun 10/4" en inglés. */
const fecha = (ts: number) => {
  const f = new Date(ts * 1000);
  return t("est.fecha", { dia: diaSemana(f), d: f.getDate(), m: f.getMonth() + 1 });
};
const diaMes = (ts: number) => {
  const f = new Date(ts * 1000);
  return t("est.diaMes", { d: f.getDate(), m: f.getMonth() + 1 });
};
const hora = (ts: number) => {
  const f = new Date(ts * 1000);
  return `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}`;
};
/** "hoy 12:50", "mañana 12:00", "dom 4/10 12:00". */
const cuando = (ts: number, ahora: number) => {
  const dia = (t: number) => new Date(t * 1000).toDateString();
  if (dia(ts) === dia(ahora)) return t("est.hoyHora", { h: hora(ts) });
  if (dia(ts) === dia(ahora + 86400)) return t("est.mananaHora", { h: hora(ts) });
  return `${fecha(ts)} ${hora(ts)}`;
};
const pct = (x: number) => `${Math.round(x * 100)} %`;
const signo = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))} %`);
const decimal = (x: number) => (x >= 10 ? String(Math.round(x)) : coma(x.toFixed(1)));
const corridas = (n: number) => t(n === 1 ? "est.corrida1" : "est.corridaN", { n });
/** "otro" es el nombre interno de la familia; se muestra traducido. */
const familia = (f: Familia) => (f === "otro" ? t("est.otro") : f);

type Datos = { corridas: Corrida[]; desde: number | null; cuota: Muestra[] | null; ahora: number };

export function Estadisticas() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ningún worker corrió todavía (no hay `medicion.tsv`): estado vacío, no error.
  const [vacia, setVacia] = useState(false);
  const [dias, setDias] = useState<(typeof RANGOS)[number]>(MODO.captura === "estadisticas-30" ? 30 : 7);
  // Reintentar: otro pedido (el efecto depende de esto).
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    fuentePaneles.medicion().then(
      (r) => {
        if (!vivo) return;
        if (r.version !== VERSION) setError(t("error.version", { que: t("panel.estadisticas"), v: r.version, conozco: VERSION }));
        else if ("error" in r) setError(r.error);
        else if ("vacia" in r) setVacia(true);
        else setDatos({ corridas: r.corridas, desde: r.desde, cuota: r.cuota, ahora: Date.now() / 1000 });
      },
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [intento]);

  const fijo = useMemo(() => {
    if (!datos) return null;
    const { corridas: cs, desde, ahora } = datos;
    return {
      tendencia: tendencia(cs, ahora, desde),
      semanas: semanas(cs, ahora, desde),
      cuota: cuota(datos.cuota, cs, ahora),
      sesenta: diario(cs, 60, ahora),
    };
  }, [datos]);
  const r = useMemo(() => (datos ? resumir(datos.corridas, dias, datos.ahora, datos.desde) : null), [datos, dias]);

  const reintentar = () => {
    setError(null);
    setIntento((n) => n + 1);
  };
  if (error) return <ErrorCarga error={error} alReintentar={reintentar} />;
  if (vacia) return <Vacio titulo={t("est.vaciaT")} texto={t("est.vaciaP")} />;
  if (!datos || !r || !fijo) return <div className="pn-aviso">{t("est.leyendo")}</div>;

  const { ahora, desde } = datos;
  const evaluadas = r.bien.si + r.bien.parcial + r.bien.no;
  const faltan = desde === null ? t("est.sinCorridas") : t("est.faltan", { f: fecha(desde) });
  return (
    <>
      <div className="pn-cab">
        <div className="pn-seg" role="group" aria-label={t("est.periodo")}>
          {RANGOS.map((d) => (
            <button key={d} type="button" aria-pressed={dias === d} onClick={() => setDias(d)}>
              {t("est.dias", { n: d })}
            </button>
          ))}
        </div>
        <div className="pn-periodo">
          {t("est.ultimos", { n: dias })}
          {r.desde !== null ? t("est.desde", { f: fecha(r.desde) }) : ""}
          <span>{t("est.soloWorkers")}</span>
        </div>
      </div>

      <section className="pn-cifras">
        <Cifra nombre={t("est.corridas")} valor={r.corridas.toLocaleString(locale())} />
        <Cifra nombre={t("est.tiempo")} valor={r.corridas ? duracion(r.tiempo_s) : "0 m"} />
        <Cifra nombre={t("est.tokens")} valor={tokens(r.tokens)} />
        <Cifra nombre={t("est.cache")} valor={r.cache === null ? "—" : pct(r.cache)} sub={t("est.cacheSub")} />
        <Cifra
          nombre={t("est.compact")}
          valor={r.conCompactaciones ? r.compactaciones.toLocaleString(locale()) : "—"}
          sub={t("est.compactSub")}
        />
      </section>

      <section className="pn-sec">
        <h2 className="pn-h">{t("est.porDia", { n: dias })}</h2>
        <Barras dias={r.porDia} valor={(d) => d.n} texto={String} tip={(d) => corridas(d.n)} ahora={ahora} />
      </section>

      <section className="pn-sec">
        <h2 className="pn-h">{t("est.tendencia")}</h2>
        <div className="pn-tabla">
          <span className="pn-t-q">
            {t("est.promedio", { hay: fijo.tendencia.dias < 7 ? t("est.hay", { n: decimal(fijo.tendencia.dias) }) : "" })}
          </span>
          {fijo.tendencia.anterior ? (
            <>
              <Comparacion
                nombre={t("est.corridas")}
                a={decimal(fijo.tendencia.actual.n)}
                b={decimal(fijo.tendencia.anterior.n)}
                c={cambio(fijo.tendencia.actual.n, fijo.tendencia.anterior.n)}
              />
              <Comparacion
                nombre={t("est.tokens")}
                a={tokens(fijo.tendencia.actual.tokens)}
                b={tokens(fijo.tendencia.anterior.tokens)}
                c={cambio(fijo.tendencia.actual.tokens, fijo.tendencia.anterior.tokens)}
              />
            </>
          ) : (
            <span className="pn-t-falta">
              {t("est.porDiaFalta", { c: decimal(fijo.tendencia.actual.n), t: tokens(fijo.tendencia.actual.tokens), faltan })}
            </span>
          )}
          <span className="pn-t-q">
            {t("est.semana", { f: diaMes(fijo.semanas.lunes) })}
          </span>
          {fijo.semanas.aLaAltura && fijo.semanas.pasada ? (
            <>
              <Semana nombre={t("est.corridas")} a={fijo.semanas.actual} b={fijo.semanas.aLaAltura} entera={fijo.semanas.pasada} k="n" />
              <Semana nombre={t("est.tokens")} a={fijo.semanas.actual} b={fijo.semanas.aLaAltura} entera={fijo.semanas.pasada} k="tokens" />
            </>
          ) : (
            <span className="pn-t-falta">
              {t("est.semanaFalta", { c: corridas(fijo.semanas.actual.n), t: tokens(fijo.semanas.actual.tokens), faltan })}
            </span>
          )}
        </div>
      </section>

      <Cuota q={fijo.cuota} ahora={ahora} desde={desde} />

      <section className="pn-sec">
        <h2 className="pn-h">{t("est.tokensDia")}</h2>
        <Barras dias={fijo.sesenta} valor={(d) => d.tokens} texto={tokens} tip={(d) => t("est.tipTokens", { t: tokens(d.tokens), c: corridas(d.n) })} ahora={ahora} />
        {desde !== null && inicioDia(desde) > fijo.sesenta[0].ts ? <div className="pn-nota">{t("est.hayDesde", { f: fecha(desde) })}</div> : null}
      </section>

      <PorModelo partes={r.porModelo} />
      <PorProyecto partes={r.porProyecto} />

      <Historial dias={dias} />

      {evaluadas > 0 ? (
        <section className="pn-sec">
          <h2 className="pn-h">
            {t("est.bien")} <span className="pn-h-sub">{t("est.evaluadas", { n: evaluadas })}</span>
          </h2>
          <div className="pn-pila" aria-hidden="true">
            <i data-b="si" style={{ flexGrow: r.bien.si }} />
            <i data-b="parcial" style={{ flexGrow: r.bien.parcial }} />
            <i data-b="no" style={{ flexGrow: r.bien.no }} />
          </div>
          <div className="pn-leyenda">
            <span data-b="si">
              {t("est.si")} <b>{r.bien.si}</b>
            </span>
            <span data-b="parcial">
              {t("est.parcial")} <b>{r.bien.parcial}</b>
            </span>
            <span data-b="no">
              {t("est.no")} <b>{r.bien.no}</b>
            </span>
            <span className="pn-tasa">{t("est.tasa", { p: pct(r.bien.si / evaluadas) })}</span>
          </div>
          <div className="pn-nota">{t("est.bienNota")}</div>
        </section>
      ) : null}
    </>
  );
}

function Cifra({ nombre, valor, sub }: { nombre: string; valor: string; sub?: string }) {
  return (
    <div className="pn-cifra">
      <div className="pn-h">{nombre}</div>
      <b>{valor}</b>
      {sub ? <div className="pn-cifra-sub">{sub}</div> : null}
    </div>
  );
}

function Comparacion({ nombre, a, b, c }: { nombre: string; a: string; b: string; c: number | null }) {
  return (
    <>
      <span className="pn-t-n">{nombre}</span>
      <span className="pn-num">{a}</span>
      <span className="pn-num pn-tok">{t("est.antes", { v: b })}</span>
      <span className="pn-num pn-cambio">{signo(c)}</span>
    </>
  );
}

function Semana({ nombre, a, b, entera, k }: { nombre: string; a: Suma; b: Suma; entera: Suma; k: keyof Suma }) {
  const f = k === "n" ? String : tokens;
  return (
    <>
      <span className="pn-t-n">{nombre}</span>
      <span className="pn-num">{f(a[k])}</span>
      <span className="pn-num pn-tok" data-tip={t("est.semanaEntera", { v: f(entera[k]) })}>
        {t("est.antesEntera", { b: f(b[k]), e: f(entera[k]) })}
      </span>
      <span className="pn-num pn-cambio">{signo(cambio(a[k], b[k]))}</span>
    </>
  );
}

/**
 * Barras verticales finas a todo el ancho: el número arriba y el día abajo,
 * visibles sin hover cuando entran (`etiquetas`); el detalle, en el tip.
 */
function Barras({
  dias,
  valor,
  texto,
  tip,
  ahora,
}: {
  dias: Dia[];
  valor: (d: Dia) => number;
  texto: (n: number) => string;
  tip: (d: Dia) => string;
  ahora: number;
}) {
  const e = etiquetas(dias.length);
  const vs = dias.map(valor);
  const tope = Math.max(1, ...vs);
  const maximo = vs.indexOf(Math.max(...vs));
  const ultimo = dias.length - 1;
  return (
    <div className="pn-barras" data-denso={e.dia === "lunes" ? "" : undefined} style={{ gridTemplateColumns: `repeat(${dias.length}, minmax(0, 1fr))` }}>
      {dias.map((d, i) => {
        const v = vs[i];
        const f = new Date(d.ts * 1000);
        // En 60 días: el máximo y hoy, salvo que estén tan cerca que se pisen (gana el máximo).
        const numero = e.numero === "todas" || (v > 0 && (i === maximo || (i === ultimo && ultimo - maximo >= 6)));
        const dia =
          i === ultimo && e.dia !== "corto"
            ? t("est.hoy")
            : e.dia === "largo"
              ? `${diaSemana(f)} ${f.getDate()}`
              : e.dia === "corto"
                ? String(f.getDate())
                : f.getDay() === 1
                  ? diaMes(d.ts)
                  : "";
        return (
          <div key={d.ts} className="pn-b" data-tip={`${fecha(d.ts)} · ${tip(d)}`} data-hoy={d.ts > ahora - 86400 ? "" : undefined}>
            <span className="pn-b-num" data-cero={v === 0 ? "" : undefined}>
              {numero ? texto(v) : ""}
            </span>
            <div className="pn-b-riel">
              <i style={{ transform: `scaleY(${v / tope})` }} />
            </div>
            <span className="pn-b-dia" data-lunes={f.getDay() === 1 ? "" : undefined}>
              {dia}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Cuota({ q, ahora, desde }: { q: ReturnType<typeof cuota>; ahora: number; desde: number | null }) {
  return (
    <section className="pn-sec">
      <h2 className="pn-h">
        {t("est.cuota")} <span className="pn-h-sub">{t("est.cuotaSub")}</span>
      </h2>
      {q === null ? (
        <div className="pn-aviso">{t("est.sinHistorial")}</div>
      ) : (
        <>
          <Medidor
            nombre={t("est.semanal")}
            valor={q.semVencida ? null : q.ultima.sem}
            nota={t(q.semVencida ? "est.renovoSin" : "est.renueva", { c: cuando(q.ultima.sem_reset, ahora) })}
          />
          <Medidor
            nombre={t("est.5h")}
            valor={q.h5Vencida ? null : q.ultima.h5}
            nota={t(q.h5Vencida ? "est.renovo" : "est.renueva", { c: cuando(q.ultima.h5_reset, ahora) })}
          />
          {q.semVencida ? null : (
            <div
              className="pn-nota"
              data-tip={t("est.cuotaTip")}
            >
              {t("est.workersSemana", { c: corridas(q.workers.n), t: tokens(q.workers.tokens) })}
              {desde !== null && desde > q.ultima.sem_reset - 7 * 86400 ? t("est.arranca", { f: fecha(desde) }) : ""}
            </div>
          )}
          <div className="pn-semanas">
            {q.anteriores.length ? (
              q.anteriores.slice(0, 6).map((s) => (
                <span key={s.reset}>
                  {t("est.cerro", { f: fecha(s.reset) })} <b>{s.sem} %</b>
                </span>
              ))
            ) : (
              <span>{t("est.seJunta", { c: cuando(q.desde, ahora) })}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Medidor({ nombre, valor, nota }: { nombre: string; valor: number | null; nota: string }) {
  return (
    <div className="pn-medidor">
      <span className="pn-t-n">{nombre}</span>
      <div className="riel pn-riel">
        <i style={{ transform: `scaleX(${Math.min(1, (valor ?? 0) / 100)})` }} />
      </div>
      <span className="pn-num">{valor === null ? "—" : `${valor} %`}</span>
      <span className="pn-num pn-tok">{nota}</span>
    </div>
  );
}

function PorModelo({ partes }: { partes: { familia: Familia; n: number; tokens: number }[] }) {
  const total = partes.reduce((s, p) => s + p.tokens, 0);
  if (!partes.length) return null;
  return (
    <section className="pn-sec">
      <h2 className="pn-h">
        {t("est.porModelo")} <span className="pn-h-sub">{t("est.porModeloSub")}</span>
      </h2>
      <div className="pn-pila pn-pila-m" aria-hidden="true">
        {partes.map((p) => (
          <i key={p.familia} data-m={p.familia} style={{ flexGrow: p.tokens }} />
        ))}
      </div>
      <div className="pn-leyenda">
        {partes.map((p) => (
          <span key={p.familia} data-m={p.familia}>
            {familia(p.familia)} <b>{total ? pct(p.tokens / total) : "—"}</b>
            <em>{corridas(p.n)}</em>
          </span>
        ))}
      </div>
    </section>
  );
}

/** Cuántos proyectos como mucho; lo demás se junta en "otros". */
const TOPE = 8;

function PorProyecto({ partes }: { partes: ReturnType<typeof resumir>["porProyecto"] }) {
  const filas = partes.slice(0, TOPE);
  const resto = partes.slice(TOPE);
  if (resto.length) {
    const modelos = { Opus: 0, Sonnet: 0, Fable: 0, Google: 0, otro: 0 };
    for (const p of resto) for (const f of FAMILIAS) modelos[f] += p.modelos[f];
    filas.push({
      nombre: t("est.otros", { n: resto.length }),
      n: resto.reduce((s, p) => s + p.n, 0),
      tokens: resto.reduce((s, p) => s + p.tokens, 0),
      modelos,
    });
  }
  const tope = Math.max(1, ...filas.map((p) => p.tokens));
  return (
    <section className="pn-sec">
      <h2 className="pn-h">
        {t("est.porProyecto")} <span className="pn-h-sub">{t("est.porProyectoSub")}</span>
      </h2>
      {filas.length === 0 ? <div className="pn-aviso">{t("est.sinPeriodo")}</div> : null}
      {filas.map((p) => (
        <div key={p.nombre} className="pn-parte">
          <span className="pn-parte-n">{p.nombre}</span>
          <div className="pn-apilada">
            <div className="pn-pila pn-pila-m" style={{ width: `${(p.tokens / tope) * 100}%` }}>
              {FAMILIAS.filter((f) => p.modelos[f] > 0).map((f) => (
                <i key={f} data-m={f} style={{ flexGrow: p.modelos[f] }} />
              ))}
            </div>
            <span className="pn-mix">
              {FAMILIAS.filter((f) => p.modelos[f] > 0)
                .map((f) => `${familia(f)} ${p.tokens ? pct(p.modelos[f] / p.tokens) : "—"}`)
                .join(" · ")}
            </span>
          </div>
          <span className="pn-num">{p.n}</span>
          <span className="pn-num pn-tok">{tokens(p.tokens)}</span>
        </div>
      ))}
    </section>
  );
}
