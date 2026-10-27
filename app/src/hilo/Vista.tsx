// El panel derecho: la vista de un hilo (B3). Migas con el estado, la
// conversación de `pa --hilo` (paginada hacia arriba, el trabajo de cada turno
// colapsado) y la línea de meta. A un worker no se le escribe (B12): se habla
// con su líder; la vista es de sólo lectura, con Parar mientras trabaja y
// "Pasárselo a un líder" si pide algo y no tiene líder.
// Un líder (sesión jefe) abre su chat (src/hilo/Lider.tsx).
import { ChipEspera } from "../barra/Espera";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Square } from "lucide-react";
import { comoSettle, GENERAL, VERSION, type Estado, type Hilo, type Lider, type Mensaje, type Tokens } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { Lado } from "./Lado";
import { MaquinaMigas } from "../barra/Maquina";
import { arrancando, nombreCarpeta } from "../barra/arbol";
import { useTitulos } from "../barra/titulos";
import { MODO } from "../modo";
import { latir } from "../barra/latido";
import type { Como, Salida } from "../barra/arbol";
import { AccionesWorker, CerrarLider, SettleLider } from "../barra/Fila";
import { cierre, Reloj, tareaDe, textoEstado, tipoDe } from "../barra/piezas";
import { Leyendo } from "./Leyendo";
import { t as tr } from "../i18n";
import { useIdioma } from "../i18n/react";
import { pintorBarato } from "../tiempo";
import { Contexto } from "./Contexto";
import { ChatLider } from "./Lider";
import { Marca } from "./Marca";
import { Texto } from "./Texto";
import { Hora, Turno } from "./Turno";
import { Sistema } from "./Sistema";
import { juntar, partirDecision, turnos, type Item } from "./turnos";
import { anotar, bajar, seguir } from "./seguir";
import { anotarScroll, faltaLlegar, guardarAncla, restaurarScroll, retomarScroll, soltarScroll } from "./scrollGuardado";
import { useCompactando } from "./compactando";
import { Compactando } from "./Posta";
import { useSeguir } from "./useSeguir";
import { mensaje } from "../puente";
import { usePasos } from "./usePasos";
import { VistaSubagente, VistaWorker, WorkerExtras } from "./Worker";
import { soltarSubagente, useSubagenteVisto } from "../barra/subagente-visto";

const puesto = (p: string) => (p === "aca" ? tr("vista.aca") : tr("vista.puesto", { p }));

/** Lo que manda la caja de un líder: texto, modelo y esfuerzo. */
export type Envio = { texto: string; modelo: string; effort: string };

/** Scrolleando a menos de esto del tope se pide la página anterior. */
const MARGEN_PAGINA = 400;

type Props = {
  h: Hilo | null;
  /** El estado que se muestra (el optimista mientras corre un Cerrar). */
  estado: Estado | null;
  /** El Settle propio del worker (`salidaWorker`): terminó y no tiene líder a la vista. `null`, sin botones. */
  settle: Salida | null;
  /** Abierto un líder en vez de un hilo. */
  lider: Lider | null;
  /** El Settle del líder abierto: las ramas sin integrar, o `null` si no puede (responde o tiene workers vivos). */
  settleLider: number | null;
  /** Abierto el chat de un líder nuevo (todavía sin sesión). */
  liderNuevo: boolean;
  alLiderCreado: (sid: string, e: Envio) => void;
  /** /clear en la caja de un líder: uno nuevo, limpio. */
  alLiderNuevo: () => void;
  alCerrarLider: (sid: string, motivo: string) => void;
  alSettleLider: (sid: string) => void;
  /** Los líderes y cómo abrir uno: el chat lleva al que siguió después de un relevo (B19). */
  lideres?: ReadonlyMap<string, Lider>;
  alAbrirLider?: (id: string) => void;
  barraAbierta: boolean;
  alAlternarBarra: () => void;
  alCerrar: (id: string, como?: Como) => void;
  /** "Pasárselo a un líder": abre uno nuevo con la caja llena. Rechaza si no se pudo armar el mensaje. */
  alPasar: (h: Hilo) => Promise<void>;
  /** Retomar (B22): un líder nuevo se hace cargo de lo que murió con commits. */
  alRetomar: (id: string) => void;
};

