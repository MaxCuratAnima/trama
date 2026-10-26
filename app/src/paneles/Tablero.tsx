// La pestaña Tablero: los pendientes del usuario (el CLI `tablero`) como un kanban. Arriba, el alta
// rápida a la bandeja; después el filtro por proyecto y el buscador; abajo las columnas, cada una
// con su scroll (las largas pintan sólo las tarjetas cercanas a lo visible). Una tarjeta se lleva
// con el mouse a otra columna (`tablero mover`) y con un clic abre su detalle a la derecha (hecho,
// posponer, tirar). La vista Proyectos lista todos por días sin tocar; un clic filtra el kanban.
// Todo es optimista: la tarjeta se mueve ya y, si el CLI falla, vuelve con el error arriba.
// Se actualiza sola cuando el CLI reescribe `vista.json` (un item cargado por voz aparece solo).
// Iniciar (el ▶ de una tarjeta, el botón del detalle, o marcar varias e "Iniciar N"): muestra a
// quién va cada tarea y, al enviar, un líder de su proyecto las recibe y pasan a "en curso".
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as PunteroReact,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronsLeft, ChevronsRight, Copy, Play, Plus, Search, X } from "lucide-react";
import { nombreCarpeta } from "../barra/arbol";
import { copiarConAviso } from "../copiar";
import { useTitulos } from "../barra/titulos";
import { GENERAL } from "../datos/contrato";
import { fuenteTablero } from "../datos/fuenteTablero";
import type { LiderAviso } from "../datos/avisar";
import { NUEVO, agrupar, cambiaElModelo, claveGrupo, destinoDe, promptIniciar, type Grupo, type LiderDe } from "../datos/iniciar";
import {
  ABIERTAS,
  altoDe,
  aplicar,
  buscar,
  edad,
  filasProyectos,
  filtrar,
  nombres,
  numero,
  rango,
  tono,
  tramos,
  type Abierta,
  type Columna,
  type FilaProyecto,
  type Item,
  type ItemId,
  type Tablero as Datos,
} from "../datos/tablero";
import { useFoco } from "../foco";
import { Selector, type Opcion } from "../hilo/Selector";
import { MODELOS, modeloDe } from "../hilo/opciones";
import { locale, t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { MaquinaMigas } from "../barra/Maquina";
import { hayVarias, nombreMaquina, opcionesMaquina, puedeMaquina, useMaquinas } from "../maquinas";
import { Vacio } from "./Vacio";
import "./tablero-estilos.css";

const NOMBRE: Record<Columna, ClaveSola> = {
  bandeja: "tablero.col.bandeja",
  sigue: "tablero.col.sigue",
  "en-curso": "tablero.col.en-curso",
  "espera-dueno": "tablero.col.espera-dueno",
  "espera-externo": "tablero.col.espera-externo",
  ideas: "tablero.col.ideas",
  hecho: "tablero.col.hecho",
};

/** Las etapas que se saben decir en los dos idiomas; cualquier otra va como la escribe el registry. */
const ETAPA: Record<string, ClaveSola> = {
  activo: "tablero.etapa.activo",
  pausado: "tablero.etapa.pausado",
  idea: "tablero.etapa.idea",
  infra: "tablero.etapa.infra",
  retirado: "tablero.etapa.retirado",
  área: "tablero.etapa.area",
};

/** Lo hecho que se muestra: lo mismo que manda el main (electron/tablero.ts, `DIAS_HECHO`). */
const DIAS_HECHO = 7;
/** Cuánto se pinta de más arriba y abajo de lo visible de una columna, en rem. */
const MARGEN = 30;
/** Cuánto hay que mover el mouse apretado para que sea llevar la tarjeta y no un clic, en px. */
const UMBRAL_PX = 5;
/** Cuánto queda el tilde de "copiado". */
const COPIADO_MS = 1200;
/** El "sin proyecto" del alta y el "todos" del filtro (un nombre de proyecto no puede ser vacío). */
const NINGUNO = "";

type Vista = "tablero" | "proyectos";

/** Lo que el tablero necesita de la barra para Iniciar una tarea (los líderes son de ella). */
export type PropsTablero = {
  /** Con qué nombre anota el tablero cada carpeta de la barra (nombre del registry → slug). */
  carpetas: Readonly<Record<string, string>>;
  /** Los líderes de la app a los que se les puede escribir, con su carpeta. */
  lideres: readonly LiderDe[];
  /**
   * Manda `texto` a ese líder o, con `lider: null`, a uno nuevo en esa carpeta (`null`: Inicio).
   * Devuelve el id del líder; rechaza si no se pudo.
   */
  alIniciar: (x: { carpeta: string | null; lider: string | null; texto: string; modelo: string | null }) => Promise<string>;
  /** Deja a la vista la conversación de ese líder. */
  alAbrirLider: (sid: string) => void;
  /**
   * El tablero nuevo: deja `texto` armado en la caja de ese líder (o de uno nuevo en esa carpeta; `null`:
   * Inicio) y abre su conversación. No lo envía: El usuario elige el modo y aprieta enviar.
   */
  alRedactar: (x: { carpeta: string | null; lider: string | null; texto: string }) => void;
  /**
   * El tablero nuevo, "Responder y avisar": los líderes vivos (de la app o de una terminal) a los que se les puede escribir, de qué
   * líder es un worker (`pa:<id>` de la clave de un item) y cómo se le manda `texto` a uno (por su cola, como la caja). Rechaza si no se pudo.
   */
  avisar: { lideres: readonly LiderAviso[]; jefeDe: (worker: string) => string | null; alAvisar: (lider: string, texto: string) => Promise<void> };
};

const SIN_MARCAS: ReadonlySet<ItemId> = new Set();
/** "Sin elegir modelo": el del líder, o el de siempre si es uno nuevo (un id de modelo no puede ser vacío). */
const SIN_MODELO = "";

const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const columnaEn = (x: number, y: number) =>
  (document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-columna]")?.dataset.columna ?? null) as Columna | null;

export function Tablero({ carpetas, lideres, alIniciar, alAbrirLider }: Omit<PropsTablero, "alRedactar">) {
  useIdioma();
  const [datos, setDatos] = useState<Datos | null>(() => fuenteTablero.guardado());
  const [errorLeer, setErrorLeer] = useState<string | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [pend, setPend] = useState(() => new Map<ItemId, Columna | null>());
  const [vista, setVista] = useState<Vista>(MODO.captura === "tablero-proyectos" ? "proyectos" : "tablero");
  const [proyecto, setProyecto] = useState(NINGUNO);
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState<ItemId | null>(null);
  const [hechoAbierto, setHechoAbierto] = useState(false);
  const [parados, setParados] = useState(true);
  const [llevando, setLlevando] = useState<Item | null>(null);
  // Iniciar: lo marcado, lo que se está por mandar (la confirmación) y a quién eligió el usuario que vaya cada proyecto.
  const [marcadas, setMarcadas] = useState(SIN_MARCAS);
  const [porIniciar, setPorIniciar] = useState<readonly ItemId[] | null>(MODO.captura === "tablero-iniciar" ? [] : null);
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  // Proyecto → el modelo que eligió el usuario para sus tareas (`SIN_MODELO`: el de siempre).
  const [modelos, setModelos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  // La vuelta atrás de Iniciar: el detalle desde el que se pidió vuelve al cancelar, y lo elegido (líder, modelo) no se pierde.
  const [volverA, setVolverA] = useState<ItemId | null>(null);
  const cortado = useRef(false);
  // Lo escrito en "posponer hasta" del detalle sobrevive a cerrarlo para mirar otra cosa (Iniciar) y volver.
  const [escritoHasta, setEscritoHasta] = useState<{ id: ItemId; texto: string } | null>(null);
  const [verPospuestos, setVerPospuestos] = useState(MODO.captura === "tablero-pospuestos");
  const [retiradosAbiertos, setRetiradosAbiertos] = useState(MODO.captura === "tablero-proyectos");
  const buscado = useDeferredValue(texto);

  // Cada lectura lleva su número: si llegan cruzadas, queda la última pedida.
  const pedidas = useRef(0);
  const leer = useCallback(() => {
    const n = ++pedidas.current;
    return fuenteTablero.leer().then(
      (d) => {
        if (n !== pedidas.current) return;
        setDatos(d);
        setErrorLeer(null);
      },
      (e: Error) => {
        if (n === pedidas.current) setErrorLeer(e.message);
      },
    );
  }, []);

  useEffect(() => {
    void leer();
    return fuenteTablero.alCambiar(() => void leer());
  }, [leer]);

  /** La tarjeta va ya a `destino` (o se va: `null`); cuando el CLI contesta se relee y, si falló, vuelve. Dice si salió bien. */
  const actuar = useCallback(
    (id: ItemId, destino: Columna | null, que: () => Promise<void>) => {
      setFalla(null);
      setPend((m) => new Map(m).set(id, destino));
      return que()
        .then(
          () => leer().then(() => true),
          (e: Error) => {
            setFalla(e.message);
            return false;
          },
        )
        .finally(() =>
          setPend((m) => {
            if (m.get(id) !== destino) return m;
            const n = new Map(m);
            n.delete(id);
            return n;
          }),
        );
    },
    [leer],
  );

  const soltarEn = useCallback(
    (i: Item, destino: Columna) => {
      if (destino === i.columna) return;
      if (destino === "hecho") void actuar(i.id, "hecho", () => fuenteTablero.cerrar(i.id));
      else void actuar(i.id, destino, () => fuenteTablero.mover(i.id, destino));
    },
    [actuar],
  );

  const visto = useMemo(() => (datos ? aplicar(datos, pend) : null), [datos, pend]);
  // Las edades se calculan cuando llegan datos: nada de reloj corriendo.
  const ahora = useMemo(() => Date.now(), [datos]);
  const filtro = useMemo(() => ({ proyecto: proyecto || null, texto: buscado }), [proyecto, buscado]);
  const columnas = useMemo(
    () => (visto ? (Object.fromEntries(ABIERTAS.map((k) => [k, filtrar(visto.columnas[k], filtro)])) as Record<Abierta, Item[]>) : null),
    [visto, filtro],
  );
  const hecho = useMemo(() => (visto ? filtrar(visto.hecho, filtro) : []), [visto, filtro]);
  const lista = useMemo(() => (visto ? nombres(visto) : []), [visto]);
  const filas = useMemo(() => (visto ? filasProyectos(visto, parados) : { activos: [], retirados: [] }), [visto, parados]);
  const pospuestosVistos = useMemo(() => (visto ? filtrar(visto.pospuestosLista, filtro) : []), [visto, filtro]);
  const detalle = visto && abierto !== null ? buscar(visto, abierto) : null;
  const abiertos = visto ? ABIERTAS.reduce((s, k) => s + visto.columnas[k].length, 0) : 0;

  // --- Iniciar ----------------------------------------------------------------------
  // Lo que se cerró o se tiró mientras estaba marcado ya no cuenta.
  const viva = useCallback(
    (id: ItemId) => {
      const i = visto ? buscar(visto, id) : null;
      return i && i.columna !== "hecho" ? i : null;
    },
    [visto],
  );
  const nMarcadas = useMemo(() => [...marcadas].filter(viva).length, [marcadas, viva]);
  const grupos = useMemo(
    () => (porIniciar ? agrupar(porIniciar.map(viva).filter((i): i is Item => !!i), carpetas, lideres) : []),
    [porIniciar, viva, carpetas, lideres],
  );
  const marcar = useCallback(
    (id: ItemId) =>
      setMarcadas((m) => {
        const n = new Set(m);
        if (!n.delete(id)) n.add(id);
        return n;
      }),
    [],
  );
  /** Abre la confirmación con esas tareas (una sola: su ▶; varias: las marcadas). Lo ya elegido se queda; si venía del detalle de una, cancelar vuelve a él. */
  const pedirIniciar = useCallback((ids: readonly ItemId[], desde: ItemId | null = null) => {
    setAbierto(null);
    setFalla(null);
    setVolverA(desde);
    setPorIniciar(ids);
  }, []);
  const iniciarUna = useCallback((id: ItemId) => pedirIniciar([id], id), [pedirIniciar]);
  /** Cancelar (o Esc): no sale nada y se vuelve a donde se estaba. Con un envío en marcha, los proyectos que todavía no salieron no salen. */
  const cancelarIniciar = useCallback(() => {
    cortado.current = true;
    setPorIniciar(null);
    if (volverA !== null) setAbierto(volverA);
    setVolverA(null);
  }, [volverA]);

  /** Confirmado: cada grupo a su líder; lo que salió pasa a "en curso" y se abre el primer líder. */
  const enviar = async () => {
    if (enviando || !grupos.length) return;
    setEnviando(true);
    setFalla(null);
    cortado.current = false;
    let primero: string | null = null;
    let salieron = 0;
    const fallas: string[] = [];
    const movidas: Promise<boolean>[] = [];
    for (const g of grupos) {
      if (cortado.current) break;
      try {
        const sid = await alIniciar({
          carpeta: g.carpeta,
          lider: destinoDe(g, elegidos[claveGrupo(g)])?.id ?? null,
          texto: promptIniciar(g),
          modelo: modelos[claveGrupo(g)] || null,
          ...(g.maquina ? { maquina: g.maquina } : {}),
        });
        salieron++;
        primero ??= sid;
        const ids = new Set(g.items.map((i) => i.id));
        setMarcadas((m) => (ids.size && [...ids].some((id) => m.has(id)) ? new Set([...m].filter((id) => !ids.has(id))) : m));
        for (const i of g.items) if (i.columna !== "en-curso") movidas.push(actuar(i.id, "en-curso", () => fuenteTablero.mover(i.id, "en-curso")));
      } catch (e) {
        fallas.push(`${g.proyecto || t("tablero.sinProyecto")}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const movio = (await Promise.all(movidas)).every(Boolean);
    const aviso = cortado.current && salieron < grupos.length ? t("tablero.ini.cortado", { n: salieron, m: grupos.length }) : null;
    setEnviando(false);
    setPorIniciar(null);
    setVolverA(null);
    if (!fallas.length) {
      // Salió todo lo que había que sacar: lo elegido para esta tanda ya cumplió.
      setElegidos({});
      setModelos({});
    }
    // Si algo no salió, se queda acá con el error a la vista (el líder que sí arrancó está en la barra).
    if (fallas.length || aviso) setFalla([...fallas, ...(aviso ? [aviso] : [])].join(" · "));
    else if (movio && primero) alAbrirLider(primero);
  };

  // La captura de la confirmación: dos tareas de un proyecto y una de otro, de "Sigue".
  const capturada = useRef(false);
  useEffect(() => {
    if (MODO.captura !== "tablero-iniciar" || !datos || capturada.current) return;
    capturada.current = true;
    const s = datos.columnas.sigue;
    const otra = s.find((i) => i.proyecto !== s[0]?.proyecto);
    const ids = [s[0], s.find((i, k) => k > 0 && i.proyecto === s[0].proyecto), otra].flatMap((i) => (i ? [i.id] : []));
    setMarcadas(new Set(ids));
    setPorIniciar(ids);
  }, [datos]);

  // La captura del detalle: la primera tarjeta de "Te esperan".
  const detalleCapturado = useRef(false);
  useEffect(() => {
    if (MODO.captura !== "tablero-detalle" || !datos || detalleCapturado.current) return;
    detalleCapturado.current = true;
    setAbierto(datos.columnas["espera-dueno"][0]?.id ?? null);
  }, [datos]);

  // Esc con la confirmación o el detalle abiertos los cierra a ellos y no al panel (cada uno con `useFoco`: el de la barra ni se entera).

  // --- Llevar una tarjeta ---------------------------------------------------------
  // Con eventos de puntero y no con el arrastre nativo: la copia que sigue al mouse se mueve con
  // `transform` y no hay un arrastre de Wayland de por medio. Mientras se lleva no se renderiza
  // nada: la copia y la columna marcada se tocan directo en el DOM.
  const fantasma = useRef<HTMLDivElement>(null);
  const zona = useRef<HTMLDivElement>(null);
  const agarre = useRef<{ item: Item; x0: number; y0: number; dx: number; dy: number; x: number; y: number; ancho: number; vivo: boolean } | null>(null);
  const sobre = useRef<HTMLElement | null>(null);
  const soltar = useRef<() => void>(() => {});

  const marcarCol = (col: Columna | null) => {
    const a = agarre.current;
    const el = col && a && col !== a.item.columna ? document.querySelector<HTMLElement>(`[data-columna="${col}"]`) : null;
    if (el === sobre.current) return;
    sobre.current?.removeAttribute("data-sobre");
    el?.setAttribute("data-sobre", "");
    sobre.current = el;
  };

  const pintar = () => {
    const a = agarre.current;
    const f = fantasma.current;
    if (!a || !f) return;
    f.style.width = `${a.ancho}px`;
    f.style.transform = `translate3d(${a.x - a.dx}px, ${a.y - a.dy}px, 0)`;
    // Contra un borde, las columnas corren de costado (sólo mientras el mouse se mueve: sin reloj).
    const cols = zona.current;
    if (cols) {
      const c = cols.getBoundingClientRect();
      const borde = 2.5 * rem();
      if (a.x > c.right - borde) cols.scrollLeft += borde / 2;
      else if (a.x < c.left + borde) cols.scrollLeft -= borde / 2;
    }
    marcarCol(columnaEn(a.x, a.y));
  };
  // La copia recién montada va a donde está el mouse antes del primer pintado.
  useLayoutEffect(pintar, [llevando]);
  useEffect(() => () => soltar.current(), []);

  const agarrar = useCallback(
    (e: PunteroReact<HTMLElement>, item: Item) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      const caja = e.currentTarget.getBoundingClientRect();
      agarre.current = { item, x0: e.clientX, y0: e.clientY, dx: e.clientX - caja.left, dy: e.clientY - caja.top, x: e.clientX, y: e.clientY, ancho: caja.width, vivo: false };
      const mover = (ev: PointerEvent) => {
        const a = agarre.current;
        if (!a) return;
        a.x = ev.clientX;
        a.y = ev.clientY;
        if (!a.vivo) {
          if (Math.hypot(a.x - a.x0, a.y - a.y0) < UMBRAL_PX) return;
          a.vivo = true;
          setLlevando(a.item);
        }
        pintar();
      };
      const fin = () => {
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", arriba);
        window.removeEventListener("pointercancel", fin);
        window.removeEventListener("keydown", tecla, true);
        window.removeEventListener("blur", fin);
        marcarCol(null);
        agarre.current = null;
        soltar.current = () => {};
        setLlevando(null);
      };
      const arriba = (ev: PointerEvent) => {
        const a = agarre.current;
        fin();
        if (!a) return;
        // Sin haberla movido es un clic: abre el detalle.
        if (!a.vivo) return setAbierto(a.item.id);
        const destino = columnaEn(ev.clientX, ev.clientY);
        if (destino) soltarEn(a.item, destino);
      };
      const tecla = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.stopPropagation();
        fin();
      };
      soltar.current = fin;
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", arriba);
      window.addEventListener("pointercancel", fin);
      window.addEventListener("keydown", tecla, true);
      window.addEventListener("blur", fin);
    },
    [soltarEn],
  );

  const abrir = useCallback((id: ItemId) => setAbierto(id), []);
  const elegirProyecto = useCallback((p: string) => {
    setProyecto(p);
    setVista("tablero");
  }, []);
  /** Despostergar: el item vuelve ya a su columna; `ya` borra su `hasta`. */
  const traer = useCallback(
    (i: Item) => {
      const columna = (ABIERTAS as readonly string[]).includes(i.columna) ? (i.columna as Columna) : "bandeja";
      void actuar(i.id, columna, () => fuenteTablero.posponer(i.id, "ya"));
    },
    [actuar],
  );

  const opcionesFiltro = useMemo<Opcion[]>(
    () => [{ id: NINGUNO, nombre: t("tablero.todos"), desc: "" }, ...lista.map((p) => ({ id: p, nombre: p, desc: "", marca: <Punto proyecto={p} /> }))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lista, t("tablero.todos")],
  );

  if (!visto || !columnas)
    return <p className={errorLeer ? "pn-aviso pn-error" : "pn-aviso"}>{errorLeer ?? t("tablero.cargando")}</p>;

  const alAgregar = (texto: string, p: string | null, m?: string) => fuenteTablero.agregar(texto, p, m).then(leer);
  // Sin tablero todavía: el alta de arriba crea el primero (`tablero agregar` arma el tablero) y abajo se explica qué es.
  if (visto.sinVista)
    return (
      <div className="tb">
        <Alta proyectos={lista} alAgregar={alAgregar} alFallar={setFalla} />
        {falla || errorLeer ? (
          <p className="tb-falla" role="alert">
            <span>{falla ?? errorLeer}</span>
          </p>
        ) : null}
        <Vacio titulo={t("tablero.vaciaT")} texto={t("tablero.vaciaP")} />
      </div>
    );

  const filtrando = !!(proyecto || buscado.trim());
  return (
    <div className="tb">
      <Alta proyectos={lista} alAgregar={alAgregar} alFallar={setFalla} />
      <div className="tb-barra">
        <div className="tb-vistas" role="tablist">
          {(["tablero", "proyectos"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}>
              {t(v === "tablero" ? "tablero.vistaTablero" : "tablero.vistaProyectos")}
            </button>
          ))}
        </div>
        <div className="pn-abajo tb-filtro">
          <Selector etiqueta={t("tablero.filtro")} opciones={opcionesFiltro} valor={proyecto} alElegir={setProyecto} />
        </div>
        <label className="buscar tb-buscar">
          <Search size={14} strokeWidth={1.8} />
          <input value={texto} placeholder={t("tablero.buscarPh")} aria-label={t("tablero.buscarPh")} spellCheck={false} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <span className="tb-cuenta">
          {t("tablero.abiertos", { n: abiertos })}
          {visto.pospuestos ? (
            <>
              {" · "}
              <button type="button" className="tb-pos-b" aria-expanded={verPospuestos} data-tip={t("tablero.pos.ver")} onClick={() => setVerPospuestos((v) => !v)}>
                {t("tablero.pospuestos", { n: visto.pospuestos })}
              </button>
            </>
          ) : null}
        </span>
      </div>
      {falla || errorLeer || visto.aviso || visto.caidas.length ? (
        <p className="tb-falla" role="alert">
          <span>{[falla ?? errorLeer ?? visto.aviso, textoCaidas(visto.caidas)].filter(Boolean).join(" · ")}</span>
          {falla ? (
            <button type="button" aria-label={t("tablero.descartarError")} onClick={() => setFalla(null)}>
              <X size={13} strokeWidth={2} />
            </button>
          ) : null}
        </p>
      ) : null}
      {verPospuestos ? <Pospuestos items={pospuestosVistos} alTraer={traer} alCerrar={() => setVerPospuestos(false)} /> : null}
      {porIniciar ? (
        <Confirmar
          grupos={grupos}
          elegidos={elegidos}
          modelos={modelos}
          enviando={enviando}
          alElegir={(clave, lider) => setElegidos((e) => ({ ...e, [clave]: lider }))}
          alModelo={(clave, modelo) => setModelos((m) => ({ ...m, [clave]: modelo }))}
          alEnviar={() => void enviar()}
          alCancelar={cancelarIniciar}
        />
      ) : nMarcadas ? (
        <div className="tb-ini tb-ini-m">
          <span>{nMarcadas === 1 ? t("tablero.marcadas1") : t("tablero.marcadasN", { n: nMarcadas })}</span>
          <button type="button" className="btn2 tb-iniciar" data-primario="" onClick={() => pedirIniciar([...marcadas])}>
            <Play size={12} strokeWidth={2.2} />
            {t("tablero.iniciarN", { n: nMarcadas })}
          </button>
          <button type="button" className="btn2" onClick={() => setMarcadas(SIN_MARCAS)}>
            {t("tablero.desmarcarTodas")}
          </button>
        </div>
      ) : null}
      <div className="tb-cuerpo">
        {vista === "tablero" ? (
          <div ref={zona} className="tb-cols" data-llevando={llevando ? "" : undefined} data-marcando={nMarcadas ? "" : undefined}>
            {ABIERTAS.map((k) => (
              <Col
                key={k}
                k={k}
                items={columnas[k]}
                total={filtrando ? visto.columnas[k].length : null}
                ahora={ahora}
                activa={abierto}
                llevada={llevando?.id ?? null}
                marcadas={marcadas}
                alAgarrar={agarrar}
                alAbrir={abrir}
                alMarcar={marcar}
                alIniciar={iniciarUna}
              />
            ))}
            {hechoAbierto ? (
              <Col
                k="hecho"
                items={hecho}
                total={filtrando ? visto.hecho.length : null}
                ahora={ahora}
                activa={abierto}
                llevada={llevando?.id ?? null}
                marcadas={SIN_MARCAS}
                alAgarrar={agarrar}
                alAbrir={abrir}
                alPlegar={() => setHechoAbierto(false)}
              />
            ) : (
              <button type="button" className="tb-plegada" data-columna="hecho" aria-expanded="false" data-tip={t("tablero.hechoDias", { n: DIAS_HECHO })} onClick={() => setHechoAbierto(true)}>
                <ChevronsLeft size={14} strokeWidth={1.8} />
                <span className="tb-n">{hecho.length}</span>
                <span className="tb-vertical">{t(NOMBRE.hecho)}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="tb-proy" role="table">
            <div className="tb-pr tb-pr-h" role="row">
              <span role="columnheader">{t("tablero.proy.proyecto")}</span>
              <span role="columnheader">{t("tablero.proy.etapa")}</span>
              <button type="button" role="columnheader" aria-label={t("tablero.proy.orden")} data-tip={t("tablero.proy.orden")} onClick={() => setParados((p) => !p)}>
                {t("tablero.proy.dias")}
                {parados ? <ArrowDown size={11} strokeWidth={2} /> : <ArrowUp size={11} strokeWidth={2} />}
              </button>
              <span role="columnheader">{t("tablero.proy.abiertos")}</span>
              <span role="columnheader">{t("tablero.proy.espera")}</span>
            </div>
            {filas.activos.map((p) => (
              <FilaProy key={p.proyecto} p={p} alElegir={elegirProyecto} />
            ))}
            {filas.retirados.length ? (
              <>
                <button type="button" className="tb-pr-grupo" aria-expanded={retiradosAbiertos} data-tip={t("tablero.proy.retiradosTip")} onClick={() => setRetiradosAbiertos((v) => !v)}>
                  <ChevronsRight size={12} strokeWidth={1.8} data-abierto={retiradosAbiertos ? "" : undefined} aria-hidden="true" />
                  {t("tablero.proy.retirados", { n: filas.retirados.length })}
                </button>
                {retiradosAbiertos ? filas.retirados.map((p) => <FilaProy key={p.proyecto} p={p} alElegir={elegirProyecto} />) : null}
              </>
            ) : null}
          </div>
        )}
        {detalle ? (
          <Detalle
            key={detalle.id}
            item={detalle}
            ahora={ahora}
            hasta={escritoHasta?.id === detalle.id ? escritoHasta.texto : ""}
            alEscribirHasta={(texto) => setEscritoHasta({ id: detalle.id, texto })}
            alCerrar={() => setAbierto(null)}
            alMover={(c) => soltarEn(detalle, c)}
            alIniciar={() => iniciarUna(detalle.id)}
            alHecho={() => {
              setAbierto(null);
              void actuar(detalle.id, "hecho", () => fuenteTablero.cerrar(detalle.id));
            }}
            alTirar={() => {
              setAbierto(null);
              void actuar(detalle.id, null, () => fuenteTablero.tirar(detalle.id));
            }}
            alPosponer={(hasta) => {
              setAbierto(null);
              void actuar(detalle.id, null, () => fuenteTablero.posponer(detalle.id, hasta));
            }}
          />
        ) : null}
      </div>
      {/* En el body: un ancestro con `transform` le correría el `position: fixed`. */}
      {llevando
        ? createPortal(
            <div ref={fantasma} className="tb-fantasma" aria-hidden="true">
              <Cara i={llevando} ahora={ahora} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// --- Iniciar: qué se manda y a quién ------------------------------------------------

type PropsConfirmar = {
  grupos: Grupo[];
  /** `claveGrupo` → el líder que eligió el usuario (`NUEVO`: uno nuevo); sin elegir, el de siempre (`destinoDe`). */
  elegidos: Readonly<Record<string, string>>;
  /** `claveGrupo` → el modelo elegido (`SIN_MODELO`: el de siempre). */
  modelos: Readonly<Record<string, string>>;
  enviando: boolean;
  alElegir: (clave: string, lider: string) => void;
  alModelo: (clave: string, modelo: string) => void;
  alEnviar: () => void;
  alCancelar: () => void;
};

/** La confirmación: por proyecto, sus tareas (como van numeradas en el mensaje) y el líder que las recibe. */
function Confirmar({ grupos, elegidos, modelos, enviando, alElegir, alModelo, alEnviar, alCancelar }: PropsConfirmar) {
  const caja = useRef<HTMLDivElement>(null);
  // Es una barra, no un modal: Tab puede salir. Al cancelar o enviar, el foco vuelve al botón Iniciar de la barra de marcadas.
  useFoco(caja, { alCerrar: alCancelar, atrapar: false, ignorar: '[role="listbox"]', devolver: () => document.querySelector<HTMLElement>(".tb-ini-m .tb-iniciar") });
  const titulos = useTitulos();
  const maquinas = useMaquinas();
  const carpeta = (slug: string) => nombreCarpeta(slug, MODO.usuario, t("barra.home"), titulos[slug]);
  return (
    <div ref={caja} className="tb-ini tb-ini-c" role="group" aria-label={t("tablero.ini.titulo")}>
      <ul>
        {grupos.map((g) => {
          const clave = claveGrupo(g);
          const nuevo = g.maquina
            ? t("tablero.ini.nuevoEnMaquina", { maquina: nombreMaquina(maquinas, g.maquina) })
            : g.carpeta
              ? t("tablero.ini.nuevoEn", { c: carpeta(g.carpeta) })
              : t("tablero.ini.nuevoEn", { c: carpeta(GENERAL) });
          const opciones: Opcion[] = [
            ...g.lideres.map((l) => ({ id: l.id, nombre: l.nombre || t("lider.sesionJefe"), desc: l.ocupado ? t("tablero.ini.ocupado") : "" })),
            { id: NUEVO, nombre: nuevo, desc: "" },
          ];
          const destino = destinoDe(g, elegidos[clave]);
          const modelo = modelos[clave] ?? SIN_MODELO;
          const modelosOpc: Opcion[] = [{ id: SIN_MODELO, nombre: t("tablero.ini.modeloDefecto"), desc: t("tablero.ini.modeloDefectoDesc") }, ...MODELOS];
          // Con el caché del líder vivo, otro modelo se lo cambia: se dice.
          const cambia = cambiaElModelo(destino, modelo, modeloDe);
          return (
            <li key={clave} data-proyecto={g.proyecto} data-maquina={g.maquina}>
              <div className="tb-ini-h">
                {g.proyecto ? <Chip proyecto={g.proyecto} /> : <span className="tb-ini-sin">{t("tablero.sinProyecto")}</span>}
                {g.maquina ? <MaquinaMigas maquina={g.maquina} /> : null}
                <ArrowRight size={12} strokeWidth={2} aria-hidden="true" />
                {g.lideres.length ? (
                  <div className="pn-abajo tb-filtro tb-ini-d">
                    <Selector etiqueta={t("tablero.ini.destino")} opciones={opciones} valor={destinoDe(g, elegidos[clave])?.id ?? NUEVO} alElegir={(l) => alElegir(clave, l)} disabled={enviando} />
                  </div>
                ) : (
                  <span className="tb-ini-d" data-tip={g.carpeta ? undefined : t("tablero.ini.inicioTip")}>
                    {nuevo}
                  </span>
                )}
              </div>
              <div className="tb-ini-m2">
                <div className="pn-abajo tb-filtro tb-ini-d">
                  <Selector etiqueta={t("tablero.ini.modelo")} opciones={modelosOpc} valor={modelo} alElegir={(m) => alModelo(clave, m)} disabled={enviando} />
                </div>
                {cambia ? <span className="tb-ini-av">{t("tablero.ini.cambiaModelo")}</span> : null}
              </div>
              <ol data-una={g.items.length === 1 ? "" : undefined}>
                {g.items.map((i) => (
                  <li key={i.id}>
                    <span className="tb-id">{etiqueta(i)}</span> {i.titulo}
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ul>
      <div className="tb-ini-b">
        <button type="button" className="btn2 tb-iniciar" data-primario="" disabled={enviando || !grupos.length} onClick={alEnviar}>
          <Play size={12} strokeWidth={2.2} />
          {t("tablero.ini.enviar")}
        </button>
        <button type="button" className="btn2" onClick={alCancelar}>
          {t("tablero.ini.cancelar")}
        </button>
      </div>
    </div>
  );
}

// --- Proyectos y pospuestos ----------------------------------------------------------

type PropsFilaProy = { p: FilaProyecto; alElegir: (proyecto: string) => void };

/** Una fila de la vista Proyectos; un clic filtra el kanban por ese proyecto. Un retirado se ve apagado. */
const FilaProy = memo(function FilaProy({ p, alElegir }: PropsFilaProy) {
  useIdioma();
  return (
    <button type="button" role="row" className="tb-pr" data-etapa={p.etapa} onClick={() => alElegir(p.proyecto)}>
      <span role="cell" className="tb-pr-n">
        <Chip proyecto={p.proyecto} />
      </span>
      <span role="cell" className="tb-etapa">
        {p.etapa in ETAPA ? t(ETAPA[p.etapa]) : p.etapa}
      </span>
      <span role="cell" className="tb-num">
        {p.dias === null ? "–" : t("tablero.proy.d", { n: p.dias })}
      </span>
      <span role="cell" className="tb-num" data-cero={p.abiertos ? undefined : ""}>
        {p.abiertos}
      </span>
      <span role="cell" className="tb-pr-e">
        {p.esperan.length ? (
          <>
            <b>{t("tablero.proy.teEsperan", { n: p.esperan.length })}</b>
            {p.esperan[0].titulo}
          </>
        ) : p.sigue ? (
          <>
            <i>{t("tablero.proy.sigue")}</i>
            {p.sigue}
          </>
        ) : null}
      </span>
    </button>
  );
});

type PropsPospuestos = { items: Item[]; alTraer: (i: Item) => void; alCerrar: () => void };

/** Los pospuestos, con su día: cada uno se puede traer de vuelta a su columna sin esperar a ese día. */
function Pospuestos({ items, alTraer, alCerrar }: PropsPospuestos) {
  const caja = useRef<HTMLDivElement>(null);
  useFoco(caja, { alCerrar, atrapar: false, devolver: () => document.querySelector<HTMLElement>(".tb-pos-b") });
  const dia = (hasta: string | null) => {
    const ms = hasta ? Date.parse(`${hasta.slice(0, 10)}T12:00:00`) : NaN;
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(locale(), { dateStyle: "medium" }) : "";
  };
  return (
    <div ref={caja} className="tb-pos" role="group" aria-label={t("tablero.pos.titulo")}>
      {items.length ? (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <Chip proyecto={i.proyecto} />
              <span className="tb-id">{etiqueta(i)}</span>
              <span className="tb-pos-t">{i.titulo}</span>
              <span className="tb-edad">{t("tablero.pos.hasta", { d: dia(i.hasta) })}</span>
              <button type="button" className="btn2" data-tip={t("tablero.pos.traerTip")} onClick={() => alTraer(i)}>
                <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
                {t("tablero.pos.traer")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tb-pos-v">{t("tablero.pos.vacio")}</p>
      )}
    </div>
  );
}

// --- Alta rápida -------------------------------------------------------------------

type PropsAlta = { proyectos: string[]; alAgregar: (texto: string, proyecto: string | null, maquina?: string) => Promise<void>; alFallar: (e: string | null) => void };

function Alta({ proyectos, alAgregar, alFallar }: PropsAlta) {
  const [texto, setTexto] = useState("");
  const [proyecto, setProyecto] = useState(NINGUNO);
  const [mandando, setMandando] = useState(false);
  // "Agregar en": a qué tablero. Siempre arranca en esta máquina y no se recuerda: nada sale a la otra sin que el usuario la elija.
  const maquinas = useMaquinas();
  const [maquina, setMaquina] = useState<string | null>(null);
  const opciones: Opcion[] = [
    { id: NINGUNO, nombre: t("tablero.sinProyecto"), desc: "" },
    ...proyectos.map((p) => ({ id: p, nombre: p, desc: "", marca: <Punto proyecto={p} /> })),
  ];
  const mandar = (e: FormEvent) => {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio || mandando) return;
    setMandando(true);
    alFallar(null);
    alAgregar(limpio, proyecto || null, maquina && maquina !== maquinas.esta.id ? maquina : undefined)
      .then(
        () => {
          setTexto("");
          setMaquina(null);
        },
        (err: Error) => alFallar(err.message),
      )
      .finally(() => setMandando(false));
  };
  return (
    <form className="tb-barra tb-alta" onSubmit={mandar}>
      <label className="buscar">
        <Plus size={14} strokeWidth={1.8} />
        <input value={texto} placeholder={t("tablero.altaPh")} aria-label={t("tablero.altaPh")} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <div className="pn-abajo tb-filtro">
        <Selector etiqueta={t("tablero.proyectoAlta")} opciones={opciones} valor={proyecto} alElegir={setProyecto} />
      </div>
      {hayVarias(maquinas) ? (
        <div className="pn-abajo tb-filtro">
          <Selector etiqueta={t("tablero.agregarEn")} opciones={opcionesMaquina(maquinas)} valor={maquina ?? maquinas.esta.id} alElegir={setMaquina} />
        </div>
      ) : null}
      <button type="submit" className="btn2" disabled={!texto.trim() || mandando}>
        {t("tablero.agregar")}
      </button>
    </form>
  );
}

// --- Columnas y tarjetas -----------------------------------------------------------

type PropsCol = {
  k: Columna;
  items: Item[];
  /** Con filtro o búsqueda, cuántas tiene la columna en total. */
  total: number | null;
  ahora: number;
  activa: ItemId | null;
  llevada: ItemId | null;
  marcadas: ReadonlySet<ItemId>;
  alAgarrar: (e: PunteroReact<HTMLElement>, i: Item) => void;
  alAbrir: (id: ItemId) => void;
  /** Marcar para iniciar varias, e iniciar una. Hecho no los lleva. */
  alMarcar?: (id: ItemId) => void;
  alIniciar?: (id: ItemId) => void;
  /** Sólo en Hecho: volver a plegarla. */
  alPlegar?: () => void;
};

const Col = memo(function Col({ k, items, total, ahora, activa, llevada, marcadas, alAgarrar, alAbrir, alMarcar, alIniciar, alPlegar }: PropsCol) {
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  const t0 = useMemo(() => tramos(items), [items]);
  const n = items.length;
  const [r, setR] = useState<[number, number]>([0, 0]);

  const calcular = useCallback(() => {
    const el = caja.current;
    if (!el) return;
    const u = rem();
    const [a, b] = rango(t0, el.scrollTop / u, el.clientHeight / u, MARGEN);
    setR((p) => (p[0] === a && p[1] === b ? p : [a, b]));
  }, [t0]);

  useLayoutEffect(calcular, [calcular]);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(calcular);
    ro.observe(el);
    return () => ro.disconnect();
  }, [calcular]);

  const desde = Math.min(r[0], n);
  const hasta = Math.min(r[1], n);
  return (
    <section className="tb-col" data-columna={k} aria-label={t(NOMBRE[k])}>
      <header className="tb-col-h">
        <b>{t(NOMBRE[k])}</b>
        <span className="tb-n">{total === null ? n : t("tablero.de", { n, total })}</span>
        {alPlegar ? (
          <button type="button" className="tb-plegar" aria-label={t("tablero.plegar")} data-tip={t("tablero.plegar")} onClick={alPlegar}>
            <ChevronsRight size={14} strokeWidth={1.8} />
          </button>
        ) : null}
      </header>
      <div ref={caja} className="tb-lista" onScroll={calcular}>
        {n ? (
          <div style={{ paddingTop: `${t0[desde]}rem`, paddingBottom: `${t0[n] - t0[hasta]}rem` }}>
            {items.slice(desde, hasta).map((i) => (
              <Tarjeta
                key={i.id}
                i={i}
                ahora={ahora}
                activa={activa === i.id}
                llevada={llevada === i.id}
                marcada={marcadas.has(i.id)}
                alAgarrar={alAgarrar}
                alAbrir={alAbrir}
                alMarcar={alMarcar}
                alIniciar={alIniciar}
              />
            ))}
          </div>
        ) : (
          <p className="tb-vacia">{k === "hecho" ? t("tablero.hechoDias", { n: DIAS_HECHO }) : t("tablero.vacia")}</p>
        )}
      </div>
    </section>
  );
});

type PropsTarjeta = {
  i: Item;
  ahora: number;
  activa: boolean;
  llevada: boolean;
  marcada: boolean;
  alAgarrar: (e: PunteroReact<HTMLElement>, i: Item) => void;
  alAbrir: (id: ItemId) => void;
  alMarcar?: (id: ItemId) => void;
  alIniciar?: (id: ItemId) => void;
};

const Tarjeta = memo(function Tarjeta({ i, ahora, activa, llevada, marcada, alAgarrar, alAbrir, alMarcar, alIniciar }: PropsTarjeta) {
  useIdioma();
  const puede = puedeMaquina(useMaquinas(), i.maquina);
  return (
    <div
      className="tb-card"
      role="button"
      tabIndex={0}
      data-id={i.id}
      data-activa={activa ? "" : undefined}
      data-llevada={llevada ? "" : undefined}
      data-marcada={marcada ? "" : undefined}
      style={{ "--alto": `${altoDe(i)}rem` } as CSSProperties}
      onPointerDown={(e) => alAgarrar(e, i)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        alAbrir(i.id);
      }}
    >
      <Cara i={i} ahora={ahora}>
        {alMarcar && alIniciar && puede ? (
          <span className="tb-btns">
            <button
              type="button"
              className="tb-marca"
              role="checkbox"
              aria-checked={marcada}
              aria-label={t("tablero.marcar")}
              data-tip={t("tablero.marcar")}
              onClick={() => alMarcar(i.id)}
            >
              {marcada ? <Check size={11} strokeWidth={3} /> : null}
            </button>
            <button type="button" className="tb-play" aria-label={t("tablero.iniciar")} data-tip={t("tablero.iniciarTip")} onClick={() => alIniciar(i.id)}>
              <Play size={12} strokeWidth={2.2} />
            </button>
          </span>
        ) : null}
      </Cara>
    </div>
  );
});

/** Lo que dice una tarjeta: título, chip del proyecto, edad y, si tiene, la prueba exacta con su botón de copiar. */
function Cara({ i, ahora, children }: { i: Item; ahora: number; children?: ReactNode }) {
  return (
    <>
      <div className="tb-t">{i.titulo}</div>
      <div className="tb-m">
        <Chip proyecto={i.proyecto} />
        <span className="tb-id">{etiqueta(i)}</span>
        {children}
        <span className="tb-edad">{edad(i.cerrado ?? i.creado, ahora)}</span>
      </div>
      {i.prueba ? (
        <div className="tb-p">
          <code>{i.prueba}</code>
          <Copiar texto={i.prueba} />
        </div>
      ) : null}
    </>
  );
}

/** `#12`, y con la máquina de la que viene si es de otra: `#12 · Dell`. */
const etiqueta = (i: Item) => `#${numero(i.id)}${i.maquina ? ` · ${i.maquinaNombre ?? i.maquina}` : ""}`;

/** Las otras máquinas que no se pudieron leer, en una línea (sus items no aparecen). */
const textoCaidas = (caidas: readonly string[]) => (caidas.length ? t("tablero.maquinaCaida", { maquina: caidas.join(", ") }) : null);

const color = (proyecto: string) => ({ "--tono": tono(proyecto) }) as CSSProperties;

/** El chip de un proyecto: el mismo nombre da siempre el mismo color. */
function Chip({ proyecto }: { proyecto: string }) {
  if (!proyecto) return <span className="tb-chip" data-sin="" />;
  return (
    <span className="tb-chip" style={color(proyecto)}>
      {proyecto}
    </span>
  );
}

/** El color solo, para los menús. */
const Punto = ({ proyecto }: { proyecto: string }) => <i className="tb-punto" style={color(proyecto)} />;

function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const reloj = useRef(0);
  useEffect(() => () => clearTimeout(reloj.current), []);
  const etq = copiado ? t("tablero.copiado") : t("tablero.copiar");
  return (
    <button
      type="button"
      className="tb-copiar"
      aria-label={etq}
      data-tip={etq}
      data-copiado={copiado ? "" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        void copiarConAviso(texto).then((ok) => {
          if (!ok) return;
          setCopiado(true);
          clearTimeout(reloj.current);
          reloj.current = window.setTimeout(() => setCopiado(false), COPIADO_MS);
        });
      }}
    >
      {copiado ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={1.8} />}
    </button>
  );
}

// --- Detalle -----------------------------------------------------------------------

type PropsDetalle = {
  item: Item;
  ahora: number;
  /** Lo escrito en "posponer hasta": lo guarda quien abre el detalle, para que cerrarlo no lo pierda. */
  hasta: string;
  alEscribirHasta: (texto: string) => void;
  alCerrar: () => void;
  alMover: (c: Columna) => void;
  alIniciar: () => void;
  alHecho: () => void;
  alTirar: () => void;
  alPosponer: (hasta: string) => void;
};

const POSPONER: [string, ClaveSola][] = [
  ["mañana", "tablero.manana"],
  ["+3d", "tablero.dias3"],
  ["+1s", "tablero.semana"],
];

function Detalle({ item: i, ahora, hasta, alEscribirHasta, alCerrar, alMover, alIniciar, alHecho, alTirar, alPosponer }: PropsDetalle) {
  const maquinas = useMaquinas();
  const caja = useRef<HTMLElement>(null);
  useFoco(caja, { alCerrar, ignorar: '[role="listbox"]' });
  // Tirar pide un segundo clic: el primero lo arma (y se desarma solo al irse el foco).
  const [armado, setArmado] = useState(false);
  const fecha = (iso: string | null) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? new Date(ms).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : null;
  };
  const columnas: Opcion[] = ABIERTAS.map((k) => ({ id: k, nombre: t(NOMBRE[k]), desc: "" }));
  if (i.columna === "hecho") columnas.push({ id: "hecho", nombre: t(NOMBRE.hecho), desc: "" });
  const datos: [ClaveSola, string | null][] = [
    ["tablero.det.origen", i.origen || null],
    ["tablero.det.fuente", i.clave || null],
    ["tablero.det.head", i.head],
    ["tablero.det.creado", fecha(i.creado)],
    ["tablero.det.tocado", fecha(i.tocado)],
    ["tablero.det.cerrado", fecha(i.cerrado)],
  ];
  return (
    <aside ref={caja} className="tb-det" aria-label={i.titulo} tabIndex={-1}>
      <header className="tb-det-h">
        <Chip proyecto={i.proyecto} />
        <span className="tb-id">{etiqueta(i)}</span>
        <span className="tb-edad">{edad(i.creado, ahora)}</span>
        <button type="button" className="lado" aria-label={t("tablero.det.cerrar")} data-tip={t("tablero.det.cerrar")} onClick={alCerrar}>
          <X size={15} strokeWidth={1.8} />
        </button>
      </header>
      <div className="tb-det-c">
        <h2>{i.titulo}</h2>
        {i.detalle ? <p className="tb-det-t">{i.detalle}</p> : null}
        {i.prueba ? (
          <section>
            <h3>{t("tablero.det.prueba")}</h3>
            <div className="tb-p tb-p-larga">
              <code>{i.prueba}</code>
              <Copiar texto={i.prueba} />
            </div>
          </section>
        ) : null}
        <dl className="tb-dl">
          <dt>{t("tablero.det.columna")}</dt>
          <dd className="pn-abajo">
            <Selector etiqueta={t("tablero.det.columna")} opciones={columnas} valor={i.columna} alElegir={(c) => alMover(c as Columna)} />
          </dd>
          {datos.map(([k, v]) =>
            v ? (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd>{v}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </div>
      {i.columna === "hecho" ? null : (
        <footer className="tb-det-p">
          <div className="tb-posponer">
            <span>{t("tablero.posponer")}</span>
            {POSPONER.map(([h, k]) => (
              <button key={h} type="button" className="btn2" onClick={() => alPosponer(h)}>
                {t(k)}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (hasta.trim()) alPosponer(hasta.trim());
              }}
            >
              <input value={hasta} placeholder={t("tablero.hastaPh")} aria-label={t("tablero.hastaAria")} spellCheck={false} onChange={(e) => alEscribirHasta(e.target.value)} />
            </form>
          </div>
          <div className="tb-acc">
            {/* Iniciar va al líder de la máquina del item; con ella en otra versión (o caída) no se ofrece. */}
            {!puedeMaquina(maquinas, i.maquina) ? null : (
              <button type="button" className="btn2 tb-iniciar" data-primario="" data-tip={t("tablero.iniciarTip")} onClick={alIniciar}>
                <Play size={12} strokeWidth={2.2} />
                {t("tablero.iniciar")}
              </button>
            )}
            <button type="button" className="btn2 tb-hecho" onClick={alHecho}>
              <Check size={14} strokeWidth={2.2} />
              {t("tablero.hecho")}
            </button>
            <button
              type="button"
              className="btn2 tb-tirar"
              data-armado={armado ? "" : undefined}
              onBlur={() => setArmado(false)}
              onClick={() => (armado ? alTirar() : setArmado(true))}
            >
              {armado ? t("tablero.tirarConfirmar") : t("tablero.tirar")}
            </button>
          </div>
        </footer>
      )}
    </aside>
  );
}
