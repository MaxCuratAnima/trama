// Los subagentes de una sesión, colgando bajo su fila como un worker: descripción, modelo, estado, cuánto lleva,
// lo último que hizo en una línea y sus tokens. Al terminar, las primeras líneas de su informe y "Ver informe".
import { memo, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Subagente } from "../../electron/subagentes";
import { fuente } from "../datos/fuente";
import { t as tr } from "../i18n";
import { locale } from "../i18n/index";
import { useIdioma } from "../i18n/react";
import { duracion, pintorDura } from "../tiempo";
import { Punto, Reloj } from "./piezas";
import { activo, useSubagentes } from "./subagentes-datos";

/** Cuántos que ya cerraron se ven sin pedirlos: lo que sigue está tras "N anteriores". */
const VISTOS = 4;

const compacto = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const quieto = (s: number) => (s < 60 ? `${Math.max(0, Math.round(s))} s` : duracion(s));

const Fila = memo(function Fila({ u, vivo }: { u: Subagente; vivo: boolean }) {
  useIdioma();
  const [abierto, setAbierto] = useState(false);
  const [entero, setEntero] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const dura = useMemo(() => pintorDura(u.inicio), [u.inicio]);
  const tipo = vivo ? "trab" : u.estado === "error" ? "fallo" : u.estado === "corriendo" ? "frenado" : "term";
  const estado = vivo ? tr("sub.corriendo") : u.estado === "error" ? tr("sub.error") : u.estado === "corriendo" ? tr("sub.sinNoticias") : tr("sub.terminado");
  const linea = u.estado === "terminado" ? (u.resultado?.split("\n").find((x) => x.trim()) ?? u.ultimo) : u.ultimo;
  const cuerpo = entero ?? (u.estado === "terminado" ? u.resultado : u.ultimo);
  const verInforme = () => {
    if (pidiendo) return;
    setPidiendo(true);
    void fuente.subagenteInforme(u.sid, u.id).then(
      (x) => {
        setEntero(x ?? u.resultado ?? "");
        setPidiendo(false);
      },
      () => setPidiendo(false),
    );
  };
  return (
    <li className="w sub" data-estado={vivo || u.estado !== "corriendo" ? u.estado : "obsoleto"} data-sub={u.id}>
      <button type="button" className="sub-fila" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <span className="sub-pt">
          <Punto tipo={tipo} clave={`sub:${u.id}`} />
        </span>
        <span className="sub-txt">
          <span className="sub-t">
            <span className="sub-desc">{u.descripcion}</span>
            {u.modelo ? <span className="sub-modelo">{u.modelo}</span> : null}
          </span>
          <span className="sub-s">
            <span className="sub-estado">{estado}</span>
            {vivo ? <Reloj pintor={dura} className="sub-dura" /> : <span className="sub-dura">{quieto(u.ultimo_en - u.inicio)}</span>}
            {u.tokens > 0 ? <span className="sub-tok">{tr("sub.tokens", { n: compacto(u.tokens) })}</span> : null}
            {!abierto && linea ? <span className="sub-ultimo">{linea}</span> : null}
          </span>
        </span>
        <ChevronDown className="chevron" size={11} strokeWidth={2} aria-hidden />
      </button>
      {abierto ? (
        <div className="sub-cuerpo">
          {cuerpo ? <pre className="sub-informe">{cuerpo}</pre> : <p className="sub-vacio">{tr("sub.sinTexto")}</p>}
          {u.estado === "terminado" && u.hay_mas && entero === null ? (
            <button type="button" className="sub-ver" onClick={verInforme} disabled={pidiendo}>
              {tr(pidiendo ? "sub.cargando" : "sub.verInforme")}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
});

export const Subagentes = memo(function Subagentes({ sid }: { sid: string }) {
  useIdioma();
  const lista = useSubagentes(sid);
  const [todos, setTodos] = useState(false);
  const { vivos, cerrados } = useMemo(() => {
    const ahora = Math.floor(Date.now() / 1000);
    const v = lista.filter((u) => activo(u, ahora));
    const c = lista.filter((u) => !activo(u, ahora)).sort((a, b) => b.ultimo_en - a.ultimo_en);
    return { vivos: v, cerrados: c };
  }, [lista]);
  if (!lista.length) return null;
  const cuantos = todos ? cerrados : cerrados.slice(0, VISTOS);
  const resto = cerrados.length - cuantos.length;
  return (
    <ul className="ramas subs" aria-label={tr("sub.lista")} data-subs={sid}>
      {vivos.map((u) => (
        <Fila key={u.id} u={u} vivo />
      ))}
      {cuantos.map((u) => (
        <Fila key={u.id} u={u} vivo={false} />
      ))}
      {resto > 0 || (todos && cerrados.length > VISTOS) ? (
        <li className="w pliegue">
          <button type="button" className="mini-pliegue" aria-expanded={todos} onClick={() => setTodos((x) => !x)}>
            {todos ? tr("sub.menos") : tr("sub.anteriores", { n: resto })}
            <ChevronDown className="chevron" size={11} strokeWidth={2} />
          </button>
        </li>
      ) : null}
    </ul>
  );
});