/**
 * La vista del panel derecho: la de siempre, o (al tocar un subagente en la barra) los pasos de ese subagente. La de siempre
 * queda montada y escondida: no pierde el scroll ni lo escrito en la caja del líder.
 */
export function Vista(props: Props) {
  useIdioma();
  const sub = useSubagenteVisto();
  return (
    <>
      <VistaPrincipal {...props} oculta={sub !== null} />
      {sub ? (
        <main className="hilo">
          <header className="migas">
            <Lado etq={props.barraAbierta ? tr("comun.ocultarBarra") : tr("comun.mostrarBarra")} alAlternar={props.alAlternarBarra} />
            <div className="ruta" data-desliza>
              <span>{tr("sub.pasosTitulo")}</span>
              <span>/</span>
              <b>{sub.descripcion}</b>
            </div>
            {sub.modelo ? <span className="sub-modelo">{sub.modelo}</span> : null}
            <span className="estado c-cerrado">
              <i />
              {sub.estado === "corriendo" ? tr("sub.corriendo") : sub.estado === "error" ? tr("sub.error") : tr("sub.terminado")}
            </span>
            <button type="button" className="btn2" onClick={soltarSubagente}>
              {tr("sub.volver")}
            </button>
          </header>
          <VistaSubagente key={`${sub.sid}:${sub.id}`} u={sub} />
        </main>
      ) : null}
    </>
  );
}

function VistaPrincipal({
  oculta,
  h,
  estado,
  settle,
  lider,
  settleLider,
  liderNuevo,
  alLiderCreado,
  alLiderNuevo,
  alCerrarLider,
  alSettleLider,
  lideres,
  alAbrirLider,
  barraAbierta,
  alAlternarBarra,
  alCerrar,
  alPasar,
  alRetomar,
}: Props & { oculta: boolean }) {
  const lado = barraAbierta ? tr("comun.ocultarBarra") : tr("comun.mostrarBarra");
  const titulos = useTitulos();
  const t = estado && h ? tipoDe(h, estado) : undefined;
  // Los pasos de un worker (src/hilo/Worker.tsx): `undefined` leyendo, `null` o sin transcript, la vista de siempre.
  const pasos = usePasos(h && estado ? h.id : null);
  const conPasos = pasos && pasos.hay ? pasos : null;
  const vive = estado === "trabajando" || estado === "colgado";
  useEffect(() => {
    if (t?.tipo === "nec") latir();
  }, [t]);

  return (
    <main className="hilo" style={oculta ? { display: "none" } : undefined}>
      <header className="migas">
        <Lado etq={lado} alAlternar={alAlternarBarra} />
        {h && estado ? (
          <>
            <div className="ruta" data-desliza>
              <span>{nombreCarpeta(h.proyecto, MODO.usuario, tr("barra.home"), titulos[h.proyecto])}</span>
              <span>/</span>
              <b>{tareaDe(h)}</b>
            </div>
            <MaquinaMigas maquina={h.maquina} />
            <span className={`estado c-${t?.tipo ?? "cerrado"}`}>
              <i>{t?.tipo === "nec" ? <span className="halo" /> : null}</i>
              {textoEstado(h, estado) ?? cierre(estado)}
            </span>
            {conPasos ? <WorkerExtras h={h} vista={conPasos} vive={vive} /> : null}
          </>
        ) : lider || liderNuevo ? (
          <>
            <div className="ruta" data-desliza>
              <span>{nombreCarpeta(lider?.proyecto ?? GENERAL, MODO.usuario, tr("barra.home"), titulos[lider?.proyecto ?? GENERAL])}</span>
              <span>/</span>
              <b>{lider?.nombre ?? tr("lider.nuevo")}</b>
            </div>
            <MaquinaMigas maquina={lider?.maquina} />
            {lider?.espera && !lider.ocupado && !lider.caido ? <ChipEspera espera={lider.espera} /> : null}
          </>
        ) : null}
        {/* Quieto, Settle (a uno de la app también lo cierra); respondiendo, Cerrar líder (sólo los de la app). */}
        {!h && lider && settleLider !== null ? (
          <SettleLider
            key={lider.id}
            l={lider}
            ramas={settleLider}
            alSettle={alSettleLider}
            className="btn2"
            armado={MODO.captura === "settle-confirmar"}
          />
        ) : !h && lider?.origen === "app" ? (
          <CerrarLider key={lider.id} l={lider} alCerrar={alCerrarLider} className="btn2" />
        ) : null}
      </header>
      {h && estado && pasos === undefined ? (
        <Leyendo key={h.id} />
      ) : h && estado && conPasos ? (
        <VistaWorker key={h.id} h={h} estado={estado} vista={conPasos} settle={settle} alCerrar={alCerrar} alRetomar={alRetomar} alPasar={alPasar} />
      ) : h && estado ? (
        <Cuerpo key={h.id} h={h} estado={estado} settle={settle} alCerrar={alCerrar} alRetomar={alRetomar} alPasar={alPasar} />
      ) : lider || liderNuevo ? (
        <ChatLider
          key={lider?.id ?? "nuevo"}
          l={lider}
          alCreado={alLiderCreado}
          alNuevo={alLiderNuevo}
          lideres={lideres}
          alAbrirLider={alAbrirLider}
          archivar={
            // Si no se puede retomar: Archivar; con algún worker todavía trabajando, al menos sacarlo de la barra.
            !lider?.caido ? null : settleLider !== null ? (
              <SettleLider l={lider} ramas={settleLider} alSettle={alSettleLider} className="btn2" />
            ) : (
              <CerrarLider l={lider} alCerrar={alCerrarLider} className="btn2" quitar />
            )
          }
        />
      ) : (
        <div className="vacio">
          <span data-desliza>{tr("vista.elegi")}</span>
        </div>
      )}
    </main>
  );
}

