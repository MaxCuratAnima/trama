// La bienvenida: la pantalla del primer arranque (y "Bienvenida" en Ajustes > General, que la vuelve a abrir). Un paso por vez, corto,
// con "Más tarde" en los que guardan algo: idioma, proveedores, modelos automáticos, modelos que no se usan, esfuerzo max,
// compactación y celular. Guarda por los mismos caminos que Ajustes (`fuentePaneles.guardarModelos|guardarAjustes|guardarRemoto`, la
// validación de `valida-ajustes`), nunca por uno propio. La marca de "ya vista" va en preferencias.json al cerrarla, de cualquier modo.
// Es un modal: atrapa el foco, Esc lo cierra (`useFoco`). Los componentes son los de `src/ui`; la lógica pura, `bienvenida-pasos.ts`.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fuente, type CuentaEstado, type EstadoCuentas } from "../datos/fuente";
import { fuentePaneles, type Ajustes, type ConfigModelos, type EstadoModelos, type EstadoRemoto, type Sondeo } from "../datos/paneles";
import { useFoco } from "../foco";
import { cambiarIdioma, esIdioma, IDIOMAS, idioma, locale, t, textoMain, type Clave, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Boton, Chip, FilaAjuste, Interruptor, Tarjeta } from "../ui/componentes";
import { IcCerrar, IcLocal, IcOk, ICONO } from "../ui/iconos";
import { LogoCaja } from "../ui/logos";
import { cuentasDe, AgregarCuenta, CuentaFila, useCuentas } from "./CuentasVarias";
import { RED_MAX, RED_MIN } from "../../electron/valida-ajustes";
import { motivo } from "./AjustesEditar";
import {
  automaticoPrendido,
  compactacionDe,
  COMPACTACION_SUGERIDA,
  excluirCon,
  FAMILIAS,
  familiasMarcadas,
  pasosVisibles,
  textoCompactacion,
  type Familia,
  type Paso,
} from "./bienvenida-pasos";
import "./bienvenida-estilos.css";

/** Sólo la ventana de la PC abre la bienvenida sola: el celular y el navegador la ven si la piden desde Ajustes. */
const enVentana = typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent);

let abierta = MODO.captura === "bienvenida";
const oyentes = new Set<() => void>();
const poner = (v: boolean) => {
  abierta = v;
  oyentes.forEach((o) => o());
};
const suscribir = (f: () => void) => (oyentes.add(f), () => void oyentes.delete(f));

export const abrirBienvenida = () => poner(true);
/** Cerrarla, de cualquier modo (✕, Esc, Terminar), la deja como vista: no vuelve sola. */
const cerrar = () => {
  poner(false);
  void fuente.guardarBienvenida(true);
};

export function Bienvenida() {
  const va = useSyncExternalStore(suscribir, () => abierta);
  useEffect(() => {
    if (!enVentana) return;
    void fuente.bienvenidaPendiente().then((si) => si && poner(true));
  }, []);
  return va ? <Dialogo /> : null;
}

/** Lo que ya hay guardado y se pide una vez al abrir; `null`: esa fuente no contestó (el paso lo dice y se puede seguir). */
type Datos = { modelos: EstadoModelos | null; ajustes: Ajustes | null; remoto: EstadoRemoto | null; cuentas: EstadoCuentas | null };

/** Una fuente lenta (el motor reconectando) no deja la bienvenida sin abrir: a los 4 s se sigue sin ella. */
const conTope = <T,>(p: Promise<T>): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 4000))]);

type Nav = { atras: (() => void) | null; sig: () => void; primera: boolean; ultima: boolean };
type Ctx = {
  d: Datos;
  nav: Nav;
  /** Guarda esos campos de modelos.json (lo demás del archivo no se toca) y deja el estado al día. */
  guardarModelos: (parche: Partial<ConfigModelos>) => Promise<void>;
  guardarRed: (n: number) => Promise<void>;
  guardarRemoto: (activo: boolean) => Promise<void>;
  refrescarCuentas: () => void;
};

const TITULOS: Record<Paso, ClaveSola> = {
  idioma: "bv.idiomaT",
  proveedores: "bv.provT",
  automatico: "bv.autoT",
  excluir: "bv.exclT",
  max: "bv.maxT",
  compactacion: "bv.compT",
  celular: "bv.celT",
};

