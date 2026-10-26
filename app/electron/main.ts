// Proceso main de hilos: abre la ventana y es el backend (todo por IPC a través del
// preload). Servidor HTTP sólo si el usuario prendió el acceso desde el celular (electron/remoto.ts).
// Dos modos: todo en uno (el núcleo corre acá: pruebas, capturas, bench, dev, y sin motor) o cliente del
// motor (electron/ventana-cliente.ts), si el motor responde en el socket local y `dueno` lo confirma.
import { codigoSalida } from "./aislar.js"; // primero: en una corrida de prueba, ningún módulo toca los datos del usuario sin que quede anotado
import "./entorno-windows.ts"; // segundo: en Windows deja TRAMA_LOCAL=1 y los .cmd en el PATH antes de que pa.ts, lider-arma.ts… lean el entorno
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { armarBench } from "./bench.js";
import { armarBandeja, type Bandeja } from "./bandeja.js";
import { conPunto } from "./espera-aviso.js";
import { crearTope } from "./bitacora.js";
import { CODIGO_CERRADO, esconderAlCerrar, preguntarSalida } from "./cierre.js";
import { vigilarPagina, vigilarProceso } from "./contencion.js";
import { abrirEnlace } from "./enlace.js";
import { carpetaLocal, motorVivo, socketDe } from "./local.js";
import { log, logAparte } from "./log.js";
import { ESTADO } from "./estado.js";
import { baseConsulta, crearConsulta } from "./consulta.js";
import { pedirSalida, pedirVista, ponerAnotadorDeVista, ponerEstadoEspera, ponerRecarga, ponerTextosBandeja, ponerVistas, ventanas } from "./ventana-canales.js";
import type { Cliente } from "./ventana-cliente.js";
import { acomodar, crearGuardadoVolver, guardarVolver, leerVolver, lugarDeVentana, type Ventana, type Volver } from "./volver.js";
import { silencio } from "./log.js";
import { enMarcha, marcar, type Corrida } from "./reinicio-marcas.js";
import { esWindows } from "./plataforma.ts";

// Wayland nativo SIEMPRE. Un cliente XWayland colgado puede congelar Hyprland
// entero (pasó con webkit + GDK_BACKEND=x11); uno Wayland nativo colgado sólo
// se cuelga a sí mismo.
// (Windows no tiene Wayland ni ozone: ahí no se pasa.)
if (!esWindows(process.platform)) app.commandLine.appendSwitch("ozone-platform", "wayland");

// Sin GPU por default: con esta UI da los mismos fps (200 en HDMI-A-2) con menos
// CPU, menos RAM y arranque más rápido (medido en B0b y otra vez en B1, ver
// docs/estado/B1.md). HILOS_GPU=1 la vuelve a prender.
if (process.env.HILOS_GPU !== "1") app.commandLine.appendSwitch("disable-gpu");

// Switches extra para probar en el bench sin recompilar:
// HILOS_FLAGS="disable-gpu use-angle=gl" → --disable-gpu --use-angle=gl.
for (const f of (process.env.HILOS_FLAGS ?? "").split(/\s+/).filter(Boolean)) {
  const [k, ...v] = f.replace(/^--/, "").split("=");
  app.commandLine.appendSwitch(k, v.join("="));
}

const aqui = import.meta.dirname;

