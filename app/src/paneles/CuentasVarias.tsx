// Varias cuentas por proveedor, la parte que comparten Ajustes > Plan y cupos y la bienvenida: la lista que dice el CLI `cuentas`
// (`useCuentas`), una cuenta con su nombre editable, si está conectada y sus acciones (`CuentaFila`) y "Conectar otra cuenta"
// (`AgregarCuenta`). Quien tiene una sola cuenta por proveedor sólo ve ese botón; sin el comando `cuentas` no se ve nada.
// El login lo hace la persona en una terminal de la PC (el motor la abre y espera); después se vuelve a preguntar `--verificar`.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Boton, Chip, Interruptor } from "../ui/componentes";
import { ICONO, IcEditar, IcMas } from "../ui/iconos";
import { fuente } from "../datos/fuente";
import { deProveedor, type ListaCuentas, type PerfilCuenta, type ProveedorCuenta, type ResultadoCuenta } from "../datos/cuentas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";

/**
 * La lista de cuentas: primero la rápida y enseguida la verificada (pregunta el login a cada CLI, tarda). Al volver a la ventana se vuelve a verificar.
 * `lista` es `null` sin el comando `cuentas` y también si falló; en ese caso `error` dice por qué (texto del main, para `textoMain`).
 * `sinComando`: ya se preguntó y no hay comando (a diferencia de «todavía no contestó»).
 */
export function useCuentas(): { lista: ListaCuentas | null; error: string | null; sinComando: boolean; mirar: () => void } {
  const [leida, setLista] = useState<ListaCuentas | null>(null);
  const [listo, setListo] = useState(false);
  const vivo = useRef(true);
  const vuelta = useRef(0);
  useEffect(() => () => void (vivo.current = false), []);
  const mirar = useCallback(() => {
    const mia = ++vuelta.current;
    const poner = (l: ListaCuentas | null) => {
      if (!vivo.current || mia !== vuelta.current) return;
      setLista(l);
      setListo(true);
    };
    void fuente.listaCuentas(false).then((l) => {
      poner(l);
      if (l && !l.error) void fuente.listaCuentas(true).then(poner, () => undefined);
    }, () => undefined);
  }, []);
  useEffect(() => {
    mirar();
    window.addEventListener("focus", mirar);
    return () => window.removeEventListener("focus", mirar);
  }, [mirar]);
  return { lista: leida?.error ? null : leida, error: leida?.error ?? null, sinComando: listo && !leida, mirar };
}

export const cuentasDe = deProveedor;

const textoError = (r: Extract<ResultadoCuenta, { ok: false }>) => textoMain(r.error);

