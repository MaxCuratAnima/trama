// AskUserQuestion de un líder de la app, como la terminal de Claude Code: la
// tarjeta sobre la caja con las preguntas (1 a 4: chip con el header, opciones
// con etiqueta y descripción, una o varias, "Otro" con texto libre) y Enviar;
// ya contestada, la llamada en el trabajo del turno es un renglón con lo elegido.
// Lo puro (armar la respuesta, leer el resultado) está en ./preguntas.ts.
import { memo, useState, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { Pregunta } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { t as tr } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { alternar, alternarOtro, armar, completo, escribirOtro, NADA, resumenRespondidas, type Eleccion, type Respondida } from "./preguntas-datos";
import { contestado, type Pedido } from "./vivo";

/** Lo elegido en cada pedido sin mandar: cambiar de líder y volver no lo pierde. */
const elecciones = new Map<string, Eleccion[]>();

/** Lo que lee el modelo si el usuario no contesta (como Esc en la terminal). */
const NO_CONTESTA = "The user declined to answer the questions.";

function UnaPregunta({ q, e, cambiar, mandar }: { q: Pregunta; e: Eleccion; cambiar: (e: Eleccion) => void; mandar: () => void }) {
  const tecla = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.nativeEvent.isComposing) return;
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      mandar();
    }
  };
  const rol = q.multiSelect ? "checkbox" : "radio";
  return (
    <div className="pq">
      <div className="pq-cab">
        {q.header ? <span className="pq-chip">{q.header}</span> : null}
        {q.multiSelect ? <span className="pq-varias">{tr("pregunta.varias")}</span> : null}
      </div>
      <div className="pq-q">{q.question}</div>
      <div className="pq-ops" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.header || q.question}>
        {q.options.map((o) => {
          const si = e.elegidas.includes(o.label);
          return (
            <button key={o.label} type="button" role={rol} aria-checked={si} className="pq-op" data-multi={q.multiSelect ? "" : undefined} onClick={() => cambiar(alternar(q, e, o.label))}>
              <span className="pq-marca" />
              <span className="pq-txt">
                <span className="pq-l">{o.label}</span>
                {o.description ? <span className="pq-d">{o.description}</span> : null}
              </span>
            </button>
          );
        })}
        <button type="button" role={rol} aria-checked={e.otro !== null} className="pq-op" data-multi={q.multiSelect ? "" : undefined} onClick={() => cambiar(alternarOtro(q, e))}>
          <span className="pq-marca" />
          <span className="pq-txt">
            <span className="pq-l">{tr("pregunta.otro")}</span>
          </span>
        </button>
      </div>
      {e.otro !== null ? (
        <textarea
          className="pq-otro"
          rows={1}
          autoFocus
          value={e.otro}
          placeholder={tr("pregunta.otroPh")}
          aria-label={tr("pregunta.otro")}
          onChange={(ev) => cambiar(escribirOtro(e, ev.target.value))}
          onKeyDown={tecla}
        />
      ) : null}
    </div>
  );
}

/** La tarjeta del pedido: se manda con todas contestadas; "No contestar" lo niega. */
/** `n` de `total`: cuál de las tandas pendientes es (sólo se muestra una a la vez). */
export function PedidoPreguntas({ sid, p, preguntas, n = 1, total = 1 }: { sid: string; p: Pedido; preguntas: Pregunta[]; n?: number; total?: number }) {
  const [es, setEs] = useState<Eleccion[]>(() => elecciones.get(p.id) ?? preguntas.map(() => NADA));
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listo = completo(preguntas, es);
  const cambiar = (i: number, e: Eleccion) => {
    const n = es.map((x, k) => (k === i ? e : x));
    elecciones.set(p.id, n);
    setEs(n);
    setError(null);
  };
  const contestar = (ok: boolean) => {
    if (mandando || (ok && !listo)) return;
    setMandando(true);
    fuente
      .liderPermiso(sid, p.id, ok, ok ? undefined : NO_CONTESTA, ok ? armar(preguntas, es) : undefined)
      .then(() => {
        elecciones.delete(p.id);
        contestado(sid, p.id);
      })
      .catch((e) => {
        setMandando(false);
        setError(mensaje(e));
      });
  };
  return (
    <div className="pide" data-preguntas="">
      <div className="pide-t">
        {tr("pregunta.titulo")}
        {total > 1 ? <span className="pide-n">{tr("pregunta.tanda", { n, total })}</span> : null}
      </div>
      <div className="pide-cuerpo">
        {preguntas.map((q, i) => (
          <UnaPregunta key={q.question} q={q} e={es[i] ?? NADA} cambiar={(e) => cambiar(i, e)} mandar={() => contestar(true)} />
        ))}
      </div>
      <div className="pide-b">
        <button type="button" className="prim" data-texto="" disabled={!listo || mandando} data-tip={listo ? undefined : tr("pregunta.falta")} onClick={() => contestar(true)}>
          {tr("pregunta.enviar")}
        </button>
        <button type="button" className="btn2" disabled={mandando} onClick={() => contestar(false)}>
          {tr("pregunta.saltar")}
        </button>
      </div>
      {error ? <div className="caja-error" role="alert">{error}</div> : null}
    </div>
  );
}

/** La llamada ya contestada: "AskUserQuestion  Color: Red · Frutas: Apple, Pear"; abierta, pregunta por pregunta. */
export const LlamadaPreguntas = memo(function LlamadaPreguntas({ nombre, rs }: { nombre: string; rs: Respondida[] }) {
  useIdioma();
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="ll" data-abierta={abierta ? "" : undefined}>
      <button type="button" className="ll-b" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
        <ChevronRight className="ll-f" size={10} strokeWidth={2} />
        <span className="ll-n">{nombre}</span>
        <span className="ll-r">{resumenRespondidas(rs)}</span>
      </button>
      {abierta ? (
        <div className="ll-c pq-hecho">
          {rs.map((r) => (
            <div key={r.question} className="pq-r">
              <div className="pq-cab">
                {r.header ? <span className="pq-chip">{r.header}</span> : null}
                <span className="pq-q">{r.question}</span>
              </div>
              <div className="pq-a">{r.respuesta}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
