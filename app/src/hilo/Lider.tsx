// El chat con un líder (B7): la sesión de Claude Code en `~` con la que habla
// El usuario. Los de la app (`claude -p` de trama) se escriben desde acá: la
// respuesta llega por el stream (src/hilo/vivo.ts) y al terminar se relee el
// transcript. Los abiertos en una terminal se leen (el transcript, al cambiar)
// y se les escribe igual: el primer mensaje lo trae a la app (`fuente.liderTraer`
// cierra ese `claude` de la terminal y sigue acá, con `--resume`); si estaba a
// mitad de algo, antes pregunta. Arriba de la caja, ir a su ventana, si se la
// pudo ubicar. `l === null`: un líder nuevo, que nace con el primer mensaje.
// B13: la caja manda con Enter (Shift+Enter, renglón nuevo), muestra el modo de
// permisos (chip; Shift+Tab lo rota), ofrece los comandos con "/" y pinta los
// pedidos de permiso: el plan de ExitPlanMode (Aprobar / Seguir planeando) y
// cualquier herramienta fuera de bypass (Permitir / Negar).
// A mitad de un turno, Enter encola (electron/cola.ts; también al de una terminal): lo pendiente se ve debajo
// de la conversación, se puede sacar y sale solo al terminar el turno.
// B26: un líder nuevo, vacío, tiene la caja al medio de la vista (con "Nuevo
// líder" encima); al mandar el primer mensaje baja a su lugar (Motion `layout`)
// y recién entonces la barra abre el líder creado (que remonta esta vista).
// B26: imágenes como en Claude Code: pegadas, soltadas sobre el chat o con el
// clip; miniaturas con × en la caja (src/hilo/adjuntos.ts) y en el globo.
import { es } from "../atajos";
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Check, Cpu, Folder, Paperclip, X, Zap } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { VERSION, type Lider, type Mensaje, type MotivoRetomar, type MotivoTraer, type Tokens } from "../datos/contrato";
import { fuente, type EnvioLider } from "../datos/fuente";
import { ChipSubagentes } from "../barra/Fila";
import { Reloj } from "../barra/piezas";
import { Leyendo } from "./Leyendo";
import { MODO } from "../modo";
import { esTactil } from "../angosto";
import { pintorCache } from "../tiempo";
import { cursorDe, escucharBorrador, guardarCursor, leerBorrador, ponerBorrador } from "./borradores";
import { effortPara } from "./elegir";
import { effortsLeidos, leerEfforts, recordarEffort } from "./efforts";
import { effortDe, effortsOpciones, MODELO_DEFAULT, MODELOS, modeloDe, nombreModelo } from "./opciones";
import { effortsDe, esAgy, esLocal, reajustarEffort, sinWorkers } from "./modelos";
import { ContextoLocal } from "./ContextoLocal";
import { t as tr, textoMain } from "../i18n";
import { Selector } from "./Selector";
import { hayVarias, opcionesMaquina, useMaquinas } from "../maquinas";
import { Contexto } from "./Contexto";
import { transcriptLeido } from "./contextoVivo";
import { Avisos, HaceChat } from "./Hace";
import { Texto } from "./Texto";
import { Hora, pintorAviso, tokens, Turno } from "./Turno";
import { Marca } from "./Marca";
import { Sistema } from "./Sistema";
import { Compactando, Pasando, relevoEn, Sigue } from "./Posta";
import { juntar, repiteElPrimero, turnos, type Item } from "./turnos";
import { anotar, bajar, seguir } from "./seguir";
import { anotarScroll, faltaLlegar, guardarAncla, restaurarScroll, retomarScroll, soltarScroll } from "./scrollGuardado";
import { useCompactando } from "./compactando";
import { useSeguir } from "./useSeguir";
import type { Encolado } from "./cola";
import { cola, comandosAgy, comandosClaude, confirmar, contestado, enCurso, enviado, escuchar, estilosClaude, fallo, inyectado, mensajesVistos, parando, ponerEstilos, ponerModo, suscribir, suscribirComandos, suscribirEstilos, type Pedido } from "./vivo";
import { ASPECTO, esModo, MODO_DEFAULT, siguienteModo, type Modo } from "./modos";
import { directo, ESTILOS_FABRICA, menuEn, moverSel, parsearComando, reemplazar, type Sugerencia, type Valores } from "./comandos";
import { main, mensaje } from "../puente";
import { agregarAdjuntos, archivosDe, archivosDeDatos, ErrorAdjunto, escucharAdjuntos, imagenesDe, leerAdjuntos, pegadoSinTexto, prepararAdjunto, quitarAdjunto, textoConArchivos, vaciarAdjuntos } from "./adjuntos";
import { Adjuntos, Miniaturas } from "./Imagenes";
import { Dictar } from "./Dictar";
import { Logo } from "./Logos";
import { PedidoPreguntas } from "./Preguntas";
import { tandasPendientes } from "./preguntas-datos";
import { ARCHIVO_MAX, IMAGENES_MAX, type Imagen } from "../../electron/imagenes";
import { separarAdjuntos } from "../../electron/adjunto";

export const BORRADOR_LIDER = "lider-nuevo";

/** Lo que tarda (como mucho) la caja de un líder nuevo en bajar antes de abrirlo. */
const BAJAR_MS = 260;
const BAJAR = { type: "spring", stiffness: 520, damping: 44, mass: 0.8 } as const;

/** Si el transcript no alcanza a la tanda del stream, a los tantos ms se suelta igual. */
const SOLTAR_MS = 2000;
const MARGEN_PAGINA = 400;

// Los eventos de un líder nuevo llegan antes que su sid: se escucha desde el arranque.
escuchar();

type Pagina = { mensajes: Mensaje[]; desde: number; total: number; usage: Tokens | null; transcript: string | null };

type Props = {
  l: Lider | null;
  /** Nació un líder nuevo (la barra lo abre). */
  alCreado: (sid: string, e: EnvioLider) => void;
  /** /clear: abrir un líder nuevo, limpio. */
  alNuevo: () => void;
  /** Los líderes, para ir al que siguió después de un relevo (B19). */
  lideres?: ReadonlyMap<string, Lider>;
  alAbrirLider?: (id: string) => void;
  /** Mirar su transcript (`fuente.liderMirar`): el analista de Ramas no, para no soltar el de la vista. */
  mirar?: boolean;
  /** El texto de su última respuesta entera, cada vez que cambia (el analista: sus veredictos). */
  alRespuesta?: (texto: string) => void;
  /** Qué se ve de cada mensaje (`null`: nada); estable, fuera del render. */
  mostrar?: (m: Mensaje) => Mensaje | null;
  /** Lo que se ofrece cuando uno sin proceso no se puede retomar: el botón de archivarlo (o de quitarlo). */
  archivar?: ReactNode;
};

/** Por qué no se pudo retomar, en criollo. */
const NO_RETOMA = { abierto: "lider.noAbierto", sinSesion: "lider.noSesion", sinCarpeta: "lider.noCarpeta" } as const;
/** Por qué no se lo pudo traer de la terminal (si está trabajando no es un error: se pregunta). */
const NO_TRAE: Record<Exclude<MotivoTraer, "trabajando">, "lider.noTraer" | "lider.noSesion" | "lider.noCarpeta"> = {
  abierto: "lider.noTraer",
  sinSesion: "lider.noSesion",
  sinCarpeta: "lider.noCarpeta",
};