/** El nombre de la cuenta: un botón que al tocarlo se vuelve campo; Enter o salir del campo guarda, Esc deja el que estaba. */
function Nombre({ perfil, alGuardar }: { perfil: PerfilCuenta; alGuardar: (nombre: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(perfil.nombre);
  const cancelado = useRef(false);
  const cerrar = (guardar: boolean) => {
    setEditando(false);
    const n = valor.trim();
    if (guardar && n && n !== perfil.nombre) alGuardar(n);
  };
  if (!editando)
    return (
      <button
        type="button"
        className="cu-cta-nom"
        aria-label={t("cu.renombrar", { nombre: perfil.nombre })}
        data-tip={t("cu.renombrar", { nombre: perfil.nombre })}
        onClick={() => {
          cancelado.current = false;
          setValor(perfil.nombre);
          setEditando(true);
        }}
      >
        <span className="cu-cta-txt">{perfil.nombre}</span>
        <IcEditar {...ICONO} size={12} aria-hidden="true" className="cu-cta-lapiz" />
      </button>
    );
  return (
    <input
      className="pn-campo cu-cta-campo"
      value={valor}
      maxLength={60}
      autoFocus
      spellCheck={false}
      autoComplete="off"
      aria-label={t("cu.nombreCuenta")}
      onChange={(e) => setValor(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          cancelado.current = true;
          cerrar(true);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          cancelado.current = true;
          cerrar(false);
        }
      }}
      onBlur={() => !cancelado.current && cerrar(true)}
    />
  );
}

/** Una cuenta: nombre editable, conectada o no, Conectar y Quitar (la de siempre no se quita). `children`: su cupo, sus ventanas. */
export function CuentaFila({ perfil, alCambiar, children }: { perfil: PerfilCuenta; alCambiar: () => void; children?: ReactNode }) {
  useIdioma();
  const [ocupada, setOcupada] = useState<"login" | "guardar" | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const correr = async (como: "login" | "guardar", hacer: () => Promise<ResultadoCuenta>) => {
    setOcupada(como);
    setError(null);
    const r = await hacer().catch((): ResultadoCuenta => ({ ok: false, error: "main.cuentasFallo" }));
    if (!vivo.current) return;
    setOcupada(null);
    if (!r.ok) setError(textoError(r));
    else setQuitando(false);
    alCambiar();
  };

  return (
    <div className="cu-cta" data-cuenta={perfil.id}>
      <div className="cu-cta-cab">
        <Nombre perfil={perfil} alGuardar={(n) => void correr("guardar", () => fuente.renombrarCuenta(perfil.id, n))} />
        {perfil.defecto ? <span className="cu-cta-def">{t("cu.cuentaPrincipal")}</span> : null}
        {perfil.logueado === null ? null : perfil.logueado ? <Chip tono="ok">{t("cu.conectado")}</Chip> : <Chip tono="aviso">{t("cu.noConectado")}</Chip>}
        <span className="cu-cta-acc">
          {perfil.logueado === false ? (
            <Boton disabled={ocupada !== null} onClick={() => void correr("login", () => fuente.loginCuenta(perfil.id))}>
              {t("cu.conectar")}
            </Boton>
          ) : null}
          {perfil.defecto ? null : (
            <Boton disabled={ocupada !== null} aria-expanded={quitando} onClick={() => setQuitando((q) => !q)}>
              {t("cu.quitar")}
            </Boton>
          )}
        </span>
      </div>
      {ocupada === "login" ? (
        <div className="cu-cta-nota" role="status">
          {t("cu.esperandoLogin")}
        </div>
      ) : null}
      {quitando ? (
        <div className="cu-cta-quitar" role="group" aria-label={t("cu.quitarPregunta", { nombre: perfil.nombre })}>
          <div className="cu-cta-q">{t("cu.quitarPregunta", { nombre: perfil.nombre })}</div>
          <label className="cu-cta-borrar">
            <Interruptor activo={borrar} alCambiar={setBorrar} aria-label={t("cu.quitarCreds")} />
            <span>
              {t("cu.quitarCreds")}
              <span className="cu-sin"> · {t("cu.quitarQue")}</span>
            </span>
          </label>
          <div className="cu-cta-botones">
            <Boton primario disabled={ocupada !== null} onClick={() => void correr("guardar", () => fuente.quitarCuenta(perfil.id, borrar))}>
              {t("cu.quitar")}
            </Boton>
            <Boton onClick={() => setQuitando(false)}>{t("cu.cancelar")}</Boton>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="pn-error cu-cta-error" role="alert">
          {error}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** "Conectar otra cuenta": pide un nombre, crea la cuenta y abre su login en una terminal; al terminar vuelve a mirar. */
export function AgregarCuenta({ proveedor, alCambiar }: { proveedor: ProveedorCuenta; alCambiar: () => void }) {
  useIdioma();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [fase, setFase] = useState<"quieto" | "creando" | "login">("quieto");
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const ocupado = fase !== "quieto";
  const crear = async () => {
    const n = nombre.trim();
    if (!n || ocupado) return;
    setError(null);
    setFase("creando");
    const alta = await fuente.agregarCuenta(proveedor, n).catch((): ResultadoCuenta => ({ ok: false, error: "main.cuentasFallo" }));
    if (!vivo.current) return;
    if (!alta.ok || !alta.id) {
      setFase("quieto");
      setError(alta.ok ? textoMain("main.cuentasFallo") : textoError(alta));
      return;
    }
    alCambiar();
    setFase("login");
    const login = await fuente.loginCuenta(alta.id).catch((): ResultadoCuenta => ({ ok: false, error: "main.cuentasFallo" }));
    if (!vivo.current) return;
    setFase("quieto");
    setNombre("");
    if (login.ok) setAbierto(false);
    else setError(`${t("cu.cuentaNueva")} ${textoError(login)}`);
    alCambiar();
  };

  if (!abierto)
    return (
      <div className="cu-otra">
        <Boton onClick={() => setAbierto(true)} data-opc="cu.otraCuenta" aria-expanded={false}>
          <IcMas {...ICONO} size={14} aria-hidden="true" />
          {t("cu.otraCuenta")}
        </Boton>
      </div>
    );
  return (
    <form
      className="cu-otra cu-otra-form"
      onSubmit={(e) => {
        e.preventDefault();
        void crear();
      }}
    >
      <input
        className="pn-campo"
        value={nombre}
        maxLength={60}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        disabled={ocupado}
        placeholder={t("cu.nombreEjemplo")}
        aria-label={t("cu.nombreCuenta")}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !ocupado) {
            e.stopPropagation();
            setAbierto(false);
          }
        }}
      />
      <div className="cu-cta-botones">
        <Boton type="submit" primario disabled={ocupado || !nombre.trim()}>
          {t("cu.crearConectar")}
        </Boton>
        <Boton disabled={ocupado} onClick={() => setAbierto(false)}>
          {t("cu.cancelar")}
        </Boton>
      </div>
      {fase === "login" ? (
        <div className="cu-cta-nota" role="status">
          {t("cu.esperandoLogin")}
        </div>
      ) : null}
      {error ? (
        <div className="pn-error cu-cta-error" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}
