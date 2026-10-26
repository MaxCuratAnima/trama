// Ajustes > Cuentas: si Claude Code y Gemini (agy) están conectados, con quién, o por qué no se pudo saber; y los botones
// para conectar, reconectar y comprobar. El estado lo da el motor preguntándole a cada CLI (`fuente.cuentas`, electron/cuentas.ts),
// no un archivo. "Conectar" abre una terminal de esta PC con el login de la cuenta de siempre (`fuente.loginCuenta`; Trama nunca ve la
// contraseña). Se vuelve a mirar al volver a la ventana (cuando se cierra la consola) o con Comprobar;
// sin reloj. Si Gemini quedó disponible después de abrir la app, la tabla de modelos se pone al día (el selector de líder nuevo).
// Las cuentas agregadas (varias por proveedor) vienen del comando `cuentas` (`useCuentas`, la misma lista de Plan y cupos): con más de
// una, cada proveedor lista todas con su nombre editable, su estado y Quitar, y debajo "Conectar otra cuenta" (`AgregarCuenta`).
// Si el comando no está o falló, se dice acá (antes la sección quedaba sin el botón y sin explicación).
import { useCallback, useEffect, useRef, useState } from "react";
import { fuente, type CuentaEstado, type EstadoCuentas } from "../datos/fuente";
import { pedirModelos } from "../datos/modelos-config";
import { aplicarModelos } from "../hilo/opciones";
import { t, textoMain, type ClaveSola } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { marcar } from "./ajustes-nav";
import { mensaje } from "../puente";
import type { FilaDato } from "./AjustesEditar";
import { AgregarCuenta, CuentaFila, cuentasDe, useCuentas } from "./CuentasVarias";

type Proveedor = "claude" | "gemini" | "chatgpt";
type Fila = { id: Proveedor; cuenta: "claude" | "google" | "chatgpt"; clave: "claude" | "agy" | "codex"; nombre: ClaveSola; que: ClaveSola };

// `cuenta`: el id de la cuenta de siempre en el CLI `cuentas` (el del proveedor).
const FILAS: (Fila & { clave: "claude" | "agy" })[] = [
  { id: "claude", cuenta: "claude", clave: "claude", nombre: "ajustes.ctaClaude", que: "ajustes.ctaClaudeQue" },
  { id: "gemini", cuenta: "google", clave: "agy", nombre: "ajustes.ctaGemini", que: "ajustes.ctaGeminiQue" },
];
// ChatGPT (codex) es opcional: sólo aparece si el comando `cuentas` lo lista.
const CHATGPT: Fila = { id: "chatgpt", cuenta: "chatgpt", clave: "codex", nombre: "cu.chatgpt", que: "cu.chatgptQue" };

const estado = (c: CuentaEstado): ClaveSola =>
  c.logueado ? "ajustes.ctaConectada" : c.error ? "ajustes.ctaError" : c.instalado ? "ajustes.ctaSinConectar" : "ajustes.ctaNoInstalada";