function Dialogo() {
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  useFoco(caja, { alCerrar: cerrar });
  const [d, setD] = useState<Datos | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    let vivo = true;
    void Promise.all([
      conTope(fuentePaneles.modelos()),
      conTope(fuentePaneles.ajustes()),
      conTope(fuentePaneles.remoto()),
      conTope(fuente.cuentas()),
    ]).then(([modelos, ajustes, remoto, cuentas]) => {
      if (!vivo) return;
      setD({ modelos, ajustes, remoto, cuentas });
      const ya = pasosVisibles(remoto?.editable === true).indexOf(MODO.captura === "bienvenida" ? (MODO.variante as Paso) : "idioma");
      if (ya > 0) setI(ya);
    });
    return () => void (vivo = false);
  }, []);

  if (!d) return null;
  const pasos = pasosVisibles(d.remoto?.editable === true);
  const paso = pasos[Math.min(i, pasos.length - 1)];
  const n = pasos.indexOf(paso);
  const mod = (f: (d: Datos) => Datos) => setD((x) => (x ? f(x) : x));

  const ctx: Ctx = {
    d,
    nav: { atras: n > 0 ? () => setI(n - 1) : null, sig: () => (n + 1 < pasos.length ? setI(n + 1) : cerrar()), primera: n === 0, ultima: n === pasos.length - 1 },
    async guardarModelos(parche) {
      if (!d.modelos) throw new Error(t("bv.noCarga"));
      const e = await fuentePaneles.guardarModelos({ ...d.modelos.config, ...parche });
      mod((x) => ({ ...x, modelos: e }));
    },
    async guardarRed(red) {
      const a = await fuentePaneles.guardarAjustes({ red_seguridad: red });
      mod((x) => ({ ...x, ajustes: a }));
    },
    async guardarRemoto(activo) {
      if (d.remoto?.editable !== true) throw new Error(t("bv.noCarga"));
      const r = await fuentePaneles.guardarRemoto({ activo, puerto: d.remoto.puerto, dispositivos: d.remoto.dispositivos });
      mod((x) => ({ ...x, remoto: r }));
    },
    refrescarCuentas() {
      void conTope(fuente.cuentas()).then((cuentas) => cuentas && mod((x) => ({ ...x, cuentas })));
    },
  };

  return createPortal(
    <div className="at" onClick={(e) => e.target === e.currentTarget && cerrar()}>
      <div ref={caja} className="at-caja bv-caja" role="dialog" aria-modal="true" aria-labelledby="bv-titulo" tabIndex={-1}>
        <header className="bv-cab">
          <div className="bv-cab-t">
            <span className="bv-marca">{t("bv.titulo")}</span>
            <span className="bv-n">{t("bv.paso", { n: n + 1, total: pasos.length })}</span>
          </div>
          <button type="button" className="bv-x" aria-label={t("bv.cerrar")} onClick={cerrar}>
            <IcCerrar {...ICONO} />
          </button>
        </header>
        <ol className="bv-prog" aria-hidden="true">
          {pasos.map((p, k) => (
            <li key={p} data-estado={k < n ? "hecho" : k === n ? "actual" : undefined} />
          ))}
        </ol>
        <div className="bv-cuerpo" key={paso}>
          {paso === "idioma" ? <PasoIdioma ctx={ctx} /> : null}
          {paso === "proveedores" ? <PasoProveedores ctx={ctx} /> : null}
          {paso === "automatico" ? <PasoAutomatico ctx={ctx} /> : null}
          {paso === "excluir" ? <PasoExcluir ctx={ctx} /> : null}
          {paso === "max" ? <PasoMax ctx={ctx} /> : null}
          {paso === "compactacion" ? <PasoCompactacion ctx={ctx} /> : null}
          {paso === "celular" ? <PasoCelular ctx={ctx} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** El título y la explicación de un paso, y su contenido. */
function Hoja({ paso, children }: { paso: Paso; children: ReactNode }) {
  const d: Record<Paso, ClaveSola> = {
    idioma: "bv.idiomaD",
    proveedores: "bv.provD",
    automatico: "bv.autoD",
    excluir: "bv.exclD",
    max: "bv.maxD",
    compactacion: "bv.compD",
    celular: "bv.celD",
  };
  return (
    <section className="bv-hoja">
      <h2 id="bv-titulo" className="bv-h">
        {t(TITULOS[paso])}
      </h2>
      <p className="bv-p">{t(d[paso])}</p>
      {children}
    </section>
  );
}

/** Guardar un paso: ocupado, el error en una línea, y al salir bien pasa al siguiente. */
function useCorrer(nav: Nav) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);
  const correr = async (f: () => Promise<void>) => {
    setOcupado(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      if (vivo.current) {
        setError(textoMain(mensaje(e)));
        setOcupado(false);
      }
      return;
    }
    if (vivo.current) setOcupado(false);
    nav.sig();
  };
  return { ocupado, error, correr };
}

