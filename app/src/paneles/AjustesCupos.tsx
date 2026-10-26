// Ajustes > Plan y cupos: una tarjeta por suscripción (Claude, Google AI Pro, ChatGPT) con su logo, si está conectada, el plan y
// cada ventana con su barra y cuándo vuelve; abajo, lo que se escribe en `modelos.json` (guardar un % para mis sesiones y qué hace
// `pa` si un proveedor se queda sin cupo). Trabaja sobre el borrador de AjustesModelos (nada se escribe hasta Guardar). Los textos que
// cambian con el tiempo ("vuelve en 20 h") los escribe el reloj, no React.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarraCupo, Boton, Chip, Interruptor, Tarjeta } from "../ui/componentes";
import { LogoCaja, type Proveedor } from "../ui/logos";
import type { GrupoCupo, SuscripcionCupo, Uso, VentanaCupo } from "../datos/contrato";
import { fuente, type CuentaEstado, type EstadoCuentas } from "../datos/fuente";
import { Selector } from "../hilo/Selector";
import { t, type ClaveSola } from "../i18n";
import { enOtros } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { Reloj } from "../barra/piezas";
import { pintorVuelve } from "../tiempo";
import { cuentasDe, AgregarCuenta, CuentaFila, useCuentas } from "./CuentasVarias";
import type { PerfilCuenta, ProveedorCuenta } from "../datos/cuentas";
import type { FilaDato } from "./AjustesEditar";
import { avisosTope, GOOGLE_CODIGO, GOOGLE_LLENA } from "./cupos-aviso";
import { SIN_CUPO, TOPE_CLAUDE_DEFECTO, type Borrador, type SinCupo } from "./modelos-borrador";

const SIN_CUPO_CLAVES: Record<SinCupo, { nombre: ClaveSola; que: ClaveSola }> = {
  otro: { nombre: "cu.sinCupoOtro", que: "cu.sinCupoOtroQue" },
  esperar: { nombre: "cu.sinCupoEsperar", que: "cu.sinCupoEsperarQue" },
  fallar: { nombre: "cu.sinCupoFallar", que: "cu.sinCupoFallarQue" },
};

const TOPE_FORMATO = /^\s*$|^\d{1,3}$/;
const topeMal = (v: string) => !TOPE_FORMATO.test(v) || (v.trim() !== "" && (Number(v) < 1 || Number(v) > 100));

type UsoClaude = Extract<Uso, { five_hour: unknown }>;
const conDatos = (u: Uso | null): u is UsoClaude => u !== null && "five_hour" in u;

/** "vuelve en 20 h": lo escribe el reloj compartido; sin hora no se pinta nada. */
function Vuelve({ epoch }: { epoch: number | null }) {
  const pintor = useMemo(() => (epoch === null ? null : pintorVuelve(epoch)), [epoch]);
  return pintor ? <Reloj pintor={pintor} className="cu-vuelve" /> : null;
}

/** Una ventana de cupo: su nombre, la barra, el porcentaje y cuándo vuelve; sin dato lo dice. */
function Ventana({ nombre, pct, vuelve }: { nombre: string; pct: number | null; vuelve: number | null }) {
  return (
    <div className="cu-vent" role="group" aria-label={nombre}>
      <span className="cu-vent-n">{nombre}</span>
      {pct === null ? (
        <span className="cu-sin">{t("uso.sinDatoCupo")}</span>
      ) : (
        <>
          <BarraCupo fraccion={pct / 100} />
          <span className="cu-pct">{Math.round(pct)} %</span>
          <Vuelve epoch={vuelve} />
        </>
      )}
    </div>
  );
}

const nombreVentana = (id: string) => (id === "5h" ? t("uso.5h") : id === "7d" ? t("uso.sem") : id);

const Ventanas = ({ vs }: { vs: VentanaCupo[] }) => (
  <>
    {vs.map((v) => (
      <Ventana key={v.id} nombre={nombreVentana(v.id)} pct={v.pct} vuelve={v.vuelve} />
    ))}
  </>
);

function Grupo({ g }: { g: GrupoCupo }) {
  return (
    <div className="cu-grupo">
      <div className="cu-grupo-n">{g.nombre}</div>
      <Ventanas vs={g.ventanas} />
    </div>
  );
}

