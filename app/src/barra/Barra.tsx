// La app: la barra izquierda de la dirección "D · Minimal"
// (referencias/diseno-D-minimal.dc.html) y, a la derecha, la vista del hilo
// elegido. Cada proyecto con algo activo es una carpeta; adentro, cada líder
// con sus workers colgando en árbol (src/barra/arbol.ts). Lo cerrado que no
// cuelga de nadie va a "Cerrados", al fondo.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as TeclaReact,
  type MouseEvent as RatonReact,
  type PointerEvent as PunteroReact,
  type ReactNode,
  type Ref,
} from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { BarChart3, ChevronDown, Crown, GitBranch, ListTree, PanelRight, PencilLine, Plus, Search, Settings, SquareKanban, type LucideIcon } from "lucide-react";
import { cerrable, cerrado, comoSettle, GENERAL, VERSION, type Caido, type Estado, type EventoPa, type Hilo, type Leidos, type Lider, type Nombres, type Orden, type RespuestaLideres } from "../datos/contrato";
import { compactarFijo, escenaFija, fuente } from "../datos/fuente";
import { ARRANCANDO, EN_COLA, FRENADO, imagenFija } from "../datos/fixtures";
import { agregarAdjuntos } from "../hilo/adjuntos";
import { fuentePaneles, type AccionRama } from "../datos/paneles";
import { t as tr } from "../i18n";
import { useIdioma } from "../i18n/react";
import { leerBorrador, llenarBorrador } from "../hilo/borradores";
import { BORRADOR_LIDER } from "../hilo/Lider";
import { fantasma, MODELO_DEFAULT, modeloDe, primeraLinea } from "../hilo/opciones";
import { effortPara } from "../hilo/elegir";
import { effortsLeidos } from "../hilo/efforts";
import { enviado } from "../hilo/vivo";
import type { LiderAviso } from "../datos/avisar";
import { modeloDeInicio, type LiderDe } from "../datos/iniciar";
import { armarMensaje, armarProyectos, sumarAlBorrador, tocadas } from "../datos/pendientes";
import { tableroFijo } from "../datos/fixtures-tablero";
import { validar } from "../datos/tablero";
import { muestraTocada } from "../datos/tocado";
import { useEsperan } from "./esperan";
import { Vista } from "../hilo/Vista";
import { MODO } from "../modo";
import { apariencia, LETRA_DEF } from "../tipografia";
import { esAngosto, useAngosto, useAtras, useMedio } from "../angosto";
import { correrGuionPaneles } from "../paneles/guion";
import { Panel, PANELES, type CualPanel } from "../paneles/Panel";
import { alPedirAjustes } from "../paneles/ajustes-nav";
import { Consumo } from "../paneles/Consumo";
import { ramas } from "../paneles/Ramas";
import { pasoLider, pasoWorker } from "../paneles/PasoLanzar";
import { conTexto, type Eleccion } from "../paneles/lanzar";
import { rcDe, RC_CONFLICTO } from "../datos/errorpa";
import { main, mensaje } from "../puente";
import {
  activo,
  aDesplegar,
  armarArbol,
  aVistaTodo,
  claveDormidos,
  claveEspera,
  compararCarpetas,
  deLider,
  estadoVisto,
  filasVisibles,
  fin,
  lideresEnOrden,
  lugarLider,
  nombreCarpeta,
  resumen,
  comoQuitar,
  salidaDe,
  lideresSinProceso,
  salidaWorker,
  settleLider,
  settleWorker,
  type Arbol as DatosArbol,
  type Carpeta as DatosCarpeta,
  type Como,
  type Item,
  type Lugar,
  type Rama,
} from "./arbol";
import { armarArrastre, CARPETAS } from "./arrastre";
import { control } from "./control";
import { Fila, FilaLider, RESORTE } from "./Fila";
import { Subagentes } from "./Subagentes";
import { soltarSubagente } from "./subagente-visto";
import { corriendo, useTodosSubagentes } from "./subagentes-datos";
import { correrGuion } from "./guion";
import { Logo } from "./Logo";
import { hayOrdenManual, ORDEN0, podar, prioridadPrendida, reordenar, reordenarPaso } from "./orden";
import { usePrioridad } from "./usePrioridad";
import { useTitulos } from "./titulos";
import { accionesCarpeta, accionesLider, accionesWorker, type LugarMenu, type Opcion } from "./menu-datos";
import { Menu, Renombre, type ItemMenu } from "./Menu";
import { armarTips } from "./tooltip";
import { AvisoClaude } from "./AvisoClaude";
import { AvisoSetup } from "./AvisoSetup";
import { Pc } from "./Pc";
import { useAlAbrirEspera, useEspera } from "./useEspera";
import { Reinicio } from "./Reinicio";
import { AvisoMaquinas } from "./Maquina";
import { es } from "../atajos";
import { abrirSalir } from "../paneles/Salir";
import { abrirAtajos } from "../paneles/Atajos";
import { listaLista } from "../actualizando";
import { useReinicio } from "../reinicio";
import { huboCambio } from "../hilo/cambios";
import { alLeerVista, vueltaInicial } from "../volver";
import { copiarConAviso } from "../copiar";
import { Cabecera } from "./Cabecera";
import { avisarVentana, irA, ponerLista, UMBRAL, useVentana } from "./ventana";

const CLAVE_COLAPSADOS = "hilos:barra:colapsados";
const CLAVE_ANCHO = "hilos:barra:ancho";
const CLAVE_ABIERTA = "hilos:barra:abierta";

const ANCHO = 320;
const ANCHO_MIN = 240;
const ANCHO_MAX = 520;
/** Soltar el borde más acá de esto esconde la barra. */
const ANCHO_OCULTAR = 170;

const acotar = (w: number) => Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, Math.round(w)));

function guardado<T>(clave: string, leer: (crudo: string) => T, defecto: T): T {
  if (MODO.datosFijos) return defecto;
  try {
    const crudo = localStorage.getItem(clave);
    return crudo === null ? defecto : leer(crudo);
  } catch {
    return defecto;
  }
}

const guardar = (clave: string, valor: string) => {
  if (!MODO.datosFijos) localStorage.setItem(clave, valor);
};

/** Lo activo puede ser un hilo (su id) o un líder (`lider:<session_id>`). */
const LIDER = "lider:";
/** El chat de un líder que todavía no existe (Nuevo líder). */
const LIDER_NUEVO = "lider:+";



/** El menú del clic derecho abierto: dónde, sobre qué y en qué nivel. `origen`: a dónde vuelve el foco. */
type MenuAbierto = {
  x: number;
  y: number;
  de: { tipo: "worker"; id: string } | { tipo: "lider"; sid: string } | { tipo: "carpeta"; proyecto: string };
  mover?: boolean;
  origen: HTMLElement | null;
};

/** Renombrando una fila: el id (de un run o un session_id), dónde va el campo y con qué letra. */
type Renombrando = {
  id: string;
  /** Lo que dice ahora (el título puesto, si hay) y lo de siempre (la tarea, o el nombre que da el main). */
  valor: string;
  original: string;
  caja: { left: number; top: number; width: number; height: number };
  letra: string;
  origen: HTMLElement | null;
};

const NOMBRES0: Nombres = { titulos: {}, proyectos: {}, ocultos: [], orden: ORDEN0 };

/** El Settle de un líder se guarda junto a lo leído (`leidos.json`), con este prefijo: id → epoch del Settle. */
const SETTLE = "settle:";

/** La rama (el líder con sus workers) de un líder, o `null` si no está a la vista. */
function ramaDe(a: DatosArbol, sid: string): Rama | null {
  for (const g of a.carpetas) for (const r of [...g.ramas, ...g.espera, ...g.dormidos]) if (r.lider?.id === sid) return r;
  return null;
}

/** El Settle de un líder a la vista: `null` si no puede (responde o tiene workers vivos), si no las ramas sin integrar. */
function settleDe(r: Rama | null): number | null {
  if (!r?.lider) return null;
  const s = settleLider(r.lider, [...r.vivas, ...r.viejas]);
  return s.puede ? s.ramas : null;
}

/** Lo que trae novedad para el usuario: va en negrita hasta que lo abre. Lo de un líder es para el líder. */
const NOVEDAD: ReadonlySet<Estado> = new Set(["decision", "listo", "murio"]);
const novedad = (h: Hilo, estado: Estado, leidos: Leidos) =>
  !deLider(h) && NOVEDAD.has(estado) && h.frenado_en == null && !((leidos[h.id] ?? 0) >= fin(h));

/** Cuánto vale un arranque que la lista no confirmó: pasado esto no se pinta (el evento era de un worker que no llegó a existir). */
const LLEGADO_S = 600;

/** El worker que `pa` acaba de lanzar, pintado desde su evento `inicio` sin esperar la lista: sin tarea ni rama todavía; su líder, el que trae el evento (`jefeDeCorrida`). */
const llegado = (e: EventoPa): Hilo => ({
  id: e.id,
  proyecto: e.proyecto,
  tarea: "",
  modelo: "",
  effort: "",
  origen: "app",
  jefe: e.jefe ?? null,
  jefe_id: e.jefe_id ?? null,
  sigue_de: null,
  estado: "trabajando",
  en_cola: false,
  inicio: e.ts,
  duracion_s: null,
  puesto: null,
  rama: null,
  commits: 0,
  decision: null,
  decision_nada: null,
  resultado: null,
  archivado: null,
  leer: false,
  cache_ttl_s: null,
  cache_vence: null,
  cache_frio: null,
  cache_modelo: null,
  arrancando: true,
});

/** Cómo queda la rama si la acción del panel de Ramas sale bien. */
const TRAS: Record<AccionRama, Estado> = { integrar: "integrado", descartar: "descartado", revertir: "revertido" };

const BOTONES_PIE: [CualPanel, LucideIcon][] = [
  ["ajustes", Settings],
  ["ramas", GitBranch],
  ["estadisticas", BarChart3],
  ["tablero", SquareKanban],
];

/** Qué muestra la barra (B15): los líderes con sus workers colgando, o sólo los líderes (con lo vivo resumido en su fila). */
type VistaBarra = "todo" | "lideres";
const VISTAS: [VistaBarra, LucideIcon, "vista.lideres" | "vista.todo", "vista.tipLideres" | "vista.tipTodo"][] = [
  ["lideres", Crown, "vista.lideres", "vista.tipLideres"],
  ["todo", ListTree, "vista.todo", "vista.tipTodo"],
];
const SIN_FILAS: Item[] = [];

/**
 * Los que se reordenan entre sí, en el orden en que se ven: los líderes de una carpeta (también los plegados
 * en espera) o, con `null`, las carpetas menos la del home, que va primera siempre. Sin esa carpeta, `null`.
 */
function visiblesDe(grupos: readonly DatosCarpeta[], orden: Orden, titulos: ReadonlyMap<string, string>, carpeta: string | null): string[] | null {
  if (carpeta === null)
    return grupos
      .map((x) => x.proyecto)
      .filter((p) => p !== GENERAL)
      .sort(compararCarpetas(orden, titulos));
  const g = grupos.find((x) => x.proyecto === carpeta);
  return g ? lideresEnOrden(g, orden) : null;
}

/** Siempre el último valor, para los manejadores que se registran una sola vez. */
function useUltimo<T>(valor: T) {
  const ref = useRef(valor);
  ref.current = valor;
  return ref;
}