/** El pie de un paso: Atrás a la izquierda; a la derecha Más tarde (si el paso guarda algo) y el botón principal. */
function Pie({ nav, guarda, alPrimario, ocupado = false, error = null, deshabilitado = false }: {
  nav: Nav;
  guarda: boolean;
  alPrimario: () => void;
  ocupado?: boolean;
  error?: string | null;
  deshabilitado?: boolean;
}) {
  const texto = ocupado ? t("bv.guardando") : guarda ? t(nav.ultima ? "bv.guardarFin" : "bv.guardarSeguir") : t(nav.ultima ? "bv.fin" : "bv.continuar");
  return (
    <>
      {error ? (
        <div className="bv-error" role="alert">
          {error}
        </div>
      ) : null}
      <footer className="bv-pie">
        {nav.atras ? (
          <Boton onClick={nav.atras} disabled={ocupado}>
            {t("bv.atras")}
          </Boton>
        ) : (
          <span />
        )}
        <div className="bv-pie-der">
          {guarda ? (
            <Boton onClick={nav.sig} disabled={ocupado}>
              {t("bv.mas_tarde")}
            </Boton>
          ) : null}
          <Boton primario onClick={alPrimario} disabled={ocupado || deshabilitado}>
            {texto}
          </Boton>
        </div>
      </footer>
      {nav.primera || nav.ultima ? <p className="bv-nota">{t("bv.reabrir")}</p> : null}
    </>
  );
}

// --- idioma ---------------------------------------------------------------------------------------------------------------

const NOMBRE_IDIOMA: Record<string, string> = { en: "English", es: "Español" };

function PasoIdioma({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const actual = idioma();
  // Cambia en el momento y se guarda como en Ajustes (preferencias.json).
  const elegir = (id: string) => {
    if (!esIdioma(id) || id === actual) return;
    cambiarIdioma(id);
    void fuente.guardarIdioma(id);
  };
  return (
    <Hoja paso="idioma">
      <div className="bv-ops" role="radiogroup" aria-labelledby="bv-titulo">
        {IDIOMAS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={id === actual} className="bv-op" lang={id} onClick={() => elegir(id)}>
            {NOMBRE_IDIOMA[id]}
          </button>
        ))}
      </div>
      <Pie nav={ctx.nav} guarda={false} alPrimario={ctx.nav.sig} />
    </Hoja>
  );
}

// --- proveedores ----------------------------------------------------------------------------------------------------------

/** Lo que se dice de una cuenta de la máquina; sin respuesta no se afirma nada. */
function estadoCuenta(c: CuentaEstado | null | undefined): { chip: ClaveSola; tono?: "ok"; cuenta: string | null; conectable: boolean } {
  if (!c) return { chip: "bv.provSinDato", cuenta: null, conectable: false };
  if (c.logueado) return { chip: "bv.provConectado", tono: "ok", cuenta: c.cuenta, conectable: false };
  if (!c.instalado) return { chip: "bv.provNoInstalado", cuenta: null, conectable: false };
  return { chip: "bv.provSinConectar", cuenta: null, conectable: true };
}

const OLLAMA = "http://localhost:11434";

