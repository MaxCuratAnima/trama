// Ajustes: muestra con qué números corre todo y qué hace cada uno, en criollo.
// Se guardan al elegir el idioma, el tamaño de letra, las fuentes y los mensajes tiernos (preferencias.json). Con Guardar (una barra fija abajo,
// y Cancelar que vuelve a lo guardado), el plan, cuándo compacta Claude, los modelos y proveedores y el acceso desde
// el celular: AjustesEditar.tsx. El modelo con que se dicta (Handy) también se guarda al elegir (preferencias.json).
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { elegirApariencia } from "../apariencia";
import { VERSION } from "../datos/contrato";
import { MODELO_LARGE_V3, MODELO_TURBO, type ModelosDictado } from "../../electron/dictado-modelos";
import { fuente } from "../datos/fuente";
import { fuentePaneles, type Ajustes as Datos } from "../datos/paneles";
import { Selector, type Opcion } from "../hilo/Selector";
import { MODO } from "../modo";
import { cambiarIdioma, esIdioma, idioma, t, textoMain, type ClaveSola } from "../i18n";
import { abrirAtajos } from "./Atajos";
import { abrirBienvenida } from "./Bienvenida";
import { BarraGuardar, Celular, PlanYRed } from "./AjustesEditar";
import { AjustesCuentas } from "./AjustesCuentas";
import { AjustesExtensiones } from "./AjustesExtensiones";
import { AjustesModelos } from "./AjustesModelos";
import { Compactar } from "./AjustesCompactar";
import { IcAtajos, IcAviso, IcCodigo, ICONO, IcIdioma, IcLetra, IcTiernos, IcTipografia } from "../ui/iconos";
import { AjustesMarco, Cat } from "./AjustesNav";
import { ErrorCarga } from "./ErrorCarga";
import { useIdioma } from "../i18n/react";
import { enOtros, Fijo } from "../i18n/Fijo";
import { cambiarTiernos } from "../hilo/tierno-datos";
import { useTiernos } from "../hilo/Tierno";
import { alCambiarAvisarEspera, avisarEspera, cambiarAvisarEspera } from "../espera";
import { mensaje } from "../puente";
import { alCambiarApariencia, apariencia, FUENTES, LETRA_DEF, LETRA_MAX, LETRA_MIN, MONOS, type Fuente } from "../tipografia";

/** Cada idioma con su nombre en ese idioma (así lo encuentra quien no lee el otro). */
const IDIOMAS: Opcion[] = [
  { id: "en", nombre: "English", desc: "" },
  { id: "es", nombre: "Español", desc: "" },
];

/** Cambia en el momento (sin reiniciar) y se guarda en preferencias.json. */
function elegirIdioma(id: string) {
  if (!esIdioma(id) || id === idioma()) return;
  cambiarIdioma(id);
  void fuente.guardarIdioma(id);
}

const LETRAS = Array.from({ length: LETRA_MAX - LETRA_MIN + 1 }, (_, i) => LETRA_MIN + i);

/** Cada fuente escrita en ella misma; la primera es la de la maqueta (default). */
const opcionesFuente = (fuentes: readonly Fuente[]): Opcion[] =>
  fuentes.map((f, i) => ({
    id: f.id,
    nombre: f.nombre ?? t("ajustes.fuenteSistema"),
    desc: f.nombre === null ? t("ajustes.fuenteSistemaQue") : "",
    rec: i === 0,
    fuente: f.pila,
  }));

