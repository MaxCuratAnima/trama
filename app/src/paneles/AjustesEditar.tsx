// Lo que Ajustes deja cambiar con Guardar (a diferencia del idioma o la letra, que se guardan al elegir): el plan, cuándo
// compacta Claude y el acceso desde el celular. Cada bloque trabaja sobre un borrador (ajustes-borrador.ts): nada se escribe
// hasta Guardar (una sola barra fija abajo, ajustes-barra.ts), Cancelar vuelve a lo guardado y lo que no vale se dice en línea antes de mandar. El main vuelve a
// validar con las mismas reglas (electron/valida-ajustes.ts) y, si algo falla, el borrador queda como estaba.
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Cat } from "./AjustesNav";
import { declarar } from "./ajustes-nav";
import { Plus, X } from "lucide-react";
import { detalleAcceso, EstadoEscucha, PasosCelular } from "./CelularGuia";
import { PUERTO_MAX, PUERTO_MIN } from "../../electron/valida-ajustes";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Ajustes as Datos, type EstadoRemoto } from "../datos/paneles";
import { Selector, type Opcion } from "../hilo/Selector";
import { locale, t, textoError, textoMain, type Clave, type ClaveSola } from "../i18n";
import { enOtros, Fijo } from "../i18n/Fijo";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { cancelarTodo, guardarTodo, publicar, resumen, suscribir } from "./ajustes-barra";
import { agregarDispositivo, numDesde, numPara, quitarDispositivo, remotoDesde, remotoPara, type BorradorNum, type BorradorRemoto } from "./ajustes-borrador";

/** Las partes de una fila de Ajustes (la misma de Ajustes.tsx, que la pasa para no repetirla). */
export type FilaDato = (p: { nombre: ClaveSola; que: ClaveSola; icono?: ReactNode; children: ReactNode }) => ReactNode;

/**
 * El motivo de una validación: la clave que devuelve valida-ajustes.ts, traducida. Los topes que mencionan van como
 * `{min}` y `{max}` (los de la red o los del puerto, según el campo).
 */
export const motivo = (clave: string, min: number, max: number) =>
  (t as (k: Clave, v: { min: string; max: string }) => string)(clave as Clave, { min: min.toLocaleString(locale()), max: max.toLocaleString(locale()) });

/** Para las capturas: `editando` deja cambios sin guardar; `editando-mal` los deja sin que valgan. */
const EDITANDO = MODO.variante === "editando";
const EDITANDO_MAL = MODO.variante === "editando-mal";

/**
 * Un bloque editable le cuenta su estado a la barra de Guardar (ajustes-barra.ts); no pinta nada. Guardar y Cancelar son
 * de la barra, que los aplica a todos los bloques con cambios.
 */
export function Acciones({
  id,
  sucio,
  valido,
  guardando,
  ok,
  error,
  alGuardar,
  alCancelar,
}: {
  id: string;
  sucio: boolean;
  valido: boolean;
  guardando: boolean;
  ok: boolean;
  error: string | null;
  alGuardar: () => void | Promise<void>;
  alCancelar: () => void;
}) {
  useEffect(() => {
    publicar(id, { sucio, valido, guardando, ok, error, guardar: alGuardar, cancelar: alCancelar });
  });
  useEffect(() => () => publicar(id, null), [id]);
  return null;
}

/** La barra fija de abajo: dice si hay cambios sin guardar y guarda o cancela todos los bloques de una vez. */
export function BarraGuardar() {
  const r = useSyncExternalStore(suscribir, resumen);
  const estado = r.guardando ? t("ajustes.guardando") : r.sucio ? t("ajustes.sinGuardar") : r.ok ? t("ajustes.guardadoOk") : t("ajustes.sinCambios");
  return (
    <div className="pn-barra" data-sucio={r.sucio ? "" : undefined} role="group" aria-label={t("ajustes.barra")}>
      {r.error ? (
        <div className="pn-error pn-barra-error" role="alert">
          {textoMain(r.error)}
        </div>
      ) : null}
      <div className="pn-barra-fila">
        <span className="pn-barra-estado" role="status">
          {estado}
        </span>
        <button type="button" className="btn2" disabled={!r.sucio || r.guardando} onClick={cancelarTodo}>
          {t("ajustes.cancelar")}
        </button>
        <button type="button" className="btn2" data-primario disabled={!r.puedeGuardar} onClick={() => void guardarTodo()}>
          {r.guardando ? t("ajustes.guardando") : t("ajustes.guardar")}
        </button>
      </div>
    </div>
  );
}

const PLANES: Opcion[] = [
  { id: "pro", nombre: "pro", desc: "" },
  { id: "max", nombre: "max", desc: "" },
];

/**
 * El plan y la red de seguridad. Guardar manda sólo lo que cambió; lo que vuelve es Ajustes como quedó (con el plan que
 * dice `pa` de verdad, no el que se creía), y de ahí sale lo guardado.
 */
