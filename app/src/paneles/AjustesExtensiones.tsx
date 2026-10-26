// Ajustes > Extensiones: las skills, los agentes, los plugins y los servidores MCP que tiene la carpeta de configuración de Claude de una
// cuenta (la de siempre: ~/.claude; una agregada: su propia carpeta, que es su CLAUDE_CONFIG_DIR). Sólo se lee (electron/extensiones.ts:
// de los MCP, nombre y tipo, nunca claves ni cabeceras). "Importar a esta cuenta" copia a la elegida lo que la principal tiene y ella no,
// sin pisar nada y sin tocar su inicio de sesión.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fuente } from "../datos/fuente";
import { deProveedor, type PerfilCuenta } from "../datos/cuentas";
import type { Extensiones, ResultadoImportar } from "../datos/extensiones";
import { Selector, type Opcion } from "../hilo/Selector";
import { t, textoMain, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Chip } from "../ui/componentes";
import type { FilaDato } from "./AjustesEditar";

const PRINCIPAL = "claude";

/** Una fila de una lista: nombre y descripción a la izquierda; a la derecha, de dónde viene y lo que lo caracteriza. */
function Fila({ nombre, descripcion, children }: { nombre: string; descripcion?: string; children: ReactNode }) {
  return (
    <div className="pn-dato ex-fila">
      <div className="pn-dato-id">
        <div className="pn-dato-txt">
          <div className="pn-nom" data-tip={nombre}>
            {nombre}
          </div>
          {descripcion ? <div className="pn-que">{descripcion}</div> : null}
        </div>
      </div>
      <div className="pn-val ex-chips">{children}</div>
    </div>
  );
}

/** Una sección con su título y cuántos hay; `opc` es la clave con que la encuentra el buscador. */
function Lista({ opc, n, children }: { opc: ClaveSola; n: number; children: ReactNode }) {
  return (
    <section className="pn-sec" data-opc={opc}>
      <h2 className="pn-h">
        {t(opc)}
        <span className="ex-n">{n}</span>
      </h2>
      {n ? children : <div className="pn-nota">{t("ext.vacio")}</div>}
    </section>
  );
}

const resumen = (r: Extract<ResultadoImportar, { ok: true }>): string => t("ext.importadoOk", { skills: r.skills, agentes: r.agentes, mcp: r.mcp, omitidos: r.omitidos });

export function AjustesExtensiones({ Dato }: { Dato: FilaDato }) {
  useIdioma();
  const [cuentas, setCuentas] = useState<PerfilCuenta[]>([]);
  const [sel, setSel] = useState(PRINCIPAL);
  // `undefined`: leyendo; `null`: la carpeta de esa cuenta no existe o no se pudo leer.
  const [ext, setExt] = useState<Extensiones | null | undefined>(undefined);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const vivo = useRef(true);
  const vuelta = useRef(0);
  useEffect(() => () => void (vivo.current = false), []);

  // Las cuentas de Claude que dice el CLI `cuentas` (sin él, sólo la de siempre).
  useEffect(() => {
    void fuente.listaCuentas(false).then(
      (l) => vivo.current && setCuentas(deProveedor(l, "claude")),
      () => undefined,
    );
  }, []);

  const leer = useCallback((id: string) => {
    const mia = ++vuelta.current;
    void fuente.extensiones(id).then(
      (e) => vivo.current && mia === vuelta.current && setExt(e),
      () => vivo.current && mia === vuelta.current && setExt(null),
    );
  }, []);

  useEffect(() => {
    setExt(undefined);
    setAviso(null);
    leer(sel);
  }, [sel, leer]);

  // Al volver a la ventana se mira de nuevo (se pudo cambiar la carpeta desde una terminal).
  useEffect(() => {
    const volver = () => leer(sel);
    window.addEventListener("focus", volver);
    return () => window.removeEventListener("focus", volver);
  }, [sel, leer]);

  const opciones: Opcion[] = (cuentas.length ? cuentas : [{ id: PRINCIPAL, proveedor: "claude", nombre: "Claude", defecto: true, logueado: null } as PerfilCuenta]).map((c) => ({
    id: c.id,
    nombre: c.defecto ? t("cu.cuentaPrincipal") : c.nombre,
    desc: c.defecto ? t("ext.cuentaPrincipalQue") : "",
  }));
  const esPrincipal = sel === PRINCIPAL;

  const importar = async () => {
    setImportando(true);
    setAviso(null);
    const r = await fuente.importarExtensiones(sel).catch((e): ResultadoImportar => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!vivo.current) return;
    setImportando(false);
    setAviso(r.ok ? { ok: true, texto: resumen(r) } : { ok: false, texto: textoMain(r.error) });
    leer(sel);
  };

  const origen = (o: string) => <Chip>{t("ext.origen", { o })}</Chip>;

  return (
    <>
      <section className="pn-sec">
        <h2 className="pn-h">{t("ext.cuentaH")}</h2>
        <Dato nombre="ext.cuenta" que="ext.cuentaQue">
          <div className="pn-sel">
            <Selector etiqueta={t("ext.cuenta")} opciones={opciones} valor={sel} alElegir={setSel} reserva={[]} />
          </div>
        </Dato>
        <Dato nombre="ext.importar" que="ext.importarQue">
          <button type="button" className="btn2" disabled={esPrincipal || importando || !ext} data-tip={esPrincipal ? t("ext.importarPrincipal") : undefined} onClick={() => void importar()}>
            {t(importando ? "ext.importando" : "ext.importarBtn")}
          </button>
        </Dato>
        {aviso ? (
          <div className={aviso.ok ? "pn-nota" : "pn-error"} role={aviso.ok ? "status" : "alert"}>
            {aviso.texto}
          </div>
        ) : null}
      </section>

      {ext === undefined ? (
        <div className="pn-aviso">{t("ext.leyendo")}</div>
      ) : ext === null ? (
        <div className="pn-aviso" data-error>
          {t("ext.noCarpeta")}
        </div>
      ) : (
        <>
          <Lista opc="ext.skills" n={ext.skills.length}>
            {ext.skills.map((s) => (
              <Fila key={s.nombre} nombre={s.nombre} descripcion={s.descripcion || t("ext.sinDesc")}>
                {origen(s.origen)}
              </Fila>
            ))}
          </Lista>
          <Lista opc="ext.agentes" n={ext.agentes.length}>
            {ext.agentes.map((a) => (
              <Fila key={a.nombre} nombre={a.nombre} descripcion={a.descripcion || t("ext.sinDesc")}>
                {a.modelo ? <Chip>{a.modelo}</Chip> : null}
                {origen(a.origen)}
              </Fila>
            ))}
          </Lista>
          <Lista opc="ext.plugins" n={ext.plugins.length}>
            {ext.plugins.map((p) => (
              <Fila key={`${p.nombre}@${p.mercado}`} nombre={p.nombre}>
                {p.activo === null ? null : <Chip tono={p.activo ? "ok" : undefined}>{t(p.activo ? "ext.activo" : "ext.inactivo")}</Chip>}
                {p.version ? <Chip>{`v${p.version}`}</Chip> : null}
                {origen(p.mercado || p.origen)}
              </Fila>
            ))}
          </Lista>
          <Lista opc="ext.mcp" n={ext.mcp.length}>
            {ext.mcp.map((m) => (
              <Fila key={`${m.origen}/${m.nombre}`} nombre={m.nombre} descripcion={m.destino}>
                <Chip>{m.tipo}</Chip>
                {origen(m.origen)}
              </Fila>
            ))}
          </Lista>
        </>
      )}
    </>
  );
}
