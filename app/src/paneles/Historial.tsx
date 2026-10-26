// "En qué se van los tokens": el registro histórico (electron/historial.ts) de los últimos 7 o 30 días.
// Los tokens por rol y por modelo son exactos y no llevan rótulo; el peso de cada parte del arranque
// sale del tamaño del texto y dice "estimado" hasta que el usuario aprieta "Medir exacto" (electron/arranque.ts): entonces se
// ve lo medido, con su fecha, en lugar del estimado; las veces que se usó algo son exactas. Sólo lectura: no apaga nada.
import { useEffect, useMemo, useRef, useState } from "react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Consulta, type Medido, type PiezaConsulta } from "../datos/paneles";
import { locale, t } from "../i18n";
import { ErrorCarga } from "./ErrorCarga";
import { mensaje } from "../puente";
import { MODO } from "../modo";
import { arranque, cargadas, CATEGORIAS, porFamilia, total, usadas } from "./historial-datos";
import { FAMILIAS, tokens, type Familia } from "./resumen";

const pct = (x: number) => `${Math.round(x * 100)} %`;
const sesiones = (n: number) => t(n === 1 ? "hist.sesiones1" : "hist.sesionesN", { n });
const veces = (n: number) => t(n === 1 ? "hist.veces1" : "hist.vecesN", { n });
const familia = (f: Familia) => (f === "otro" ? t("est.otro") : f);
const ROLES = ["lider", "worker", "subagente"] as const;