// Modos de prueba. El frontend los lee de la query (síncrono, sin parpadeo):
//   HILOS_BENCH=<out.json>   corre un guion de medición y cierra (scripts/bench.sh).
//   HILOS_GUION=barra|paneles|b0  qué guion: la barra (default con HILOS_BENCH), los paneles
//                            del pie (siempre con el `pa` falso) o la pantalla de B0.
//   HILOS_CAPTURA=<estado>   la app con fixtures y un estado forzado (los de `Captura` en
//                            src/modo.ts); se cierra sola (scripts/captura.sh).
//   HILOS_CAPTURA_PNG=<png>  igual, pero sin ventana: render offscreen a un PNG y cierra.
//   HILOS_ESCALA=1.5         zoom del render offscreen.
//   HILOS_FALLA=cerrar       hace fallar el Cerrar (la fila vuelve con el error en línea).
//   HILOS_POCOS=1            fixtures de Estadísticas con pocos datos (3 días, la cuota de hoy).
//   HILOS_CAPTURA_ESPERA=<ms> cuánto esperar antes de la foto (default 1500).
//   HILOS_AHORA=<ms>         reloj quieto en la captura (src/reloj-fijo.ts): horas iguales en cada corrida.
//   HILOS_VARIANTE=<v>       variante de la captura: `modelo` (ajustes con el selector de
//                            modelo abierto), `asistente` (lider-nuevo con el prompt de Ramas).
//   HILOS_FIXTURES=1|0       datos falsos (src/datos/fixtures.ts) o los de `pa`. Sin la
//                            variable: fixtures en bench y captura, `pa` en todo lo demás.
//   HILOS_PA=<ruta>          qué `pa` se ejecuta (default `pa`; para probar, scripts/pa-falso.sh).
//   HILOS_PRUEBA=<s>         la app de siempre pero offscreen (sin ventana) y se cierra a los
//                            <s> segundos: la maneja scripts/prueba-acciones.mjs por CDP.
//   HILOS_TAILSCALE=<ruta>   qué `tailscale` se ejecuta para trama por la tailnet (docs/remoto.md).
//   HILOS_TABLERO=<ruta>     qué `tablero` se ejecuta (default: el del PATH o ~/.local/bin/tablero).
//                            Para probar, `TABLERO_DIR=<carpeta temporal>` (lo lee el CLI): la app
//                            mira `<carpeta>/vista.json` y el tablero real no se toca.
//   HILOS_NPM=<ruta>         el `npm` del aviso de Claude Code nuevo (para probar, scripts/npm-falso.sh;
//                            el `claude` que se pregunta es HILOS_CLAUDE, como los líderes).
//   HILOS_IDIOMA=en|es       idioma de la interfaz. Sin la variable: el de preferencias.json
//                            (Ajustes), o inglés; en bench y captura, inglés siempre.
//   HILOS_LETRA=13..18       tamaño de letra en px; HILOS_FUENTE=<id> y HILOS_MONO=<id>, las fuentes
//                            (ids en src/tipografia.ts). Sin las variables: lo de preferencias.json
//                            (Ajustes); en bench y captura, el default (13, Inter, JetBrains Mono).
//   HILOS_TIERNOS=1|0        los mensajes tiernos (B17). Sin la variable: lo de preferencias.json
//   HILOS_CONSUMO=1|0        el panel de consumo a la vista. Sin la variable: lo de preferencias.json
//                            (Ajustes); en bench y captura, prendidos (y sin rotar).
//   HILOS_VISTA=todo|lideres la vista de la barra. Sin la variable: la de preferencias.json; en
//                            bench y captura, todo.
//   --escondida              (argumento) arranca sin mostrar la ventana: así la levanta la unidad de
//                            systemd al iniciar la sesión (systemd/trama.service). Abrirla desde el
//                            lanzador la muestra.
//   TRAMA_UNIDAD=1           lo pone la unidad: para reiniciarse alcanza con salir (Restart=always).
//   HILOS_BANDEJA=1          con HILOS_PERFIL (una trama residente de prueba) no hay ícono en la bandeja salvo que se pida:
//                            la prueba no pone uno de más en la barra del usuario. HILOS_BANDEJA=0: ni la de siempre.
//   HILOS_PERFIL=<carpeta>   otro `userData` (y otro candado de instancia única): una trama residente
//                            de prueba no le abre la ventana a la del usuario (scripts/prueba-relanzar.mjs).
//   HILOS_RELANZAR_MS=<ms>   cuánto tiene que quedarse quieto el build para darlo por terminado.
//   HILOS_BUILD=<carpeta>    el checkout cuyo build se mira para avisar que hay uno nuevo (default: éste). La prueba
//                            pone uno de mentira: no toca el build de verdad, que mira la trama del usuario.
const guion = process.env.HILOS_GUION ?? (process.env.HILOS_BENCH ? "barra" : "");
const captura = process.env.HILOS_CAPTURA ?? "";
const png = process.env.HILOS_CAPTURA_PNG ?? "";
const escala = Number(process.env.HILOS_ESCALA ?? 1);
const prueba = Number(process.env.HILOS_PRUEBA ?? 0);
// Perfil aparte: que la prueba no comparta localStorage con la app que el usuario tiene abierta.
if (prueba) app.setPath("userData", process.env.HILOS_PRUEBA_PERFIL ?? path.join(app.getPath("temp"), `hilos-prueba-${process.pid}`));
else if (process.env.HILOS_PERFIL) app.setPath("userData", process.env.HILOS_PERFIL);
// Bench y captura sin perfil propio: uno temporal, no el de la Trama del usuario (~/.config/hilos).
else if (guion || captura || png) {
  const perfil = path.join(app.getPath("temp"), `hilos-captura-${process.pid}`);
  app.setPath("userData", perfil);
  process.on("exit", () => rmSync(perfil, { recursive: true, force: true }));
}
// La unidad de systemd. Los líderes no la heredan: un `trama` corrido desde uno es el lanzador de siempre.
const unidad = process.env.TRAMA_UNIDAD === "1";
delete process.env.TRAMA_UNIDAD;
const escondida = process.argv.includes("--escondida");
/**
 * La ventana pedida a la vista aunque se arranque escondida: lo deja el lanzador cuando arranca la
 * unidad ("foco") y el reinicio que la tenía abierta ("foco" si lo tenía, si no "sin-foco"). Se gasta al leerlo, y uno viejo
 * (nadie lo gastó: p. ej. la unidad no llegó a arrancar) no vale: no abre la ventana al otro día.
 */