/** El texto de la caja con que arranca una captura (`lider-comandos`: el menú de "/" abierto; `lider-valores`, el de /output-style). */
const textoCaptura = () => (MODO.captura === "lider-comandos" ? "/" : MODO.captura === "lider-valores" ? "/output-style " : null);

export function ChatLider({ l, alCreado, alNuevo, lideres, alAbrirLider, mirar = true, alRespuesta, mostrar, archivar }: Props) {
  const sid = l?.id ?? "";
  const clave = l ? `lider:${l.id}` : BORRADOR_LIDER;
  const vivo = useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => enCurso(sid),
  );
  // Varias tandas de preguntas a la vez: de a una, la más vieja primero.
  const tandas = tandasPendientes(vivo.pide);
  // Recién traído de la terminal: es de la app aunque la lista todavía no lo diga.
  const [traido, setTraido] = useState(false);
  const deApp = !l || l.origen === "app";
  useEffect(() => {
    // La lista ya lo dice: si lo vuelven a abrir en una terminal, vuelve a ser ajeno.
    if (deApp) setTraido(false);
    // Un turno en curso desde acá (lo trajo la cola al terminar su turno allá): ya es de la app.
    else if (vivo.ocupado) setTraido(true);
  }, [deApp, vivo.ocupado]);
  const app = deApp || traido;
  // Abierto en una terminal: se le escribe igual (el primer mensaje lo trae a la app).
  const ajeno = !!l && !app && l.vivo && !l.caido;
  // Murió o cerró (también uno de la app al que mataron): no hay caja hasta retomarlo.
  const puede = (app || ajeno) && !l?.caido;
  const ocupado = app ? (vivo.ocupado ?? l?.ocupado ?? false) : !!l?.ocupado;
  const encolados = useSyncExternalStore(
    useCallback((fn: () => void) => cola.suscribir(sid, fn), [sid]),
    () => cola.lista(sid),
  );
  // Lo primero de la cola no pudo salir: por qué (no se reintenta solo).
  const errorCola = useSyncExternalStore(
    useCallback((fn: () => void) => cola.suscribir(sid, fn), [sid]),
    () => cola.error(sid),
  );

  // El de la terminal con algo en la cola: sale cuando termine su turno.
  const enEspera = ajeno && encolados.length > 0 && !errorCola;

  const [pag, setPag] = useState<Pagina | null>(null);
  const [error, setError] = useState<string | null>(null);
  const borrador = leerBorrador(clave);
  const [texto, setTexto] = useState(() => textoCaptura() ?? borrador.texto);
  // Dónde está el cursor en la caja: el menú de "/" mira el token que tiene al lado.
  const [caret, setCaret] = useState(() => texto.length);
  const [errorCaja, setErrorCaja] = useState<string | null>(borrador.error);
  const [enviando, setEnviando] = useState(false);
  // Su ventana: el botón de ir sólo si se la pudo ubicar.
  const [ventana, setVentana] = useState(false);
  const pidAjeno = ajeno ? l.pid : null;
  useEffect(() => {
    setVentana(false);
    if (!pidAjeno) return;
    let sigue = true;
    void fuente.liderUbicable(pidAjeno).then((v) => sigue && setVentana(v));
    return () => {
      sigue = false;
    };
  }, [pidAjeno]);
  // Sin proceso y de nadie (`caido`): Retomar lo pasa a la app; al llegar la lista nueva, esto es la caja de siempre.
  const [retomando, setRetomando] = useState(false);
  // Si vuelve a morir, el botón no queda trabado del retomar anterior.
  const murioDe = !!l?.caido;
  useEffect(() => {
    if (!murioDe) setRetomando(false);
  }, [murioDe]);
  const [noRetoma, setNoRetoma] = useState<MotivoRetomar | null>(MODO.captura === "lider-muerto" && MODO.variante === "no" ? "sinSesion" : null);
  // Un líder nuevo, vacío: la caja al medio hasta que sale el primer mensaje (B26).
  const [partio, setPartio] = useState(false);
  // A qué máquina va un líder nuevo (el selector de la caja): siempre esta al empezar, y no se recuerda.
  const maquinas = useMaquinas();
  const [maquinaNueva, setMaquinaNueva] = useState<string | null>(null);
  // La carpeta donde arranca un líder nuevo (campo opcional de la caja): vacía = `~`, como siempre. Se escribe la ruta; en la ventana de la PC también se elige con el selector nativo.
  const [carpeta, setCarpeta] = useState(MODO.captura === "lider-nuevo-carpeta" ? "/srv/proyectos/mi-app" : "");
  const [carpetaAbierta, setCarpetaAbierta] = useState(MODO.captura === "lider-nuevo-carpeta");
  const idCarpeta = useId();
  const elegirCarpeta = () => {
    void main?.carpeta?.elegir().then(
      (c) => c && setCarpeta(c),
      (err) => setErrorCaja(mensaje(err)),
    );
  };
  const maquinaDe = l ? l.maquina : maquinaNueva && maquinaNueva !== maquinas.esta.id ? maquinaNueva : undefined;
  const quieto = useReducedMotion();
  const bajo = useRef<(() => void) | null>(null);
  const adjuntos = useSyncExternalStore(
    useCallback((fn: () => void) => escucharAdjuntos(clave, fn), [clave]),
    () => leerAdjuntos(clave),
  );
  const [arrastra, setArrastra] = useState(false);
  const elegir = useRef<HTMLInputElement>(null);
  // Captura `aviso`: otro modelo elegido con el caché vivo.
  const [modelo, setModelo] = useState(() =>
    MODO.captura === "aviso" && l
      ? (MODELOS.find((m) => m.id !== modeloDe(l.modelo))?.id ?? MODELO_DEFAULT)
      : MODO.captura === "lider-comandos" && MODO.variante === "agy"
        ? (MODELOS.find((m) => esAgy(m.id))?.id ?? MODELO_DEFAULT)
        : MODO.captura === "local-esfuerzo" || MODO.captura === "local-ctx"
          ? (MODELOS.find((m) => esLocal(m.id))?.id ?? MODELO_DEFAULT)
          : (modeloDe(l?.modelo) ?? MODELO_DEFAULT),
  );
  const [effort, setEffort] = useState(() => effortDe(l?.effort, modelo) ?? effortPara(modelo, effortsLeidos() ?? {}));
  const tocado = useRef(!!l);
  // El modo de un líder nuevo se elige antes de que exista (y el de uno de la terminal, antes de
  // traerlo); el de uno de la app, lo dice el stream (o la lista).
  const [modoNuevo, setModoNuevo] = useState<Modo>(MODO_DEFAULT);
  const modoVisto = l && app ? (vivo.modo ?? l.modo ?? MODO_DEFAULT) : modoNuevo;
  const modo: Modo = esModo(modoVisto) ? modoVisto : MODO_DEFAULT;
  const agy = esAgy(modelo);
  // El motor del líder deja ver su razonamiento y sus comandos (Gemini; o cualquiera que ya mandó razonamiento): la tarjeta y el turno
  // los muestran en vez de la frase tierna. Claude y los que no lo traen siguen como siempre.
  const piensa = esAgy(modeloDe(l?.modelo) ?? modelo) || vivo.razona;
  const comandos = useSyncExternalStore(suscribirComandos, agy ? comandosAgy : comandosClaude);
  // Los del otro proveedor: con ellos se sabe cuáles comandos sólo existen de este lado (la marca de cada fila).
  const deOtro = useSyncExternalStore(suscribirComandos, agy ? comandosClaude : comandosAgy);
  // El menú de "/": la fila elegida y si el usuario lo cerró con Esc (vuelve al cambiar el texto).
  const [sel, setSel] = useState(0);
  const [sinMenu, setSinMenu] = useState(false);
  const estilos = useSyncExternalStore(suscribirEstilos, estilosClaude);
  const listaEstilos = estilos.lista.length ? estilos.lista : ESTILOS_FABRICA;
  // El segundo nivel del menú: los valores de /model, /effort y (en Claude) /output-style, con el puesto marcado.
  const valores = useMemo<Valores>(
    () => ({
      model: {
        lista: MODELOS.filter((m) => esAgy(m.id) === agy).map((m) => ({ valor: m.clave, desc: m.nombre })),
        actual: MODELOS.find((m) => m.id === modelo)?.clave ?? null,
      },
      effort: { lista: effortsOpciones(modelo).map((e) => ({ valor: e.id, desc: e.desc })), actual: effort },
      ...(agy ? {} : { "output-style": { lista: listaEstilos.map((x) => ({ valor: x, desc: null })), actual: estilos.actual } }),
    }),
    [agy, modelo, effort, listaEstilos, estilos.actual],
  );
  const mn = useMemo(
    () => (puede && !sinMenu ? menuEn(texto, caret, comandos, valores, modelo, deOtro) : null),
    [puede, sinMenu, texto, caret, comandos, valores, modelo, deOtro],
  );
  const menu = mn?.filas ?? [];
  const [nota, setNota] = useState<string | null>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const menuCmd = useRef<HTMLDivElement>(null);
  // Tras elegir una fila, el cursor va al final de lo puesto: se aplica al pintar la caja con el texto nuevo.
  const pendiente = useRef<number | null>(null);
  useLayoutEffect(() => {
    const p = pendiente.current;
    if (p === null || !caja.current) return;
    pendiente.current = null;
    caja.current.setSelectionRange(p, p);
  });

  // El asistente de Ramas llena la caja de un líder nuevo que ya puede estar montado.
  useEffect(
    () =>
      escucharBorrador(clave, () => {
        const b = leerBorrador(clave);
        setTexto(b.texto);
        setCaret(b.texto.length);
        setErrorCaja(b.error);
        // Llenada desde afuera (Ramas, o el borrador que vuelve tras un reinicio): el cursor, al final.
        guardarCursor(clave, b.texto.length);
        requestAnimationFrame(() => caja.current?.setSelectionRange(b.texto.length, b.texto.length));
      }),
    [clave],
  );
  // La caja se arma de nuevo en cada cambio de conversación: el navegador deja el cursor al inicio del texto.
  // Vuelve a donde estaba (o al final); al irse se anota.
  useLayoutEffect(() => {
    const c = caja.current;
    if (!c) return;
    const p = cursorDe(clave, c.value.length);
    c.setSelectionRange(p, p);
    setCaret(p);
    return () => guardarCursor(clave, c.selectionEnd);
  }, [clave, puede]);
  const zona = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ tipo: "fondo" } | { tipo: "mantener"; alFondo: number } | null>({ tipo: "fondo" });
  const pidiendo = useRef(false);
  // Pegado al fondo mientras llega contenido; si el usuario sube, se suelta (src/hilo/seguir.ts).
  const seg = useSeguir(zona);
  // Uno de terminal: que compacta lo dice la marca del hook (uno de la app lo dice en su stream, HaceChat).
  const compacta = useCompactando(l && !app && !l.caido ? l.id : null);
  const id = useId();

  useEffect(() => {
    if (l) return;
    let sigue = true;
    void leerEfforts().then((e) => sigue && !tocado.current && setEffort(effortPara(modelo, e)));
    return () => {
      sigue = false;
    };
  }, []);

  // --- La conversación (transcript) ---

  const recargar = useCallback(
    (forzar = false) => {
      if (!sid) return;
      fuente.liderConversacion(sid, null).then(
        (r) => {
          if (r.version !== VERSION) throw new Error(tr("error.version", { que: "transcript", v: r.version, conozco: VERSION }));
          setError(null);
          scroll.current = seg.pegado ? { tipo: "fondo" } : null;
          setPag((p) => {
            const empalma = p && r.desde <= p.total;
            return {
              mensajes: empalma ? juntar(p.mensajes, r.mensajes) : r.mensajes,
              desde: empalma ? Math.min(p.desde, r.desde) : r.desde,
              total: r.total,
              usage: r.usage,
              transcript: r.transcript,
            };
          });
          confirmar(sid, r.total, forzar);
          transcriptLeido(sid, r);
        },
        (e) => setError(mensaje(e)),
      );
    },
    [sid, seg],
  );

  useEffect(() => {
    if (!sid) return;
    recargar();
    if (!mirar) return;
    fuente.liderMirar(sid);
    return () => fuente.liderMirar(null);
  }, [sid, recargar, mirar]);

  // Mientras un líder de la app responde, lo nuevo viene por el stream; el transcript, al terminar.
  const ocupadoApp = useRef(false);
  ocupadoApp.current = app && ocupado;
  useEffect(() => fuente.alTranscript((s) => s === sid && !ocupadoApp.current && recargar()), [sid, recargar]);
  useEffect(() => {
    if (!vivo.fines) return;
    recargar();
    const t = setTimeout(() => recargar(true), SOLTAR_MS);
    return () => clearTimeout(t);
  }, [vivo.fines, recargar]);

  const anterior = useCallback(() => {
    const z = zona.current;
    if (!pag || pag.desde <= 0 || pidiendo.current || !z) return;
    pidiendo.current = true;
    fuente.liderConversacion(sid, pag.desde).then(
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
  }, [pag, sid]);

  // Lo del transcript y, detrás, lo que llegó por el stream y todavía no está en él.
  const mensajes = useMemo(() => mensajesVistos(pag, vivo), [pag, vivo.ocupado, vivo.base, vivo.tanda, vivo.parcial, vivo.pensando]);
  const transcript = pag?.transcript ?? null;
  const items = useMemo(
    () => turnos(mostrar ? mensajes.flatMap((m) => mostrar(m) ?? []) : mensajes, transcript),
    [mensajes, mostrar, transcript],
  );
  const respuesta = useMemo(() => {
    for (let i = mensajes.length - 1; i >= 0; i--) if (mensajes[i].rol === "assistant" && mensajes[i].texto) return mensajes[i].texto;
    return "";
  }, [mensajes]);
  useEffect(() => {
    if (respuesta && !vivo.parcial) alRespuesta?.(respuesta);
  }, [respuesta, vivo.parcial, alRespuesta]);
  // Con el turno ya en el transcript, el límite, el error y la compactación se ven ahí como
  // líneas de sistema (B18): el aviso del stream no se repite abajo.
  const enTranscript = !vivo.ocupado && (pag?.total ?? 0) >= vivo.base + vivo.tanda.length;
  // El error del `result` (sin código) se repite sólo si es el texto de un sintético del transcript.
  const avisos = useMemo(() => {
    if (!enTranscript) return vivo.avisos;
    const dichos = new Set(mensajes.filter((m) => m.modelo === "<synthetic>").map((m) => m.texto.trim()));
    return vivo.avisos.filter(
      (a) =>
        !(
          a.clase === "compacto" ||
          (a.clase === "limite" && a.rechazado) ||
          (a.clase === "error" && (a.codigo !== null || dichos.has(a.texto.trim())))
        ),
    );
  }, [enTranscript, vivo.avisos, mensajes]);
  let ultimoTurno = items.length - 1;
  while (ultimoTurno >= 0 && items[ultimoTurno].tipo !== "turno") ultimoTurno--;
  // El relevo (B19): mientras corre, el testimonio; al salir, "Sigue en …" con el líder nuevo
  // (hereda el nombre de la sesión: el más nuevo con el mismo nombre y otro id).
  const relevo = useMemo(() => relevoEn(items), [items]);
  const pasando = !!relevo && !relevo.hecho && ocupado && relevo.k === ultimoTurno;
  const sigue = useMemo(() => {
    if (!relevo?.hecho || !l || !lideres) return null;
    let n: Lider | null = null;
    for (const x of lideres.values()) if (x.id !== l.id && x.nombre === l.nombre && (!n || x.actividad > n.actividad)) n = x;
    return n;
  }, [relevo?.hecho, l, lideres]);

  // Volver a una conversación que ya estuvo abierta en esta sesión: donde el usuario la dejó (abajo del todo, si estaba abajo).
  useLayoutEffect(() => {
    const z = zona.current;
    if (!sid || !z) return;
    retomarScroll(clave);
    return () => guardarAncla(clave, z, seg.pegado);
  }, [clave, sid]);

  // Al fondo cuando llega algo, también cada pedazo del texto que va llegando; si el usuario scrolleó
  // para arriba se suelta y no se lo arrastra hasta que vuelva al fondo (`seg`: src/hilo/seguir.ts,
  // que además mira el scroll y lo que crece fuera de un render).
  useLayoutEffect(() => {
    const z = zona.current;
    if (!z) return;
    const s = scroll.current;
    scroll.current = null;
    // Al abrir tras un reinicio, la conversación vuelve a donde el usuario la dejó (src/hilo/scrollGuardado.ts).
    if (pag && sid && restaurarScroll(z, seg, clave, pag.desde > 0)) {
      // ya está
    } else if (s?.tipo === "mantener") {
      z.scrollTop = z.scrollHeight - s.alFondo;
      anotar(z, seg);
    } else if (s?.tipo === "fondo") bajar(z, seg);
    else seguir(z, seg);
    // Si el usuario había subido y lo de abajo creció, la distancia al final cambió sin que él scrollee.
    if (pag && sid && !seg.pegado) anotarScroll(clave, z);
    if (pag && pag.desde > 0 && (z.scrollHeight <= z.clientHeight + MARGEN_PAGINA || faltaLlegar(clave))) anterior();
  }, [pag, mensajes.length, vivo.parcial, vivo.pensando, anterior, seg]);

  // --- La caja ---

  const escribir = (v: string, c = v.length) => {
    setTexto(v);
    setCaret(c);
    setSinMenu(false);
    setSel(0);
    setNota(null);
    ponerBorrador(clave, { texto: v });
  };

  const cambiarModo = (m: Modo) => {
    if (!puede) return;
    if (!l || !app) return setModoNuevo(m);
    const antes = modo;
    ponerModo(l.id, m);
    fuente.liderModo(l.id, m).catch((err) => {
      ponerModo(l.id, antes);
      setErrorCaja(mensaje(err));
    });
  };

  /** Lo que se escribió: un comando de la app se resuelve acá; lo demás va al líder. */
  const ejecutar = (crudo: string) => {
    if (!crudo.trim()) return enviar(crudo);
    const a = parsearComando(crudo, MODELOS, effortsDe(modelo), listaEstilos, modelo);
    if (a.tipo === "texto") return enviar(crudo);
    setErrorCaja(null);
    if (a.tipo === "error") return setErrorCaja(tr(a.clave, { v: a.v }));
    if (a.tipo === "modo") {
      cambiarModo(a.modo);
      // "/plan armá X": el modo primero, después el pedido (o a la cola, si está respondiendo).
      if (a.resto) return enviar(a.resto, a.modo);
      return escribir("");
    }
    escribir("");
    if (a.tipo === "limpiar") return l ? alNuevo() : undefined;
    if (a.tipo === "modelo") return elegirModelo(a.modelo);
    if (a.tipo === "estilo") return elegirEstilo(a.estilo);
    elegirEffort(a.effort);
  };

  /** /output-style: por el proceso vivo (al toque) o, si no hay ninguno, al próximo que arranque. */
  const elegirEstilo = (x: string) => {
    const antes = estilos.actual;
    ponerEstilos(x, null);
    fuente.liderEstilo(sid, x).then(
      (r) => setNota(tr(r === "vivo" ? "comando.estiloYa" : "comando.estiloDespues", { v: x })),
      (err) => {
        ponerEstilos(antes, null);
        setErrorCaja(mensaje(err));
      },
    );
  };

  /** "Que lo lea ya": lo que espera en la cola se saca (para no duplicarlo) y se le pasa al líder a mitad del turno. Si no va, vuelve a la cola. */
  const forzar = (x: Encolado) => {
    if (!l) return;
    const { id: _id, ...item } = x;
    cola.quitar(l.id, x.id);
    cola.inyectar(l.id, item).then(
      () => {
        inyectado(l.id, x.texto, x.imagenes);
        scroll.current = { tipo: "fondo" };
      },
      (err) => {
        cola.encolar(l.id, item).catch(() => {});
        setErrorCaja(mensaje(err));
      },
    );
  };

  const enviar = (crudo = texto, modoNuevoYa?: Modo) => {
    const archivos = archivosDe(adjuntos);
    // Los archivos que no son imágenes van como rutas al final del texto: Claude los lee con Read.
    const t = textoConArchivos(crudo.trim(), archivos, (ruta) => tr("adjunto.linea", { ruta }));
    const imgs = imagenesDe(adjuntos);
    const imagenes = imgs.length ? imgs : undefined;
    if ((!t && !imagenes) || enviando || !puede) return;
    /** A mitad de un turno: a la cola; sale solo cuando termine. Al de la terminal, con lo que hace falta para traerlo. */
    const aLaCola = (id: string, nombre: string) => {
      const antes = adjuntos;
      cola.encolar(id, { texto: t, modelo, effort, ...(imagenes ? { imagenes } : {}), ...(app ? {} : { modo: modoNuevoYa ?? modo, nombre }) }).catch((err) => {
        // No entró (el main lo rechazó, o el celular sin red): vuelve a la caja.
        const msg = mensaje(err);
        ponerBorrador(clave, { texto: crudo, error: msg });
        setTexto(crudo); setCaret(crudo.length);
        setErrorCaja(msg);
        agregarAdjuntos(clave, antes);
      });
      scroll.current = { tipo: "fondo" };
      setTexto(""); setCaret(0);
      setErrorCaja(null);
      setEnviando(false);
      ponerBorrador(clave, { texto: "", error: null });
      vaciarAdjuntos(clave);
    };
    // El de la terminal: también si ya hay algo esperando (no se le adelanta a lo que está en la cola).
    if (l && (ocupado || (!app && encolados.length > 0))) return aLaCola(l.id, l.nombre);
    const e: EnvioLider = { texto: t, modelo, effort, ...(imagenes ? { imagenes } : {}), ...(l ? {} : { modo: modoNuevoYa ?? modoNuevo, ...(maquinaDe ? { maquina: maquinaDe } : {}), ...(carpeta.trim() ? { carpeta: carpeta.trim() } : {}) }) };
    setEnviando(true);
    setErrorCaja(null);
    ponerBorrador(clave, { texto: crudo, error: null });
    // Las imágenes salen de la caja con el mensaje; si no sale, vuelven.
    let salieron = false;
    const mal = (err: unknown) => {
      const msg = mensaje(err);
      ponerBorrador(clave, { texto: crudo, error: msg });
      setTexto(crudo); setCaret(crudo.length);
      setErrorCaja(msg);
      setEnviando(false);
      if (salieron && adjuntos.length) agregarAdjuntos(clave, [...(imagenes ?? []), ...archivos]);
    };
    if (!l) {
      // La caja baja ya; el líder creado se abre (remonta la vista) cuando terminó de bajar.
      setPartio(true);
      const bajada = new Promise<void>((ok) => {
        bajo.current = ok;
        setTimeout(ok, quieto ? 0 : BAJAR_MS);
      });
      fuente.liderNuevo(e).then(
        (nuevo) => {
          // El turno se anota ya (el stream puede terminar antes de que la caja baje); sólo la vista espera.
          enviado(nuevo, t, 0, imagenes);
          void bajada.then(() => {
            setMaquinaNueva(null);
            setCarpeta("");
            setCarpetaAbierta(false);
            ponerBorrador(clave, { texto: "", error: null });
            vaciarAdjuntos(clave);
            alCreado(nuevo, e);
          });
        },
        (err) => {
          setPartio(false);
          mal(err);
        },
      );
      return;
    }
    const salir = (total: number) => {
      salieron = true;
      vaciarAdjuntos(clave);
      enviado(l.id, t, total, imagenes);
      scroll.current = { tipo: "fondo" };
      setTexto(""); setCaret(0);
      fuente.liderMandar(l.id, e).then(
        () => {
          ponerBorrador(clave, { texto: "", error: null });
          setEnviando(false);
        },
        (err) => {
          fallo(l.id);
          mal(err);
        },
      );
    };
    if (app) return salir(pag?.total ?? 0);
    // Abierto en una terminal: primero se lo trae (cierra ese `claude`, por su pid) y recién
    // entonces sale el mensaje, con el `--resume` de siempre. Nunca dos procesos en el transcript.
    const modoAl = modoNuevoYa ?? modo;
    fuente.liderTraer(l.id, { modelo, effort, nombre: l.nombre, modo: modoAl }).then((r) => {
      if (!r.ok) {
        // A mitad de algo (la lista todavía no lo decía): no se tocó nada, y el mensaje espera en la cola.
        if (r.motivo === "trabajando") return aLaCola(l.id, l.nombre);
        setEnviando(false);
        setErrorCaja(tr(NO_TRAE[r.motivo]));
        return;
      }
      setTraido(true);
      ponerModo(l.id, modoAl);
      // Lo que alcanzó a escribir la terminal antes de cerrarse ya está en el transcript.
      return fuente.liderConversacion(l.id, null).then(
        (c) => salir(c.total),
        () => salir(pag?.total ?? 0),
      );
    }, mal);
  };

  /** Archivos pegados, soltados o elegidos: las imágenes se achican si hace falta; el resto lo guarda el main. Quedan en la caja. */
  const adjuntar = (fs: readonly File[]) => {
    if (!puede || !fs.length) return;
    setErrorCaja(null);
    void Promise.allSettled(fs.map((f) => prepararAdjunto(f, (n, d) => fuente.liderArchivo(n, d, maquinaDe)))).then((rs) => {
      const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const mal = rs.find((r): r is PromiseRejectedResult => r.status === "rejected");
      const sobran = agregarAdjuntos(clave, ok);
      if (mal)
        setErrorCaja(
          mal.reason instanceof ErrorAdjunto
            ? mal.reason.grande
              ? tr("adjunto.grande", { v: mal.reason.grande, n: ARCHIVO_MAX / 1024 / 1024 })
              : tr("adjunto.leer")
            : mensaje(mal.reason),
        );
      else if (sobran) setErrorCaja(tr("adjunto.muchas", { n: IMAGENES_MAX }));
    });
    caja.current?.focus();
  };
  // El texto pegado sigue su camino; los archivos del portapapeles, a la caja.
  const pegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const fs = archivosDeDatos(e.clipboardData);
    if (!fs.length) {
      // Sin nada que el navegador sepa pegar (otro tipo de texto, un offer viejo): el main lee el portapapeles.
      const leer = main?.portapapeles;
      if (!puede || !leer || !pegadoSinTexto(e.clipboardData)) return;
      e.preventDefault();
      const c = e.currentTarget;
      const [ini, fin] = [c.selectionStart, c.selectionEnd];
      void leer.texto().then((t) => {
        if (!t) return;
        const base = c.value;
        const p = ini + t.length;
        pendiente.current = p;
        escribir(base.slice(0, ini) + t + base.slice(fin), p);
      }, (err) => setErrorCaja(mensaje(err)));
      return;
    }
    if (!e.clipboardData.types.includes("text/plain")) e.preventDefault();
    adjuntar(fs);
  };
  const conArchivos = (e: DragEvent) => puede && e.dataTransfer.types.includes("Files");
  const soltable = {
    onDragOver: (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!arrastra) setArrastra(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastra(false);
    },
    onDrop: (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      setArrastra(false);
      adjuntar(Array.from(e.dataTransfer.files));
    },
  };

  const parar = () => {
    if (!l || vivo.parando) return;
    parando(l.id);
    void fuente.liderParar(l.id);
  };

  const elegirComando = (s: Sugerencia, ya: boolean) => {
    if (!mn) return;
    const { texto: nuevo, caret: p } = reemplazar(texto, mn, s);
    // Enter o clic sobre un comando de la app al inicio de la caja lo ejecuta, con lo que sigue ("/plan armá X").
    if (ya && directo(s) && mn.ini === 0) return ejecutar(nuevo);
    // El foco primero: enfocar dispara onFocus, que abre el menú.
    caja.current?.focus();
    pendiente.current = p;
    escribir(nuevo, p);
    if (directo(s)) setSinMenu(true);
  };

  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Tab rota el modo, como en Claude Code (también mientras responde).
    if (es("modo", e)) {
      e.preventDefault();
      cambiarModo(siguienteModo(modo));
      return;
    }
    if (e.nativeEvent.isComposing) return;
    if (menu.length) {
      const n = moverSel(Math.min(sel, menu.length - 1), menu.length, e.key);
      if (n !== null) {
        e.preventDefault();
        setSel(n);
        // Sólo con el teclado (el mouse ya la tiene a la vista): que no quede fuera del scroll.
        menuCmd.current?.children[n]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        elegirComando(menu[Math.min(sel, menu.length - 1)], e.key === "Enter");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSinMenu(true);
        return;
      }
    }
    // Con el dedo no hay Shift+Enter: Enter es un renglón más y se manda con el botón.
    if (es("enviar", e) && !esTactil()) {
      e.preventDefault();
      ejecutar(texto);
    } else if (es("salirCaja", e)) e.currentTarget.blur();
  };

  const elegirModelo = (m: string) => {
    if (l && esAgy(m) !== esAgy(l.modelo)) {
      setErrorCaja(tr("comando.cambioProveedor", { v: nombreModelo(m) }));
      return;
    }
    tocado.current = true;
    setModelo(m);
    // Cada modelo tiene sus niveles: si el esfuerzo de ahora no existe en el nuevo, pasa al que le toca a ese modelo.
    setEffort((antes) => reajustarEffort(m, antes, effortsLeidos() ?? {}));
  };
  const elegirEffort = (x: string) => {
    tocado.current = true;
    setEffort(x);
    recordarEffort(modelo, x);
  };

  const cache = useMemo(
    () => (l && l.cache_vence !== null && !l.subagentes ? pintorCache(`lider:${l.id}:${l.cache_vence}`, l.cache_vence, l.cache_ttl_s, false) : null),
    [l],
  );

  const retomar = () => {
    if (!l || retomando) return;
    setRetomando(true);
    setErrorCaja(null);
    fuente.liderRetomar(l.id, { modelo, effort, nombre: l.nombre }).then(
      (r) => {
        setNoRetoma(r.ok ? null : r.motivo);
        // Si salió bien queda "retomando" hasta que la lista lo traiga como líder de la app.
        if (!r.ok) setRetomando(false);
      },
      (e) => {
        setRetomando(false);
        setErrorCaja(mensaje(e));
      },
    );
  };
  // Abierto en otro lado se puede reintentar (cerrándolo allá); sin conversación o sin carpeta, no.
  const sinVuelta = noRetoma !== null && noRetoma !== "abierto";
  const cambia = !!l && puede && !ocupado && (l.cache_vence ?? 0) * 1000 > Date.now() && modelo !== modeloDe(l.modelo);
  const aviso = useMemo(
    () => (cambia && l ? pintorAviso(l.cache_vence ?? 0, modelo, tokens(pag?.usage ?? null)) : null),
    [cambia, l, modelo, pag?.usage],
  );

  const alMedio = !l && !items.length && !partio;

  return (
    <>
      <div className="lider-linea" data-desliza>
        {l ? (
          <>
            <b>{l.nombre && !repiteElPrimero(l.nombre, items) ? l.nombre : tr("lider.sesionJefe")}</b>
            <span>{l.titulo || nombreModelo(modelo)}</span>
            {l.effort ? <span>{l.effort}</span> : null}
            {!ocupado && cache ? <Reloj pintor={cache} className="cache" /> : null}
            {l.subagentes ? <ChipSubagentes n={l.subagentes} clave={l.id} /> : null}
            {app && !l.vivo && !l.caido ? <span className="tenue">{tr("lider.dormido")}</span> : null}
            {l.caido ? <span className={l.caido === "murio" ? "c-fallo" : "tenue"} title={l.motivo}>{tr(l.caido === "murio" ? "estado.fallo" : "lider.cerrado")}</span> : null}
          </>
        ) : (
          <>
            <b>{tr("lider.nuevo")}</b>
            <span>{tr("lider.nuevoSub")}</span>
          </>
        )}
      </div>
      <div
        className="conv-zona"
        ref={zona}
        data-vacia={!l && !items.length ? "" : undefined}
        onWheel={() => soltarScroll(clave)}
        onPointerDown={() => soltarScroll(clave)}
        onKeyDown={() => soltarScroll(clave)}
        onScroll={(e) => {
          if (sid && pag) anotarScroll(clave, e.currentTarget);
          if (e.currentTarget.scrollTop < MARGEN_PAGINA) anterior();
        }}
        {...soltable}
      >
        <div className="conv" data-desliza>
          {pag && pag.desde > 0 ? <div className="conv-mas">{tr("vista.anteriores")}</div> : null}
          {sid && !pag && !error && !items.length ? <Leyendo /> : null}
          <Mensajes
            items={items}
            ultimoTurno={ultimoTurno}
            app={app}
            ocupado={ocupado}
            pasando={pasando}
            pensando={app && ocupado && vivo.ind.hace?.que === "pensando"}
            razon={app && piensa}
            relevo={relevo}
            sigue={sigue}
            nombre={l?.nombre}
            alAbrirLider={alAbrirLider}
          />
          {!l && !items.length ? (
            <div className="conv-vacia" data-ido={partio ? "" : undefined}>
              {tr("lider.vacio")}
            </div>
          ) : null}
          <Avisos avisos={avisos} />
          {pasando ? <Pasando /> : app && sid ? <HaceChat sid={sid} piensa={piensa} modelo={nombreModelo(modeloDe(l?.modelo) ?? modelo)} effort={l?.effort ?? effort} alParar={l ? parar : undefined} parando={vivo.parando} /> : compacta !== null ? <Compactando desde={compacta} /> : null}
          {l
            ? encolados.map((x, k) => (
                <div key={x.id} className="yo encolado" data-error={k === 0 && errorCola ? "" : undefined}>
                  <div className="encolado-t">
                    <span>{k === 0 && errorCola ? textoMain(errorCola) : tr("lider.enCola")}</span>
                    {k === 0 && errorCola ? (
                      <button type="button" className="encolado-re" data-reintentar-cola onClick={() => cola.ya(l.id, false)}>
                        {tr("lider.colaReintentar")}
                      </button>
                    ) : null}
                    {ocupado && app && !agy ? (
                      <button type="button" className="encolado-ya" data-forzar-cola aria-label={tr("inyectar.queLoLea")} data-tip={tr("inyectar.tip")} onClick={() => forzar(x)}>
                        <Zap size={12} strokeWidth={2.2} />
                        <span>{tr("inyectar.queLoLea")}</span>
                      </button>
                    ) : null}
                    <button type="button" className="encolado-x" aria-label={tr("lider.quitarCola")} data-tip={tr("lider.quitarCola")} onClick={() => cola.quitar(l.id, x.id)}>
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  </div>
                  <Yo texto={x.texto} imagenes={x.imagenes} />
                </div>
              ))
            : null}
          {error ? (
            <div className="lista-aviso" data-error="" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <motion.div
        className="caja-zona"
        data-desliza
        layout={l ? false : "position"}
        transition={quieto ? { duration: 0 } : BAJAR}
        onLayoutAnimationComplete={() => bajo.current?.()}
        {...soltable}
      >
        {app && sid ? vivo.pide.filter((p) => !p.preguntas?.length).map((p) => <PedidoPermiso key={p.id} sid={sid} p={p} />) : null}
        {app && sid && tandas[0] ? <PedidoPreguntas key={tandas[0].id} sid={sid} p={tandas[0]} preguntas={tandas[0].preguntas} n={1} total={tandas.length} /> : null}
        {puede && menu.length ? (
          <div className="menu-cmd" ref={menuCmd} role="listbox" aria-label={tr("comando.menu")}>
            {menu.map((s, k) => (
              <button
                key={s.valor ?? s.nombre}
                type="button"
                role="option"
                aria-selected={k === sel}
                aria-current={s.actual || undefined}
                className="cmd"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSel(k)}
                onClick={() => elegirComando(s, true)}
              >
                <span className="cmd-m" aria-hidden="true">
                  {s.solo ? <Logo empresa={s.solo} /> : null}
                </span>
                {s.valor !== undefined ? (
                  <span className="cmd-n">
                    <i>/{s.nombre} </i>
                    {s.valor}
                    {s.actual ? <Check className="cmd-ya" size={12} strokeWidth={2.4} aria-label={tr("comando.actual")} /> : null}
                  </span>
                ) : (
                  <span className="cmd-n">
                    /{s.nombre}
                    {s.args ? <i> {s.args}</i> : null}
                  </span>
                )}
                <span className="cmd-d">{s.clave ? tr(s.clave) : (s.descripcion ?? "")}</span>
                {s.solo ? <span className="cmd-s">{tr(s.solo === "google" ? "comando.soloGoogle" : "comando.soloAnthropic")}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {ajeno ? (
          <div className="caja-ajeno" data-espera={enEspera ? "" : undefined}>
            <span>{tr(enEspera ? "lider.ajenoEspera" : ocupado ? "lider.ajenoOcupado" : "lider.ajenoNota")}</span>
            {enEspera && ocupado ? (
              // Lo de siempre es esperar; cortarlo es la salida de emergencia.
              <button type="button" className="btn2" data-cortar-lider onClick={() => cola.ya(l.id, true)}>
                {tr("lider.ajenoCortarYa")}
              </button>
            ) : ventana && l.pid ? (
              <button type="button" className="btn2" data-ir-lider onClick={() => void fuente.liderIr(l.pid!).then((ok) => ok || setVentana(false))}>
                {tr("lider.ir")}
              </button>
            ) : null}
          </div>
        ) : null}
        {puede ? (
          <div className="caja" data-arrastra={arrastra ? "" : undefined}>
            {adjuntos.length ? <Adjuntos lista={adjuntos} alQuitar={(k) => quitarAdjunto(clave, k)} /> : null}
            <label className="oculto" htmlFor={id}>
              {tr("lider.label")}
            </label>
            <textarea
              id={id}
              ref={caja}
              rows={1}
              value={texto}
              readOnly={enviando}
              // Con el dedo, enfocar abre el teclado y tapa lo que se vino a leer: se toca la caja.
              autoFocus={!MODO.captura && !esTactil()}
              placeholder={ocupado ? tr("lider.phOcupado") : l ? tr("vista.ph") : tr("lider.ph")}
              onChange={(e) => escribir(e.target.value, e.target.selectionStart)}
              // El cursor se mueve con las flechas o el mouse, sin tecla que cambie el texto: el menú sigue al token.
              onSelect={(e) => {
                const c = e.currentTarget.selectionStart;
                if (c !== caret) {
                  setCaret(c);
                  setSel(0);
                }
              }}
              // Esc (o salir de la caja) cierra el menú; volver a la caja lo abre de nuevo.
              onFocus={() => setSinMenu(false)}
              onBlur={() => setSinMenu(true)}
              onKeyDown={tecla}
              onPaste={pegar}
            />
            {!l && carpetaAbierta ? (
              <div className="caja-carpeta">
                <Folder size={13} strokeWidth={2} aria-hidden />
                <label className="oculto" htmlFor={idCarpeta}>
                  {tr("lider.carpeta")}
                </label>
                <input
                  id={idCarpeta}
                  type="text"
                  value={carpeta}
                  readOnly={enviando}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={tr("lider.carpetaPh")}
                  onChange={(e) => setCarpeta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setCarpetaAbierta(false);
                      caja.current?.focus();
                    }
                  }}
                />
                {main?.carpeta ? (
                  <button type="button" className="btn2" disabled={enviando} onClick={elegirCarpeta}>
                    {tr("lider.carpetaElegir")}
                  </button>
                ) : null}
              </div>
            ) : null}
            <input
              ref={elegir}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                adjuntar(Array.from(e.currentTarget.files ?? []));
                e.currentTarget.value = "";
              }}
            />
            <div className="barra-c">
              <button
                type="button"
                className="clip"
                aria-label={tr("adjunto.adjuntar")}
                data-tip={tr("adjunto.adjuntar")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir.current?.click()}
              >
                <Paperclip size={13} strokeWidth={2} />
              </button>
              {!l ? (
                <button
                  type="button"
                  className="clip"
                  data-carpeta
                  data-on={carpeta.trim() ? "" : undefined}
                  aria-label={tr("lider.carpeta")}
                  aria-expanded={carpetaAbierta}
                  data-tip={carpeta.trim() ? tr("lider.carpetaEn", { c: carpeta.trim() }) : tr("lider.carpetaTip")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCarpetaAbierta((a) => !a)}
                >
                  <Folder size={13} strokeWidth={2} />
                </button>
              ) : null}
              <button
                type="button"
                className="modo"
                style={{ color: ASPECTO[modo].color }}
                // Con el dedo no hay Shift+Tab, y en angosto el chip es sólo el símbolo: el tooltip dice el modo.
                data-tip={esTactil() ? tr(ASPECTO[modo].clave) : "Shift+Tab"}
                aria-label={tr("modo.tip", { modo: tr(ASPECTO[modo].clave) })}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => cambiarModo(siguienteModo(modo))}
              >
                <span aria-hidden>{ASPECTO[modo].simbolo}</span>
                <span className="modo-t">{tr(ASPECTO[modo].clave)}</span>
              </button>
              <Selector
                etiqueta={tr("comun.modelo")}
                opciones={l ? MODELOS.filter((m) => esAgy(m.id) === esAgy(l.modelo)) : MODELOS}
                valor={modelo}
                alElegir={elegirModelo}
                chip={<span className="chip" />}
                disabled={app && ocupado}
                abierto={MODO.captura === "modelo"}
              />
              {/* Un modelo sin niveles (Ollama) no tiene qué elegir acá. */}
              {effortsDe(modelo).length ? (
                <Selector
                  etiqueta={tr("comun.esfuerzo")}
                  opciones={effortsOpciones(modelo)}
                  valor={effort}
                  alElegir={elegirEffort}
                  disabled={app && ocupado}
                  abierto={MODO.captura === "esfuerzo" || MODO.captura === "local-esfuerzo"}
                />
              ) : null}
              {!l && hayVarias(maquinas) ? (
                <Selector
                  etiqueta={tr("maquina.elegir")}
                  opciones={opcionesMaquina(maquinas)}
                  valor={maquinaNueva ?? maquinas.esta.id}
                  alElegir={setMaquinaNueva}
                  disabled={enviando}
                  abierto={MODO.captura?.startsWith("maquinas-selector")}
                />
              ) : null}
              {esLocal(modelo) ? <ContextoLocal modelo={modelo} abierto={MODO.captura === "local-ctx"} /> : null}
              <span className="esp" />
              <Contexto sid={sid} modelo={modelo} vence={l?.cache_vence ?? null} abierto={MODO.captura === "contexto-abierto"} />
              {app && ocupado ? (
                <button type="button" className="btn2" disabled={vivo.parando} onClick={parar}>
                  {vivo.parando ? tr("accion.parando") : tr("accion.parar")}
                </button>
              ) : null}
              <Dictar
                clave={clave}
                alError={setErrorCaja}
                alNota={setNota}
                alListo={(c) => c === clave && !esTactil() && caja.current?.focus()}
              />
              <button
                type="button"
                className="prim"
                aria-label={tr("lider.mandar")}
                data-tip="Enter"
                disabled={(!texto.trim() && !adjuntos.length) || enviando}
                onClick={() => ejecutar(texto)}
              >
                <ArrowUp size={14} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        ) : l?.caido ? (
          <div className="caja lider-ajeno" data-caido={l.caido}>
            <span title={l.motivo}>{tr(noRetoma ? NO_RETOMA[noRetoma] : l.caido === "murio" ? "lider.caidoMurio" : "lider.caidoCerro")}</span>
            <span className="esp" />
            {sinVuelta ? (
              archivar
            ) : (
              <button type="button" className="prim" data-texto data-retomar-lider disabled={retomando} onClick={retomar}>
                {tr("lider.retomar")}
              </button>
            )}
          </div>
        ) : (
          <div className="caja lider-ajeno">
            <span>{tr("lider.ajeno")}</span>
            <span className="esp" />
            <Contexto sid={sid} modelo={l?.modelo ?? null} vence={l?.cache_vence ?? null} />
          </div>
        )}
        {errorCaja ? <div className="caja-error" role="alert">{errorCaja}</div> : null}
        {nota && !errorCaja ? <div className="caja-nota" role="status">{nota}</div> : null}
        {aviso ? <Reloj pintor={aviso} className="caja-aviso" /> : null}
        {/* Un líder local corre en la GPU de esta máquina, sin pa ni subagentes: que se sepa antes de pedirle una tarea grande. */}
        {puede && sinWorkers(modelo) ? (
          <div className="caja-local" role="status">
            <Cpu size={12} strokeWidth={2} aria-hidden="true" />
            {tr(esLocal(modelo) ? "lider.localSinWorkers" : "lider.ollamaSinWorkers")}
          </div>
        ) : null}
      </motion.div>
      {/* Debajo de la caja al medio, lo mismo que la conversación arriba: queda centrada. */}
      {alMedio ? <div className="caja-bajo" /> : null}
    </>
  );
}

/**
 * Un pedido de permiso del líder: el plan de ExitPlanMode (Aprobar vuelve a
 * bypass y sigue; Seguir planeando le dice qué cambiar) o una herramienta que
 * el modo no deja sola (Permitir / Negar).
 */
/**
 * Lo de un mensaje del usuario: imágenes y archivos arriba, después el texto. Las
 * líneas con la ruta de cada archivo (lo que recibe Claude) se ven como chips.
 */
type PropsMensajes = {
  items: Item[];
  ultimoTurno: number;
  app: boolean;
  ocupado: boolean;
  pasando: boolean;
  /** Está razonando ahora: el bloque del último turno dice "Pensando…". */
  pensando: boolean;
  /** Un motor que deja ver su razonamiento y sus comandos (Gemini). */
  razon: boolean;
  relevo: ReturnType<typeof relevoEn>;
  sigue: Lider | null;
  nombre: string | undefined;
  alAbrirLider: ((id: string) => void) | undefined;
};

/**
 * La conversación. Aparte de la caja para que cada tecla no la recorra entera: lo que se escribe es estado de `ChatLider`, y con
 * 3000 mensajes volver a armarlos en cada letra tardaba más de 50 ms. Sólo se repinta cuando cambian los mensajes o el turno.
 */
const Mensajes = memo(function Mensajes({ items, ultimoTurno, app, ocupado, pasando, pensando, razon, relevo, sigue, nombre, alAbrirLider }: PropsMensajes) {
  return (
    <>
      {items.map((x, i) =>
        x.tipo === "yo" ? (
          <Fragment key={x.key}>
            <Marca k={x.key} />
            <div className="yo">
              <Yo texto={x.texto} imagenes={x.imagenes} />
            </div>
            {x.ts !== null ? <Hora ts={x.ts} der /> : null}
          </Fragment>
        ) : x.tipo === "sistema" ? (
          <Fragment key={x.key}>
            <Marca k={x.key} />
            <Sistema s={x.s} nombre={nombre} />
          </Fragment>
        ) : (
          <Fragment key={x.key}>
            <Marca k={x.key} />
            {/* Uno de la app dice qué hace abajo (HaceChat); uno de terminal, "Trabajando X s" en su turno. */}
            <Turno t={x} vivo={!app && ocupado && i === ultimoTurno && !pasando} enCurso={ocupado && i === ultimoTurno} pensando={pensando && i === ultimoTurno} razon={razon} />
            {relevo?.hecho && relevo.k === i ? (
              <Sigue nombre={sigue?.nombre ?? nombre ?? null} alAbrir={sigue && alAbrirLider ? () => alAbrirLider(sigue.id) : null} />
            ) : null}
          </Fragment>
        ),
      )}
    </>
  );
});

const Yo = memo(function Yo({ texto, imagenes }: { texto: string; imagenes?: readonly Imagen[] }) {
  const { texto: t, archivos } = separarAdjuntos(texto);
  return (
    <>
      {imagenes?.length || archivos.length ? <Miniaturas imagenes={imagenes ?? []} archivos={archivos} /> : null}
      {t.trim() ? <Texto texto={t} propio /> : null}
    </>
  );
});

function PedidoPermiso({ sid, p }: { sid: string; p: Pedido }) {
  const [planear, setPlanear] = useState(false);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const plan = p.herramienta === "ExitPlanMode";
  const [mandando, setMandando] = useState(false);
  // La tarjeta se va recién cuando el main contesta; si falla, se queda y dice por qué.
  const contestar = (ok: boolean, msj?: string) => {
    if (mandando) return;
    setMandando(true);
    fuente
      .liderPermiso(sid, p.id, ok, msj)
      .then(() => {
        if (ok && plan) ponerModo(sid, MODO_DEFAULT);
        contestado(sid, p.id);
      })
      .catch((e) => {
        setMandando(false);
        setError(mensaje(e));
      });
  };
  const seguir = () => contestar(false, nota.trim() || undefined);
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      seguir();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPlanear(false);
    }
  };
  return (
    <div className="pide" data-plan={plan ? "" : undefined}>
      <div className="pide-t">
        {plan ? tr("plan.titulo") : tr("permiso.titulo", { herramienta: p.herramienta })}
      </div>
      {plan ? (
        <div className="pide-plan el">
          <Texto texto={p.plan ?? ""} />
        </div>
      ) : p.detalle ? (
        <pre className="pide-detalle">{p.detalle}</pre>
      ) : null}
      {planear ? (
        <div className="pide-nota">
          <textarea
            rows={1}
            autoFocus
            value={nota}
            placeholder={tr("plan.notaPh")}
            aria-label={tr("plan.seguir")}
            onChange={(e) => setNota(e.target.value)}
            onKeyDown={tecla}
          />
          <button type="button" className="prim" aria-label={tr("plan.mandarNota")} data-tip="Enter" disabled={mandando} onClick={seguir}>
            <ArrowUp size={14} strokeWidth={2.4} />
          </button>
        </div>
      ) : (
        <div className="pide-b">
          <button type="button" className="prim" data-texto="" disabled={mandando} onClick={() => contestar(true)}>
            {plan ? tr("plan.aprobar") : tr("permiso.permitir")}
          </button>
          <button type="button" className="btn2" disabled={mandando} onClick={() => (plan ? setPlanear(true) : contestar(false))}>
            {plan ? tr("plan.seguir") : tr("permiso.negar")}
          </button>
        </div>
      )}
      {error ? <div className="caja-error" role="alert">{error}</div> : null}
    </div>
  );
}