export function Historial({ dias }: { dias: 7 | 30 }) {
  // Al cambiar de período se sigue viendo lo anterior, apagado, hasta que llega lo nuevo: no se vacía ni se achica el panel
  // (y el filtro de abajo se queda donde estaba). `de`: de cuántos días es lo que se ve.
  const [c, setC] = useState<{ de: number; r: Consulta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reintentar: otro pedido (el efecto depende de esto).
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    fuentePaneles.historial(dias).then(
      (r) => {
        if (!vivo) return;
        if (r.version !== VERSION) setError(t("error.version", { que: t("hist.titulo"), v: r.version, conozco: VERSION }));
        else if ("error" in r) setError(r.error);
        else {
          setError(null);
          setC({ de: dias, r });
        }
      },
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [dias, intento]);

  if (error)
    return (
      <ErrorCarga
        error={error}
        alReintentar={() => {
          setError(null);
          setIntento((n) => n + 1);
        }}
      />
    );
  if (!c) return <div className="pn-aviso">{t("hist.leyendo")}</div>;
  const viejo = c.de !== dias;
  return (
    <>
      <PorRol c={c.r} viejo={viejo} />
      <Arranque c={c.r} viejo={viejo} />
      <Cargado dias={dias} todos={c.r} viejo={viejo} />
    </>
  );
}

function PorRol({ c, viejo }: { c: Consulta; viejo: boolean }) {
  const modelos = useMemo(() => porFamilia(c.modelos), [c]);
  const roles = useMemo(() => ROLES.map((r) => ({ r, n: c.roles[r].sesiones, ...porFamilia(c.roles[r].modelos) })), [c]);
  const tope = Math.max(1, ...roles.map((x) => x.total));
  return (
    <section className="pn-sec" data-viejo={viejo ? "" : undefined}>
      <h2 className="pn-h">
        {t("hist.titulo")} <span className="pn-h-sub">{t("hist.sub")}</span>
      </h2>
      {c.sesiones === 0 ? <div className="pn-aviso">{t("hist.sinSesiones")}</div> : null}
      {c.sesiones > 0 ? (
        <>
          {roles.map((x) => (
            <div key={x.r} className="pn-parte" data-tip={desglose(c.roles[x.r].modelos)}>
              <span className="pn-parte-n">{t(`hist.${x.r}`)}</span>
              <div className="pn-apilada">
                <div className="pn-pila pn-pila-m" style={{ width: `${(x.total / tope) * 100}%` }}>
                  {FAMILIAS.filter((f) => x.familias[f] > 0).map((f) => (
                    <i key={f} data-m={f} style={{ flexGrow: x.familias[f] }} />
                  ))}
                </div>
                <span className="pn-mix">
                  {FAMILIAS.filter((f) => x.familias[f] > 0)
                    .map((f) => `${familia(f)} ${pct(x.familias[f] / x.total)}`)
                    .join(" · ")}
                </span>
              </div>
              <span className="pn-num">{x.n}</span>
              <span className="pn-num pn-tok">{tokens(x.total)}</span>
            </div>
          ))}
          <div className="pn-pila pn-pila-m" aria-hidden="true">
            {FAMILIAS.filter((f) => modelos.familias[f] > 0).map((f) => (
              <i key={f} data-m={f} style={{ flexGrow: modelos.familias[f] }} />
            ))}
          </div>
          <div className="pn-leyenda">
            {FAMILIAS.filter((f) => modelos.familias[f] > 0).map((f) => (
              <span key={f} data-m={f}>
                {familia(f)} <b>{pct(modelos.familias[f] / modelos.total)}</b>
                <em>{tokens(modelos.familias[f])}</em>
              </span>
            ))}
            <span className="pn-tasa">
              {sesiones(c.sesiones)} · {tokens(modelos.total)}
            </span>
          </div>
          {c.sinDato.parserViejo ? <div className="pn-nota">{t("hist.sinDatoParser", { n: c.sinDato.parserViejo })}</div> : null}
        </>
      ) : null}
    </section>
  );
}

/** Las cuatro clases de tokens sumadas entre los modelos, para el tip. */
function desglose(modelos: Consulta["modelos"]) {
  const s = { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 };
  for (const m of Object.values(modelos)) {
    s.entrada += m.entrada;
    s.cacheCreado += m.cacheCreado;
    s.cacheLeido += m.cacheLeido;
    s.salida += m.salida;
  }
  const f = (n: number) => n.toLocaleString(locale());
  return t("consumo.desglose", { e: f(s.entrada), c: f(s.cacheCreado), l: f(s.cacheLeido), s: f(s.salida) }) + ` · ${t("hist.cuenta", { n: f(total(s)) })}`;
}

const PARTES_MEDIDAS = ["sistema", "skills", "mcp", "resto"] as const;
const diaMes = (ms: number) => {
  const f = new Date(ms);
  return t("est.diaMes", { d: f.getDate(), m: f.getMonth() + 1 });
};

function Arranque({ c, viejo }: { c: Consulta; viejo: boolean }) {
  const a = useMemo(() => arranque(c), [c]);
  // Lo último que se midió (`null`: nunca) y el pedido en curso. Lo medido no depende del período: es de ahora.
  const [medido, setMedido] = useState<Medido | null>(null);
  const [midiendo, setMidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fuentePaneles.arranqueMedido().then(
      (m) => vivo && setMedido(m),
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, []);
  const medir = () => {
    setError(null);
    setMidiendo(true);
    fuentePaneles.medirArranque().then(
      (r) => {
        if ("error" in r) setError(r.error);
        else setMedido(r);
        setMidiendo(false);
      },
      (e) => {
        setError(mensaje(e));
        setMidiendo(false);
      },
    );
  };
  // La captura `estadisticas-medido` es de esta sección: la deja a la vista en vez de al pie del panel.
  const seccion = useRef<HTMLElement>(null);
  // Con las fuentes cargadas y la entrada del panel (`entra`: 3 px de translateY) terminada: scrollIntoView mide con los
  // transforms puestos, y centrar antes mueve la sección hasta 3 px según el cuadro en que caiga (scripts/visual.mjs).
  useEffect(() => {
    if (!medido || MODO.captura !== "estadisticas-medido") return;
    let vivo = true;
    void document.fonts.ready
      .then(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)))
      .then(() => requestAnimationFrame(() => vivo && seccion.current?.scrollIntoView({ block: "center" })));
    return () => {
      vivo = false;
    };
  }, [medido]);
  if (!a.sesiones && !medido) return null;
  const filas = medido
    ? PARTES_MEDIDAS.map((k) => ({ k, nombre: t(`hist.m.${k}`), peso: medido.partes[k], total: medido.total }))
    : [...CATEGORIAS.map((k) => ({ k, nombre: t(`hist.${k}`), peso: a.partes[k] })), { k: "sinDesglosar", nombre: t("hist.sinDesglosar"), peso: a.sinDesglosar }].map((f) => ({ ...f, total: a.exacto }));
  const tope = Math.max(1, ...filas.map((f) => f.peso));
  return (
    <section ref={seccion} className="pn-sec" data-viejo={viejo ? "" : undefined}>
      <h2 className="pn-h">
        {t("hist.arranque")} <span className="pn-h-sub">{medido ? t("hist.medidoEl", { f: diaMes(medido.medido_en) }) : t("hist.estimado")}</span>
      </h2>
      <div className="pn-nota">
        {medido
          ? t("hist.medidoResumen", { t: tokens(medido.total) })
          : t("hist.arranqueResumen", { t: tokens(a.exacto), s: sesiones(a.sesiones), p: tokens(a.exacto / a.sesiones) })}
      </div>
      {filas.map((f) => (
        <div key={f.k} className="pn-parte">
          <span className="pn-parte-n">{f.nombre}</span>
          <div className="pn-apilada">
            <div className="pn-pila pn-pila-m" style={{ width: `${(f.peso / tope) * 100}%` }}>
              <i data-m="Opus" style={{ flexGrow: 1 }} />
            </div>
          </div>
          <span className="pn-num">{pct(f.peso / f.total)}</span>
          <span className="pn-num pn-tok">{medido ? tokens(f.peso) : t("hist.aprox", { t: tokens(f.peso) })}</span>
        </div>
      ))}
      {!medido && c.sinDato.sinArranque ? <div className="pn-nota">{t("hist.sinArranque", { n: c.sinDato.sinArranque })}</div> : null}
      {!medido && c.sinDato.sinCalibrar ? <div className="pn-nota">{t("hist.sinCalibrar", { n: c.sinDato.sinCalibrar })}</div> : null}
      {error ? <ErrorCarga error={error} alReintentar={medir} /> : null}
      <div className="pn-medir">
        <button type="button" className="mini" disabled={midiendo} onClick={medir}>
          {midiendo ? t("hist.midiendo") : medido ? t("hist.medirDeNuevo") : t("hist.medir")}
        </button>
        <span className="pn-nota">{t("hist.medirNota")}</span>
      </div>
    </section>
  );
}