export function PlanYRed({
  inicial,
  Dato,
}: {
  inicial: Datos;
  Dato: FilaDato;
}) {
  const [g, setG] = useState(inicial);
  const [b, setB] = useState<BorradorNum>(() => {
    const base = numDesde(inicial);
    if (EDITANDO) return { plan: "pro", red: base.red };
    return base;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const r = numPara(g, b);
  const valido = r.error === null;

  const cambiar = (nuevo: BorradorNum) => {
    setB(nuevo);
    setError(null);
    setOk(false);
  };
  const guardar = async () => {
    if (!valido || !r.sucio) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuentePaneles.guardarAjustes(r.cambio);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("panel.ajustes"), v: nuevo.version, conozco: VERSION }));
      setG(nuevo);
      setB(numDesde(nuevo));
      setOk(true);
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  return (
    <>
      <section className="pn-sec">
        <h2 className="pn-h">{t("ajustes.plan")}</h2>
        <Dato nombre="ajustes.planSus" que="ajustes.planQue">
          {g.plan && b.plan ? (
            <div className="pn-sel">
              <Selector
                etiqueta={t("ajustes.planSus")}
                opciones={PLANES.map((o) => ({ ...o, desc: t(o.id === "pro" ? "ajustes.planProQue" : "ajustes.planMaxQue") }))}
                valor={b.plan}
                alElegir={(plan) => cambiar({ ...b, plan: plan === "pro" ? "pro" : "max" })}
                reserva={[]}
              />
            </div>
          ) : (
            <span className="pn-falta">{g.plan_error ? textoError(g.plan_error) : t("comun.sinDato")}</span>
          )}
        </Dato>
        <Acciones id="plan" sucio={r.sucio} valido={valido} guardando={guardando} ok={ok} error={error} alGuardar={guardar} alCancelar={() => cambiar(numDesde(g))} />
      </section>
    </>
  );
}

const ESTADOS: Opcion[] = [
  { id: "on", nombre: "", desc: "" },
  { id: "off", nombre: "", desc: "" },
];

/**
 * El acceso desde el celular: prendido o apagado, el puerto y los dispositivos que entran. Sólo en la PC (por la tailnet
 * `editable` viene en falso y la sección no se ve). Dónde se escucha no se elige acá: siempre y sólo las direcciones de
 * Tailscale, y un nombre que parezca una dirección no se acepta como dispositivo.
 */