const MOSTRAR = path.join(ESTADO, "mostrar");
const MOSTRAR_VALE_MS = 2 * 60_000;
function pedida(): "foco" | "sin-foco" | null {
  try {
    const fresco = Date.now() - statSync(MOSTRAR).mtimeMs < MOSTRAR_VALE_MS;
    const dice = readFileSync(MOSTRAR, "utf8").trim();
    rmSync(MOSTRAR, { force: true });
    if (!fresco) return null;
    return dice === "sin-foco" ? "sin-foco" : "foco";
  } catch {
    return null;
  }
}
/** Cómo estaba la trama que se fue, sea cual sea la forma (electron/volver.ts): la ventana, y lo que cada vista tenía abierto. No se gasta al leerlo. */
const VOLVER = path.join(ESTADO, "volver.json");
let vuelta: Volver | null = null;
const LUGAR_VALE_MS = 2 * 60_000;
/** Lo mantiene al día mientras corre (sólo la residente: una captura o una prueba no dejan rastro). */
let guardadoVolver: ReturnType<typeof crearGuardadoVolver> | null = null;
const query: Record<string, string> = {};
if (guion) query.guion = guion;
if (captura || png) query.captura = captura || "normal";
if (process.env.HILOS_FALLA) query.falla = process.env.HILOS_FALLA;
if (process.env.HILOS_POCOS) query.pocos = "1";
if (process.env.HILOS_AHORA && (captura || png)) query.ahora = process.env.HILOS_AHORA;
if (process.env.HILOS_VARIANTE) query.variante = process.env.HILOS_VARIANTE;
const fixtures = process.env.HILOS_FIXTURES ? process.env.HILOS_FIXTURES !== "0" : !!(guion || captura || png);
// Si hay fixtures, y con datos de verdad la máquina (la ficha de cada worker) y el usuario (la carpeta del home en la barra).
Object.assign(query, baseConsulta(fixtures));

/** Cuánto vive la ventana en modo captura: lo justo para sacarle la foto. */
const CAPTURA_MS = Number(process.env.HILOS_CAPTURA_MS ?? 8000);
/** Cuánto se espera, ya cargada la página, antes de la foto: que terminen los resortes de entrada (`HILOS_CAPTURA_ESPERA`, scripts/visual.mjs). */
const ESPERA_FOTO_MS = Number(process.env.HILOS_CAPTURA_ESPERA ?? 1500);
/** Captura con datos reales: `pa --hilos` tarda; se espera a que el frontend avise, con tope. */
const CAPTURA_REAL_MS = 60_000;