/** El chip de arriba de una tarjeta: conectada, sin conectar, sin instalar, o sin saber. */
function Estado({ c }: { c: CuentaEstado | undefined }) {
  if (!c) return <Chip>{t("comun.sinDato")}</Chip>;
  if (c.logueado) return <Chip tono="ok">{t("cu.conectado")}</Chip>;
  return <Chip tono="aviso">{t(c.instalado ? "cu.noConectado" : "cu.noInstalado")}</Chip>;
}

/** `estado` `null`: hay varias cuentas y cada una dice el suyo. */
function Cabecera({ id, nombre, estado }: { id: Proveedor; nombre: string; estado: CuentaEstado | undefined | null }) {
  return (
    <div className="cu-cab">
      <LogoCaja id={id} />
      <h4 className="cu-nombre">{nombre}</h4>
      {estado === null ? null : <Estado c={estado} />}
    </div>
  );
}

/** "Conectar": abre una terminal con el login de la cuenta de siempre y explica cómo se hace, sin prometer nada que no pasa solo. */
function Conectar({ id, c, como, alMirar }: { id: Proveedor; c: CuentaEstado | undefined; como: string; alMirar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  if (c?.logueado) return null;
  return (
    <div className="cu-conectar">
      <Boton
        aria-expanded={abierto}
        onClick={() => {
          setAbierto((a) => !a);
          // Vuelve cuando la persona termina (o cierra) la terminal: ahí se mira de nuevo.
          if (c?.instalado) void fuente.loginCuenta(id).then(alMirar, alMirar);
        }}
      >
        {t("cu.conectar")}
      </Boton>
      {abierto ? (
        <div className="cu-como" role="status">
          <span>{como}</span>
          <Boton onClick={alMirar}>{t("cu.volverAMirar")}</Boton>
        </div>
      ) : null}
    </div>
  );
}

/** El cupo de una cuenta agregada (la de siempre se pinta con lo de siempre): sus ventanas o sus grupos, o «sin dato». */
function CupoDe({ uso, proveedor, perfil }: { uso: Uso | null; proveedor: ProveedorCuenta; perfil: PerfilCuenta }) {
  const s = conDatos(uso) ? uso.suscripciones?.find((x) => (x.proveedor ?? x.id) === proveedor && (x.cuenta ?? x.id) === perfil.id) : undefined;
  if (s?.grupos?.length) return <>{s.grupos.map((g) => <Grupo key={g.id} g={g} />)}</>;
  if (s?.ventanas?.length) return <Ventanas vs={s.ventanas} />;
  return <div className="cu-sin">{t("uso.sinDatoCupo")}</div>;
}

/**
 * Las cuentas de un proveedor cuando hay más de una: una fila por cuenta con su nombre, su estado y su cupo (`deSiempre`: lo de
 * siempre para la principal). Con una sola, `null` y la tarjeta se ve como siempre.
 */
function ListaCuentas({ proveedor, perfiles, uso, deSiempre, alCambiar }: { proveedor: ProveedorCuenta; perfiles: PerfilCuenta[]; uso: Uso | null; deSiempre: ReactNode; alCambiar: () => void }) {
  if (perfiles.length < 2) return null;
  return (
    <div className="cu-cuentas">
      {perfiles.map((p) => (
        <CuentaFila key={p.id} perfil={p} alCambiar={alCambiar}>
          {p.defecto ? deSiempre : <CupoDe uso={uso} proveedor={proveedor} perfil={p} />}
        </CuentaFila>
      ))}
    </div>
  );
}

const planClaude = (plan: string | null) => (plan === "max" ? t("cu.planMax") : plan === "pro" ? t("cu.planPro") : "Claude");

/** Arriba de la categoría: el aviso de tope cruzado y las tres tarjetas de suscripción. */
export function CuposTarjetas({ b, uso, plan }: { b: Borrador; uso: Uso | null; plan: string | null }) {
  useIdioma();
  const [cuentas, setCuentas] = useState<EstadoCuentas | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const mirar = useCallback(() => {
    void fuente.cuentas().then((c) => vivo.current && setCuentas(c), () => undefined);
  }, []);
  useEffect(() => {
    mirar();
    // Al volver a la ventana (se hizo el login en una terminal) se vuelve a mirar, sin reloj.
    window.addEventListener("focus", mirar);
    return () => window.removeEventListener("focus", mirar);
  }, [mirar]);

  const { lista, mirar: mirarCuentas } = useCuentas();
  const alCambiarCuentas = useCallback(() => {
    mirarCuentas();
    mirar();
  }, [mirarCuentas, mirar]);
  const pClaude = cuentasDe(lista, "claude");
  const pGoogle = cuentasDe(lista, "google");
  const pChatgpt = cuentasDe(lista, "chatgpt");

  const google: SuscripcionCupo | undefined = conDatos(uso) ? uso.suscripciones?.find((s) => s.id === "google") : undefined;
  const avisos = avisosTope(b, uso);
  const cupoClaude = conDatos(uso) ? (
    <>
      <Ventana nombre={t("uso.5h")} pct={uso.five_hour?.pct ?? null} vuelve={uso.five_hour?.resets_at ?? null} />
      <Ventana nombre={t("uso.sem")} pct={uso.seven_day?.pct ?? null} vuelve={uso.seven_day?.resets_at ?? null} />
    </>
  ) : (
    <div className="cu-sin">{t("uso.sinDatoCupo")}</div>
  );
  const cupoGoogle = google?.grupos ? google.grupos.map((g) => <Grupo key={g.id} g={g} />) : google?.ventanas ? <Ventanas vs={google.ventanas} /> : <div className="cu-sin">{t("uso.sinDatoCupo")}</div>;

  return (
    <section className="cu-sec">
      {avisos.map((a) => (
        <div key={a.ventana} className="pn-aviso mdl-cruce cu-aviso" role="status">
          <div>
            {t("cu.avisoTope", { quien: "Claude", ventana: t(a.ventana === "5h" ? "cu.ventana5h" : "cu.ventanaSem"), pct: a.pct })}
            {a.vuelve !== null ? ", " : ""}
            <Vuelve epoch={a.vuelve} />
          </div>
          <div className="cu-aviso-q">{t("cu.avisoTopeQue", { tope: a.tope })}</div>
        </div>
      ))}

      <div className="cu-tarjetas">
        <div data-opc="cu.claude">
          <Tarjeta>
            <Cabecera id="claude" nombre={planClaude(plan)} estado={pClaude.length > 1 ? null : cuentas?.claude} />
            <div className="cu-cuerpo">
              {pClaude.length > 1 ? (
                <ListaCuentas proveedor="claude" perfiles={pClaude} uso={uso} deSiempre={cupoClaude} alCambiar={alCambiarCuentas} />
              ) : (
                <>
                  {cupoClaude}
                  <Conectar id="claude" c={cuentas?.claude} como={t("cu.comoClaude")} alMirar={mirar} />
                </>
              )}
              {lista ? <AgregarCuenta proveedor="claude" alCambiar={alCambiarCuentas} /> : null}
            </div>
          </Tarjeta>
        </div>

        <div data-opc="cu.google">
          <Tarjeta>
            <Cabecera id="google" nombre={google?.nombre ?? "Google AI Pro"} estado={pGoogle.length > 1 ? null : cuentas?.agy} />
            <div className="cu-cuerpo">
              {pGoogle.length > 1 ? <ListaCuentas proveedor="google" perfiles={pGoogle} uso={uso} deSiempre={cupoGoogle} alCambiar={alCambiarCuentas} /> : cupoGoogle}
              <div className="cu-topes" data-opc="cu.topesGoogle">
                <div className="cu-tope">
                  <span>{t("cu.topeLlena")}</span>
                  <Chip>{t("cu.desdeUsado", { pct: GOOGLE_LLENA })}</Chip>
                </div>
                <div className="cu-tope">
                  <span>{t("cu.topeCodigo")}</span>
                  <Chip>{t("cu.desdeUsado", { pct: GOOGLE_CODIGO })}</Chip>
                </div>
                <div className="cu-sin">{t("cu.topesQue")}</div>
              </div>
              {pGoogle.length > 1 ? null : <Conectar id="google" c={cuentas?.agy} como={t("cu.comoGoogle")} alMirar={mirar} />}
              {lista ? <AgregarCuenta proveedor="google" alCambiar={alCambiarCuentas} /> : null}
            </div>
          </Tarjeta>
        </div>

        <div data-opc="cu.chatgpt">
          <Tarjeta>
            <Cabecera id="chatgpt" nombre="ChatGPT" estado={pChatgpt.length > 1 ? null : (cuentas?.codex ?? (cuentas ? { instalado: false, logueado: false, cuenta: null, error: null } : undefined))} />
            <div className="cu-cuerpo">
              {pChatgpt.length > 1 ? (
                <ListaCuentas proveedor="chatgpt" perfiles={pChatgpt} uso={uso} deSiempre={<div className="cu-sin">{t("cu.chatgptSinCupo")}</div>} alCambiar={alCambiarCuentas} />
              ) : (
                <>
                  <div className="cu-sin">{t("cu.chatgptSinCupo")}</div>
                  <Conectar id="chatgpt" c={cuentas?.codex} como={t(cuentas?.codex?.instalado ? "cu.comoCodex" : "cu.comoCodexInstalar")} alMirar={mirar} />
                </>
              )}
              {lista && pChatgpt.length > 0 ? <AgregarCuenta proveedor="chatgpt" alCambiar={alCambiarCuentas} /> : null}
            </div>
          </Tarjeta>
        </div>
      </div>
    </section>
  );
}

/** Lo que se escribe en `modelos.json`: guardar un % para mis sesiones y qué hace `pa` sin cupo. */
export function AjustesCupos({ Dato, b, cambiar }: { Dato: FilaDato; b: Borrador; cambiar: (b: Borrador) => void }) {
  useIdioma();
  const errTope5 = topeMal(b.tope5);
  const errTope7 = topeMal(b.tope7);
  const nuevo = (k: "tope5" | "tope7") => (ev: { target: { value: string } }) => cambiar({ ...b, [k]: ev.target.value });
  const campo = (k: "tope5" | "tope7", mal: boolean, etiqueta: ClaveSola) => (
    <div className="pn-campo-fila">
      <input
        className="pn-campo pn-campo-num"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={b[k]}
        placeholder={String(TOPE_CLAUDE_DEFECTO)}
        aria-label={t(etiqueta)}
        aria-invalid={mal}
        onChange={nuevo(k)}
      />
      <span className="pn-unidad">%</span>
    </div>
  );

  return (
    <section className="pn-sec pn-edita">
      <Dato nombre="ajustes.cuposGuardar" que="ajustes.cuposGuardarQue">
        <Interruptor activo={b.guardar} alCambiar={(v) => cambiar({ ...b, guardar: v })} aria-label={t("ajustes.cuposGuardar")} />
      </Dato>
      {b.guardar ? (
        <>
          <Dato nombre="ajustes.mdlTope5" que="ajustes.mdlTope5Que">
            {campo("tope5", errTope5, "ajustes.mdlTope5")}
            {errTope5 ? <div className="pn-error pn-campo-error">{t("ajustes.mdlTopeErr")}</div> : null}
          </Dato>
          <Dato nombre="ajustes.mdlTope7" que="ajustes.mdlTope7Que">
            {campo("tope7", errTope7, "ajustes.mdlTope7")}
            {errTope7 ? <div className="pn-error pn-campo-error">{t("ajustes.mdlTopeErr")}</div> : null}
          </Dato>
        </>
      ) : null}

      <Dato nombre="ajustes.cuposSinCupo" que="ajustes.cuposSinCupoQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.cuposSinCupo")}
            opciones={SIN_CUPO.map((id) => ({ id, nombre: t(SIN_CUPO_CLAVES[id].nombre), desc: t(SIN_CUPO_CLAVES[id].que), ...(id === "otro" ? { rec: true } : {}) }))}
            valor={b.sin_cupo ?? "otro"}
            alElegir={(id) => cambiar({ ...b, sin_cupo: id as SinCupo })}
            reserva={SIN_CUPO.flatMap((id) => enOtros(SIN_CUPO_CLAVES[id].nombre))}
          />
        </div>
      </Dato>
    </section>
  );
}