export function Celular({ Dato }: { Dato: FilaDato }) {
  const [e, setE] = useState<EstadoRemoto | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [b, setB] = useState<BorradorRemoto | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);
  const nuevoRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => void (vivo.current = false), []);
  // Quién entró y si escucha cambia sin que Ajustes se entere: se vuelve a mirar al volver a la ventana (sin reloj).
  // Sólo se toma lo que informa el motor; el borrador no se toca.
  useEffect(() => {
    const alFoco = () => {
      if (document.visibilityState === "hidden") return;
      fuentePaneles.remoto().then(
        (r) => vivo.current && r.editable && setE((antes) => (antes?.editable ? { ...antes, escuchando: r.escuchando, accesos: r.accesos } : antes)),
        () => {},
      );
    };
    window.addEventListener("focus", alFoco);
    return () => window.removeEventListener("focus", alFoco);
  }, []);

  useEffect(() => {
    fuentePaneles.remoto().then(
      (r) => {
        if (!vivo.current) return;
        setE(r);
        if (r.editable) {
          const base = remotoDesde(r);
          if (EDITANDO) setB({ ...base, dispositivos: [...base.dispositivos, "mi-tablet"] });
          else if (EDITANDO_MAL) setB({ ...base, puerto: "80", nuevo: "192.168.0.7" });
          else setB(base);
        }
      },
      (x) => vivo.current && setFalla(mensaje(x)),
    );
  }, []);

  // Las capturas del celular abren el panel mostrando esta sección.
  const visible = e?.editable === true && b !== null;
  // La categoría Celular existe sólo si esta sección se ve (o si falló y hay que decirlo).
  useEffect(() => {
    declarar("celular", visible || falla !== null);
    return () => declarar("celular", false);
  }, [visible, falla]);
  useEffect(() => {
    if (visible && (MODO.variante === "celular" || EDITANDO || EDITANDO_MAL)) sec.current?.scrollIntoView({ block: "start" });
  }, [visible]);

  if (falla) return <Cat id="celular"><div className="pn-aviso" data-error>{textoMain(falla)}</div></Cat>;
  if (!e || !e.editable || !b) return null;

  const r = remotoPara(e, b);
  const valido = r.config !== null;
  const cambiar = (nuevo: BorradorRemoto) => {
    setB(nuevo);
    setError(null);
    setOk(false);
  };
  const agregar = () => {
    if (!b.nuevo.trim()) return;
    const a = agregarDispositivo(b);
    cambiar(a.borrador);
    if (!a.error) nuevoRef.current?.focus();
  };
  const guardar = async () => {
    if (!r.config || !r.sucio) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuentePaneles.guardarRemoto(r.config);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("ajustes.celular"), v: nuevo.version, conozco: VERSION }));
      setE(nuevo);
      if (nuevo.editable) setB(remotoDesde(nuevo));
      setOk(true);
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    agregar();
  };

  // Lo que se dice de dónde escucha es lo guardado y andando, no el borrador.
  const escucha = e.escuchando[0];
  const visto = new Map(e.accesos.map((a) => [a.nombre, a]));
  // Un nombre a medio escribir que no vale se señala con el error del campo, no con el general.
  const errNuevo = b.nuevo.trim() && r.errores.nuevo !== "ajustes.errDispPendiente" ? r.errores.nuevo : null;
  const errPuerto = r.errores.puerto ?? null;
  const pendiente = b.nuevo.trim() && !errNuevo;
  const opciones = ESTADOS.map((o) => ({ ...o, nombre: t(o.id === "on" ? "ajustes.celOn" : "ajustes.celOff"), desc: t("ajustes.celAccesoQue") }));

  return (
    <Cat id="celular">
    <section className="pn-sec pn-edita" ref={sec} data-celular>
      <h2 className="pn-h">{t("ajustes.celular")}</h2>
      <EstadoEscucha activo={e.activo} url={escucha} />
      <div data-opc="ajustes.celGuia">
        <PasosCelular url={e.activo ? escucha : undefined} />
      </div>
      <Fijo k="ajustes.celularIntro" bloque className="pn-nota pn-intro" />

      <Dato nombre="ajustes.celAcceso" que="ajustes.celAccesoQue">
        <div className="pn-sel">
          <Selector etiqueta={t("ajustes.celAcceso")} opciones={opciones} valor={b.activo ? "on" : "off"} alElegir={(id) => cambiar({ ...b, activo: id === "on" })} reserva={[...enOtros("ajustes.celOn"), ...enOtros("ajustes.celOff")]} />
        </div>
      </Dato>

      <Dato nombre="ajustes.celPuerto" que="ajustes.celPuertoQue">
        <input
          className="pn-campo pn-campo-num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={b.puerto}
          aria-label={t("ajustes.celPuerto")}
          aria-invalid={errPuerto !== null}
          onChange={(ev) => cambiar({ ...b, puerto: ev.target.value })}
        />
        {errPuerto ? <div className="pn-error pn-campo-error">{motivo(errPuerto, PUERTO_MIN, PUERTO_MAX)}</div> : null}
      </Dato>

      <Dato nombre="ajustes.celDisp" que="ajustes.celDispQue">
        <ul className="pn-disp" aria-label={t("ajustes.celDisp")}>
          {b.dispositivos.length ? (
            b.dispositivos.map((d) => (
              <li key={d} className="cel-disp">
                <div className="cel-disp-txt">
                  <div className="pn-disp-nom">{d}</div>
                  <div className="cel-disp-sub">{detalleAcceso(visto.get(d))}</div>
                </div>
                <button type="button" className="pn-quitar cel-quitar" aria-label={t("ajustes.celQuitar", { nombre: d })} data-tip={t("ajustes.celQuitar", { nombre: d })} onClick={() => cambiar(quitarDispositivo(b, d))}>
                  <X size={14} aria-hidden />
                  {t("ajustes.celQuitarAcceso")}
                </button>
              </li>
            ))
          ) : (
            <li className="pn-falta">
              <Fijo k="ajustes.celNinguno" />
            </li>
          )}
        </ul>
        <form className="pn-nuevo" onSubmit={enviar}>
          <input
            ref={nuevoRef}
            className="pn-campo"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={b.nuevo}
            placeholder={t("ajustes.celDispNuevo")}
            aria-label={t("ajustes.celDispNuevo")}
            aria-invalid={errNuevo !== null}
            onChange={(ev) => cambiar({ ...b, nuevo: ev.target.value })}
          />
          <button type="submit" className="btn2" disabled={!pendiente}>
            <Plus size={14} aria-hidden />
            <Fijo k="ajustes.celAgregar" />
          </button>
        </form>
        {errNuevo ? <div className="pn-error pn-campo-error">{motivo(errNuevo, 0, 0)}</div> : null}
      </Dato>

      <Acciones
        id="celular"
        sucio={r.sucio}
        valido={valido}
        guardando={guardando}
        ok={ok}
        error={error ?? (r.errores.general ? motivo(r.errores.general, 0, 0) : r.errores.nuevo === "ajustes.errDispPendiente" ? motivo(r.errores.nuevo, 0, 0) : null)}
        alGuardar={guardar}
        alCancelar={() => cambiar(remotoDesde(e))}
      />
    </section>
    </Cat>
  );
}
