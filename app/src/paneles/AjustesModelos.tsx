// Ajustes > Modelos y proveedores: qué modelo usan el líder y cada tipo de worker (Claude, Gemini o uno local por Ollama),
// los modelos locales y los límites de Gemini. Es el archivo `~/.config/trama/modelos.json` que también lee `pa`. Trabaja
// sobre un borrador (modelos-borrador.ts): nada se escribe hasta Guardar, y sin archivo se muestra lo que corre hoy y no se
// crea nada hasta que se guarda un cambio. Los modelos locales se detectan preguntándole a Ollama (`/api/tags`); acá no se
// carga ninguno. Sólo se edita desde la PC (por la tailnet el main rechaza guardar).
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Plus, X } from "lucide-react";
import { Chip, Interruptor } from "../ui/componentes";
import { VERSION, type Uso } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { fuentePaneles, type Bajada, type EntornoOllama, type EstadoModelos, type Sondeo } from "../datos/paneles";
import { defDe } from "../hilo/modelos";
import { effortsOpciones } from "../hilo/opciones";
import { Selector, type Opcion } from "../hilo/Selector";
import { t, textoMain, type ClaveSola } from "../i18n";
import { enOtros, Fijo } from "../i18n/Fijo";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Acciones, type FilaDato } from "./AjustesEditar";
import { AjustesCupos, CuposTarjetas } from "./AjustesCupos";
import { Boton } from "../ui/componentes";
import { Cat } from "./AjustesNav";
import { GuiaOllama, SugeridosOllama, textoBajada } from "./AjustesLocales";
import { marcar } from "./ajustes-nav";
import { avisosTope } from "./cupos-aviso";
import {
  agregarExcluido,
  agregarLocal,
  borradorDe,
  configDe,
  efectivoBorrador,
  elegirEffortLider,
  elegirEffortWorker,
  elegirLider,
  elegirWorker,
  esAutomatico,
  liderEfectivo,
  modelosPara,
  nombreModeloValido,
  destrabarOn,
  DESTRABAR_MODELOS,
  nombreGemini,
  ponerAutomatico,
  ponerDestrabar,
  ponerPermitirMax,
  porcentaje,
  quitarExcluido,
  quitarLocal,
  FAMILIAS,
  sucio,
  textoEleccion,
  TIPOS,
  todoEn,
  URL_OLLAMA,
  type Borrador,
  type Eleccion,
  type Modelo,
  type Proveedor,
  type Tipo,
} from "./modelos-borrador";
import { esClaude, urlOllama } from "../../electron/modelos-tipos";

/** Para las capturas: `mdl` (con archivo), `mdl-agregar` (con el panel de otra dirección abierto), `mdl-lider` (el selector del líder abierto), `mdl-bajando` (un modelo a mitad de bajada), `mdl-sinollama` (Ollama sin instalar), `mdl-apagado` (instalado y apagado), `mdl-sugeridos` (los modelos sugeridos), `mdl-tope` (el aviso de un tope cruzado) y `sinmdl` (sin archivo). */
const VARIANTE = MODO.variante ?? "";
const ES_CAPTURA = VARIANTE.startsWith("mdl") || VARIANTE === "sinmdl";

const GRUPO: Record<Proveedor, string | undefined> = { anthropic: "Anthropic", google: "Google", ollama: "Ollama", otro: undefined };

const sinMarca = (o: Opcion): Opcion => ({ ...o, rec: false });

/** La descripción de un modelo, en el idioma de ahora. */
function descDe(m: Modelo): string {
  if (m.desc === "argon") return t("mdl.desc.argon");
  if (m.desc === "flash") return t("mdl.desc.flash");
  if (m.desc === "agy") return t("mdl.desc.agy");
  if (m.desc === "local") return t("mdl.desc.local");
  if (m.desc === "otro") return t("mdl.desc.otro");
  const d = defDe(m.id);
  return d ? t(d.desc) : "";
}

/** Las opciones de un selector de modelo, con "Como hoy" delante cuando se puede dejar sin elegir. */
function opcionesDe(modelos: Modelo[], comoHoy: boolean): Opcion[] {
  const ops = modelos.map((m): Opcion => ({ id: m.id, nombre: m.nombre, desc: descDe(m), grupo: GRUPO[m.proveedor] }));
  const cab: Opcion[] = [];
  if (comoHoy) cab.push({ id: "", nombre: t("ajustes.mdlComoHoy"), desc: t("ajustes.mdlComoHoyQue") });
  return [...cab, ...ops];
}