/** La query con que carga el frontend (la ventana, y quien entra por red): los modos y lo de preferencias.json. */
const consulta = crearConsulta(query, !!(guion || captura || png));

/** El motor al que esta ventana le pide todo (modo cliente), o `null`: todo en uno. */
let cliente: Cliente | null = null;
/** Esta ventana nace de un reinicio por un build nuevo: su primera carga lleva el cartel "Actualizando Trama…" desde el primer cuadro (src/actualizando.ts). */
let llegaDeReinicio = false;
/** Anotar cómo estaba la ventana que se va (`anotarVolver`), que sigue en marcha mientras el motor cierra a los líderes. */
let guardando: Promise<void> = Promise.resolve();

/** Carga el frontend en la ventana; `extra` va en la query (`cartel=<detalle>`: sólo el cartel de error, sin la app). */
function cargar(ventana: BrowserWindow, extra: Record<string, string> = {}) {
  const q = { ...consulta(), ...extra };
  const dev = process.env.HILOS_DEV_URL;
  if (dev) void ventana.loadURL(`${dev}?${new URLSearchParams(q)}`);
  else void ventana.loadFile(path.join(aqui, "..", "dist", "index.html"), { query: q });
}

/** Cómo está la ventana ahora, para `volver.json` (el escritorio y el lugar sólo los anota el reinicio que pide el usuario: hyprctl tarda). */
function ventanaAhora(): Ventana | null {
  const v = BrowserWindow.getAllWindows()[0];
  if (!v || v.isDestroyed()) return null;
  const [ancho, alto] = v.getSize();
  return { ancho, alto, visible: v.isVisible(), foco: v.isFocused(), lugar: null };
}

function crearVentana() {
  // Vuelve del tamaño que tenía al irse, sea cual sea el motivo.
  const [ancho, alto] = vuelta?.ventana ? [vuelta.ventana.ancho, vuelta.ventana.alto] : (process.env.HILOS_TAM ?? "900 640").split(/\s+/).map(Number);
  // Residente y escondida (la unidad): sin ventana a la vista, salvo que la hayan dejado pedida.
  const mostrar = residente ? pedida() : null;
  const visible = !png && !prueba && (!(residente && escondida) || mostrar !== null);
  const ventana = new BrowserWindow({
    title: "trama",
    // La marca (public/favicon.svg, en PNG: Electron no abre SVG). En Wayland el ícono de la
    // ventana lo pone el .desktop del lanzador; esto cubre lo demás.
    icon: path.join(aqui, "..", "public", "icon.png"),
    width: ancho,
    height: alto,
    frame: false,
    show: visible && mostrar !== "sin-foco",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(aqui, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: !!png || prueba > 0,
    },
  });

  // Un archivo soltado fuera de la caja de un líder navegaba la ventana a `file://` (B26):
  // la app nunca navega sola (dev: la recarga de Vite no pasa por acá).
  ventana.webContents.on("will-navigate", (e) => e.preventDefault());
  // Un enlace de un mensaje (`target="_blank"`) va al navegador del sistema; acá no se abre nada.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    abrirEnlace(url, (u) => void shell.openExternal(u).catch(silencio("main")));
    return { action: "deny" };
  });

  // Volvía de un reinicio con la ventana abierta pero sin el foco: vuelve a la vista sin pedirlo.
  if (visible && mostrar === "sin-foco") ventana.once("ready-to-show", () => ventana.showInactive());
  // Y al escritorio (y al lugar, si flotaba) donde estaba: Hyprland la abre en el activo.
  // (El lugar sólo lo anota el reinicio del usuario: uno de hace rato ya no es de ese reinicio.)
  const lugar = visible && vuelta && Date.now() - vuelta.cuando < LUGAR_VALE_MS ? vuelta.ventana?.lugar : null;
  if (lugar) ventana.once("ready-to-show", () => void acomodar(process.pid, lugar));

  if (guardadoVolver) ventana.on("resize", guardadoVolver.tocar);

  // Super+Q (el cierre de ventana de Hyprland) y el ✕ llegan acá: la ventana se esconde y trama sigue viva, con su ícono en la bandeja.
  if (residente) ventana.on("close", esconderAlCerrar(ventana, () => saliendo));

  // Una página que carga con el motor caído se entera ya (el aviso de la caída le llegó a la anterior).
  if (cliente) ventana.webContents.on("did-finish-load", () => void (cliente?.caida() && ventana.webContents.send("remoto:conexion", false)));

  marcar("ventana", "ventana-creada");
  ventana.webContents.once("did-finish-load", () => void marcar("ventana", "pagina-cargada"));
  cargar(ventana, llegaDeReinicio ? { actualizando: "1" } : {});
  llegaDeReinicio = false;

  // La red de contención (electron/contencion.ts): si el renderer muere se recarga solo; si muere 3 veces en
  // un minuto se deja el cartel (el mismo de un error de render, con el detalle) y Recargar vuelve a intentar.
  const tope = crearTope();
  vigilarPagina(ventana.webContents, { log, tope, recargar: () => ventana.webContents.reload(), cartel: (detalle) => cargar(ventana, { cartel: detalle }) });
  ponerRecarga(() => {
    tope.reiniciar();
    cargar(ventana);
  });

  if (png) {
    // Al crearla, Electron la recorta al monitor primario; para la foto no hace falta.
    ventana.setContentSize(ancho, alto);
    ventana.webContents.once("did-finish-load", () => {
      // Offscreen no toma la escala del monitor: se agranda con zoom (HILOS_TAM va en px del PNG).
      ventana.webContents.setZoomFactor(escala);
      const foto = () =>
        setTimeout(async () => {
          writeFileSync(png, (await ventana.webContents.capturePage()).toPNG());
          app.exit(codigoSalida(0));
        }, ESPERA_FOTO_MS);
      if (fixtures) return void foto();
      // Con datos de `pa`: la foto cuando el frontend pintó los hilos frescos.
      ipcMain.once("captura:pintado", foto);
      setTimeout(() => app.exit(1), CAPTURA_REAL_MS).unref();
    });
  } else if (captura) {
    setTimeout(() => app.exit(codigoSalida(0)), CAPTURA_MS).unref();
  } else if (prueba) {
    setTimeout(() => app.exit(codigoSalida(0)), prueba * 1000).unref();
  }
}