function PasoProveedores({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const { cuentas } = ctx.d;
  const [local, setLocal] = useState<Sondeo | null>(null);
  const { refrescarCuentas } = ctx;
  const { lista, mirar: mirarCuentas } = useCuentas();
  useEffect(() => {
    let vivo = true;
    void conTope(fuentePaneles.sondearOllama(OLLAMA)).then((s) => vivo && setLocal(s));
    return () => void (vivo = false);
  }, []);
  // Al volver a la ventana (se cerró la consola donde se inició sesión) se mira de nuevo, sin reloj.
  useEffect(() => {
    window.addEventListener("focus", refrescarCuentas);
    return () => window.removeEventListener("focus", refrescarCuentas);
  }, [refrescarCuentas]);

  const filas = [
    { id: "claude" as const, nombre: "bv.provClaude" as const, e: estadoCuenta(cuentas?.claude), cuenta: "claude" as const },
    { id: "google" as const, nombre: "bv.provGoogle" as const, e: estadoCuenta(cuentas?.agy), cuenta: "google" as const },
  ];
  const vivoLocal = local?.ok === true;

  return (
    <Hoja paso="proveedores">
      <Tarjeta>
        {filas.map((f) => (
          <FilaAjuste key={f.id} icono={<LogoCaja id={f.id} />} titulo={t(f.nombre)} detalle={f.e.cuenta ? t("bv.provConectadoComo", { cuenta: f.e.cuenta }) : undefined}>
            {f.e.conectable ? (
              // El login se hace en una terminal de esta PC; al volver a la ventana (efecto de arriba) se mira de nuevo.
              <Boton onClick={() => void fuente.loginCuenta(f.cuenta).then(refrescarCuentas, refrescarCuentas)}>{t("bv.provConectar")}</Boton>
            ) : (
              <Chip tono={f.e.tono}>{t(f.e.chip)}</Chip>
            )}
          </FilaAjuste>
        ))}
        <FilaAjuste icono={<LogoCaja id="chatgpt" />} titulo={t("bv.provChatgpt")}>
          <Chip>{t("bv.provSinDato")}</Chip>
        </FilaAjuste>
        <FilaAjuste
          icono={<IcLocal {...ICONO} />}
          titulo={t("bv.provLocal")}
          detalle={local ? (vivoLocal ? t("bv.provLocalVivo", { n: local.modelos.length }) : t("bv.provLocalNo")) : undefined}
        >
          {local ? <Chip tono={vivoLocal ? "ok" : undefined}>{t(vivoLocal ? "bv.provConectado" : "bv.provNoInstalado")}</Chip> : null}
        </FilaAjuste>
      </Tarjeta>
      {lista ? (
        <Tarjeta titulo={t("bv.otrasCuentas")}>
          <div className="bv-cuentas">
            {(["claude", "google"] as const).map((p) => (
              <div key={p} className="bv-cuentas-p" data-proveedor={p}>
                <div className="bv-cuentas-n">
                  <LogoCaja id={p} />
                  <span>{t(p === "claude" ? "bv.provClaude" : "bv.provGoogle")}</span>
                </div>
                {cuentasDe(lista, p)
                  .filter((c) => !c.defecto)
                  .map((c) => (
                    <CuentaFila key={c.id} perfil={c} alCambiar={mirarCuentas} />
                  ))}
                <AgregarCuenta proveedor={p} alCambiar={mirarCuentas} />
              </div>
            ))}
          </div>
        </Tarjeta>
      ) : null}
      <Pie nav={ctx.nav} guarda={false} alPrimario={ctx.nav.sig} />
    </Hoja>
  );
}

// --- modelos --------------------------------------------------------------------------------------------------------------

/** Lo que impide guardar en modelos.json desde acá: no se pudo leer, o el archivo está roto (no se escribe encima). */
function falloModelos(m: EstadoModelos | null): string | null {
  if (!m) return t("bv.noCarga");
  return m.error ? t("bv.archivoRoto") : null;
}

function PasoAutomatico({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const m = ctx.d.modelos;
  const [on, setOn] = useState(automaticoPrendido(m?.config.reparto));
  const { ocupado, error, correr } = useCorrer(ctx.nav);
  const fallo = falloModelos(m);
  return (
    <Hoja paso="automatico">
      <Tarjeta>
        <FilaAjuste titulo={<span id="bv-auto">{t("bv.autoFila")}</span>} detalle={t("bv.autoFilaD")}>
          <Interruptor activo={on} alCambiar={setOn} aria-labelledby="bv-auto" disabled={!!fallo} />
        </FilaAjuste>
      </Tarjeta>
      <Pie nav={ctx.nav} guarda alPrimario={() => void correr(() => ctx.guardarModelos({ reparto: on ? "auto" : "fijo" }))} ocupado={ocupado} error={error ?? fallo} deshabilitado={!!fallo} />
    </Hoja>
  );
}

function PasoExcluir({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const m = ctx.d.modelos;
  const [marcadas, setMarcadas] = useState(() => familiasMarcadas(m?.config.excluir));
  const { ocupado, error, correr } = useCorrer(ctx.nav);
  const fallo = falloModelos(m);
  const alternar = (f: Familia) =>
    setMarcadas((x) => {
      const y = new Set(x);
      if (!y.delete(f)) y.add(f);
      return y;
    });
  return (
    <Hoja paso="excluir">
      <Tarjeta>
        <div role="group" aria-labelledby="bv-titulo">
          {FAMILIAS.map((f) => (
            <button key={f.id} type="button" role="checkbox" aria-checked={marcadas.has(f.id)} className="ui-fila bv-fila" disabled={!!fallo} onClick={() => alternar(f.id)}>
              <span className="bv-cb" aria-hidden="true">
                {marcadas.has(f.id) ? <IcOk size={14} strokeWidth={2.4} /> : null}
              </span>
              <LogoCaja id={f.empresa === "google" ? "google" : "claude"} />
              <span className="ui-fila-txt">
                <span className="ui-fila-t">{f.nombre}</span>
              </span>
              {f.sugerida ? <Chip>{t("bv.exclSugerida")}</Chip> : null}
            </button>
          ))}
        </div>
      </Tarjeta>
      <Pie
        nav={ctx.nav}
        guarda
        alPrimario={() => void correr(() => ctx.guardarModelos({ excluir: excluirCon(m?.config.excluir, marcadas) }))}
        ocupado={ocupado}
        error={error ?? fallo}
        deshabilitado={!!fallo}
      />
    </Hoja>
  );
}

function PasoMax({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const m = ctx.d.modelos;
  const [on, setOn] = useState(m?.config.permitir_max === true);
  const { ocupado, error, correr } = useCorrer(ctx.nav);
  const fallo = falloModelos(m);
  return (
    <Hoja paso="max">
      <Tarjeta>
        <FilaAjuste titulo={<span id="bv-max">{t("bv.maxFila")}</span>} detalle={t("bv.maxFilaD")}>
          <Interruptor activo={on} alCambiar={setOn} aria-labelledby="bv-max" disabled={!!fallo} />
        </FilaAjuste>
      </Tarjeta>
      <Pie nav={ctx.nav} guarda alPrimario={() => void correr(() => ctx.guardarModelos({ permitir_max: on }))} ocupado={ocupado} error={error ?? fallo} deshabilitado={!!fallo} />
    </Hoja>
  );
}

// --- compactación y celular -----------------------------------------------------------------------------------------------

function PasoCompactacion({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const a = ctx.d.ajustes;
  const [texto, setTexto] = useState(textoCompactacion(a?.red_seguridad ?? null));
  const { ocupado, error, correr } = useCorrer(ctx.nav);
  const r = compactacionDe(texto);
  const msg = r.error ? motivo(r.error, RED_MIN, RED_MAX) : null;
  const fallo = a ? null : t("bv.noCarga");
  const guardar = () => {
    if (r.valor !== null) void correr(() => ctx.guardarRed(r.valor as number));
  };
  return (
    <Hoja paso="compactacion">
      <Tarjeta>
        <FilaAjuste titulo={<label htmlFor="bv-red">{t("bv.compCampo")}</label>} detalle={t("bv.compSugerida")}>
          <div className="pn-campo-fila">
            <input
              id="bv-red"
              className="pn-campo pn-campo-num"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={texto}
              placeholder={COMPACTACION_SUGERIDA.toLocaleString(locale())}
              disabled={!a}
              aria-invalid={!!r.error}
              aria-describedby={r.error ? "bv-red-e" : undefined}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && guardar()}
            />
            <span className="pn-unidad">{t("ajustes.redUnidad")}</span>
          </div>
        </FilaAjuste>
      </Tarjeta>
      {msg ? (
        <div className="bv-error" id="bv-red-e">
          {msg}
        </div>
      ) : null}
      <Pie nav={ctx.nav} guarda alPrimario={guardar} ocupado={ocupado} error={error ?? fallo} deshabilitado={!a || r.valor === null} />
    </Hoja>
  );
}

function PasoCelular({ ctx }: { ctx: Ctx }) {
  useIdioma();
  const r = ctx.d.remoto;
  const [on, setOn] = useState(r?.editable === true && r.activo);
  const { ocupado, error, correr } = useCorrer(ctx.nav);
  return (
    <Hoja paso="celular">
      <Tarjeta>
        <FilaAjuste titulo={<span id="bv-cel">{t("bv.celFila")}</span>} detalle={t("bv.celFilaD")}>
          <Interruptor activo={on} alCambiar={setOn} aria-labelledby="bv-cel" />
        </FilaAjuste>
      </Tarjeta>
      <Pie nav={ctx.nav} guarda alPrimario={() => void correr(() => ctx.guardarRemoto(on))} ocupado={ocupado} error={error} />
    </Hoja>
  );
}

export type { Clave };