type Pagina = { mensajes: Mensaje[]; desde: number; hasta: number; usage: Tokens | null; sinTranscript: boolean; transcript: string | null };

type PropsCuerpo = Pick<Props, "settle" | "alCerrar" | "alRetomar" | "alPasar"> & { h: Hilo; estado: Estado };

function Cuerpo({ h, estado, settle, alCerrar, alRetomar, alPasar }: PropsCuerpo) {
  const [pag, setPag] = useState<Pagina | null>(null);
  const idioma = useIdioma();
  const [error, setError] = useState<string | null>(null);
  // El error de Parar o de Pasárselo, abajo.
  const [errorPie, setErrorPie] = useState<string | null>(null);
  const [parando, setParando] = useState(false);
  const [pasando, setPasando] = useState(false);
  const zona = useRef<HTMLDivElement>(null);
  // Qué hacer con el scroll después de pintar: al fondo, mantener lo que se ve
  // al anteponer una página (distancia al fondo), o nada.
  const scroll = useRef<{ tipo: "fondo" } | { tipo: "mantener"; alFondo: number } | null>({ tipo: "fondo" });
  const pidiendo = useRef(false);
  // Pegado al fondo mientras llega contenido; si el usuario sube, se suelta (src/hilo/seguir.ts).
  const seg = useSeguir(zona);

  // Mientras trabaja, Parar.
  const vive = estado === "trabajando" || estado === "colgado";
  // En cola: se la puede Parar, pero todavía no trabaja: sin el "turno en curso" de la frase que rota.
  const espera = estado === "trabajando" && h.en_cola;
  // Compactando su contexto (la marca del hook): la figurita al final de la conversación.
  const compacta = useCompactando(vive ? h.id : null);

  // Cada relectura de la lista trae un `h` nuevo: la conversación depende sólo del id.
  const actual = useRef(h);
  actual.current = h;
  const leer = useCallback(
    async (antes: number | null) => {
      const r = await fuente.conversacion(actual.current, antes);
      if (r.version !== VERSION) throw new Error(tr("error.version", { que: "pa --hilo", v: r.version, conozco: VERSION }));
      return r;
    },
    [h.id],
  );

  // La última página: al abrir, cuando `pa` avisa algo de este hilo y cuando cambia su estado.
  const recargar = useCallback(() => {
    leer(null).then(
      (r) => {
        setError(null);
        setPag((p) => {
          // Si lo nuevo no empalma con lo que había (llegaron más de una página), se tira lo viejo.
          const empalma = p && r.desde <= p.hasta;
          scroll.current = seg.pegado ? { tipo: "fondo" } : null;
          return {
            mensajes: empalma ? juntar(p.mensajes, r.mensajes) : r.mensajes,
            desde: empalma ? Math.min(p.desde, r.desde) : r.desde,
            hasta: r.hasta,
            usage: r.usage,
            sinTranscript: r.transcript === null,
            transcript: r.transcript,
          };
        });
      },
      (e) => setError(mensaje(e)),
    );
  }, [leer, seg]);

  useEffect(recargar, [recargar, estado]);
  useEffect(() => fuente.alEvento((ids) => ids.includes(h.id) && recargar()), [h.id, recargar]);

  const anterior = useCallback(() => {
    const z = zona.current;
    if (!pag || pag.desde <= 0 || pidiendo.current || !z) return;
    pidiendo.current = true;
    leer(pag.desde).then(
      (r) => {
        pidiendo.current = false;
        const z = zona.current;
        scroll.current = z ? { tipo: "mantener", alFondo: z.scrollHeight - z.scrollTop } : null;
        setPag((p) => p && { ...p, mensajes: juntar(r.mensajes, p.mensajes), desde: Math.min(p.desde, r.desde) });
      },
      (e) => {
        pidiendo.current = false;
        setError(mensaje(e));
      },
    );
  }, [pag, leer]);

  useLayoutEffect(() => {
    const z = zona.current;
    const s = scroll.current;
    scroll.current = null;
    if (!z || !pag) return;
    // Al abrir tras un reinicio, la conversación vuelve a donde el usuario la dejó (src/hilo/scrollGuardado.ts).
    if (restaurarScroll(z, seg, h.id, pag.desde > 0)) {
      // ya está
    } else if (s?.tipo === "fondo") bajar(z, seg);
    else if (s?.tipo === "mantener") {
      z.scrollTop = z.scrollHeight - s.alFondo;
      anotar(z, seg);
    } else seguir(z, seg);
    if (!seg.pegado) anotarScroll(h.id, z);
    // Si la página no llena la pantalla no hay scroll que la pida: se pide sola.
    if (pag.desde > 0 && (z.scrollHeight <= z.clientHeight + MARGEN_PAGINA || faltaLlegar(h.id))) anterior();
  }, [pag, anterior, seg]);

  // Volver a un hilo que ya estuvo abierto en esta sesión: donde el usuario lo dejó (abajo del todo, si estaba abajo).
  useLayoutEffect(() => {
    const z = zona.current;
    if (!z) return;
    retomarScroll(h.id);
    return () => guardarAncla(h.id, z, seg.pegado);
  }, [h.id]);

  // Sin transcript (o en vuelo): lo que dice la fila.
  const items = useMemo((): Item[] => {
    if (pag && pag.mensajes.length) return turnos(pag.mensajes, pag.transcript);
    if (!pag) return [];
    // Recién lanzado no se sabe su tarea todavía: no se la inventa ni se escribe "Arrancando…" como si la hubiera pedido el usuario.
    const its: Item[] = h.tarea || !arrancando(h, Math.floor(Date.now() / 1000)) ? [{ tipo: "yo", key: "tarea", texto: tareaDe(h), ts: h.inicio }] : [];
    if ((vive && !espera) || h.resultado)
      its.push({
        tipo: "turno",
        key: "resultado",
        pasos: [],
        texto: vive ? null : h.resultado,
        desde: h.inicio,
        hasta: h.duracion_s == null ? null : h.inicio + h.duracion_s,
      });
    return its;
  }, [pag, vive, espera, h, idioma]);
  let ultimoTurno = items.length - 1;
  while (ultimoTurno >= 0 && items[ultimoTurno].tipo !== "turno") ultimoTurno--;

  const parar = () => {
    if (parando) return;
    setParando(true);
    setErrorPie(null);
    fuente.parar(h).catch((e) => {
      setParando(false);
      setErrorPie(mensaje(e));
    });
  };

  const pasar = () => {
    if (pasando) return;
    setPasando(true);
    setErrorPie(null);
    alPasar(h).catch((e) => {
      setPasando(false);
      setErrorPie(mensaje(e));
    });
  };

  const barato = useMemo(() => pintorBarato(h.cache_vence, h.cache_frio !== null), [h]);
  // `decision` sólo llega acá sin líder (con líder se ve "Terminó", `estadoVisto`).
  const decide = estado === "decision";
  // La pregunta entera sale de la última respuesta (la de `pa` viene en un renglón y
  // recortada); si no se encuentra, la de `pa`.
  const ultimo = ultimoTurno >= 0 ? items[ultimoTurno] : null;
  const partida = decide && ultimo?.tipo === "turno" && ultimo.texto ? partirDecision(ultimo.texto) : null;
  const pregunta = partida?.decision ?? h.decision;

  return (
    <>
      <div
        className="conv-zona"
        ref={zona}
        onWheel={() => soltarScroll(h.id)}
        onPointerDown={() => soltarScroll(h.id)}
        onKeyDown={() => soltarScroll(h.id)}
        onScroll={(e) => {
          if (pag) anotarScroll(h.id, e.currentTarget);
          if (e.currentTarget.scrollTop < MARGEN_PAGINA) anterior();
        }}
      >
        <div className="conv" data-desliza>
          {pag && pag.desde > 0 ? <div className="conv-mas">{tr("vista.anteriores")}</div> : null}
          {!pag && !error ? <Leyendo /> : null}
          {items.map((x, i) =>
            x.tipo === "yo" ? (
              <Fragment key={x.key}>
                <Marca k={x.key} />
                <div className="yo">
                  <Texto texto={x.texto} propio />
                </div>
                {x.ts !== null ? <Hora ts={x.ts} der /> : null}
              </Fragment>
            ) : x.tipo === "sistema" ? (
              <Fragment key={x.key}>
                <Marca k={x.key} />
                <Sistema s={x.s} />
              </Fragment>
            ) : (
              <Fragment key={x.key}>
                <Marca k={x.key} />
                <Turno t={partida && i === ultimoTurno ? { ...x, texto: partida.antes || null } : x} vivo={vive && i === ultimoTurno} semilla={h.id} />
              </Fragment>
            ),
          )}
          {compacta !== null ? <Compactando desde={compacta} /> : null}
          {decide && pregunta ? (
            <div className="pregunta">
              <div className="q">{tr("estado.decision")}</div>
              <Texto texto={pregunta} />
            </div>
          ) : null}
          {error ? (
            <div className="lista-aviso" data-error="" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="caja-zona solo-lectura" data-desliza>
        {/* Vivo, Parar al medio; terminado, cómo terminó y su Settle (o Quitar). */}
        <div className="pie-worker" data-fin={vive || decide ? undefined : ""}>
          {vive ? (
            <button type="button" className="prim" data-texto="" data-parar disabled={parando} onClick={parar}>
              <Square size={12} strokeWidth={2.4} fill="currentColor" />
              {parando ? tr("accion.parando") : tr("accion.parar")}
            </button>
          ) : decide ? (
            <button type="button" className="prim" data-texto="" data-pasar data-tip={tr("vista.pasarTip")} disabled={pasando} onClick={pasar}>
              {pasando ? tr("vista.pasando") : tr("vista.pasar")}
            </button>
          ) : (
            <span className={`estado c-${tipoDe(h, estado)?.tipo ?? "cerrado"}`}>
              <i />
              {textoEstado(h, estado) ?? cierre(estado)}
            </span>
          )}
          {settle && !vive ? <AccionesWorker key={h.id} id={h.id} salida={settle} como={comoSettle(h)} alCerrar={alCerrar} alRetomar={alRetomar} className="btn2" /> : null}
        </div>
        {errorPie ? <div className="caja-error" role="alert">{errorPie}</div> : null}
        <div className="meta">
          {pag?.usage ? <Contexto usage={pag.usage} modelo={h.modelo} vence={vive ? null : h.cache_vence} frio={h.cache_frio !== null} lado="izq" /> : null}
          {h.puesto ? <span>{puesto(h.puesto)}</span> : null}
          <span>{h.rama ?? (h.en_cola || arrancando(h, Math.floor(Date.now() / 1000)) ? "…" : tr("comun.sinRama"))}</span>
          {h.cache_vence !== null && !vive ? <Reloj pintor={barato} /> : null}
        </div>
      </div>
    </>
  );
}