/**
 * Anota cómo está la ventana para volver como estaba (electron/volver.ts): la ventana, lo que tenía abierto y
 * lo escrito sin mandar. Lo hace el reinicio por un build nuevo, de la ventana o (modo cliente) del motor.
 */
async function anotarVolver() {
  try {
    const v = BrowserWindow.getAllWindows()[0];
    const visible = !!v?.isVisible();
    const foco = !!v?.isFocused();
    const [ancho, alto] = v?.getSize() ?? [0, 0];
    const [vista, lugar] = await Promise.all([pedirVista(), visible ? lugarDeVentana(process.pid) : null]);
    guardarVolver(VOLVER, { ventana: v ? { ancho, alto, visible, foco, lugar } : null, vistas: vista === null ? {} : { ventana: vista } });
    // Lo que sigue (salir) no le pisa el archivo: ése lleva el escritorio y el lugar.
    guardadoVolver?.congelar();
    if (visible) writeFileSync(MOSTRAR, foco ? "foco\n" : "sin-foco\n");
  } catch (e) {
    console.error("[relanzar] no se pudo anotar cómo estaba:", e);
  }
}

/**
 * Se va este proceso tras "Cerrar del todo" (Ctrl+Q, la bandeja). Bajo la unidad sale con `CODIGO_CERRADO` (en `RestartPreventExitStatus`):
 * Cerrar del todo no la levanta de nuevo a los 0,5 s; vuelve con `trama` (el lanzador la arranca) o con la próxima sesión.
 */
function irseDelTodo() {
  // `process.exitCode` no llega: Electron sale con 0 al terminar `app.quit()`; el código se pone cuando ya terminó de cerrar.
  if (unidad) app.once("quit", () => process.exit(CODIGO_CERRADO));
  app.quit();
}