const FILTROS = [null, "lider", "worker"] as const;
type Filtro = (typeof FILTROS)[number];

/** "Cargado y sin usar" y las listas de lo que sí se usa; el filtro de líderes / workers pide la consulta de ese rol. */
function Cargado({ dias, todos, viejo }: { dias: 7 | 30; todos: Consulta; viejo: boolean }) {
  const [rol, setRol] = useState<Filtro>(null);
  // La del rol elegido, con el período y el rol que se pidieron.
  const [pedida, setPedida] = useState<{ dias: number; rol: Filtro; r: Consulta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (rol === null) {
      setError(null);
      return;
    }
    let vivo = true;
    fuentePaneles.historial(dias, rol).then(
      (r) => {
        if (!vivo) return;
        if (r.version !== VERSION) setError(t("error.version", { que: t("hist.sinUsar"), v: r.version, conozco: VERSION }));
        else if ("error" in r) setError(r.error);
        else {
          setError(null);
          setPedida({ dias, rol, r });
        }
      },
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [dias, rol, intento]);

  // Mientras llega la consulta del rol (o la del otro período) se sigue viendo la anterior, apagada: sin parpadeo ni saltos.
  const c = rol === null ? todos : pedida?.rol === rol ? pedida.r : todos;
  const apagado = viejo || (rol !== null && (pedida?.rol !== rol || pedida.dias !== dias));
  const filas = useMemo(() => cargadas(c), [c]);
  const usos = useMemo(() => usadas(c), [c]);
  const tope = Math.max(1, ...filas.map((f) => f.pieza.peso));
  const nombre = (k: Filtro) => (k === null ? t("hist.todos") : t(`hist.${k}`));
  return (
    <>
      <section className="pn-sec" data-viejo={apagado ? "" : undefined}>
        <h2 className="pn-h">
          {t("hist.sinUsar")} <span className="pn-h-sub">{t("hist.estimado")}</span>
        </h2>
        <div className="pn-seg" role="group" aria-label={t("hist.filtro")}>
          {FILTROS.map((k) => (
            <button key={k ?? "todos"} type="button" aria-pressed={rol === k} onClick={() => setRol(k)}>
              {nombre(k)}
            </button>
          ))}
        </div>
        {error ? (
          <ErrorCarga
            error={error}
            alReintentar={() => {
              setError(null);
              setIntento((n) => n + 1);
            }}
          />
        ) : null}
        {c.sesiones === 0 ? <div className="pn-aviso">{t("hist.sinSesiones")}</div> : null}
        {c.sesiones > 0 && filas.length === 0 ? <div className="pn-aviso">{t("hist.sinPiezas")}</div> : null}
        {filas.length > 0 ? <div className="pn-nota">{t("hist.sinUsarNota", { s: sesiones(c.sesiones) })}</div> : null}
        {filas.map(({ pieza: p, sinUsar }) => (
          <div key={`${p.clase}\n${p.nombre}`} className="pn-parte" data-sin-uso={sinUsar ? "" : undefined} data-tip={p.nombre}>
            <span className="pn-parte-n">{p.nombre}</span>
            <div className="pn-apilada">
              <div className="pn-pila pn-pila-m" style={{ width: `${(p.peso / tope) * 100}%` }}>
                <i data-m="Opus" style={{ flexGrow: 1 }} />
              </div>
              <span className="pn-mix">
                {sinUsar ? <b>{t("hist.nunca")} · </b> : null}
                {p.ganchos > 0 ? <>{t("hist.ganchos")} · {veces(p.ganchos)} · </> : null}
                {tipo(p)} · {sesiones(p.sesiones)} · {t("hist.enTotal", { t: tokens(p.peso) })}
              </span>
            </div>
            <span className="pn-num">{p.usos === null ? "—" : p.usos.toLocaleString(locale())}</span>
            <span className="pn-num pn-tok">{t("hist.aprox", { t: tokens(p.peso / p.sesiones) })}</span>
          </div>
        ))}
      </section>
      <section className="pn-sec" data-viejo={apagado ? "" : undefined}>
        <h2 className="pn-h">
          {t("hist.usadas")} <span className="pn-h-sub">{t("hist.exacto")}</span>
        </h2>
        <Usadas titulo={t("hist.skillsUsadas")} lista={usos.skills} />
        <Usadas titulo={t("hist.mcpUsados")} lista={usos.mcp} />
        <Usadas titulo={t("hist.subagentesUsados")} lista={usos.subagentes} />
      </section>
    </>
  );
}

function tipo(p: PiezaConsulta) {
  if (p.clase === "skill") {
    const corte = p.nombre.indexOf(":");
    return p.origen === "plugin" && corte > 0 ? t("hist.tipoSkillPlugin", { p: p.nombre.slice(0, corte) }) : t("hist.tipoSkill");
  }
  return p.clase === "plugin" ? t("hist.tipo.plugin") : p.clase === "mcp" ? t("hist.tipo.mcp") : t("hist.tipo.claudemd");
}

function Usadas({ titulo, lista }: { titulo: string; lista: [string, number][] }) {
  const tope = Math.max(1, ...lista.map((x) => x[1]));
  return (
    <>
      <div className="pn-nota pn-sub-h">{titulo}</div>
      {lista.length === 0 ? <div className="pn-aviso">{t("hist.ninguna")}</div> : null}
      {lista.map(([nombre, n]) => (
        <div key={nombre} className="pn-parte" data-tip={nombre}>
          <span className="pn-parte-n">{nombre}</span>
          <div className="pn-apilada">
            <div className="pn-pila pn-pila-m" style={{ width: `${(n / tope) * 100}%` }}>
              <i data-m="Opus" style={{ flexGrow: 1 }} />
            </div>
          </div>
          <span className="pn-num">{n.toLocaleString(locale())}</span>
          <span />
        </div>
      ))}
    </>
  );
}