export function AjustesCuentas({ Dato }: { Dato: FilaDato }) {
  useIdioma();
  const [c, setC] = useState<EstadoCuentas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirando, setMirando] = useState(false);
  const [esperando, setEsperando] = useState<Proveedor | null>(null);
  const { lista, error: errorLista, sinComando, mirar } = useCuentas();
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  const leer = useCallback(async () => {
    setMirando(true);
    try {
      const r = await fuente.cuentas();
      if (!r) throw new Error(t("main.cuentasFallo", { rc: "?" }));
      if (!vivo.current) return;
      setC(r);
      setError(null);
      // Gemini instalado y la tabla de modelos sin sus filas (agy apareció después de abrir la app): se arma de nuevo.
      if (r.agy.instalado) void pedirModelos(5000).then((m) => m && m.gemini && aplicarModelos(m));
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setMirando(false);
    }
  }, []);

  useEffect(() => {
    void leer();
    // Al volver a la ventana (se cerró la consola donde se inició sesión) se mira de nuevo.
    window.addEventListener("focus", leer);
    return () => window.removeEventListener("focus", leer);
  }, [leer]);

  // La captura de `cuentas` abre Ajustes mostrando esta sección.
  useEffect(() => {
    if (c && (MODO.variante ?? "").startsWith("cuentas")) sec.current?.scrollIntoView({ block: "start" });
  }, [c]);

  // La marca de la barra lateral: lo que falta conectar (sin dato, no se dice nada).
  useEffect(() => {
    if (!c) return;
    const sin = FILAS.filter((f) => !c[f.clave].logueado);
    if (sin.length === FILAS.length) marcar("cuentas", "aj.marca.ninguna");
    else if (sin.length) marcar("cuentas", "aj.marca.sinConectar", { quien: sin[0].id === "claude" ? "Claude" : "Gemini" });
    else marcar("cuentas", null);
    return () => marcar("cuentas", null);
  }, [c]);

  // Algo cambió en la lista (se agregó, renombró, quitó o conectó una cuenta): se vuelve a mirar la lista y el estado de cada CLI.
  const alCambiar = useCallback(() => {
    mirar();
    void leer();
  }, [mirar, leer]);

  // Vuelve cuando la persona termina (o cierra) la terminal: entonces se mira de nuevo.
  const conectar = async (f: Fila) => {
    setEsperando(f.id);
    const r = await fuente.loginCuenta(f.cuenta).catch((e) => ({ ok: false as const, error: mensaje(e) }));
    if (!vivo.current) return;
    setEsperando(null);
    if (r.ok) alCambiar();
    else setError(r.error);
  };

  const filas = lista && cuentasDe(lista, "chatgpt").length ? [...FILAS, CHATGPT] : FILAS;

  return (
    <section className="pn-sec" ref={sec} data-cuentas>
      <Fijo k="ajustes.cuentasIntro" bloque className="pn-nota pn-intro" />
      {c
        ? filas.map((f) => {
            const cuenta = c[f.clave];
            const perfiles = cuentasDe(lista, f.cuenta);
            // Más de una cuenta (o una sola sin el estado del CLI, como ChatGPT): la lista del comando `cuentas`, una fila por cuenta.
            const varias = perfiles.length > 1 || (perfiles.length === 1 && !cuenta);
            return (
              <Dato key={f.id} nombre={f.nombre} que={f.que}>
                {varias ? (
                  <div className="cu-cuentas">
                    {perfiles.map((p) => (
                      <CuentaFila key={p.id} perfil={p} alCambiar={alCambiar}>
                        {p.defecto && cuenta?.logueado && cuenta.cuenta ? <div className="cu-cta-nota">{t("ajustes.ctaConectadaComo", { cuenta: cuenta.cuenta })}</div> : null}
                      </CuentaFila>
                    ))}
                  </div>
                ) : cuenta ? (
                  <div className="pn-cuenta">
                    <span className="pn-estado" data-escucha={cuenta.logueado ? "" : undefined} data-error={cuenta.error ? "" : undefined}>
                      {cuenta.logueado && cuenta.cuenta ? t("ajustes.ctaConectadaComo", { cuenta: cuenta.cuenta }) : t(estado(cuenta))}
                    </span>
                    <button type="button" className="btn2" disabled={!cuenta.instalado} onClick={() => void conectar(f)}>
                      {t(cuenta.logueado ? "ajustes.ctaReconectar" : f.id === "claude" ? "ajustes.ctaConectarClaude" : "ajustes.ctaConectarGemini")}
                    </button>
                  </div>
                ) : null}
                {cuenta?.error ? <div className="pn-nota" role="status">{cuenta.error}</div> : null}
                {esperando === f.id && !cuenta?.logueado ? <div className="pn-nota">{t("ajustes.ctaConsola")}</div> : null}
                {lista ? <AgregarCuenta proveedor={f.cuenta} alCambiar={alCambiar} /> : null}
              </Dato>
            );
          })
        : error
          ? null
          : <div className="pn-aviso">{t("ajustes.leyendo")}</div>}
      {errorLista ? (
        <div className="pn-error" role="alert">
          {t("ajustes.ctaListaFallo", { motivo: textoMain(errorLista) })}
        </div>
      ) : sinComando && c ? (
        <div className="pn-nota" role="status">{t("ajustes.ctaSinComando")}</div>
      ) : null}
      {error ? (
        <div className="pn-error" role="alert">
          {textoMain(error)}
        </div>
      ) : null}
      {c || error ? (
        <div className="pn-acciones">
          <button type="button" className="btn2" disabled={mirando} onClick={alCambiar}>
            {t(mirando ? "ajustes.ctaComprobando" : "ajustes.ctaRevisar")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