/** La bandeja del sistema: clic trae la ventana, y "Cerrar del todo" le hace la pregunta (el diálogo es de la ventana, no un confirm). */
let bandeja: Bandeja | null = null;
function armarLaBandeja() {
  const sin = process.env.HILOS_BANDEJA === "0" || (process.env.HILOS_PERFIL && process.env.HILOS_BANDEJA !== "1");
  if (!residente || sin || bandeja) return;
  const abrir = () => {
    const v = BrowserWindow.getAllWindows()[0];
    if (!v || v.isDestroyed()) return;
    v.show();
    v.focus();
  };
  const icono = nativeImage.createFromPath(path.join(aqui, "..", "public", "icon.png"));
  const normal = icono.isEmpty() ? icono : icono.resize({ width: 24, height: 24 });
  // Con alguien esperando, el mismo ícono con un punto ámbar (el de "te necesita" de la barra).
  const conEspera = normal.isEmpty()
    ? normal
    : nativeImage.createFromBitmap(Buffer.from(conPunto(normal.toBitmap(), normal.getSize().width, normal.getSize().height, [251, 191, 36])), normal.getSize());
  bandeja = armarBandeja({
    imagenes: { normal, espera: conEspera },
    crear: () => new Tray(normal),
    menu: (items) => Menu.buildFromTemplate(items),
    abrir,
    cerrarDelTodo: () => preguntarSalida({ mostrar: abrir, preguntar: pedirSalida }),
  });
  ponerTextosBandeja((t) => bandeja?.textos(t));
  ponerEstadoEspera((e) => bandeja?.espera(e));
}

/**
 * Tras un reinicio que hizo el motor: espera a que conteste el motor NUEVO (otro pid que el que se fue) mientras Electron arranca,
 * en vez de decidir cómo arrancar con un motor que se está yendo. `false` si no aparece (entonces arranca como siempre).
 */
async function esperarMotorNuevo(viejo: number, sock: string, ms = 20_000): Promise<boolean> {
  const dueno = path.join(ESTADO, "dueno");
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let pid: unknown;
    try {
      pid = JSON.parse(readFileSync(dueno, "utf8"))?.pid;
    } catch {}
    if (pid !== viejo && (await motorVivo(dueno, sock))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  log.escribir("aviso", "main", `reinicio: el motor nuevo no apareció en ${ms} ms`);
  return false;
}

/** Sale este proceso y vuelve otro con el build nuevo: bajo la unidad alcanza con salir (Restart=always la levanta); suelta, se relanza ella. */
function relanzarProceso() {
  if (!unidad) app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== "--escondida"), "--escondida"] });
  app.quit();
}

/**
 * Un build nuevo (electron/reinicio.ts): cuando el usuario toca Reiniciar y no queda nada que cortar, vuelve
 * como estaba. En modo cliente el cartel lo tiene el motor (ver `alMotorNuevo` en armarCliente).
 */
async function armarRelanzoVentana() {
  const { armarRelanzo } = await import("./reinicio.js");
  armarRelanzo({
    raiz: process.env.HILOS_BUILD || path.join(aqui, ".."),
    quien: "ventana",
    irse() {
      marcar("ventana", "ventana-aviso");
      void anotarVolver().then(() => {
        marcar("ventana", "ventana-guardo");
        relanzarProceso();
      });
    },
  });
}

// La app de todos los días (no bench, captura, prueba ni dev) es residente:
// cerrar la ventana la esconde (los líderes siguen vivos) y volver a lanzar
// `trama` trae la que ya está. Se sale de verdad con Ctrl+Q (ver ipc.ts).
const residente = !guion && !captura && !png && !prueba && !process.env.HILOS_DEV_URL;
let saliendo = false;

if (residente && !app.requestSingleInstanceLock()) {
  // Ya hay una trama (a ésa le llegó `second-instance`). Si ésta es la de la unidad, la otra está
  // suelta: salir con 3 le dice a systemd que no insista (RestartPreventExitStatus), o le abriría
  // la ventana a la otra cada 2 s.
  app.exit(unidad ? 3 : 0);
} else {
  void arrancar().catch((e) => {
    log.escribir("error", "main", e);
    app.exit(1);
  });
}