/** Cómo se llama en la lista de "no se usan" lo que `excluir` guarda (una familia, un id o un prefijo con `*`). */
const NOMBRE_FAMILIA: Record<string, string> = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", argon: "Gemini Argon", flash: "Gemini Flash", "gpt-oss": "GPT-OSS" };
const nombreExcluido = (id: string) => NOMBRE_FAMILIA[id] ?? id;

const gb = (n: number | null) => (n === null ? "" : `${(n / 1e9).toFixed(1)} GB`);

type Estado = Sondeo | "comprobando";

/** El modelo de una fila y, si es de Claude, su esfuerzo. */
function EleccionSel({
  etiqueta,
  modelos,
  valor,
  comoHoy,
  alModelo,
  alEffort,
  abierto,
}: {
  etiqueta: string;
  modelos: Modelo[];
  valor: Eleccion | undefined;
  comoHoy: boolean;
  alModelo: (id: string) => void;
  alEffort: (e: string) => void;
  abierto?: boolean;
}) {
  const ops = opcionesDe(modelos, comoHoy);
  const claude = valor && esClaude(valor.modelo);
  return (
    <div className="pn-sel">
      <Selector etiqueta={t("ajustes.mdlSelModelo", { que: etiqueta })} opciones={ops} valor={valor?.modelo ?? ""} alElegir={alModelo} reserva={[]} abierto={abierto} />
      {claude ? (
        <Selector
          etiqueta={t("ajustes.mdlSelEsfuerzo", { que: etiqueta })}
          opciones={effortsOpciones(valor.modelo).map(sinMarca)}
          valor={valor.effort ?? ""}
          alElegir={alEffort}
          reserva={[]}
        />
      ) : null}
    </div>
  );
}