/** Tamaño de letra y fuentes: se aplican al toque a toda la app y se guardan en preferencias.json. */
function Apariencia() {
  const a = useSyncExternalStore(alCambiarApariencia, apariencia);
  return (
    <>
      <Dato nombre="ajustes.letra" que="ajustes.letraQue" icono={<IcLetra {...ICONO} />}>
        <div className="pn-letra" role="radiogroup" aria-label={t("ajustes.letra")}>
          {LETRAS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === a.letra}
              aria-label={t("ajustes.letraPx", { n })}
              data-def={n === LETRA_DEF ? "" : undefined}
              onClick={() => elegirApariencia({ letra: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </Dato>
      <Dato nombre="ajustes.fuente" que="ajustes.fuenteQue" icono={<IcTipografia {...ICONO} />}>
        <div className="pn-sel pn-abajo">
          <Selector
            etiqueta={t("ajustes.fuente")}
            opciones={opcionesFuente(FUENTES)}
            valor={a.fuente}
            alElegir={(fuente) => elegirApariencia({ fuente })}
            abierto={MODO.variante === "fuente"}
            reserva={enOtros("ajustes.fuenteSistema")}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.mono" que="ajustes.monoQue" icono={<IcCodigo {...ICONO} />}>
        <div className="pn-sel pn-abajo">
          <Selector
            etiqueta={t("ajustes.mono")}
            opciones={opcionesFuente(MONOS)}
            valor={a.mono}
            alElegir={(mono) => elegirApariencia({ mono })}
            abierto={MODO.variante === "mono"}
            reserva={enOtros("ajustes.fuenteSistema")}
          />
        </div>
      </Dato>
    </>
  );
}

/** La notificación de "te espera": igual, al toque y a preferencias.json. */
function elegirAvisarEspera(id: string) {
  const si = id === "si";
  cambiarAvisarEspera(si);
  fuente.guardarAvisarEspera(si);
}

/** Los mensajes tiernos (B17): igual, al toque y a preferencias.json. */
function elegirTiernos(id: string) {
  const si = id === "si";
  cambiarTiernos(si);
  fuente.guardarTiernos(si);
}

/**
 * Una fila de Ajustes. El nombre va en un renglón (cortado con "…" y entero en el
 * tooltip) y la explicación reserva el alto del idioma más largo: cambiar de
 * idioma no mueve ninguna fila (B21).
 */
function Dato({ nombre, que, icono, children }: { nombre: ClaveSola; que: ClaveSola; icono?: ReactNode; children: ReactNode }) {
  return (
    <div className="pn-dato" data-opc={nombre}>
      <div className="pn-dato-id">
        {icono ? <span className="ui-fila-ico" aria-hidden="true">{icono}</span> : null}
        <div className="pn-dato-txt">
          <div className="pn-nom" data-tip={t(nombre)}>
            {t(nombre)}
          </div>
          <Fijo k={que} bloque className="pn-que" />
        </div>
      </div>
      <div className="pn-val">{children}</div>
    </div>
  );
}

export function Ajustes() {
  useIdioma();
  const [a, setA] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tiernos = useTiernos();
  const avisar = useSyncExternalStore(alCambiarAvisarEspera, avisarEspera);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    fuentePaneles.ajustes().then(
      (r) => {
        if (!vivo) return;
        if (r.version !== VERSION) setError(t("error.version", { que: t("panel.ajustes"), v: r.version, conozco: VERSION }));
        else setA(r);
      },
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [intento]);

  // El idioma, la letra y las fuentes van siempre, aunque los datos no hayan llegado o hayan fallado.
  const app = (
    <section className="pn-sec">
      <h2 className="pn-h">{t("ajustes.aplicacionH")}</h2>
      <Dato nombre="ajustes.idioma" que="ajustes.idiomaQue" icono={<IcIdioma {...ICONO} />}>
        <div className="pn-sel">
          <Selector etiqueta={t("ajustes.idioma")} opciones={IDIOMAS} valor={idioma()} alElegir={elegirIdioma} reserva={[]} />
        </div>
      </Dato>
      <Apariencia />
      <Dato nombre="ajustes.tiernos" que="ajustes.tiernosQue" icono={<IcTiernos {...ICONO} />}>
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.tiernos")}
            opciones={[
              { id: "si", nombre: t("ajustes.tiernosSi"), desc: "" },
              { id: "no", nombre: t("ajustes.tiernosNo"), desc: "" },
            ]}
            valor={tiernos ? "si" : "no"}
            alElegir={elegirTiernos}
            reserva={[...enOtros("ajustes.tiernosSi"), ...enOtros("ajustes.tiernosNo")]}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.avisarEspera" que="ajustes.avisarEsperaQue" icono={<IcAviso {...ICONO} />}>
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.avisarEspera")}
            opciones={[
              { id: "si", nombre: t("ajustes.tiernosSi"), desc: "" },
              { id: "no", nombre: t("ajustes.tiernosNo"), desc: "" },
            ]}
            valor={avisar ? "si" : "no"}
            alElegir={elegirAvisarEspera}
            reserva={[...enOtros("ajustes.tiernosSi"), ...enOtros("ajustes.tiernosNo")]}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.atajos" que="ajustes.atajosQue" icono={<IcAtajos {...ICONO} />}>
        <button type="button" className="btn2" onClick={abrirAtajos}>
          <Fijo k="ajustes.atajosVer" />
        </button>
      </Dato>
      <Dato nombre="ajustes.bienvenida" que="ajustes.bienvenidaQue">
        <button type="button" className="btn2" onClick={abrirBienvenida}>
          <Fijo k="bv.ajustesVer" />
        </button>
      </Dato>
    </section>
  );

  // Mismo lugar en el árbol con o sin datos: el selector no se remonta cuando llegan. Cada bloque queda montado aunque su
  // categoría no se vea (AjustesNav.tsx): los borradores que se guardan con la barra de abajo no se pierden al cambiar de lugar.
  return (
    <>
      <AjustesMarco>
        <Cat id="general">
          {a ? <Fijo k="ajustes.nota" bloque className="pn-nota" /> : null}
          {app}
        </Cat>

        {/* El aviso de carga va fuera de toda categoría: se ve estés donde estés, no sólo en Cupos. */}
        {error ? (
          <ErrorCarga
            error={error}
            alReintentar={() => {
              setError(null);
              setIntento((n) => n + 1);
            }}
          />
        ) : !a ? (
          <div className="pn-aviso">{t("ajustes.leyendo")}</div>
        ) : (
          <Numeros a={a} />
        )}
        <Cat id="modelos" orden={3}>
          <Dictado />
        </Cat>
        <Cat id="cuentas">
          <AjustesCuentas Dato={Dato} />
        </Cat>
        <Cat id="extensiones">
          <AjustesExtensiones Dato={Dato} />
        </Cat>
        <AjustesModelos Dato={Dato} plan={a?.plan ?? null} />
        <Celular Dato={Dato} />
      </AjustesMarco>
      <BarraGuardar />
    </>
  );
}

/** Para qué sirve cada uno de los que Trama recomienda (los demás, los que Handy ya tiene bajados, sin explicación). */
const QUE_DICTADO: Record<string, ClaveSola> = { [MODELO_TURBO]: "ajustes.dictadoTurbo", [MODELO_LARGE_V3]: "ajustes.dictadoLarge" };

/**
 * El modelo de Handy con que se transcribe lo que se dicta en la caja de un líder. Se guarda al elegir; rige desde la
 * próxima grabación. Uno sin bajar se ve pero no se elige (Handy no descarga nada al transcribir).
 */
function Dictado() {
  const [d, setD] = useState<ModelosDictado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fuente.dictadoModelos().then(
      (r) => vivo && setD(r),
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, []);

  const elegir = (id: string) => {
    if (!d || id === d.elegido) return;
    const antes = d;
    setD({ ...d, elegido: id });
    setError(null);
    fuente.elegirDictadoModelo(id).then(setD, (e) => {
      setD(antes);
      setError(mensaje(e));
    });
  };

  const opciones: Opcion[] = (d?.modelos ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    desc: !m.bajado ? t("ajustes.dictadoSinBajar") : QUE_DICTADO[m.id] ? t(QUE_DICTADO[m.id]) : "",
    rec: m.id === MODELO_TURBO,
    deshabilitada: !m.bajado && m.id !== d?.elegido,
  }));

  return (
    <section className="pn-sec">
      <h2 className="pn-h">{t("ajustes.dictadoH")}</h2>
      <Dato nombre="ajustes.dictado" que="ajustes.dictadoQue">
        <div className="pn-sel">
          <Selector etiqueta={t("ajustes.dictado")} opciones={opciones} valor={d?.elegido ?? ""} alElegir={elegir} disabled={!d} reserva={[]} abierto={MODO.variante === "dictado"} />
        </div>
        {d && (d.motor === null || d.motor === "windows") ? (
          <div className="pn-alt">
            <span>{t(d.motor === null ? "ajustes.dictadoSinHandy" : "ajustes.dictadoWindows")}</span>
          </div>
        ) : null}
      </Dato>
      {error ? <div className="pn-error" role="alert">{textoMain(error)}</div> : null}
    </section>
  );
}

function Numeros({ a }: { a: Datos }) {
  return (
    <>
      <Cat id="cupos">
        <PlanYRed inicial={a} Dato={Dato} />
      </Cat>
      <Cat id="general" orden={2}>
        <Compactar inicial={a} Dato={Dato} />
      </Cat>
    </>
  );
}