async function arrancar() {
  if (residente) {
    vuelta = leerVolver(VOLVER);
    ponerVistas(vuelta?.vistas ?? {});
    guardadoVolver = crearGuardadoVolver({ archivo: VOLVER, ventana: ventanaAhora, vistaInicial: vuelta?.vistas.ventana });
    ponerAnotadorDeVista(guardadoVolver.vista);
  }
  // Un error sin atrapar del main se loguea y la app sigue (electron/log.ts); trama vive todo el día y no se cae por una promesa.
  vigilarProceso(log);
  app.on("before-quit", () => {
    saliendo = true;
    guardadoVolver?.ahora();
  });
  app.on("window-all-closed", () => app.quit());
  if (residente)
    app.on("second-instance", (_e, argv) => {
      // Otra que arrancó escondida (la unidad, con ésta suelta) no trae la ventana, salvo que el lanzador la haya pedido.
      if (argv.includes("--escondida") && pedida() === null) return;
      const v = BrowserWindow.getAllWindows()[0];
      if (!v) return;
      v.show();
      v.focus();
    });
  armarBench();
  // Electron arranca mientras se decide lo demás: nada espera a nadie de más.
  const electronListo = app.whenReady().then(() => void marcar("ventana", "electron-listo"));
  // ¿Viene de un reinicio por un build nuevo? Entonces la ventana nace con el cartel, y si lo reinició el motor se lo espera.
  const deReinicio: Corrida | null = residente ? enMarcha() : null;
  if (deReinicio) {
    llegaDeReinicio = true;
    marcar("ventana", "ventana-arranco", undefined, Math.round(Date.now() - process.uptime() * 1000));
  }
  // ¿Hay un motor? (bench y captura, nunca: sus fixtures son de esta ventana.)
  const sock = socketDe(carpetaLocal());
  if (deReinicio?.via === "motor") await esperarMotorNuevo(deReinicio.marcas[0]?.pid ?? 0, sock);
  // En Windows no hay trama-motor ni socket unix: siempre todo en uno.
  const conMotor = !(guion || captura || png || esWindows(process.platform)) && (await motorVivo(path.join(ESTADO, "dueno"), sock));
  marcar("ventana", conMotor ? "motor-visto" : "sin-motor");
  if (conMotor) {
    // El motor tiene el núcleo, la cola, los líderes, el remoto y el cartel del build nuevo: acá sólo la ventana.
    logAparte("ventana.log");
    const { armarCliente } = await import("./ventana-cliente.js");
    cliente = await armarCliente({
      sock,
      recargar: () => recargarVentana(),
      irse: irseDelTodo,
      // El motor se va por un build nuevo: se anota cómo estaba la ventana, y cuando el motor nuevo contesta se relanza
      // este proceso también (la ventana queda en Reconectando entre uno y otro, sin cortar nada).
      motorSaliendo: () => {
        marcar("ventana", "ventana-aviso");
        if (residente) guardando = anotarVolver().then(() => void marcar("ventana", "ventana-guardo"));
      },
      motorNuevo: () => (residente ? void guardando.then(relanzarProceso) : recargarVentana()),
    });
    marcar("ventana", "cliente-armado");
    query.cliente = "1";
  } else {
    const { armarIpc } = await import("./ipc.js");
    armarIpc(irseDelTodo);
    // trama desde el celular (electron/remoto-armar.ts): sólo con `remoto.json`, y nunca en bench ni captura.
    if (!(guion || captura || png)) {
      const { armarRemoto } = await import("./remoto-armar.js");
      armarRemoto({ dist: path.join(aqui, "..", "dist"), preload: path.join(aqui, "preload.cjs"), consulta });
    }
  }
  if (residente) log.escribir("info", "main", `trama arrancó (pid ${process.pid}, electron ${process.versions.electron}${cliente ? ", cliente del motor" : ""})`);
  await electronListo;
  crearVentana();
  armarLaBandeja();
  // El cartel del build nuevo: en modo cliente lo tiene el motor (la ventana se relanza cuando vuelve).
  if (residente && !cliente) await armarRelanzoVentana();
}

/** Vuelve a cargar la página (un motor nuevo: se pone al día), como el Recargar del cartel. */
function recargarVentana() {
  const v = ventanas()[0];
  if (v && !v.isDestroyed()) cargar(v);
}