export function AjustesModelos({ Dato, plan = null }: { Dato: FilaDato; plan?: string | null }) {
  const [e, setE] = useState<EstadoModelos | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [b, setB] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [ag, setAg] = useState<{ url: string; sondeo: Estado | null } | null>(null);
  const [ollama, setOllama] = useState<Estado>("comprobando");
  const [bajando, setBajando] = useState<Record<string, Bajada>>({});
  const [bajar, setBajar] = useState("");
  const [errBajar, setErrBajar] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [entorno, setEntorno] = useState<EntornoOllama | null>(null);
  const vivo = useRef(true);
  const sondeados = useRef(new Set<string>());
  const sec = useRef<HTMLElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  useEffect(() => {
    fuentePaneles.modelos().then(
      (r) => {
        if (!vivo.current) return;
        if (r.version !== VERSION) return setFalla(t("error.version", { que: t("ajustes.mdlTitulo"), v: r.version, conozco: VERSION }));
        setE(r);
        setB(borradorDe(r));
        if (VARIANTE === "mdl-agregar") void detectar(URL_OLLAMA);
      },
      (x) => vivo.current && setFalla(mensaje(x)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mira si el Ollama de esta computadora contesta y qué modelos tiene: no carga nada. */
  async function mirarOllama() {
    setOllama("comprobando");
    const s = await fuentePaneles.sondearOllama(URL_OLLAMA).catch((x): Sondeo => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setOllama(s);
  }
  useEffect(() => {
    void mirarOllama();
    void fuentePaneles.bajadas().then((l) => vivo.current && setBajando(Object.fromEntries(l.filter((x) => x.estado === "bajando").map((x) => [x.modelo, x]))));
    const off = fuentePaneles.alBajar((x) => {
      if (!vivo.current) return;
      setBajando((a) => {
        const { [x.modelo]: _, ...resto } = a;
        return x.estado === "bajando" ? { ...resto, [x.modelo]: x } : resto;
      });
      if (x.estado === "listo") {
        setListo(x.modelo);
        void mirarOllama();
      } else if (x.estado === "error") setErrBajar(t("ajustes.mdlBajarFallo", { nombre: x.modelo, motivo: textoMain(x.motivo ?? "") }));
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void fuentePaneles.entornoOllama().then((x) => vivo.current && setEntorno(x), () => {});
  }, []);
  useEffect(() => {
    void fuente.uso().then((u) => vivo.current && setUso(u), () => {});
    return fuente.alCambiarUso((u) => vivo.current && setUso(u));
  }, []);

  /** Pregunta a Ollama qué tiene: no carga nada. */
  async function detectar(url: string) {
    setAg({ url, sondeo: "comprobando" });
    const s = await fuentePaneles.sondearOllama(url).catch((x): Sondeo => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setAg((a) => (a && a.url === url ? { url, sondeo: s } : a));
  }

  // Cada dirección de los locales se comprueba una vez: responde o no.
  const urls = useMemo(() => (b ? [...new Set(b.locales.map((l) => l.url))].sort() : []), [b]);
  const clave = urls.join("|");
  useEffect(() => {
    for (const url of urls) {
      if (sondeados.current.has(url)) continue;
      sondeados.current.add(url);
      setEstados((x) => ({ ...x, [url]: "comprobando" }));
      void fuentePaneles
        .sondearOllama(url)
        .catch((x): Sondeo => ({ ok: false, motivo: mensaje(x) }))
        .then((s) => vivo.current && setEstados((x) => ({ ...x, [url]: s })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const visible = e !== null && b !== null;
  useEffect(() => {
    if (!visible || !ES_CAPTURA) return;
    // Captura: `mdl-agregar` deja a la vista los locales y su panel; el resto, la cabecera de la sección.
    const mira = sec.current?.querySelector(VARIANTE === "mdl-agregar" ? ".mdl-panel" : VARIANTE === "mdl-bajando" || VARIANTE === "mdl-sinollama" || VARIANTE === "mdl-apagado" ? ".mdl-ollama" : VARIANTE === "mdl-sugeridos" ? ".ol-sug" : VARIANTE === "mdl-tope" ? ".mdl-cruce" : "x:not(x)");
    if (mira) mira.scrollIntoView({ block: "center" });
    else sec.current?.scrollIntoView({ block: "start" });
  }, [visible]);

  // Lo que le falta a Locales y a Cupos se dice en la barra lateral (ajustes-nav.ts).
  const sinResponder = b !== null && b.locales.some((l) => {
    const s = estados[l.url];
    return typeof s === "object" && !s.ok;
  });
  const primero = b !== null ? avisosTope(b, uso)[0] : undefined;
  const marcaTope = primero ? `${primero.quien}|${primero.ventana}|${primero.pct}` : null;
  useEffect(() => {
    marcar("locales", sinResponder ? "aj.marca.ollama" : null);
    if (!primero) marcar("cupos", null);
    else marcar("cupos", "aj.marca.topeDe", { quien: "Claude", ventana: t(primero.ventana === "5h" ? "cu.ventana5h" : "cu.ventanaSem"), pct: String(primero.pct) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinResponder, marcaTope]);
  useEffect(
    () => () => {
      marcar("locales", null);
      marcar("cupos", null);
    },
    [],
  );

  if (falla)
    return (
      <Cat id="modelos">
        <div className="pn-aviso" data-error>{textoMain(falla)}</div>
      </Cat>
    );
  if (!e || !b) return null;

  const cambiar = (nuevo: Borrador) => {
    setB(nuevo);
    setError(null);
    setOk(false);
  };
  const config = configDe(b);
  const hayCambio = sucio(e, b);
  const instaladosOl = typeof ollama === "object" && ollama.ok ? ollama.modelos : null;
  const bajandoLista = Object.values(bajando);
  const valido = config !== null;
  const auto = esAutomatico(b);
  const locales = b.locales;
  const modelos = modelosPara(locales, [b.lider?.modelo ?? "", ...TIPOS.map((x) => b.workers[x]?.modelo ?? "")], e.agy ?? true);

  const guardar = async () => {
    if (!config || !hayCambio) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuentePaneles.guardarModelos(config);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("ajustes.mdlTitulo"), v: nuevo.version, conozco: VERSION }));
      setE(nuevo);
      setB(borradorDe(nuevo));
      setOk(true);
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  // Con lo guardado a la vista, `pa` dice con qué corre cada cosa; si no, se calcula del borrador.
  const deLider = (): Eleccion => (!hayCambio && e.efectivo?.lider) || liderEfectivo(b);
  const soloGemini = e.solo_gemini === true;
  const deTipo = (tipo: Tipo): Eleccion => (!hayCambio && e.efectivo?.workers[tipo]) || efectivoBorrador(b, tipo, soloGemini);

  const abrirAgregar = () => {
    if (ag) return setAg(null);
    void detectar(URL_OLLAMA);
  };
  const enviarUrl = (ev: FormEvent) => {
    ev.preventDefault();
    if (ag && urlOllama(ag.url)) void detectar(ag.url);
  };
  const bajarModelo = async (nombre: string) => {
    setErrBajar(null);
    setListo(null);
    try {
      const x = await fuentePaneles.bajarModelo(URL_OLLAMA, nombre);
      if (!vivo.current) return;
      setBajando((a) => ({ ...a, [x.modelo]: x }));
      return true;
    } catch (x) {
      if (vivo.current) setErrBajar(mensaje(x));
    }
  };
  const empezarBajada = async (ev: FormEvent) => {
    ev.preventDefault();
    const nombre = bajar.trim();
    if (!nombreModeloValido(nombre)) return;
    if (await bajarModelo(nombre)) setBajar("");
  };
  const urlValida = ag ? urlOllama(ag.url) !== null : true;
  const instalados = ag && typeof ag.sondeo === "object" && ag.sondeo && ag.sondeo.ok ? ag.sondeo.modelos : null;
  const motivoNo = ag && typeof ag.sondeo === "object" && ag.sondeo && !ag.sondeo.ok ? ag.sondeo.motivo : null;

  if (e.error)
    return (
      <Cat id="modelos">
        <section className="pn-sec" ref={sec} data-modelos>
          <div className="pn-error" role="alert">
            {textoMain(e.error)}
          </div>
        </section>
      </Cat>
    );

  return (
    <div className="aj-sin-caja" ref={sec as RefObject<HTMLDivElement>} data-modelos>
      <Cat id="modelos">
        <section className="pn-sec pn-edita">
          <h2 className="pn-h">{t("ajustes.mdlModelosH")}</h2>
          <Fijo k="ajustes.mdlIntro" bloque className="pn-nota pn-intro" />
          {!e.existe ? <Fijo k="ajustes.mdlSinArchivo" bloque className="pn-nota pn-intro" /> : null}

          <Dato nombre="ajustes.mdlLider" que="ajustes.mdlLiderQue">
            <EleccionSel
              etiqueta={t("ajustes.mdlLider")}
              modelos={modelos}
              valor={b.lider}
              comoHoy
              alModelo={(id) => cambiar(elegirLider(b, id))}
              alEffort={(x) => cambiar(elegirEffortLider(b, x))}
              abierto={VARIANTE === "mdl-lider"}
            />
            {!b.lider ? (
              <div className="pn-alt">
                <span>{t("ajustes.mdlEfectivo", { modelo: textoEleccion(deLider(), locales) })}</span>
              </div>
            ) : null}
          </Dato>

          <Dato nombre="ajustes.mdlAutomatico" que="ajustes.mdlAutomaticoQue">
            <Interruptor activo={auto} alCambiar={(v) => cambiar(ponerAutomatico(b, v))} aria-label={t("ajustes.mdlAutomatico")} />
          </Dato>

          {auto ? (
            <>
              <h3 className="pn-sub-h">{t("ajustes.mdlHoyElegiria")}</h3>
              <ul className="pn-disp mdl-hoy" aria-label={t("ajustes.mdlHoyElegiria")}>
                {TIPOS.map((tipo) => {
                  const h = e.efectivo?.reparto?.[tipo];
                  return (
                    <li key={tipo} data-tipo={tipo}>
                      <span className="mdl-hoy-tipo" data-tip={t(`mdl.t.${tipo}Que` as ClaveSola)}>{t(`mdl.t.${tipo}` as ClaveSola)}</span>
                      <span className="mdl-hoy-modelo" data-vacio={h ? undefined : ""} data-tip={h ? textoMain(h.motivo) : undefined}>
                        {h ? textoEleccion({ modelo: h.modelo, ...(h.effort ? { effort: h.effort } : {}) }, locales) : t("ajustes.mdlHoySin")}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {hayCambio ? <Fijo k="ajustes.mdlHoyAlGuardar" bloque className="pn-nota" /> : null}
            </>
          ) : (
            <>
              <Dato nombre="ajustes.mdlTodo" que="ajustes.mdlTodoQue">
                <div className="pn-sel">
                  <Selector
                    etiqueta={t("ajustes.mdlSelTodo")}
                    opciones={[{ id: "", nombre: t("ajustes.mdlTodoElegir"), desc: "" }, ...opcionesDe(modelos, false)]}
                    valor=""
                    alElegir={(id) => cambiar(todoEn(b, id))}
                    reserva={enOtros("ajustes.mdlTodoElegir")}
                  />
                </div>
              </Dato>

              <h3 className="pn-sub-h">{t("ajustes.mdlWorkers")}</h3>
              {TIPOS.map((tipo) => {
                const nombre = `mdl.t.${tipo}` as ClaveSola;
                const eleccion = b.workers[tipo];
                return (
                  <Dato key={tipo} nombre={nombre} que={`mdl.t.${tipo}Que` as ClaveSola}>
                    <EleccionSel
                      etiqueta={t(nombre)}
                      modelos={modelos}
                      valor={eleccion}
                      comoHoy
                      alModelo={(id) => cambiar(elegirWorker(b, tipo, id))}
                      alEffort={(x) => cambiar(elegirEffortWorker(b, tipo, x))}
                    />
                    {!eleccion ? (
                      <div className="pn-alt">
                        <span>{t("ajustes.mdlEfectivo", { modelo: textoEleccion(deTipo(tipo), locales) })}</span>
                      </div>
                    ) : null}
                  </Dato>
                );
              })}
            </>
          )}

          <Dato nombre="ajustes.mdlExcluir" que="ajustes.mdlExcluirQue">
            <div className="mdl-excluir">
              <ul className="mdl-chips" aria-label={t("ajustes.mdlExcluir")}>
                {b.excluir.length ? (
                  b.excluir.map((id) => (
                    <li key={id}>
                      <Chip>
                        {nombreExcluido(id)}
                        <button type="button" className="pn-quitar" aria-label={t("ajustes.mdlExcluirQuitar", { que: nombreExcluido(id) })} data-tip={t("ajustes.mdlExcluirQuitar", { que: nombreExcluido(id) })} onClick={() => cambiar(quitarExcluido(b, id))}>
                          <X size={12} aria-hidden />
                        </button>
                      </Chip>
                    </li>
                  ))
                ) : (
                  <li className="pn-falta">
                    <Fijo k="ajustes.mdlExcluirNinguno" />
                  </li>
                )}
              </ul>
              <div className="pn-sel">
                <Selector
                  etiqueta={t("ajustes.mdlExcluirSel")}
                  opciones={[{ id: "", nombre: t("ajustes.mdlExcluirAgregar"), desc: "" }, ...FAMILIAS.filter((f) => !b.excluir.includes(f)).map((f): Opcion => ({ id: f, nombre: nombreExcluido(f), desc: "" }))]}
                  valor=""
                  alElegir={(id) => cambiar(agregarExcluido(b, id))}
                  reserva={enOtros("ajustes.mdlExcluirAgregar")}
                />
              </div>
              {!b.excluir.includes("fable") ? (
                <div className="mdl-sug">
                  <Fijo k="ajustes.mdlFableSug" bloque className="pn-nota" />
                  <button type="button" className="btn2" onClick={() => cambiar(agregarExcluido(b, "fable"))}>
                    <Fijo k="ajustes.mdlFableBtn" />
                  </button>
                </div>
              ) : null}
            </div>
          </Dato>

          <Dato nombre="ajustes.mdlPermitirMax" que="ajustes.mdlPermitirMaxQue">
            <Interruptor activo={b.permitir_max} alCambiar={(v) => cambiar(ponerPermitirMax(b, v))} aria-label={t("ajustes.mdlPermitirMax")} />
          </Dato>

          {e.agy ?? true ? (
            <Dato nombre="ajustes.mdlDestrabar" que="ajustes.mdlDestrabarQue">
              <ul className="pn-disp mdl-destrabar" aria-label={t("ajustes.mdlDestrabar")}>
                {DESTRABAR_MODELOS.map((m) => {
                  const nombre = nombreGemini(`${m}-low`).replace(/ · low$/, "");
                  return (
                    <li key={m}>
                      <span className="mdl-destrabar-nom">{nombre}</span>
                      <Interruptor activo={destrabarOn(b, m)} alCambiar={(v) => cambiar(ponerDestrabar(b, m, v))} aria-label={t("ajustes.mdlDestrabarDe", { modelo: nombre })} />
                    </li>
                  );
                })}
              </ul>
              <div className="pn-nota">{t("ajustes.mdlDestrabarCuenta", { veces: e.destrabo?.veces ?? 0, bien: e.destrabo?.bien ?? 0 })}</div>
            </Dato>
          ) : null}

        </section>
      </Cat>

      <Cat id="locales">
        <section className="pn-sec pn-edita">
          <h2 className="pn-h">{t("ajustes.mdlLocales")}</h2>
          <GuiaOllama estado={ollama} entorno={entorno} alMirar={() => void mirarOllama()} />

          {instaladosOl ? (
            <>
              <SugeridosOllama
                vramMiB={entorno?.gpu?.vramMiB ?? null}
                instalados={instaladosOl.map((m) => m.nombre)}
                bajando={bajando}
                alBajar={(m) => void bajarModelo(m)}
                alCancelar={(x) => void fuentePaneles.cancelarBajada(x.url, x.modelo)}
              />
              <Dato nombre="ajustes.mdlInstalados" que="ajustes.mdlInstaladosQue">
                {instaladosOl.length ? (
                  <ul className="pn-disp mdl-instalados" aria-label={t("ajustes.mdlInstalados")}>
                    {instaladosOl.map((m) => {
                      const ya = locales.some((l) => l.id === `ollama:${m.nombre}`);
                      return (
                        <li key={m.nombre}>
                          <span className="mdl-local-nom">
                            <span className="pn-disp-nom">{m.nombre}</span>
                            <span className="mdl-url">{gb(m.bytes)}</span>
                          </span>
                          {ya ? (
                            <span className="mdl-estado" data-estado="ok">{t("ajustes.mdlEnUso")}</span>
                          ) : (
                            <Boton aria-label={t("ajustes.mdlUsarModelo", { nombre: m.nombre })} data-recien={listo === m.nombre ? "" : undefined} onClick={() => cambiar(agregarLocal(b, URL_OLLAMA, m.nombre))}>
                              <Fijo k="ajustes.mdlUsar" />
                            </Boton>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="pn-nota">{t("ajustes.mdlNingunoInstalado")}</div>
                )}
              </Dato>

              <Dato nombre="ajustes.mdlBajar" que="ajustes.mdlBajarQue">
                <form className="pn-nuevo" onSubmit={(ev) => void empezarBajada(ev)}>
                  <input
                    className="pn-campo"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={bajar}
                    placeholder="llama3.2:3b"
                    aria-label={t("ajustes.mdlBajarCampo")}
                    aria-invalid={bajar.trim() !== "" && !nombreModeloValido(bajar)}
                    onChange={(ev) => {
                      setBajar(ev.target.value);
                      setErrBajar(null);
                    }}
                  />
                  <Boton type="submit" disabled={!nombreModeloValido(bajar)}>
                    <Fijo k="ajustes.mdlBajarBtn" />
                  </Boton>
                </form>
                {bajar.trim() !== "" && !nombreModeloValido(bajar) ? <div className="pn-error pn-campo-error">{t("ajustes.mdlBajarNombreMal")}</div> : null}
                {bajandoLista.map((x) => {
                  const pct = porcentaje(x);
                  return (
                    <div key={x.modelo} className="mdl-baja" role="status">
                      <div className="mdl-baja-fila">
                        <span className="mdl-baja-nom">{t("ajustes.mdlBajando", { nombre: x.modelo })}</span>
                        <span className="mdl-estado">{textoBajada(x)}</span>
                        <Boton aria-label={t("ajustes.mdlBajarCancelarModelo", { nombre: x.modelo })} onClick={() => void fuentePaneles.cancelarBajada(x.url, x.modelo)}>
                          <Fijo k="ajustes.mdlBajarCancelar" />
                        </Boton>
                      </div>
                      <div className="mdl-barra" role="progressbar" aria-label={t("ajustes.mdlBajando", { nombre: x.modelo })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
                        <div className="mdl-barra-r" data-indef={pct === null ? "" : undefined} style={pct === null ? undefined : { transform: `scaleX(${pct / 100})` }} />
                      </div>
                    </div>
                  );
                })}
                {listo && !bajando[listo] && !errBajar ? <div className="pn-nota" role="status">{t("ajustes.mdlBajarListo", { nombre: listo })}</div> : null}
                {errBajar ? <div className="pn-error pn-campo-error" role="alert">{textoMain(errBajar)}</div> : null}
              </Dato>
            </>
          ) : null}

          <Dato nombre="ajustes.mdlLocalesAgregados" que="ajustes.mdlLocalesQue">
            <ul className="pn-disp mdl-locales" aria-label={t("ajustes.mdlLocales")}>
              {locales.length ? (
                locales.map((l) => {
                  const s = estados[l.url];
                  const responde = typeof s === "object" && s.ok;
                  const texto = s === undefined || s === "comprobando" ? t("ajustes.mdlComprobando") : responde ? t("ajustes.mdlResponde") : t("ajustes.mdlNoResponde");
                  return (
                    <li key={l.id}>
                      <span className="mdl-local-nom">
                        <span className="pn-disp-nom">{l.nombre}</span>
                        <span className="mdl-url">{l.url}</span>
                      </span>
                      <span className="mdl-estado" data-estado={responde ? "ok" : typeof s === "object" ? "no" : "..."} data-tip={typeof s === "object" && !s.ok ? textoMain(s.motivo) : undefined}>
                        {texto}
                      </span>
                      <button type="button" className="pn-quitar" aria-label={t("ajustes.mdlQuitarLocal", { nombre: l.nombre })} data-tip={t("ajustes.mdlQuitarLocal", { nombre: l.nombre })} onClick={() => cambiar(quitarLocal(b, l.id))}>
                        <X size={14} aria-hidden />
                      </button>
                    </li>
                  );
                })
              ) : (
                <li className="pn-falta">
                  <Fijo k="ajustes.mdlNingunLocal" />
                </li>
              )}
            </ul>
            <Boton className="mdl-agregar-btn" aria-expanded={ag !== null} onClick={abrirAgregar}>
              {ag ? null : <Plus size={14} aria-hidden />}
              {ag ? t("ajustes.mdlCerrarAgregar") : t("ajustes.olOtroServidor")}
            </Boton>
          </Dato>

          {ag ? (
            <div className="mdl-panel" role="group" aria-label={t("ajustes.mdlAgregarLocal")}>
              <form className="pn-nuevo" onSubmit={enviarUrl}>
                <input
                  className="pn-campo"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={ag.url}
                  aria-label={t("ajustes.mdlUrl")}
                  aria-invalid={!urlValida}
                  onChange={(ev) => setAg({ url: ev.target.value, sondeo: null })}
                />
                <Boton type="submit" disabled={!urlValida || ag.sondeo === "comprobando"}>
                  {ag.sondeo === "comprobando" ? t("ajustes.mdlDetectando") : t("ajustes.mdlDetectar")}
                </Boton>
              </form>
              {!urlValida ? <div className="pn-error pn-campo-error">{t("ajustes.mdlUrlMal")}</div> : null}
              {motivoNo ? <div className="pn-error pn-campo-error" role="alert">{textoMain(motivoNo)}</div> : null}
              {instalados ? (
                instalados.length ? (
                  <ul className="pn-disp mdl-instalados" aria-label={t("ajustes.mdlInstalados")}>
                    {instalados.map((m) => {
                      const ya = locales.some((l) => l.id === `ollama:${m.nombre}`);
                      return (
                        <li key={m.nombre}>
                          <span className="mdl-local-nom">
                            <span className="pn-disp-nom">{m.nombre}</span>
                            <span className="mdl-url">{gb(m.bytes)}</span>
                          </span>
                          <Boton disabled={ya} aria-label={t("ajustes.mdlAgregar", { nombre: m.nombre })} onClick={() => cambiar(agregarLocal(b, ag.url, m.nombre))}>
                            {ya ? t("ajustes.mdlYaAgregado") : <Plus size={14} aria-hidden />}
                            {ya ? null : <Fijo k="ajustes.celAgregar" />}
                          </Boton>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="pn-nota">{t("ajustes.mdlNingunoInstalado")}</div>
                )
              ) : null}
            </div>
          ) : null}

        </section>
      </Cat>

      <Cat id="cupos" orden={1}>
        <CuposTarjetas b={b} uso={uso} plan={plan} />
      </Cat>
      <Cat id="cupos" orden={2}>
        <AjustesCupos Dato={Dato} b={b} cambiar={cambiar} />
      </Cat>

      <Acciones id="modelos" sucio={hayCambio} valido={valido} guardando={guardando} ok={ok} error={error} alGuardar={guardar} alCancelar={() => cambiar(borradorDe(e))} />
    </div>
  );
}