export function Barra() {
  // Lo que no es `memo` se re-renderiza desde acá al cambiar de idioma.
  useIdioma();
  const [hilos, setHilos] = useState<Hilo[] | null>(null);
  const [lideres, setLideres] = useState<Lider[]>([]);
  const [caidos, setCaidos] = useState<Caido[]>([]);
  // El analista de Ramas (B22): viene con los líderes pero no va en la barra.
  const [analista, setAnalista] = useState<Lider | null>(null);
  const [fantasmas, setFantasmas] = useState(() => new Map<string, Lider>());
  const [errorDatos, setErrorDatos] = useState<string | null>(null);
  // Ya llegó la lista de verdad (no la guardada) de workers y de líderes: recién entonces se sabe si lo que quedó abierto sigue existiendo.
  const [listosPa, setListosPa] = useState(false);
  const [listosLideres, setListosLideres] = useState(false);
  const [optimista, setOptimista] = useState(() => new Map<string, Estado>());
  const [errores, setErrores] = useState(() => new Map<string, string>());
  // Lo que dijo `eventos.jsonl` antes de que la lista (~11 s) lo trajera: los que arrancan y los que se frenaron.
  const [llegados, setLlegados] = useState(() => new Map<string, Hilo>());
  const [frenos, setFrenos] = useState(() => new Map<string, number>());
  const [colapsados, setColapsados] = useState(
    () => new Set(guardado<string[]>(CLAVE_COLAPSADOS, (c) => JSON.parse(c) as string[], [])),
  );
  // Los pliegues abiertos: el "+N" de un líder o "N terminadas" (clave de la rama), o los "N líderes en espera" (`espera:<proyecto>`).
  const [pliegues, setPliegues] = useState(() => new Set<string>());
  const [vista, setVista] = useState<VistaBarra>(MODO.vista);
  // El panel de consumo (a la derecha): arranca oculto y se recuerda en preferencias.json.
  const [consumo, setConsumo] = useState(MODO.consumo);
  const [cerradosAbiertos, setCerradosAbiertos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  // Tras un reinicio pedido (o una recarga en el celular) arranca en lo que estaba abierto (src/volver.ts).
  const [activa, setActiva] = useState<string | null>(() => vueltaInicial()?.activa ?? null);
  // El panel del pie que tapa la vista del hilo (Ajustes, Ramas o Estadísticas).
  const [panel, setPanel] = useState<CualPanel | null>(() => {
    const p = vueltaInicial()?.panel;
    return p && p in PANELES ? (p as CualPanel) : null;
  });
  // Acciones de Ramas que `pa` todavía no terminó.
  const [enCurso, setEnCurso] = useState(() => new Set<string>());
  // Las ramas cuyo Integrar chocó con main: Ramas les ofrece Actualizar.
  const [conflictos, setConflictos] = useState(() => new Set<string>());
  // Qué abrió el usuario y cuándo: lo que terminó después vuelve a ser novedad.
  const [leidos, setLeidos] = useState<Leidos>({});
  // B20: títulos, carpetas elegidas y terminados ocultos (nombres.json), el menú del clic derecho y el renombrar en línea.
  const [nombres, setNombres] = useState<Nombres>(NOMBRES0);
  const [carpetasReg, setCarpetasReg] = useState<string[]>([]);
  // Con qué nombre anota el tablero cada carpeta (nombre del registry → slug): se lee al abrir el Tablero.
  const [slugsReg, setSlugsReg] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<MenuAbierto | null>(null);
  const [renombrando, setRenombrando] = useState<Renombrando | null>(null);
  // "Nueva tarea aquí": la carpeta del líder que está por nacer.
  const nuevaEn = useRef<string | null>(null);
  const [ancho, setAncho] = useState(() => guardado(CLAVE_ANCHO, (c) => acotar(Number(c) || ANCHO), ANCHO));
  const [abierta, setAbierta] = useState(() => vueltaInicial()?.abierta ?? guardado(CLAVE_ABIERTA, (c) => c !== "0", true));
  const reinicio = useReinicio();
  // Cuántos items esperan al usuario (el número del botón del Tablero, en el pie).
  const esperan = useEsperan();
  const vistaAhora = useRef({ activa, panel: panel as string | null, abierta });
  vistaAhora.current = { activa, panel, abierta };
  useEffect(() => alLeerVista(() => vistaAhora.current), []);
  // La pastilla "Falta configurar" abre Ajustes en la categoría que corresponde.
  useEffect(
    () =>
      alPedirAjustes(() => {
        if (esAngosto()) setAbierta(false);
        setPanel("ajustes");
      }),
    [],
  );
  // En el celular (src/angosto.ts) se ve una cosa a la vez y `abierta` dice cuál: la lista o lo abierto.
  const angosto = useAngosto();
  // Con ancho intermedio el panel de consumo no cabe al lado de la conversación: la reemplaza (CSS, `data-consumo`) y
  // abrir otra cosa lo suelta (sin tocar lo guardado: con la ventana ancha vuelve al costado).
  const medio = useMedio();
  const tapa = consumo && medio && !angosto;
  const abierto = useRef({ activa, panel });
  useEffect(() => {
    const a = abierto.current;
    abierto.current = { activa, panel };
    if (medio && !MODO.captura && (a.activa !== activa || a.panel !== panel)) setConsumo(false);
  }, [medio, activa, panel]);
  // Abrir un panel del pie (Ajustes, Ramas, Estadísticas) deja de mirar los pasos del subagente.
  useEffect(() => {
    if (panel) soltarSubagente();
  }, [panel]);
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  // Datos: lo guardado de la vez anterior (si `pa` todavía no contestó), una
  // lectura al abrir y otra cada vez que `pa` avisa.
  useEffect(() => {
    let vivo = true;
    let frescos = false;
    const errorVersion = (v: number) => tr("error.version", { que: "pa --hilos", v, conozco: VERSION });
    void fuente.hilosGuardados().then((r) => {
      if (!vivo || !r || frescos) return;
      if (r.version !== VERSION) return setErrorDatos(errorVersion(r.version));
      setHilos(r.hilos);
    });
    void fuente.leidos().then((l) => vivo && setLeidos({ ...l }));
    void fuente.nombres().then((n) => vivo && setNombres(n));
    // El orden que se cambió arrastrando desde el otro lado (la ventana o el celular).
    const soltarOrden = fuente.alCambiarOrden((orden) => setNombres((n) => ({ ...n, orden })));
    void fuente.carpetas().then((c) => vivo && setCarpetasReg(c));
    const leer = () => {
      void fuente.hilos().then(
        (r) => {
          if (!vivo) return;
          frescos = true;
          listaLista();
          if (r.version !== VERSION) return setErrorDatos(errorVersion(r.version));
          setErrorDatos(null);
          setListosPa(true);
          setHilos(r.hilos);
          // Lo que la lista ya trae deja de ser de los eventos.
          const ids = new Set(r.hilos.map((h) => h.id));
          setLlegados((m) => (r.hilos.some((h) => m.has(h.id)) ? new Map([...m].filter(([id]) => !ids.has(id))) : m));
          const yaFrenados = new Set(r.hilos.filter((h) => h.frenado_en != null || !["trabajando", "colgado", "murio"].includes(h.estado)).map((h) => h.id));
          setFrenos((m) => ([...m.keys()].some((id) => yaFrenados.has(id)) ? new Map([...m].filter(([id]) => !yaFrenados.has(id))) : m));
          // Lo que `pa` ya da por cerrado deja de ser optimista.
          // (Salvo lo que el panel de Ramas tiene a medio hacer: deshacer parte de algo ya cerrado.)
          const hechos = new Set(r.hilos.filter((h) => cerrado(h.estado) && !ultimo.current.enCurso.has(h.id)).map((h) => h.id));
          setOptimista((m) => ([...m.keys()].some((id) => hechos.has(id)) ? new Map([...m].filter(([id]) => !hechos.has(id))) : m));
        },
        (e) => vivo && setErrorDatos(mensaje(e)),
      );
    };
    leer();
    const soltar = fuente.alCambiarHilos(leer);
    const soltarEventos = fuente.alEventoPa((es) => {
      for (const e of es) {
        if (e.tipo === "inicio")
          setLlegados((m) => (m.has(e.id) ? m : new Map(m).set(e.id, llegado(e))));
        else if (e.tipo === "parar") setFrenos((m) => (m.get(e.id) === e.ts ? m : new Map(m).set(e.id, e.ts)));
      }
    });
    // Líderes: del statusline, que avisa solo cuando cambia.
    const ponerLideres = (r: RespuestaLideres) => {
      if (!vivo) return;
      setListosLideres(true);
      setLideres(r.version === VERSION ? r.lideres : []);
      const cs = r.version === VERSION ? (r.caidos ?? []) : [];
      // Casi siempre los mismos (o ninguno): el arreglo de antes, para no rearmar el árbol.
      setCaidos((antes) => (JSON.stringify(antes) === JSON.stringify(cs) ? antes : cs));
      setAnalista(r.version === VERSION ? (r.analista ?? null) : null);
    };
    void fuente.lideres().then(ponerLideres, () => {});
    const soltarLideres = fuente.alCambiarLideres(ponerLideres);
    return () => {
      vivo = false;
      soltar();
      soltarEventos();
      soltarLideres();
      soltarOrden();
    };
  }, []);

  // Captura con datos de `pa`: el main saca la foto cuando ya están pintados.
  useEffect(() => {
    if (hilos && !MODO.fixtures && MODO.captura && !errorDatos) main?.pintado();
  }, [hilos, errorDatos]);

  // El título que puso el usuario gana sobre la tarea y el nombre en todos lados (barra, vista, Ramas, búsqueda).
  // Y se le suma lo que dijeron los eventos y la lista todavía no: el que arranca ("Arrancando…") y el que se frenó.
  const vistos = useMemo(() => {
    if (!hilos) return hilos;
    const ahora = Math.floor(Date.now() / 1000);
    const propios = new Set(hilos.map((h) => h.id));
    const vivos = [...llegados.values()].filter((h) => !propios.has(h.id) && ahora - h.inicio < LLEGADO_S);
    return [...hilos, ...vivos].map((h) => {
      const t = frenos.get(h.id);
      // Frenar lo deja `murio` en la lista; hasta que llega, el evento ya lo dijo.
      if (t !== undefined && h.frenado_en == null && (h.estado === "trabajando" || h.estado === "colgado" || h.estado === "murio"))
        h = { ...h, estado: "murio", frenado_en: t, murio_en: h.murio_en ?? t, arrancando: false };
      return nombres.titulos[h.id] ? { ...h, tarea: nombres.titulos[h.id] } : h;
    });
  }, [hilos, llegados, frenos, nombres.titulos]);
  const todos = useMemo(() => vistos ?? [], [vistos]);
  // Con los que quedaron sin proceso y dejaron workers a la vista (`lideresSinProceso`): siguen en la barra.
  // Los subagentes que corren de cada sesión: con alguno, el líder está activo (no enfriándose).
  const subagentes = useTodosSubagentes();
  const lideresVistos = useMemo(() => {
    const ahora = Math.floor(Date.now() / 1000);
    return [...lideres, ...lideresSinProceso(todos, { lideres, caidos, optimista, ahora })].map((l) => {
      const n = corriendo(subagentes[l.id] ?? [], ahora).length;
      const nombre = nombres.titulos[l.id];
      return nombre || n ? { ...l, ...(nombre ? { nombre } : null), ...(n ? { subagentes: n } : null) } : l;
    });
  }, [lideres, todos, caidos, optimista, nombres.titulos, subagentes]);
  const mover = useMemo(() => new Map(Object.entries(nombres.proyectos)), [nombres.proyectos]);
  const ocultos = useMemo(() => new Set(nombres.ocultos), [nombres.ocultos]);
  // El `titulo` del registry de cada carpeta: se ve y se busca por él.
  const titulosReg = useTitulos();
  const titulos = useMemo(() => new Map(Object.entries(titulosReg)), [titulosReg]);
  // Los líderes settleados (en `leidos.json` con el prefijo `settle:`): no se ven hasta que tengan actividad nueva.
  const settleados = useMemo(
    () => new Map(Object.entries(leidos).flatMap(([k, ts]) => (k.startsWith(SETTLE) ? [[k.slice(SETTLE.length), ts] as const] : []))),
    [leidos],
  );
  // Orden por prioridad (prendido de fábrica): no se reordena mientras el usuario mira la lista (mouse encima, foco adentro o un menú abierto).
  const [mirando, setMirando] = useState({ mouse: false, foco: false });
  const porPrioridad = prioridadPrendida(nombres.orden);
  const prioridad = usePrioridad(porPrioridad, lideresVistos, mirando.mouse || mirando.foco || menu !== null);
  // Sin polling: "en espera hace 30 min" se recalcula cuando cambia algo (datos, líderes, búsqueda).
  const arbolBruto = useMemo(
    () => armarArbol(todos, { optimista, lideres: lideresVistos, settleados, busqueda, mover, ocultos, titulos, caidos, orden: nombres.orden, prioridad, ahora: Math.floor(Date.now() / 1000) }),
    [todos, optimista, busqueda, lideresVistos, settleados, mover, ocultos, titulos, caidos, nombres.orden, prioridad],
  );
  // "Líderes y workers" esconde debajo de cada líder lo que murió o terminó (`aVistaTodo`); "sólo líderes" usa el árbol tal cual.
  const arbol = useMemo(() => (vista === "lideres" ? arbolBruto : aVistaTodo(arbolBruto)), [arbolBruto, vista]);
  const { carpetas: hayGrupos, cerrados } = arbol;
  // General siempre está (sin buscar): ahí vive el botón Nuevo líder.
  const grupos = useMemo(
    () =>
      busqueda.trim() || !hilos || hayGrupos.some((g) => g.proyecto === GENERAL)
        ? hayGrupos
        : [{ proyecto: GENERAL, ramas: [], espera: [], dormidos: [], cuenta: 0 }, ...hayGrupos],
    [hayGrupos, busqueda, hilos],
  );
  const buscando = busqueda.trim() !== "";
  // Clave con ":" = el pliegue de una rama; sin ":" = una carpeta (el nombre del proyecto).
  // Buscando, las carpetas se abren pero los pliegues no: lo inactivo sigue en su "+N" / "N terminadas".
  const desplegada = (k: string) => (k.includes(":") ? pliegues.has(k) : buscando || !colapsados.has(k));
  const verCerrados = cerradosAbiertos;
  const soloLideres = vista === "lideres";
  const visibles = filasVisibles(arbol, desplegada, verCerrados, soloLideres);
  const virtual = visibles.length > UMBRAL;

  const ultimo = useUltimo({ hilos, optimista, visibles, grupos, cursor, activa, busqueda, panel, enCurso, arbol, vista, orden: nombres.orden, lideresVistos, carpetasReg, titulos });

  // Integrar, Descartar y Deshacer del panel de Ramas: optimistas como Cerrar.
  const actuar = useCallback(
    (id: string, accion: AccionRama) => {
      const { hilos, enCurso } = ultimo.current;
      const h = hilos?.find((x) => x.id === id);
      if (!h || enCurso.has(id)) return;
      const sin = <V,>(m: Map<string, V>) => new Map([...m].filter(([k]) => k !== id));
      setOptimista((m) => new Map(m).set(id, TRAS[accion]));
      setErrores((m) => (m.has(id) ? sin(m) : m));
      setConflictos((c) => (c.has(id) ? new Set([...c].filter((k) => k !== id)) : c));
      setEnCurso((s) => new Set(s).add(id));
      fuentePaneles
        .rama(accion, h)
        .catch((e) => {
          // Chocó con main: la fila ofrece Actualizar.
          if (rcDe(e) === RC_CONFLICTO) setConflictos((c) => new Set(c).add(id));
          setOptimista(sin);
          setErrores((m) => new Map(m).set(id, mensaje(e)));
        })
        .finally(() => setEnCurso((s) => new Set([...s].filter((k) => k !== id))));
    },
    [ultimo],
  );

  const cerrar = useCallback(
    (id: string, como: Como = "settle") => {
      const { hilos, optimista, arbol } = ultimo.current;
      const h = hilos?.find((x) => x.id === id);
      const estado = h && (optimista.get(id) ?? h.estado);
      // Lo de un líder a la vista se va con el Settle del líder.
      if (!h || !estado || !settleWorker(h, estado, arbol.aCargo)) return;
      // Lo que murió no va por `--integrar --tests` a ciegas: Quitar, o Integrar si el usuario lo elige.
      const salida = salidaDe(h, estado);
      if (salida === "elegir" && como === "integrar") return actuar(id, "integrar");
      // Con commits, el Settle a secas (la tecla "c") no elige por el usuario.
      if (salida === "elegir" && como === "settle") return;
      if (salida !== "settle" && comoQuitar(h) === "descartar") return actuar(id, "descartar");
      // Settle optimista: la fila se va ya; si `pa` falla, vuelve con el error en línea.
      // Lo de un líder sólo se archiva (su rama es del líder); lo de la app con rama se integra.
      // Lo que murió sin rama también se archiva (`comoSettle` sin rama).
      setOptimista((m) => new Map(m).set(id, comoSettle(h) === "integrar" ? "integrado" : "archivado"));
      setErrores((m) => (m.has(id) ? new Map([...m].filter(([k]) => k !== id)) : m));
      fuente.cerrar(h).catch((e) => {
        setOptimista((m) => new Map([...m].filter(([k]) => k !== id)));
        setErrores((m) => new Map(m).set(id, mensaje(e)));
      });
    },
    [ultimo, actuar],
  );

  const alternar = useCallback((proyecto: string) => {
    setColapsados((s) => {
      const n = new Set(s);
      if (!n.delete(proyecto)) n.add(proyecto);
      guardar(CLAVE_COLAPSADOS, JSON.stringify([...n]));
      return n;
    });
  }, []);

  const plegar = useCallback((clave: string) => {
    setPliegues((s) => {
      const n = new Set(s);
      if (!n.delete(clave)) n.add(clave);
      return n;
    });
  }, []);

  // Cambiar de vista: lo que se desplegó a mano en un líder se vuelve a plegar (cada vista arranca limpia).
  const ponerVista = useCallback(
    (v: VistaBarra) => {
      if (v === ultimo.current.vista) return;
      setVista(v);
      // El cursor del teclado puede quedar en una fila que se fue: se suelta.
      setCursor(null);
      setPliegues((s) => {
        const n = new Set([...s].filter((k) => !k.startsWith(LIDER)));
        return n.size === s.size ? s : n;
      });
      fuente.guardarVista(v);
    },
    [ultimo],
  );

  // Angosto: abrir algo saca la lista de adelante (también si ya era lo abierto).
  const alFrente = useCallback(() => {
    if (esAngosto()) setAbierta(false);
  }, []);

  const abrir = useCallback((id: string) => {
    soltarSubagente();
    alFrente();
    setActiva(id);
    setPanel(null);
    const ts = Math.floor(Date.now() / 1000);
    fuente.marcarLeido(id, ts);
    setLeidos((l) => ({ ...l, [id]: ts }));
  }, []);

  const abrirLider = useCallback((id: string) => {
    soltarSubagente();
    alFrente();
    setPanel(null);
    setActiva(LIDER + id);
  }, []);

  const abrirLiderNuevo = useCallback(() => {
    soltarSubagente();
    nuevaEn.current = null;
    alFrente();
    setPanel(null);
    setActiva(LIDER_NUEVO);
  }, []);

  // Cerrar un líder de la app: sale de la barra cuando lideres.json cambia (statusline). `motivo` va al log (`MOTIVOS`, electron/lider.ts).
  const cerrarLider = useCallback((sid: string, motivo: string = "cerrar") => {
    setFantasmas((m) => {
      if (!m.has(sid)) return m;
      const n = new Map(m);
      n.delete(sid);
      return n;
    });
    setActiva((a) => (a === LIDER + sid ? null : a));
    // Borrado adrede: si dejó workers a la vista no vuelve como "Cerrado" hasta que alguno tenga novedad.
    const ts = Math.floor(Date.now() / 1000);
    fuente.marcarLeido(SETTLE + sid, ts);
    setLeidos((l) => ({ ...l, [SETTLE + sid]: ts }));
    void fuente.liderCerrar(sid, motivo).catch(() => {});
  }, []);

  /**
   * Settle de un líder quieto ("esta conversación terminó"): sus workers
   * terminados se archivan (nunca se integran: la rama es del líder) y él se
   * oculta hasta que tenga actividad nueva. A uno de la app además se lo
   * cierra (su historial queda en disco); a uno de terminal no se lo toca.
   * Optimista: si un `--archivar` falla, ese worker vuelve con el error.
   */
  const settleLiderYa = useCallback(
    (sid: string) => {
      const { hilos, arbol } = ultimo.current;
      const r = ramaDe(arbol, sid);
      if (!r?.lider) return;
      const s = settleLider(r.lider, [...r.vivas, ...r.viejas]);
      if (!s.puede) return;
      const ts = Math.floor(Date.now() / 1000);
      fuente.marcarLeido(SETTLE + sid, ts);
      setLeidos((l) => ({ ...l, [SETTLE + sid]: ts }));
      setOptimista((m) => {
        const n = new Map(m);
        for (const id of s.archivar) n.set(id, "archivado");
        return n;
      });
      for (const id of s.archivar) {
        const h = hilos?.find((x) => x.id === id);
        if (!h) continue;
        fuente.cerrar({ ...h, origen: "jefe" }).catch((e) => {
          setOptimista((m) => new Map([...m].filter(([k]) => k !== id)));
          setErrores((m) => new Map(m).set(id, mensaje(e)));
        });
      }
      if (r.lider.origen === "app") cerrarLider(sid, "archivar");
      else setActiva((a) => (a === LIDER + sid ? null : a));
    },
    [ultimo, cerrarLider],
  );

  /** "Pasárselo a un líder": un líder nuevo con la caja llena (id, rama, commits, RESULTADO, DECISION). Rechaza si no se pudo armar. */
  const pasar = useCallback(
    async (h: Hilo) => {
      llenarBorrador(BORRADOR_LIDER, await fuentePaneles.pasar(h));
      abrirLiderNuevo();
    },
    [abrirLiderNuevo],
  );

  /** Retomar (B22): un líder nuevo con el prompt de src/datos/retomar.ts, y se abre. Rechaza si no se pudo. */
  const retomar = useCallback(
    async (h: Hilo, el: Eleccion) => {
      const texto = conTexto(await fuentePaneles.retomar(h), el.texto);
      // El líder nuevo nace en la máquina del worker: ahí corre su `pa`.
      const e = { texto, modelo: el.modelo, effort: el.effort, ...(h.maquina ? { maquina: h.maquina } : {}) };
      const sid = await fuente.liderNuevo(e);
      setFantasmas((m) => new Map(m).set(sid, fantasma(sid, e, GENERAL)));
      alFrente();
      setPanel(null);
      setActiva(LIDER + sid);
    },
    [],
  );

  /**
   * "Mandar a verificar y arreglar" (B25): un líder nuevo con el prompt de
   * src/datos/arreglar.ts, en la carpeta del proyecto (como "Nueva tarea aquí"), y se abre.
   */
  const arreglar = useCallback(async (h: Hilo, estado: Estado, el: Eleccion) => {
    const texto = conTexto(await fuentePaneles.arreglar(h, estado), el.texto);
    const e = { texto, modelo: el.modelo, effort: el.effort, ...(h.maquina ? { maquina: h.maquina } : {}) };
    const sid = await fuente.liderNuevo(e);
    setNombres((n) => ({ ...n, proyectos: { ...n.proyectos, [sid]: h.proyecto } }));
    fuente.guardarProyecto(sid, h.proyecto);
    setFantasmas((m) => new Map(m).set(sid, fantasma(sid, e, h.proyecto)));
    alFrente();
    setPanel(null);
    setActiva(LIDER + sid);
  }, []);

  /**
   * Actualizar (Ramas, tras un choque con main): un worker de `pa` que rebasa la rama sobre main y resuelve el choque,
   * con el modelo y el esfuerzo del paso previo. Rechaza con lo que dijo `pa`; si sale, la fila deja de ofrecerlo.
   */
  const actualizarRama = useCallback(async (h: Hilo, el: Eleccion) => {
    await fuentePaneles.lanzar({ accion: "actualizar", id: h.id, proyecto: h.proyecto, modelo: el.modelo, effort: el.effort, ...(el.texto.trim() ? { texto: el.texto.trim() } : {}) });
    setConflictos((s) => new Set([...s].filter((k) => k !== h.id)));
    setErrores((m) => (m.has(h.id) ? new Map([...m].filter(([k]) => k !== h.id)) : m));
  }, []);

  /** Retomar desde la barra o la vista: no lanza al tocarlo, abre el paso previo; el error sale ahí. */
  const retomarId = useCallback(
    (id: string) => {
      const h = ultimo.current.hilos?.find((x) => x.id === id);
      if (h) pasoLider("retomar", (el) => retomar(h, el));
    },
    [retomar, ultimo],
  );

  /**
   * "Iniciar" del tablero: las tareas van a ese líder (por su cola: a mitad de un turno esperan, y
   * libre salen ya) o a uno nuevo en la carpeta del proyecto (`null`: Inicio). Devuelve su id.
   */
  const iniciarTarea = useCallback(
    async ({ carpeta, lider, texto, modelo: elegido, maquina }: { carpeta: string | null; lider: string | null; texto: string; modelo: string | null; maquina?: string }) => {
      if (lider) {
        // Con su modelo y su esfuerzo: iniciar una tarea no le cambia el modelo con el caché vivo, salvo que el usuario elija otro (la confirmación se lo dice).
        const l = ultimo.current.arbol.lideres.get(lider);
        const m = modeloDeInicio(elegido, l ?? null, MODELO_DEFAULT, modeloDe);
        const effort = m.effort ?? effortPara(m.modelo, effortsLeidos() ?? {});
        await fuente.liderEncolar(lider, { texto, modelo: m.modelo, effort });
        return lider;
      }
      const modelo = modeloDeInicio(elegido, null, MODELO_DEFAULT, modeloDe).modelo;
      const e = { texto, modelo, effort: effortPara(modelo, effortsLeidos() ?? {}), ...(maquina ? { maquina } : {}) };
      const sid = await fuente.liderNuevo(e);
      if (carpeta) {
        setNombres((n) => ({ ...n, proyectos: { ...n.proyectos, [sid]: carpeta } }));
        fuente.guardarProyecto(sid, carpeta);
      }
      setFantasmas((m) => new Map(m).set(sid, fantasma(sid, e, carpeta ?? GENERAL)));
      enviado(sid, texto, 0);
      return sid;
    },
    [ultimo],
  );
  // Los líderes a los que Iniciar les puede escribir: los de la app (uno de terminal no se toca; uno caído se retoma antes).
  const lideresTablero = useMemo<LiderDe[]>(
    () =>
      [...arbol.lideres.values()]
        .filter((l) => l.origen === "app" && !l.caido)
        .map((l) => ({ id: l.id, nombre: l.nombre, carpeta: l.proyecto, ocupado: l.ocupado, actividad: l.actividad, modelo: l.modelo, ...(l.maquina ? { maquina: l.maquina } : {}) })),
    [arbol],
  );
  // Los líderes a los que "Responder y avisar" les puede escribir: los de la app (no caídos) y los abiertos en una terminal que siguen vivos.
  const lideresAviso = useMemo<LiderAviso[]>(
    () =>
      [...arbol.lideres.values()]
        .filter((l) => !l.caido && (l.origen === "app" || l.vivo))
        .map((l) => ({ id: l.id, nombre: l.nombre, carpeta: l.proyecto, origen: l.origen, ocupado: l.ocupado, actividad: l.actividad, ...(l.maquina ? { maquina: l.maquina } : {}) })),
    [arbol],
  );
  const jefeDe = useCallback((worker: string) => ultimo.current.hilos?.find((h) => h.id === worker)?.jefe_id ?? null, [ultimo]);
  /** Por su cola, como la caja: a mitad de un turno espera, libre sale ya, y uno de terminal se trae primero. Con su modelo: no se lo cambia. */
  const avisarLider = useCallback(
    async (id: string, texto: string) => {
      const l = ultimo.current.arbol.lideres.get(id);
      const m = modeloDeInicio(null, l ?? null, MODELO_DEFAULT, modeloDe);
      const effort = m.effort ?? effortPara(m.modelo, effortsLeidos() ?? {});
      await fuente.liderEncolar(id, { texto, modelo: m.modelo, effort, ...(l?.origen === "terminal" && l.nombre ? { nombre: l.nombre } : {}) });
    },
    [ultimo],
  );
  useEffect(() => {
    if (panel !== "tablero") return;
    let vivo = true;
    void fuente.slugsPorNombre().then((s) => vivo && setSlugsReg(s));
    return () => {
      vivo = false;
    };
  }, [panel]);

  /**
   * El tablero nuevo: deja el mensaje armado en la caja de ese líder (debajo de lo que ya tuviera escrito) o de uno
   * nuevo en la carpeta del proyecto, y abre su conversación. No envía nada.
   */
  const redactarTablero = useCallback(
    ({ carpeta, lider, texto }: { carpeta: string | null; lider: string | null; texto: string }) => {
      const clave = lider ? `lider:${lider}` : BORRADOR_LIDER;
      llenarBorrador(clave, sumarAlBorrador(leerBorrador(clave).texto, texto));
      if (lider) abrirLider(lider);
      else {
        abrirLiderNuevo();
        // Después de abrir: abrir un líder nuevo suelta la carpeta que quedó pedida.
        nuevaEn.current = carpeta;
      }
    },
    [abrirLider, abrirLiderNuevo],
  );

  const liderCreado = useCallback((sid: string, e: { modelo: string; effort: string; modo?: string; texto?: string; maquina?: string }) => {
    // Nació con "Nueva tarea aquí": va a esa carpeta (como un Mover a proyecto…).
    const en = nuevaEn.current;
    nuevaEn.current = null;
    if (en) {
      setNombres((n) => ({ ...n, proyectos: { ...n.proyectos, [sid]: en } }));
      fuente.guardarProyecto(sid, en);
    }
    setFantasmas((m) => new Map(m).set(sid, fantasma(sid, e, en ?? GENERAL)));
    // Si el usuario se fue a otro lado mientras arrancaba, no se lo lleva.
    setActiva((a) => (a === LIDER_NUEVO ? LIDER + sid : a));
  }, []);

  // Mostrar/ocultar: el ancho de la barra cambia de golpe y su cuerpo entra o
  // sale deslizando (CSS). Lo del panel derecho que cambió de lugar lo acompaña
  // con un FLIP a mano: sólo `transform`.
  const antes = useRef<Map<HTMLElement, number> | null>(null);
  const alternarConsumo = useCallback(() => {
    setConsumo((c) => {
      fuente.guardarConsumo(!c);
      return !c;
    });
  }, []);
  const carpetaVista = useCallback((p: string) => titulos.get(p) ?? p, [titulos]);
  const alternarBarra = useCallback(() => {
    const el = raiz.current;
    if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      antes.current = new Map(
        // El botón de la vista está escondido con la barra abierta: sin caja, no hay de dónde deslizar.
        [...el.querySelectorAll<HTMLElement>("[data-desliza]")]
          .filter((n) => n.getClientRects().length > 0)
          .map((n) => [n, n.getBoundingClientRect().left]),
      );
    setAbierta((a) => !a);
  }, []);
  useLayoutEffect(() => {
    const m = antes.current;
    antes.current = null;
    if (!m) return;
    for (const [n, x] of m) {
      if (n.getClientRects().length === 0) continue;
      const dx = x - n.getBoundingClientRect().left;
      if (Math.abs(dx) > 0.5)
        n.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], {
          duration: 220,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
    }
  }, [abierta]);

  useEffect(() => {
    guardar(CLAVE_ANCHO, String(ancho));
    // Angosto, `abierta` es qué se está viendo: no pisa lo que el usuario eligió en el escritorio.
    if (!angosto) guardar(CLAVE_ABIERTA, abierta ? "1" : "0");
  }, [ancho, abierta, angosto]);

  // Al achicarse a angosto queda adelante lo abierto (o la lista, si no hay nada); al volver a
  // ancho, la barra como estaba. Sin nada abierto no hay qué mostrar: la lista.
  useLayoutEffect(() => {
    if (!angosto) return;
    const escritorio = abierta;
    setAbierta(!(activa || panel));
    return () => setAbierta(escritorio);
  }, [angosto]);
  useEffect(() => {
    if (angosto && !activa && !panel) setAbierta(true);
  }, [angosto, activa, panel]);
  const aLista = useCallback(() => {
    setPanel(null);
    setAbierta(true);
  }, []);
  const volverALista = useAtras(angosto && !abierta, aLista);

  // Arrastrar el borde: mientras dura se escribe directo en el DOM (ni un
  // render de React por movimiento); el estado se asienta al soltar.
  const arrastrar = (e: PunteroReact<HTMLDivElement>) => {
    const el = raiz.current;
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    const tirador = e.currentTarget;
    const x0 = e.clientX;
    let w = ancho;
    let oculta = false;
    tirador.setPointerCapture(e.pointerId);
    el.setAttribute("data-arr", "");
    const mover = (ev: PointerEvent) => {
      // `ancho` son px de la letra 13 (el CSS lo multiplica): el arrastre se lleva a esa escala.
      const crudo = ancho + ((ev.clientX - x0) * LETRA_DEF) / apariencia().letra;
      oculta = crudo < ANCHO_OCULTAR;
      if (!oculta) el.style.setProperty("--ancho-barra", `${(w = acotar(crudo))}px`);
      el.toggleAttribute("data-oculta", oculta);
    };
    const soltar = () => {
      tirador.removeEventListener("pointermove", mover);
      tirador.removeEventListener("pointerup", soltar);
      tirador.removeEventListener("pointercancel", soltar);
      el.removeAttribute("data-arr");
      setAncho(w);
      setAbierta(!oculta);
    };
    tirador.addEventListener("pointermove", mover);
    tirador.addEventListener("pointerup", soltar);
    tirador.addEventListener("pointercancel", soltar);
  };

  const teclaTirador = (e: TeclaReact) => {
    const paso = ({ ArrowLeft: -16, ArrowRight: 16 } as Record<string, number>)[e.key];
    if (paso) setAncho((w) => acotar(w + paso));
    else if (e.key === "Home") setAncho(ANCHO_MIN);
    else if (e.key === "End") setAncho(ANCHO_MAX);
    else return;
    e.preventDefault();
  };

  // Teclado: un solo listener para toda la barra.
  useEffect(() => {
    const mover = (id: string | null | undefined) => {
      if (id === undefined) return;
      setCursor(id);
      if (id)
        requestAnimationFrame(() => {
          const el = lista.current?.querySelector(`[data-fila="${id}"]`);
          // Virtualizada, la fila puede no estar pintada: se scrollea hasta donde iría.
          if (el) el.scrollIntoView({ block: "nearest" });
          else irA(id);
        });
    };
    const tecla = (e: KeyboardEvent) => {
      const { visibles, cursor, activa, busqueda, panel, arbol, vista } = ultimo.current;
      const ids = visibles.map((f) => f.h.id);
      const donde = e.target as HTMLElement;
      const enCampo = donde === campo.current;
      if (es("salir", e)) {
        e.preventDefault();
        abrirSalir();
        return;
      }
      if (es("buscar", e)) {
        e.preventDefault();
        setAbierta(true);
        campo.current?.focus();
        campo.current?.select();
        return;
      }
      // Ctrl+N (y Ctrl+Shift+N, el de antes): Nueva tarea es siempre un líder; los workers los lanza él.
      if (es("nuevo", e)) {
        e.preventDefault();
        abrirLiderNuevo();
        return;
      }
      // Lo que se escribe en la caja de respuesta o se mueve en un menú no es para la barra.
      if (!enCampo && donde.closest?.('input, textarea, [contenteditable], [role="listbox"], [role="menu"], [role="separator"]')) return;
      if (es("atras", e)) {
        if (enCampo) {
          if (busqueda) setBusqueda("");
          else campo.current?.blur();
        } else if (panel) setPanel(null);
        else if (cursor) setCursor(null);
        else setActiva(null);
        return;
      }
      if (enCampo) {
        if (e.key !== "Enter" && e.key !== "ArrowDown") return;
        campo.current?.blur();
        mover(ids[0]);
        return e.preventDefault();
      }
      if (es("atajos", e)) {
        e.preventDefault();
        abrirAtajos();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ids.indexOf(cursor ?? activa ?? "");
      if (es("siguiente", e)) mover(ids[Math.min(ids.length - 1, i + 1)]);
      else if (es("anterior", e)) mover(ids[i < 0 ? ids.length - 1 : Math.max(0, i - 1)]);
      else if (es("abrir", e)) {
        // Sobre un botón con foco, Enter es de ese botón.
        if (!cursor || donde.closest?.("button, summary")) return;
        abrir(cursor);
      } else if (es("cerrar", e)) {
        // Lo que murió con commits no se va con una tecla: Integrar o Quitar, a mano.
        if (!cursor || i < 0 || (salidaWorker(visibles[i].h, visibles[i].estado, arbol.aCargo) ?? "elegir") === "elegir") return;
        cerrar(cursor);
        mover(ids[i + 1] ?? ids[i - 1] ?? null);
      } else if (es("vista", e)) {
        // Sólo líderes ↔ todo.
        ponerVista(vista === "lideres" ? "todo" : "lideres");
      } else if (es("consumo", e)) {
        // El panel de consumo (tokens), a la derecha.
        alternarConsumo();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ultimo, cerrar, abrir, abrirLiderNuevo, ponerVista, alternarConsumo]);

  useEffect(() => {
    // En captura el mouse real no cuenta: el estado es el forzado.
    if (!MODO.captura) armarTips();
    control.actual = {
      grupos: () => ultimo.current.grupos.map((g) => g.proyecto),
      cerrables: () => {
        const { visibles, arbol } = ultimo.current;
        // Como la tecla "c": lo que murió con commits no se va sin que el usuario elija.
        return visibles.filter((f) => (salidaWorker(f.h, f.estado, arbol.aCargo) ?? "elegir") !== "elegir").map((f) => f.h.id);
      },
      cerrar,
      alternar,
    };
    if (MODO.guion === "barra") void correrGuion();
    if (MODO.guion === "paneles") void correrGuionPaneles();
    return () => {
      control.actual = null;
    };
  }, [ultimo, cerrar, alternar]);

  // Capturas: el estado se fuerza acá, sin mouse ni teclado.
  const forzado = useRef(false);
  useEffect(() => {
    const c = MODO.captura;
    if (!hilos || forzado.current || !c) return;
    forzado.current = true;
    const primero = (e: Estado) => hilos.find((h) => estadoVisto(h) === e)?.id ?? null;
    const proyectos = grupos.map((g) => g.proyecto);
    // La caja (modelo, esfuerzo, aviso de cambiar de modelo), el indicador y los avisos: en el líder de la app.
    const app = lideres.find((l) => l.origen === "app" && l.vivo)?.id ?? lideres[0]?.id ?? "";
    const enApp = ["lider", "modelo", "esfuerzo", "local-esfuerzo", "local-ctx", "aviso", "lider-trabajando", "lider-avisos", "lider-plan", "lider-permiso", "lider-preguntas", "lider-preguntas-dos", "lider-comandos", "lider-dictado", "lider-valores", "lider-sistema", "lider-compactando", "lider-relevo", "lider-imagenes", "lider-tabla", "lider-formato", "lider-listas", "lider-hover", "lider-pensando", "lider-gemini", "te-espera", "tablero-nuevo-chat", "foco-caja", "consumo"].includes(c) || c.startsWith("contexto");
    if (enApp) setActiva(LIDER + app);
    if (c === "tablero-nuevo-chat") {
      // El tablero nuevo: el mensaje con las respuestas de muestra, armado en la caja del líder y sin enviar.
      const ahora = Date.now();
      const p = armarProyectos(validar(tableroFijo(ahora, true)), ahora).find((x) => x.nombre === "atlas");
      if (p) llenarBorrador(`lider:${app}`, armarMensaje(p.nombre, tocadas(p, muestraTocada())));
    }
    if (c === "lider-trabajando" || c === "lider-hover") escenaFija(app, "trabajando");
    if (c === "lider-avisos") escenaFija(app, "avisos");
    if (c === "lider-pensando" && MODO.variante === "vivo") {
      // El usuario acaba de pedir algo y el líder razona: el pedido, "Pensando…" y el texto que va llegando (la charla de siempre tiene 6 mensajes).
      enviado(app, "Mirá por qué falla el índice de cauce y arreglalo.", 6);
      escenaFija(app, "pensando");
    }
    if (c === "lider-gemini") {
      enviado(app, "Mirá por qué falla el índice de cauce y arreglalo.", 6);
      escenaFija(app, "gemini");
    }
    if (c === "lider-plan") escenaFija(app, "plan");
    if (c === "lider-permiso") escenaFija(app, "permiso");
    if (c === "lider-preguntas") escenaFija(app, "preguntas");
    if (c === "lider-preguntas-dos") escenaFija(app, "preguntas-dos");
    if (c === "lider-compactando") escenaFija(app, "compactando");
    if (c === "lider-imagenes") agregarAdjuntos(`lider:${app}`, [imagenFija(900, 600, 140)]);
    if (c === "lider-relevo") escenaFija(app, MODO.variante === "hecho" ? "relevado" : "relevo");
    if (c === "settle-confirmar") {
      const r = [...arbol.lideres.keys()].find((sid) => (settleDe(ramaDe(arbol, sid)) ?? 0) > 0);
      if (r) setActiva(LIDER + r);
    }
    // Compactan un worker que trabaja y el líder de terminal (la marca del hook, de mentira).
    const terminal = lideres.find((l) => l.origen === "terminal" && !l.caido)?.id ?? null;
    if (c === "compactando") {
      const w = primero("trabajando");
      if (w) compactarFijo(w, true);
      if (terminal) compactarFijo(terminal, true);
    }
    if (c === "lider-terminal") setActiva(LIDER + (lideres.find((l) => l.origen === "terminal")?.id ?? ""));
    if (c === "lider-muerto" || c === "lider-app-muerto") setActiva(LIDER + (lideres.find((l) => l.caido)?.id ?? ""));
    if (c === "maquinas-lider") setActiva(LIDER + (lideres.find((l) => l.maquina)?.id ?? ""));
    if (c === "arrancando") setActiva(ARRANCANDO.id);
    else if (c === "frenado") setActiva(FRENADO.id);
    else if (c === "worker-en-cola") setActiva(EN_COLA.id);
    else if (c === "worker-vista") setActiva(primero("listo"));
    else if (c === "worker-vista-vivo") setActiva(primero("trabajando"));
    else if (c === "leyendo" && MODO.variante === "lider") setActiva(LIDER + app);
    else if (c === "leyendo") setActiva(primero("decision"));
    if (c === "lider-nuevo" || c === "lider-nuevo-carpeta" || c === "local-esfuerzo" || c === "local-ctx" || c.startsWith("maquinas-selector")) setActiva(LIDER_NUEVO);
    else if (c === "compactando" && MODO.variante === "lider") setActiva(LIDER + (terminal ?? ""));
    else if (c !== "vacio" && !enApp && !c.startsWith("lider") && c !== "settle-confirmar" && c !== "arrancando" && c !== "frenado" && c !== "worker-en-cola" && !c.startsWith("worker-vista") && c !== "leyendo" && c !== "maquinas-lider" && !c.startsWith("maquinas-selector")) setActiva(primero(c === "trabajando" || c === "compactando" ? "trabajando" : "decision"));
    if (c === "buscar") {
      setBusqueda("yaml");
      campo.current?.focus();
    }
    if (c === "hover") setCursor(primero("listo"));
    // El anillo de foco, como lo deja el teclado (`data-anillo`: una ventana de captura sin foco no dibuja `:focus-visible`).
    if (c === "foco-barra") setTimeout(() => lista.current?.querySelector<HTMLElement>("[data-fila] button")?.setAttribute("data-anillo", ""), 400);
    if (c === "foco-caja") setTimeout(() => document.querySelector<HTMLElement>(".caja button")?.setAttribute("data-anillo", ""), 600);
    // El orden a mano (docs/estado/orden-barra.md): lo que se ve a mitad de un arrastre (lo que se lleva apagado en su lugar y la línea
    // donde cae, como la deja `arrastre.ts`) y el menú de una carpeta del medio con Subir / Bajar / Orden por defecto.
    // Arrastrar y Subir / Bajar son del orden fijo: estas dos capturas lo apagan (el de fábrica es por prioridad).
    if (c === "orden-arrastrando") {
      setNombres((n) => ({ ...n, orden: { ...n.orden, prioridad: false } }));
      setTimeout(() => {
        const lis = lista.current;
        if (!lis || !linea.current) return;
        const L = lis.getBoundingClientRect();
        const unidades = (css: string) => [...lis.querySelectorAll<HTMLElement>(css)];
        const propia = unidades(".proy").find((p) => p.querySelectorAll(".lider").length >= 2);
        const hs = propia ? [...propia.querySelectorAll<HTMLElement>(".lider")].map((x) => x.closest<HTMLElement>("[data-lider]") ?? x) : unidades(".proy").slice(1);
        if (hs.length < 2) return;
        const quien = hs[hs.length - 1];
        const caja = hs[0].getBoundingClientRect();
        quien.setAttribute("data-movida", "");
        raiz.current?.setAttribute("data-moviendo", "");
        linea.current.style.width = `${caja.width}px`;
        linea.current.style.transform = `translate(${caja.left - L.left - lis.clientLeft + lis.scrollLeft}px, ${caja.top - 3 - L.top - lis.clientTop + lis.scrollTop}px)`;
        linea.current.setAttribute("data-ve", "");
      }, 700);
    }
    if (c === "orden-menu") {
      const medio = grupos.map((g) => g.proyecto).filter((p) => p !== GENERAL)[1];
      setNombres((n) => ({ ...n, orden: { carpetas: grupos.map((g) => g.proyecto).filter((p) => p !== GENERAL), lideres: {}, prioridad: false } }));
      setTimeout(() => {
        const el = lista.current?.querySelector<HTMLElement>(`[data-carpeta="${CSS.escape(medio ?? "")}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        setMenu({ x: r.left + 24, y: r.bottom - 4, de: { tipo: "carpeta", proyecto: medio }, origen: el });
      }, 500);
    }
    if (c === "orden-prioridad") setNombres((n) => ({ ...n, orden: { ...n.orden, prioridad: true } }));
    if (c === "mover-menu") {
      setTimeout(() => {
        const el = lista.current?.querySelector<HTMLElement>("[data-lider]");
        const sid = el?.getAttribute("data-lider");
        if (!el || !sid) return;
        const r = el.getBoundingClientRect();
        setMenu({ x: r.left + 24, y: r.bottom - 4, de: { tipo: "lider", sid }, origen: el, mover: true });
      }, 500);
    }
    if (c === "colapsado") setColapsados(new Set(proyectos.slice(1, 2)));
    if (c === "oculta") setAbierta(false);
    // Angosto se ve lo abierto; la lista, con HILOS_VARIANTE=lista (o si no hay nada que abrir).
    if (esAngosto()) setAbierta(MODO.variante === "lista" || c === "vacio" || c === "foco-barra" || c === "orden-arrastrando" || c === "orden-menu" || c === "orden-prioridad" || c === "mover-menu" || (c.startsWith("maquinas") && c !== "maquinas-lider" && !c.startsWith("maquinas-selector")));
    if (c === "ajustes") setPanel("ajustes");
    if (c === "estadisticas" || c === "estadisticas-30" || c === "estadisticas-medido" || c === "estadisticas-vacia") setPanel("estadisticas");
    if (c.startsWith("tablero") && c !== "tablero-nuevo-chat") setPanel("tablero");
    if (c === "ramas" || c === "ramas-confirmar" || c === "ramas-analista" || c === "ramas-conflicto" || c === "ramas-lanzar" || c === "ramas-lanzar-error") setPanel("ramas");
    if (c === "ramas-conflicto" || c === "ramas-lanzar" || c === "ramas-lanzar-error") {
      // Una rama que chocó con main: su fila ofrece Actualizar, y el paso previo se ve abierto (con el error de pa en la última).
      const quieta = ramas(hilos, new Map()).pendientes.flatMap((g) => g.filas).find((f) => f.estado !== "trabajando" && f.estado !== "colgado");
      if (quieta) {
        setConflictos(new Set([quieta.h.id]));
        setErrores(new Map([[quieta.h.id, "pa: conflicts merging into main. A worker can resolve it: pa atlas --actualizar 20261003-100900-13131"]]));
        if (c !== "ramas-conflicto") {
          const fallar = c === "ramas-lanzar-error";
          pasoWorker("actualizar", fallar ? () => Promise.reject(new Error("pa: effort 'max' with 'claude-opus-5-5' needs --ok-dueno")) : () => Promise.resolve());
        }
      }
    }
    if (c === "ramas-confirmar") {
      // Una rama con el Descartar armado (lo arma el panel) y otra a la que le fallaron los tests.
      const roja = ramas(hilos, new Map()).pendientes.flatMap((g) => g.filas)[1];
      if (roja) setErrores(new Map([[roja.h.id, tr("error.testsRojos")]]));
    }
    if (c === "arbol") {
      setColapsados(new Set(proyectos.slice(0, 2)));
      setPliegues(new Set(grupos.flatMap((g) => g.ramas.map((r) => r.clave))));
    }
    if (c === "solo-lideres" || (c === "frenado" && MODO.variante === "lideres")) setVista("lideres");
    if (c === "ocultos") {
      // El líder con más terminados escondidos, con su "N terminados" desplegado.
      const r = grupos
        .flatMap((g) => g.ramas)
        .filter((x) => x.tipo === "lider")
        .sort((x, y) => y.viejas.length - x.viejas.length)[0];
      if (r) setPliegues(new Set([r.clave]));
    }
    if (c === "cerrados") {
      setColapsados(new Set(proyectos.slice(1, 4)));
      setCerradosAbiertos(true);
      setTimeout(() => lista.current?.scrollTo(0, lista.current.scrollHeight), 400);
    }
  }, [hilos, grupos, lideres, arbol]);

  // Virtualizada: lo que se movió (datos, colapsar, ancho) puede cambiar qué filas caen a la vista.
  useLayoutEffect(() => {
    if (virtual) avisarVentana();
  });
  useEffect(() => {
    const el = lista.current;
    ponerLista(el);
    if (!el) return;
    const ro = new ResizeObserver(() => avisarVentana());
    ro.observe(el);
    return () => {
      ro.disconnect();
      ponerLista(null);
    };
  }, []);

  const hiloActivo = activa ? (todos.find((h) => h.id === activa) ?? null) : null;
  const sidActivo = activa?.startsWith(LIDER) && activa !== LIDER_NUEVO ? activa.slice(LIDER.length) : null;
  const liderActivo = sidActivo ? (arbol.lideres.get(sidActivo) ?? fantasmas.get(sidActivo) ?? null) : null;
  // Lo abierto cambia: se guarda para volver (demorado, src/volver.ts).
  useEffect(huboCambio, [activa, panel, abierta]);
  // Lo que quedó abierto de la vez anterior y ya no existe (se archivó, se quitó, pasó más de un día): se abre normal, sin conversación.
  const porVerificar = useRef(vueltaInicial()?.activa ?? null);
  useEffect(() => {
    const a = porVerificar.current;
    if (!a || !listosPa || !listosLideres) return;
    porVerificar.current = null;
    if (a === activa && a !== LIDER_NUEVO && !hiloActivo && !liderActivo) setActiva(null);
  }, [listosPa, listosLideres, activa, hiloActivo, liderActivo]);
  // La carpeta de lo que se está viendo (un líder, o un worker: la de su líder si cuelga de uno): se marca su marco.
  // "Te espera": título, bandeja y notificación; apagarlo al mirar esa conversación; la notificación abre la conversación.
  useEspera(lideresVistos, sidActivo);
  useAlAbrirEspera(abrirLider);

  const carpetaActiva = liderActivo
    ? liderActivo.proyecto
    : hiloActivo && !cerrados.some((it) => it.h.id === hiloActivo.id)
      ? (arbol.lideres.get(hiloActivo.jefe_id ?? "")?.proyecto ?? hiloActivo.proyecto)
      : null;

  // El líder que se está viendo queda siempre a la vista: al elegirlo, o cuando cambia de carpeta
  // (uno nuevo arranca en el home y pasa a la de su proyecto), se abre la suya aunque estuviera
  // plegada. Sólo en ese cambio: si después el usuario la pliega a mano, se queda plegada.
  const lugar = sidActivo ? lugarLider(arbol, sidActivo) : null;
  const desplegado = useRef<Lugar | null>(null);
  useLayoutEffect(() => {
    if (desplegado.current?.sid !== sidActivo) desplegado.current = null;
    // Buscando las carpetas ya están abiertas (y nadie está en espera): se decide al salir de la búsqueda.
    if (!lugar || buscando) return;
    const claves = aDesplegar(desplegado.current, lugar);
    desplegado.current = lugar;
    if (!claves.length) return;
    const espera = claves.filter((k) => k.includes(":"));
    // Sólo cayó en espera: se abre ese pliegue, la carpeta no se toca.
    if (claves.includes(lugar.proyecto))
      setColapsados((s) => {
        if (!s.has(lugar.proyecto)) return s;
        const n = new Set(s);
        n.delete(lugar.proyecto);
        guardar(CLAVE_COLAPSADOS, JSON.stringify([...n]));
        return n;
      });
    if (espera.length) setPliegues((s) => (espera.every((k) => s.has(k)) ? s : new Set([...s, ...espera])));
    const sid = lugar.sid;
    requestAnimationFrame(() => lista.current?.querySelector(`[data-lider="${CSS.escape(sid)}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [sidActivo, lugar?.proyecto, lugar?.espera, lugar?.dormido, buscando]);
  // --- B20: clic derecho y renombrar ----------------------------------------------

  /** Clic derecho (o Shift+F10 / la tecla de menú) sobre un worker, un líder o una carpeta. */
  const abrirMenu = (e: RatonReact) => {
    const el = e.target as HTMLElement;
    const w = el.closest<HTMLElement>("[data-fila]");
    const l = el.closest<HTMLElement>("[data-lider]");
    const c = el.closest<HTMLElement>("[data-carpeta]");
    const de: MenuAbierto["de"] | null = w
      ? { tipo: "worker", id: w.dataset.fila! }
      : l
        ? { tipo: "lider", sid: l.dataset.lider! }
        : c
          ? { tipo: "carpeta", proyecto: c.dataset.carpeta! }
          : null;
    if (!de) return;
    e.preventDefault();
    const origen = w?.querySelector<HTMLElement>("button") ?? l ?? c;
    let { clientX: x, clientY: y } = e;
    // Desde el teclado puede no traer dónde: abajo de la fila.
    if (x === 0 && y === 0 && origen) {
      const r = origen.getBoundingClientRect();
      x = r.left + 16;
      y = r.bottom;
    }
    setRenombrando(null);
    setMenu({ x, y, de, origen });
  };

  const cerrarMenu = () => {
    menu?.origen?.focus();
    setMenu(null);
  };

  const empezarRenombre = (id: string, sel: string, original: string, valor: string, origen: HTMLElement | null) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    // El campo llega hasta el borde de la fila: el título puede crecer.
    const f = (el.closest<HTMLElement>(".w, .lw") ?? el).getBoundingClientRect();
    const caja = { left: r.left, top: r.top, width: Math.max(r.width, f.right - r.left - 8), height: r.height };
    setRenombrando({ id, valor, original, caja, letra: getComputedStyle(el).font, origen });
  };

  /** Guardar un título: vacío o igual al de siempre lo borra (vuelve la tarea o el nombre). */
  const guardarTitulo = (r: Renombrando, texto: string) => {
    setRenombrando(null);
    r.origen?.focus();
    const t = primeraLinea(texto).slice(0, 200);
    const quitar = !t || t === r.original;
    if (t === r.valor || (quitar && !nombres.titulos[r.id])) return;
    setNombres((n) => {
      const titulos = { ...n.titulos };
      if (quitar) delete titulos[r.id];
      else titulos[r.id] = t;
      return { ...n, titulos };
    });
    fuente.guardarTitulo(r.id, quitar ? "" : t);
  };

  const moverLider = (sid: string, slug: string | null) => {
    setNombres((n) => {
      const proyectos = { ...n.proyectos };
      if (slug) proyectos[sid] = slug;
      else delete proyectos[sid];
      return { ...n, proyectos };
    });
    fuente.guardarProyecto(sid, slug);
  };

  // Reordenar arrastrando (`arrastre.ts`): un líder dentro de su carpeta, o una carpeta entre las demás.
  // Se guarda la lista entera de ese grupo, ya sin los líderes y las carpetas que no existen más.
  const linea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = lista.current;
    // En captura el mouse real no cuenta.
    if (!el || MODO.captura) return;
    return armarArrastre(el, {
      raiz: () => raiz.current,
      linea: () => linea.current,
      puede: () => !ultimo.current.busqueda.trim(),
      alSoltar: (m) => {
        const { orden, grupos, titulos } = ultimo.current;
        const carpeta = m.grupo === CARPETAS ? null : m.grupo.slice(m.grupo.indexOf(":") + 1);
        const visibles = visiblesDe(grupos, orden, titulos, carpeta);
        if (!visibles) return;
        asentarOrden(reordenar(orden, carpeta, visibles, m.id, m.junto, m.antes));
      },
    });
  }, [ultimo]);

  /** Guarda el orden que quedó (arrastrando o desde el menú), ya sin lo que no existe más. Sin cambio (`null`), nada. */
  const asentarOrden = (movido: Orden | null) => {
    if (!movido) return;
    const { lideresVistos, carpetasReg, grupos } = ultimo.current;
    const nuevo = podar(movido, {
      lideres: lideresVistos.length ? new Set(lideresVistos.map((l) => l.id)) : null,
      carpetas: carpetasReg.length ? new Set([...carpetasReg, ...grupos.map((x) => x.proyecto)]) : null,
    });
    setNombres((n) => ({ ...n, orden: nuevo }));
    fuente.guardarOrden(nuevo);
  };

  /** Vuelve al orden automático: borra lo que se acomodó a mano (carpetas y líderes); el interruptor de prioridad queda como estaba. */
  const ordenPorDefecto = () => {
    const sin = { ...ultimo.current.orden, carpetas: [], lideres: {} };
    setNombres((n) => ({ ...n, orden: sin }));
    fuente.guardarOrden(sin);
  };

  /** Prende o apaga el orden por prioridad (de fábrica, prendido; lo puesto a mano queda guardado, sin uso mientras esté prendido). */
  const alternarPrioridad = () => {
    const nuevo: Orden = { ...ultimo.current.orden, prioridad: !prioridadPrendida(ultimo.current.orden) };
    setNombres((n) => ({ ...n, orden: nuevo }));
    fuente.guardarOrden(nuevo);
  };

  /**
   * Un lugar arriba o abajo desde el menú (`dir`), con el mismo `reordenar` que al soltar. El vecino es el
   * que se ve junto a la fila (un líder plegado en "en espera" no cuenta para uno que está a la vista).
   */
  const pasoOrden = (de: MenuAbierto["de"], dir: -1 | 1): Orden | null => {
    const { orden, grupos, titulos } = ultimo.current;
    if (de.tipo === "worker") return null;
    if (de.tipo === "carpeta") {
      const visibles = visiblesDe(grupos, orden, titulos, null);
      return visibles && de.proyecto !== GENERAL ? reordenarPaso(orden, null, visibles, de.proyecto, dir) : null;
    }
    const g = grupos.find((x) => [...x.ramas, ...x.espera, ...x.dormidos].some((r) => r.lider?.id === de.sid));
    const visibles = g && visiblesDe(grupos, orden, titulos, g.proyecto);
    if (!g || !visibles) return null;
    const mios = [g.ramas, g.espera, g.dormidos].find((rs) => rs.some((r) => r.lider?.id === de.sid))!;
    const juntos = new Set(mios.flatMap((r) => (r.lider ? [r.lider.id] : [])));
    return reordenarPaso(orden, g.proyecto, visibles, de.sid, dir, visibles.filter((id) => juntos.has(id)));
  };

  const ocultarTerminados = (proyecto: string, si: boolean) => {
    setNombres((n) => ({ ...n, ocultos: [...n.ocultos.filter((x) => x !== proyecto), ...(si ? [proyecto] : [])] }));
    fuente.guardarOculto(proyecto, si);
  };

  /** Borrar un worker terminado: `pa --archivar` (aunque tenga rama: para tirarla, Descartar). Optimista. */
  const borrarWorker = (h: Hilo) => {
    const id = h.id;
    setOptimista((m) => new Map(m).set(id, "archivado"));
    setErrores((m) => (m.has(id) ? new Map([...m].filter(([k]) => k !== id)) : m));
    fuente.cerrar({ ...h, origen: "jefe" }).catch((e) => {
      setOptimista((m) => new Map([...m].filter(([k]) => k !== id)));
      setErrores((m) => new Map(m).set(id, mensaje(e)));
    });
  };

  const copiar = (id: string) => void copiarConAviso(id);

  const hacer = (m: MenuAbierto, o: Opcion) => {
    const { hilos, optimista, arbol } = ultimo.current;
    const listo = () => {
      setMenu(null);
      m.origen?.focus();
    };
    if (m.de.tipo === "worker") {
      const id = m.de.id;
      const h = hilos?.find((x) => x.id === id);
      if (!h) return listo();
      const visto = todos.find((x) => x.id === id) ?? h;
      if (o.a === "renombrar") {
        setMenu(null);
        return empezarRenombre(id, `[data-fila="${CSS.escape(id)}"] .l1 .t`, h.tarea, visto.tarea, m.origen);
      }
      listo();
      if (o.a === "settle") cerrar(id);
      else if (o.a === "parar") fuente.parar(h).catch((e) => setErrores((x) => new Map(x).set(id, mensaje(e))));
      else if (o.a === "copiar") copiar(id);
      else if (o.a === "borrar" && cerrable(estadoVisto(h, optimista.get(id)))) borrarWorker(h);
      else if (o.a === "descartar") actuar(id, "descartar");
      return;
    }
    if (m.de.tipo === "lider") {
      const sid = m.de.sid;
      if (o.a === "mover") return setMenu({ ...m, mover: true });
      if (o.a === "renombrar") {
        setMenu(null);
        const original = lideres.find((l) => l.id === sid)?.nombre ?? "";
        return empezarRenombre(sid, `[data-lider="${CSS.escape(sid)}"] .nom`, original, arbol.lideres.get(sid)?.nombre ?? original, m.origen);
      }
      listo();
      if (o.a === "subir" || o.a === "bajar") asentarOrden(pasoOrden(m.de, o.a === "subir" ? -1 : 1));
      else if (o.a === "defecto") ordenPorDefecto();
      else if (o.a === "prioridad") alternarPrioridad();
      else if (o.a === "settle") settleLiderYa(sid);
      else if (o.a === "parar") void fuente.liderParar(sid).catch(() => {});
      else if (o.a === "copiar") copiar(sid);
      else if (o.a === "borrar") cerrarLider(sid, "borrar");
      return;
    }
    const p = m.de.proyecto;
    if (o.a === "nueva") {
      setMenu(null);
      abrirLiderNuevo();
      nuevaEn.current = p;
      return;
    }
    listo();
    if (o.a === "subir" || o.a === "bajar") asentarOrden(pasoOrden(m.de, o.a === "subir" ? -1 : 1));
    else if (o.a === "defecto") ordenPorDefecto();
    else if (o.a === "prioridad") alternarPrioridad();
    else if (o.a === "ocultar" || o.a === "mostrar") ocultarTerminados(p, o.a === "ocultar");
  };

  /** Qué puede hacer una fila con el orden a mano: sin buscar (ahí el orden es el de la búsqueda) y sólo líderes y carpetas. */
  const lugarMenu = (de: MenuAbierto["de"]): LugarMenu | undefined =>
    buscando || de.tipo === "worker" ? undefined : { sube: pasoOrden(de, -1) !== null, baja: pasoOrden(de, 1) !== null, defecto: hayOrdenManual(nombres.orden), prioridad: porPrioridad };

  /** Lo que se ve en el menú abierto, en el idioma de ahora. */
  const itemsMenu = (m: MenuAbierto): ItemMenu[] => {
    const { de } = m;
    if (de.tipo === "lider" && m.mover) {
      const ya = nombres.proyectos[de.sid] ?? null;
      const donde = arbol.lideres.get(de.sid)?.proyecto ?? null;
      // Sin repetidos (por slug y por cómo se ve), el del home primero y el resto por nombre.
      const vistos = new Set<string>();
      const lista = [...new Set([...carpetasReg, ...grupos.map((g) => g.proyecto), ...(ya ? [ya] : [])])]
        .filter((p) => p !== GENERAL)
        .map((p) => ({ p, texto: nombreCarpeta(p, MODO.usuario, tr("barra.home"), titulosReg[p]) }))
        .filter(({ texto }) => !vistos.has(texto.toLowerCase()) && !!vistos.add(texto.toLowerCase()))
        .sort((a, b) => a.texto.localeCompare(b.texto, undefined, { sensitivity: "base", numeric: true }));
      const casa = { p: GENERAL, texto: nombreCarpeta(GENERAL, MODO.usuario, tr("barra.home")) };
      return [
        { clave: "auto", texto: tr("menu.moverAuto"), marcado: ya === null, fijo: true, alElegir: () => (moverLider(de.sid, null), cerrarMenu()) },
        ...[casa, ...lista].map(({ p, texto }) => ({
          clave: `a:${p}`,
          texto,
          marcado: ya === p,
          nota: ya === null && donde === p ? tr("menu.moverActual") : undefined,
          alElegir: () => (moverLider(de.sid, p), cerrarMenu()),
        })),
      ];
    }
    let ops: Opcion[] = [];
    let settle = 0;
    // Lo que hace el botón de cerrar de esta fila: integrar su rama, o sólo sacarla de la lista.
    let como: "integrar" | "archivar" = "archivar";
    let ocupado = false;
    if (de.tipo === "worker") {
      const h = hilos?.find((x) => x.id === de.id);
      if (h) {
        const e = estadoVisto(h, optimista.get(h.id));
        ops = accionesWorker(h, e, settleWorker(h, e, arbol.aCargo));
        como = comoSettle(h);
      }
    } else if (de.tipo === "lider") {
      const l = arbol.lideres.get(de.sid);
      if (l) {
        const s = settleDe(ramaDe(arbol, de.sid));
        settle = s ?? 0;
        ocupado = l.ocupado;
        ops = accionesLider(l, s, lugarMenu(de));
      }
    } else ops = accionesCarpeta(ocultos.has(de.proyecto), lugarMenu(de));
    const texto: Record<Opcion["a"], string> = {
      renombrar: tr("menu.renombrar"),
      mover: tr("menu.mover"),
      settle: tr(como === "integrar" ? "accion.integrar" : "accion.archivar"),
      parar: tr("accion.parar"),
      copiar: tr("menu.copiar"),
      borrar: tr("menu.borrar"),
      descartar: tr("menu.descartar"),
      nueva: tr("menu.nueva"),
      ocultar: tr("menu.ocultar"),
      mostrar: tr("menu.mostrar"),
      subir: tr("menu.subir"),
      bajar: tr("menu.bajar"),
      defecto: tr("menu.ordenDefecto"),
      prioridad: tr(porPrioridad ? "menu.ordenFijo" : "menu.ordenPrioridad"),
    };
    const seguro: Partial<Record<Opcion["a"], string>> = {
      settle: tr(settle > 0 ? "menu.settleSeguro" : "menu.archivarLiderSeguro", { n: settle }),
      borrar: tr(ocupado ? "menu.borrarOcupadoSeguro" : "menu.borrarSeguro"),
      descartar: tr("menu.descartarSeguro"),
    };
    return ops.map((o) => ({
      clave: o.a,
      texto: texto[o.a],
      seguro: o.confirmar ? seguro[o.a] : undefined,
      peligro: o.peligro,
      sub: o.a === "mover",
      alElegir: () => hacer(m, o),
    }));
  };

  const fila = (it: Item, quieta?: boolean) => (
    <Fila
      key={it.h.id}
      quieta={quieta}
      h={it.h}
      estado={it.estado}
      apagada={deLider(it.h) && !activo(it)}
      cursor={cursor === it.h.id}
      activa={activa === it.h.id}
      nuevo={novedad(it.h, it.estado, leidos)}
      error={errores.get(it.h.id) ?? null}
      settle={salidaWorker(it.h, it.estado, arbol.aCargo)}
      alAbrir={abrir}
      alCerrar={cerrar}
      alRetomar={retomarId}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={raiz}
        className={`app ${MODO.captura ? "pointer-events-none" : ""}`}
        style={{ "--ancho-barra": `${ancho}px` } as CSSProperties}
        data-oculta={abierta ? undefined : ""}
        data-panel={panel ?? undefined}
        data-consumo={tapa ? "solo" : undefined}
        data-reinicio={reinicio.hay ? "" : undefined}
      >
        <aside className="barra" aria-label={tr("barra.aria")} inert={!abierta}>
          <div className="barra-cuerpo">
            <div className="top">
              <Cabecera alOcultar={alternarBarra} />
              <div className="fila-top">
                <label className="buscar">
                  <Search size={14} strokeWidth={2} />
                  <input
                    ref={campo}
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder={tr("barra.buscar")}
                    aria-label={tr("barra.buscarAria")}
                    spellCheck={false}
                  />
                  <kbd>Ctrl K</kbd>
                </label>
                {/* Sólo líderes | todo: siempre a mano (y con la tecla W). */}
                <div className="vista" role="group" aria-label={tr("vista.aria")} data-vista={vista}>
                  {VISTAS.map(([v, Icono, etq, tip]) => (
                    <button key={v} type="button" aria-label={tr(etq)} data-tip={tr(tip)} data-ver={v} aria-pressed={vista === v} onClick={() => ponerVista(v)}>
                      <Icono size={14} strokeWidth={2} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="nueva"
                  aria-label={tr("lider.nuevo")}
                  data-tip={tr("lider.nuevoTipN")}
                  aria-pressed={activa === LIDER_NUEVO}
                  onClick={abrirLiderNuevo}
                >
                  <PencilLine size={15} strokeWidth={2} />
                </button>
              </div>
            </div>

            <motion.div
              ref={lista}
              layoutScroll
              className="lista"
              onScroll={virtual ? avisarVentana : undefined}
              onPointerMove={() => !MODO.datosFijos && ultimo.current.cursor && setCursor(null)}
              onPointerEnter={() => setMirando((m) => (m.mouse ? m : { ...m, mouse: true }))}
              onPointerLeave={() => setMirando((m) => (m.mouse ? { ...m, mouse: false } : m))}
              onFocus={() => setMirando((m) => (m.foco ? m : { ...m, foco: true }))}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setMirando((m) => (m.foco ? { ...m, foco: false } : m))}
              onContextMenu={abrirMenu}
            >
              {/* El error de `pa` va arriba sin tapar lo último que se leyó bien. */}
              {errorDatos ? (
                <div className="lista-aviso" data-error="" role="alert">
                  {errorDatos}
                </div>
              ) : hilos ? null : (
                <div className="lista-aviso">{tr("barra.leyendo")}</div>
              )}
              {hilos ? (
                // Recién con los datos: si no, la primera carga entraría animada.
                <AnimatePresence mode="popLayout" initial={false}>
                  {grupos.map((g) => (
                    <Carpeta
                      key={g.proyecto}
                      g={g}
                      viendo={g.proyecto === carpetaActiva}
                      liderActivo={activa}
                      alAbrirLider={abrirLider}
                      alCerrarLider={cerrarLider}
                      alSettleLider={settleLiderYa}
                      alLiderNuevo={g.proyecto === GENERAL ? abrirLiderNuevo : null}
                      liderNuevo={activa === LIDER_NUEVO}
                      desplegada={desplegada}
                      alAlternar={alternar}
                      alPlegar={plegar}
                      fila={fila}
                      virtual={virtual}
                      soloLideres={soloLideres}
                      mueve={!buscando && !MODO.captura && !porPrioridad}
                    />
                  ))}
                  {hayGrupos.length === 0 ? (
                    <motion.div
                      key="vacio"
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="lista-aviso"
                    >
                      {buscando ? (cerrados.length ? tr("barra.soloCerrados") : tr("barra.sinResultados")) : tr("barra.nadaActivo")}
                    </motion.div>
                  ) : null}
                  {cerrados.length > 0 ? (
                    <motion.div
                      key="cerrados"
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={RESORTE}
                      className="bloque-cerrados"
                    >
                      <button
                        type="button"
                        className="cerrados"
                        aria-expanded={verCerrados}
                        onClick={() => setCerradosAbiertos((a) => !a)}
                      >
                        <span>{tr("barra.cerrados", { n: cerrados.length })}</span>
                        <ChevronDown className="chevron" size={12} strokeWidth={2} />
                      </button>
                      <AnimatePresence mode="popLayout" initial={false}>
                        {verCerrados ? (
                          <motion.ul
                            key="cerradas"
                            className="cerradas"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12 }}
                          >
                            <Filas items={cerrados} virtual={virtual} fila={fila} />
                          </motion.ul>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              ) : null}
              {/* Dónde cae lo que se arrastra: la ubica `arrastre.ts`, sin render. */}
              <div ref={linea} className="cae" aria-hidden="true" />
            </motion.div>

            {/* Cada botón abre su panel a la derecha; otro clic (o Esc) lo cierra. */}
            <AvisoMaquinas />
            <Pc />
            <Reinicio />
            <AvisoClaude />
            <AvisoClaude cual="agy" />
            <AvisoSetup />
            <footer className="pie">
              {BOTONES_PIE.map(([cual, icono]) => (
                <BotonPie
                  key={cual}
                  icono={icono}
                  etq={tr(PANELES[cual])}
                  ver={cual === "ramas" && MODO.captura === "hover"}
                  activo={panel === cual}
                  n={cual === "tablero" ? esperan : 0}
                  alClic={() => {
                    alFrente();
                    setPanel((p) => (p === cual ? null : cual));
                  }}
                />
              ))}
              {/* En el celular no hay panel de consumo: tampoco su botón. */}
              {angosto ? null : <BotonPie icono={PanelRight} etq={tr(consumo ? "consumo.ocultar" : "consumo.mostrar")} activo={consumo} alClic={alternarConsumo} />}
            </footer>
          </div>
          <div
            role="separator"
            tabIndex={0}
            className="tirador"
            aria-orientation="vertical"
            aria-label={tr("barra.tirador")}
            aria-valuemin={ANCHO_MIN}
            aria-valuemax={ANCHO_MAX}
            aria-valuenow={ancho}
            onPointerDown={arrastrar}
            onDoubleClick={() => {
              setAncho(ANCHO);
              setAbierta(true);
            }}
            onKeyDown={teclaTirador}
          />
        </aside>

        {menu ? (
          <Menu
            x={menu.x}
            y={menu.y}
            nivel={menu.mover ? "mover" : "fila"}
            buscable={menu.mover}
            items={itemsMenu(menu)}
            alCerrar={cerrarMenu}
            ancla={menu.origen}
            alVolver={menu.mover ? () => setMenu({ ...menu, mover: false }) : undefined}
          />
        ) : null}
        {renombrando ? (
          <Renombre
            key={renombrando.id}
            caja={renombrando.caja}
            letra={renombrando.letra}
            valor={renombrando.valor}
            ancla={renombrando.origen}
            alGuardar={(t) => guardarTitulo(renombrando, t)}
            alCancelar={() => {
              setRenombrando(null);
              renombrando.origen?.focus();
            }}
          />
        ) : null}
        <Vista
          h={hiloActivo}
          estado={hiloActivo ? estadoVisto(hiloActivo, optimista.get(hiloActivo.id)) : null}
          settle={hiloActivo ? salidaWorker(hiloActivo, estadoVisto(hiloActivo, optimista.get(hiloActivo.id)), arbol.aCargo) : null}
          lider={liderActivo}
          settleLider={sidActivo ? settleDe(ramaDe(arbol, sidActivo)) : null}
          liderNuevo={activa === LIDER_NUEVO}
          alLiderCreado={liderCreado}
          alLiderNuevo={abrirLiderNuevo}
          alCerrarLider={cerrarLider}
          alSettleLider={settleLiderYa}
          lideres={arbol.lideres}
          alAbrirLider={abrirLider}
          barraAbierta={abierta}
          alAlternarBarra={angosto ? volverALista : alternarBarra}
          alCerrar={cerrar}
          alPasar={pasar}
          alRetomar={retomarId}
        />
        {/* El panel va al lado y la vista se esconde por CSS (`data-panel`): no se desmonta. */}
        {panel ? (
          <Panel
            cual={panel}
            barraAbierta={abierta}
            alAlternarBarra={angosto ? volverALista : alternarBarra}
            alVolver={() => setPanel(null)}
            ramas={{ hilos: vistos, optimista, errores, enCurso, alActuar: actuar, alAbrir: abrir, alRetomar: retomar, alArreglar: arreglar, alActualizar: actualizarRama, conflictos, analista }}
            tablero={{ carpetas: slugsReg, lideres: lideresTablero, alIniciar: iniciarTarea, alAbrirLider: abrirLider, alRedactar: redactarTablero, avisar: { lideres: lideresAviso, jefeDe, alAvisar: avisarLider } }}
          />
        ) : null}
        {/* El panel de consumo, a la derecha de todo. En el celular no existe. */}
        {consumo && !angosto ? <Consumo lideres={lideresVistos} hilos={todos} carpeta={carpetaVista} alCerrar={alternarConsumo} /> : null}
      </div>
    </MotionConfig>
  );
}

type PropsCarpeta = {
  /** Lo pone AnimatePresence (popLayout). */
  ref?: Ref<HTMLElement>;
  g: DatosCarpeta;
  /** Lo que está abierto a la derecha vive en esta carpeta: su marco se marca. */
  viendo: boolean;
  /** Lo que está abierto a la derecha (`lider:<id>` si es un líder). */
  liderActivo: string | null;
  alAbrirLider: (id: string) => void;
  alCerrarLider: (id: string, motivo?: string) => void;
  alSettleLider: (id: string) => void;
  /** Sólo en General: el botón Nuevo líder. */
  alLiderNuevo: (() => void) | null;
  liderNuevo: boolean;
  desplegada: (clave: string) => boolean;
  alAlternar: (proyecto: string) => void;
  alPlegar: (clave: string) => void;
  fila: (item: Item, quieta?: boolean) => ReactNode;
  virtual: boolean;
  /** La barra muestra sólo líderes: sus workers no tienen fila salvo con el pliegue abierto. */
  soloLideres: boolean;
  /** Se puede reordenar arrastrando (buscando, no): la carpeta y sus líderes llevan `data-mueve`. */
  mueve: boolean;
};

/**
 * Un proyecto. El marco va aparte y en piezas (ver `.marco` en index.css) para
 * que al colapsar acompañe con FLIP sin deformarse; el cuerpo (líderes y sus
 * workers) se desvanece entero.
 */
function Carpeta({
  ref,
  g,
  viendo,
  liderActivo,
  alAbrirLider,
  alCerrarLider,
  alSettleLider,
  alLiderNuevo,
  liderNuevo,
  desplegada,
  alAlternar,
  alPlegar,
  fila,
  virtual,
  soloLideres,
  mueve,
}: PropsCarpeta) {
  const abierto = desplegada(g.proyecto);
  const titulo = useTitulos()[g.proyecto];
  const nombre = nombreCarpeta(g.proyecto, MODO.usuario, tr("barra.home"), titulo);
  return (
    <motion.section
      ref={ref}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RESORTE}
      className="proy"
      data-viendo={viendo ? "" : undefined}
      data-mueve={mueve && g.proyecto !== GENERAL ? g.proyecto : undefined}
      data-grupo={mueve && g.proyecto !== GENERAL ? CARPETAS : undefined}
      aria-label={nombre}
    >
      <div className="marco marco-arriba" />
      <motion.div layout transition={RESORTE} className="marco marco-lado" />
      <motion.div layout transition={RESORTE} className="marco marco-lado" data-der="" />
      <motion.div layout="position" transition={RESORTE} className="marco marco-abajo" />
      <button type="button" className="proy-nom" data-carpeta={g.proyecto} aria-expanded={abierto} onClick={() => alAlternar(g.proyecto)}>
        <Logo proyecto={g.proyecto} titulo={titulo} />
        <span className="n">{nombre}</span>
        <span className="cuenta">{g.cuenta || null}</span>
        <ChevronDown className="chevron" size={12} strokeWidth={2} />
      </button>
      {alLiderNuevo ? (
        <button
          type="button"
          className="lider-nuevo"
          aria-label={tr("lider.nuevo")}
          data-tip={tr("lider.nuevoTip")}
          aria-pressed={liderNuevo}
          onClick={alLiderNuevo}
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      ) : null}
      <AnimatePresence mode="popLayout" initial={false}>
        {abierto ? (
          <motion.div
            key="cuerpo"
            className="proy-cuerpo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {[
                ...g.ramas.map((r) => [r, "lider"] as const),
                ...(g.espera.length && desplegada(claveEspera(g.proyecto)) ? g.espera.map((r) => [r, "espera"] as const) : []),
                ...(g.dormidos.length && desplegada(claveDormidos(g.proyecto)) ? g.dormidos.map((r) => [r, "dormidos"] as const) : []),
              ].map(([r, tipo]) => (
                <Arbol
                  key={r.clave}
                  r={r}
                  grupo={mueve && r.lider ? `${tipo}:${g.proyecto}` : null}
                  activo={liderActivo === r.clave}
                  alAbrirLider={alAbrirLider}
                  alCerrarLider={alCerrarLider}
                  alSettleLider={alSettleLider}
                  plegada={!desplegada(r.clave)}
                  alPlegar={alPlegar}
                  fila={fila}
                  virtual={virtual}
                  soloLideres={soloLideres}
                />
              ))}
              {g.espera.length ? (
                <Espera key="espera" n={g.espera.length} abierta={desplegada(claveEspera(g.proyecto))} alPlegar={() => alPlegar(claveEspera(g.proyecto))} />
              ) : null}
              {g.dormidos.length ? (
                <Dormidos key="dormidos" n={g.dormidos.length} abierta={desplegada(claveDormidos(g.proyecto))} alPlegar={() => alPlegar(claveDormidos(g.proyecto))} />
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

/** El pliegue de los líderes ociosos de una carpeta, al final: "N líderes en espera". */
function Espera({ ref, n, abierta, alPlegar }: { ref?: Ref<HTMLDivElement>; n: number; abierta: boolean; alPlegar: () => void }) {
  return (
    <motion.div ref={ref} layout="position" transition={RESORTE} className="espera">
      <button type="button" className="mini-pliegue" aria-expanded={abierta} onClick={alPlegar}>
        {abierta ? tr("barra.ocultarEspera") : tr(n === 1 ? "barra.espera1" : "barra.esperaN", { n })}
        <ChevronDown className="chevron" size={11} strokeWidth={2} />
      </button>
    </motion.div>
  );
}

/** El pliegue de los líderes dormidos (sin proceso y de más de un día), al final de la carpeta: "N dormidos". */
function Dormidos({ ref, n, abierta, alPlegar }: { ref?: Ref<HTMLDivElement>; n: number; abierta: boolean; alPlegar: () => void }) {
  return (
    <motion.div ref={ref} layout="position" transition={RESORTE} className="espera" data-dormidos="">
      <button type="button" className="mini-pliegue" aria-expanded={abierta} data-tip={tr("barra.dormidosTip")} onClick={alPlegar}>
        {abierta ? tr("barra.ocultarDormidos") : tr(n === 1 ? "barra.dormidos1" : "barra.dormidosN", { n })}
        <ChevronDown className="chevron" size={11} strokeWidth={2} />
      </button>
    </motion.div>
  );
}

const SIN_NOMBRES: string[] = [];

/**
 * La cabecera de lo que quedó sin líder. Si al líder lo mataron (su sesión quedó sin
 * proceso) lo dice: "líder muerto", con el nombre en el tooltip; si cerró, "sin líder".
 */
function SinLider({ muertos, idos }: { muertos: string[]; idos: string[] }) {
  const murio = muertos.length > 0;
  const tip = murio
    ? tr("barra.liderMuertoTip", { n: muertos.join(", ") })
    : idos.length
      ? tr("barra.sinLiderTip", { n: idos.join(", ") })
      : undefined;
  return (
    <div className="sin-lider" data-muerto={murio ? "" : undefined} data-tip={tip}>
      <span className="corona">
        <Crown size={12} strokeWidth={2} />
      </span>
      {tr(murio ? "barra.liderMuerto" : "barra.sinLider")}
    </div>
  );
}

type PropsArbol = {
  ref?: Ref<HTMLDivElement>;
  r: Rama;
  /** Entre quiénes se mueve al arrastrarlo (`arrastre.ts`); `null`, no se arrastra. */
  grupo: string | null;
  activo: boolean;
  alAbrirLider: (id: string) => void;
  alCerrarLider: (id: string, motivo?: string) => void;
  alSettleLider: (id: string) => void;
  plegada: boolean;
  alPlegar: (clave: string) => void;
  fila: PropsCarpeta["fila"];
  virtual: boolean;
  soloLideres: boolean;
};

/**
 * Una rama de la carpeta: el líder (o "sin líder") y sus workers colgando en
 * árbol. Lo que terminó se esconde solo (`r.viejas`): bajo un líder, en "N
 * terminados" al final de sus workers (la vista de todo; `aVistaTodo` deja ahí
 * también lo que murió o frenó); sin líder, en "N terminadas" al final. Lo que
 * lanzó el usuario sin líder cuelga directo de la carpeta. Con la barra en "sólo
 * líderes", lo vivo de un líder tampoco tiene fila: va resumido en la suya, y el
 * "+N" lo despliega.
 */
function Arbol({ ref, r, grupo, activo, alAbrirLider, alCerrarLider, alSettleLider, plegada, alPlegar, fila, virtual, soloLideres }: PropsArbol) {
  const n = r.viejas.length;
  const resumida = soloLideres && r.tipo === "lider" && plegada;
  const res = useMemo(() => (resumida ? resumen(r.vivas) : null), [resumida, r.vivas]);
  // El pliegue al final: de un líder sólo en la vista de todo (en "sólo líderes" está el "+N" de su fila).
  const pliegue = n > 0 && (r.tipo !== "lider" || !soloLideres);
  const lider = r.tipo === "lider";
  const cuantos = lider ? (n === 1 ? "barra.terminado1" : "barra.terminadosN") : n === 1 ? "barra.terminada1" : "barra.terminadaN";
  const ocultar = lider ? "barra.ocultarTerminados" : "barra.ocultarTerminadas";
  return (
    <motion.div
      ref={ref}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RESORTE}
      className="arbol"
      data-tipo={r.tipo}
      data-mueve={grupo && r.lider ? r.lider.id : undefined}
      data-grupo={grupo ?? undefined}
    >
      {r.lider ? (
        <FilaLider
          l={r.lider}
          activa={activo}
          settle={settleDe(r)}
          alAbrir={alAbrirLider}
          alCerrar={alCerrarLider}
          alSettle={alSettleLider}
          ocultos={soloLideres ? r.vivas.length + n : 0}
          abierto={!plegada}
          trabajando={res?.trabajando ?? 0}
          trabados={res?.trabados ?? 0}
          fallaron={res?.fallaron ?? 0}
          frenados={res?.frenados ?? 0}
          alPlegar={alPlegar}
        />
      ) : r.tipo === "huerfanos" ? (
        <SinLider muertos={r.muertos ?? SIN_NOMBRES} idos={r.idos ?? SIN_NOMBRES} />
      ) : null}
      {r.lider && !resumida ? <Subagentes sid={r.lider.id} /> : null}
      <ul className="ramas">
        <Filas items={resumida ? SIN_FILAS : r.vivas} virtual={virtual} fila={fila} />
        {/* El "N terminados" va antes de lo terminado, no al final: es el mismo botón que lo despliega y el que lo
            oculta, y con una lista larga no hay que bajar hasta el fondo. Abierto se queda pegado arriba al scrollear. */}
        {pliegue ? (
          <li key="pliegue" className="w pliegue" data-abierto={plegada ? undefined : ""}>
            <button type="button" className="mini-pliegue" aria-expanded={!plegada} onClick={() => alPlegar(r.clave)}>
              {plegada ? tr(cuantos, { n }) : tr(ocultar)}
              <ChevronDown className="chevron" size={11} strokeWidth={2} />
            </button>
          </li>
        ) : null}
        {/* Siempre montada (salvo virtualizada): las filas entran y salen animadas al plegar. */}
        {plegada && virtual ? null : <Filas items={plegada ? SIN_FILAS : r.viejas} virtual={virtual} fila={fila} />}
      </ul>
    </motion.div>
  );
}

/**
 * Las filas de una lista. Virtualizada, sólo las que caen cerca de lo visible,
 * entre dos rellenos, y sin animación de entrada ni de salida: entran y salen
 * por el scroll, no porque cambiaron.
 */
function Filas({ items, virtual, fila }: { items: Item[]; virtual: boolean; fila: PropsCarpeta["fila"] }) {
  const tope = useRef<HTMLLIElement>(null);
  const ids = useMemo(() => items.map((f) => f.h.id), [items]);
  const r = useVentana(tope, ids, virtual);
  if (!virtual)
    return (
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((f) => fila(f))}
      </AnimatePresence>
    );
  return (
    <>
      <li ref={tope} className="relleno" aria-hidden="true" style={{ height: r.antes }} />
      {items.slice(r.desde, r.hasta).map((f) => fila(f, true))}
      <li className="relleno" aria-hidden="true" style={{ height: r.despues }} />
    </>
  );
}

type PropsBotonPie = { icono: LucideIcon; etq: string; ver?: boolean; activo: boolean; alClic: () => void; n?: number };

function BotonPie({ icono: I, etq, ver, activo, alClic, n = 0 }: PropsBotonPie) {
  return (
    <button type="button" aria-label={n > 0 ? `${etq}: ${tr("pd.pieEsperan", { n })}` : etq} aria-pressed={activo} data-ver={ver ? "" : undefined} onClick={alClic}>
      <I size={16} strokeWidth={1.8} />
      {n > 0 ? (
        <span className="pie-n" aria-hidden="true">
          {n > 99 ? "99+" : n}
        </span>
      ) : null}
      <span className="etq" aria-hidden="true">
        {etq}
      </span>
    </button>
  );
}
