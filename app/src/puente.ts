// Lo único que el frontend sabe del proceso main: `window.hilos`, que expone
// el preload (electron/preload.cts) con contextBridge. Lo que llega del main
// se trata como `unknown` hasta que src/datos/fuente.ts le mira la versión.
import type { Dif } from "./datos/hilos-dif";
import type { Imagen } from "../electron/imagenes";
import type { EstadoLocales, ResultadoProbar } from "../electron/locales";
import type { EstadoVram, ResultadoLiberar } from "../electron/vram";
import type { EventoLider, Statusline } from "./datos/contrato";
import type { DatosPasar, RamaBrief } from "../electron/asistente";
import { textoMain } from "./i18n";

type Bench = {
  modo(): Promise<boolean>;
  listo(): Promise<number>;
  cpu(): Promise<unknown>;
  fin(reporte: unknown): Promise<void>;
};

type Soltar = () => void;


/** Una lectura de `pa --hilos --json`; `n` crece con cada corrida (0: la guardada del arranque anterior). */
export type Lectura = { n: number; datos: unknown } | { n: number; error: string };
/** Lo que llega por `hilos.alCambiar`: la lectura entera o sólo lo que cambió contra la anterior (`src/datos/hilos-dif.ts`). */
export type Envio = Lectura | { n: number; dif: Dif };

type Main = {
  bench: Bench;
  statusline: { leer(): Promise<Statusline>; sincronizar(): Promise<Statusline>; alCambiar(fn: (s: Statusline) => void): Soltar };
  hilos: {
    leer(): Promise<Lectura>;
    /** La última lista buena (`~/.local/state/hilos/hilos.json`) o `null`. */
    guardados(): Promise<unknown>;
    /** La última lista entera: para cuando una diferencia no cierra con la que se tiene. */
    completa(): Promise<Lectura>;
    alCambiar(fn: (l: Envio) => void): Soltar;
    /** Los ids que nombró cada tanda nueva de `eventos.jsonl`. */
    alEvento(fn: (ids: string[]) => void): Soltar;
    /** Cada línea nueva de `eventos.jsonl` (un worker que arranca o se frena). */
    alEventoPa(fn: (eventos: unknown) => void): Soltar;
  };
  leidos: { leer(): Promise<Record<string, number>>; marcar(id: string, ts: number): Promise<void> };
  /** Lo que el usuario le cambió a la barra (B20, `~/.local/state/hilos/nombres.json`), sin validar. */
  nombres: {
    leer(): Promise<unknown>;
    titulo(id: string, titulo: string): Promise<void>;
    proyecto(sid: string, slug: string | null): Promise<void>;
    oculto(slug: string, si: boolean): Promise<void>;
    /** El orden entero que quedó tras arrastrar. */
    orden(orden: unknown): Promise<void>;
    /** El orden que se guardó (acá o desde el otro lado: la ventana o el celular), sin validar. */
    alOrden(fn: (orden: unknown) => void): Soltar;
  };
  /** Los slugs del registry, sin validar. */
  carpetas(): Promise<unknown>;
  /** Cada nombre del registry (alias incluidos) con el slug de su carpeta, sin validar. */
  slugsPorNombre(): Promise<unknown>;
  /** Lo que la app recuerda (`~/.local/state/hilos/preferencias.json`): el esfuerzo por modelo, el idioma, la letra, las fuentes y la vista de la barra. */
  preferencias: {
    leer(): Promise<{ effort: Record<string, string> }>;
    effort(modelo: string, effort: string): Promise<void>;
    idioma(idioma: string): Promise<void>;
    apariencia(a: { letra?: number; fuente?: string; mono?: string }): Promise<void>;
    /** Los mensajes tiernos (B17), prendidos o apagados. */
    tiernos(si: boolean): Promise<void>;
    /** La notificación de "te espera", prendida o apagada. */
    avisarEspera(si: boolean): Promise<void>;
    vista(vista: "todo" | "lideres"): Promise<void>;
    /** El panel de consumo, a la vista u oculto. */
    consumo(si: boolean): Promise<void>;
    /** ¿Abrir la bienvenida sola? Nunca se vio y no es una corrida de prueba. */
    bienvenidaPendiente(): Promise<boolean>;
    /** Marca la bienvenida como vista (`true`) o vuelve a dejarla pendiente. */
    bienvenida(si: boolean): Promise<void>;
  };
  /** El panel de consumo (electron/consumo.ts): lo que contesta va sin validar (`consumoDe`). */
  consumo: {
    mirar(pedido: { lideres: string[]; workers: string[] }): Promise<unknown>;
    soltar(): Promise<void>;
    alCambiar(fn: (c: unknown) => void): Soltar;
  };
  /** Los pasos de un worker (electron/pasos-worker.ts): lo que contesta va sin validar (`vistaDe`, `cambioDe`). */
  pasos: {
    mirar(id: string): Promise<unknown>;
    soltar(): Promise<void>;
    /** Los pasos de un subagente de una sesión (electron/subagentes.ts), sin validar. */
    subagente(sid: string, id: string): Promise<unknown>;
    alCambiar(fn: (c: unknown) => void): Soltar;
  };
  pa: {
    /** Settle: integra o archiva según `origen` y `rama` (electron/settle.ts). */
    cerrar(h: { id: string; proyecto: string; rama: string | null; origen: string }): Promise<void>;
    /** `pa --hilo <id> --json -n <n> [--antes <antes>]`, sin validar (ver fuente.ts). */
    hilo(x: { id: string; n?: number; antes?: number | null }): Promise<unknown>;
    parar(id: string): Promise<void>;
  };
  /** slug → `titulo` del registry, sin validar. */
  titulos(): Promise<unknown>;
  /** slug → data URL del logo de cada proyecto que tiene uno. */
  iconos(): Promise<Record<string, string>>;
  /** Dictar (electron/dictado.ts): un WAV 16 kHz mono de hasta 5 min → el texto que dijo (Handy, en la máquina del motor). */
  /** `modelos` / `elegirModelo`: el modelo de Handy de Ajustes (electron/dictado-modelos.ts), sin validar. */
  dictado: { transcribir(x: { datos: Uint8Array }): Promise<string>; modelos(): Promise<unknown>; elegirModelo(id: string): Promise<unknown> };
  /** Los modelos locales (electron/locales.ts): su contexto, la cuenta de la VRAM y Probar (carga el modelo de verdad). */
  locales: {
    leer(): Promise<EstadoLocales>;
    guardar(x: { id: string; ctx: number }): Promise<EstadoLocales>;
    probar(x: { id: string; ctx: number }): Promise<ResultadoProbar>;
  };
  /** Quién tiene la GPU y cómo liberarla (electron/vram.ts): la lista no toca nada; `liberar` para o reinicia un servicio (sólo con el clic). */
  vram: {
    leer(): Promise<EstadoVram>;
    liberar(x: { id: string }): Promise<ResultadoLiberar>;
  };
  /** Los líderes: los de la app se manejan desde acá; los de la terminal se leen (electron/lider.ts). */
  lider: {
    /** Un líder nuevo con su primer mensaje; devuelve su session_id. */
    nuevo(x: { modelo: string; effort: string; texto: string; imagenes?: Imagen[]; modo?: string; rol?: "analista"; carpeta?: string }): Promise<string>;
    mandar(x: { sid: string; texto: string; imagenes?: Imagen[]; modelo: string; effort: string }): Promise<void>;
    /** Guarda un archivo adjunto (no imagen) y devuelve su ruta absoluta. */
    archivo(x: { nombre: string; datos: Uint8Array }): Promise<string>;
    parar(sid: string): Promise<void>;
    /** Cambiar el modo de permisos (vivo: `set_permission_mode`; dormido: para el próximo `--resume`). */
    modo(x: { sid: string; modo: string }): Promise<void>;
    /** Contestar un pedido de permiso (`can_use_tool`): permitir, o negar con un mensaje para el modelo. */
    permiso(x: { sid: string; id: string; ok: boolean; mensaje?: string; respuestas?: Record<string, string> }): Promise<void>;
    /** Los pedidos sin contestar de un líder (una vista recargada no los vio llegar), sin validar. */
    pendientes(sid: string): Promise<unknown>;
    /** Los slash commands que dijo la última sesión, sin validar. */
    comandos(): Promise<unknown>;
    /** Los output styles (`{ actual, lista }`) que dijo la última sesión, sin validar. */
    estilos(): Promise<unknown>;
    /** `/output-style`: "vivo" si ya se aplicó, "pendiente" si va al próximo líder que arranque. */
    estilo(x: { sid: string; estilo: string }): Promise<unknown>;
    /** Cerrar uno de la app: termina su proceso y lo saca de lideres.json. */
    cerrar(sid: string, motivo?: string): Promise<void>;
    /** Retomar uno sin proceso: pasa a ser de la app, sin lanzar nada. `{ ok }` o `{ ok: false, motivo }`, sin validar. */
    retomar(x: { sid: string; modelo: string; effort: string; nombre?: string }): Promise<unknown>;
    /** Su transcript con la forma de `pa --hilo --json`, sin validar. */
    conversacion(x: { sid: string; antes?: number | null }): Promise<unknown>;
    /** Mirar el transcript de uno (el abierto) o de ninguno. */
    mirar(sid: string | null): Promise<void>;
    /** El usuario abrió esa conversación (o le escribió): el líder deja de esperarlo. */
    visto(sid: string): Promise<void>;
    /** Traer a la app uno abierto en una terminal (cierra ese `claude`): `{ ok }` o `{ ok: false, motivo }`. */
    traer(x: { sid: string; modelo: string; effort: string; nombre?: string; modo?: string; cortar?: boolean }): Promise<unknown>;
    /** "Ir a la ventana": `false` si no se la pudo ubicar. */
    ir(pid: number): Promise<boolean>;
    /** ¿Se puede ubicar la ventana de ese proceso? */
    ubicable(pid: number): Promise<boolean>;
    /** Forzar: a mitad de un turno, lo lee en el próximo paso (sin esperar a que termine). Libre, es `mandar`. */
    inyectar(x: { sid: string; texto: string; imagenes?: Imagen[]; modelo: string; effort: string }): Promise<void>;
    /** A la cola del líder (electron/cola.ts): sale cuando quede libre. */
    encolar(x: { sid: string; texto: string; imagenes?: Imagen[]; modelo: string; effort: string; modo?: string; nombre?: string }): Promise<void>;
    colaQuitar(x: { sid: string; id: number }): Promise<void>;
    /** Todas las colas con algo, sin validar. */
    colas(): Promise<unknown>;
    /** Ahora: reintenta lo que había fallado y, con `cortar`, corta al de la terminal. */
    colaYa(x: { sid: string; cortar?: boolean }): Promise<void>;
    /** Cambió la cola de un líder (`AvisoCola`), sin validar. */
    alCola(fn: (x: unknown) => void): Soltar;
    alEvento(fn: (x: { sid: string; e: EventoLider }) => void): Soltar;
    alTranscript(fn: (sid: string) => void): Soltar;
  };
  /** Los paneles del pie (Ajustes, Estadísticas, acciones de Ramas): ver src/datos/paneles.ts. */
  paneles: {
    ajustes(): Promise<unknown>;
    /** Los umbrales del anillo de contexto (`{ autoCompact }`, electron/contexto.ts), sin validar. */
    umbralContexto(): Promise<unknown>;
    medicion(): Promise<unknown>;
    /** El registro histórico (electron/historial.ts) de los últimos 7 o 30 días, de todos o de un rol; sin validar. */
    historial(dias: number, rol: string | null): Promise<unknown>;
    /** Lo último que se midió del peso de arrancar (electron/arranque.ts), o `null` si nunca; sin validar. */
    arranqueMedido(): Promise<unknown>;
    /** Mide ahora el peso exacto de arrancar (cuatro pedidos cortos a `claude`); nunca rechaza; sin validar. */
    medirArranque(): Promise<unknown>;
    /** No rechaza si `pa` falla: devuelve su código de salida y lo último que dijo. */
    rama(accion: string, h: { id: string; proyecto: string }): Promise<{ rc: number; dijo: string }>;
    /** Lanza un worker de rama (`pa --actualizar … -m … --effort … --tipo …`); no rechaza si `pa` falla: devuelve su código y lo último que dijo. */
    lanzar(x: { accion: string; id: string; proyecto: string; modelo: string; effort: string; texto?: string }): Promise<{ rc: number; dijo: string }>;
    /** Reescribe las filas de worker de la tabla de routing de `~/CLAUDE.md`; devuelve cómo quedó o el error. */
    routing(cambios: { rol: string; modelo: string | null; effort: string | null }[]): Promise<unknown>;
    /** La config de modelos (`~/.config/trama/modelos.json`) con la tabla efectiva de `pa --modelos --json` si existe; sin validar. */
    modelos(): Promise<unknown>;
    /** Guarda esa config (atómico; rechaza con el motivo sin escribir) y pone al día las filas de `~/CLAUDE.md`; devuelve cómo quedó. */
    guardarModelos(config: unknown): Promise<unknown>;
    /** Pregunta a un Ollama (`GET <url>/api/tags`) qué modelos tiene; nunca rechaza por no contestar. */
    sondearOllama(url: string): Promise<unknown>;
    /** Empieza a bajar un modelo de Ollama (`/api/pull`); el progreso llega por `alBajar`. Rechaza con el motivo (sólo desde la PC). */
    bajarModelo(url: string, modelo: string): Promise<unknown>;
    cancelarBajada(url: string, modelo: string): Promise<void>;
    /** Las bajadas en curso o terminadas desde que arrancó el motor. */
    bajadas(): Promise<unknown>;
    /** Qué hay en esta máquina para Ollama: si está instalado, la distro, la GPU con su VRAM y los comandos de instalar y arrancar; sólo lee. */
    entornoOllama(): Promise<unknown>;
    alBajar(fn: (b: unknown) => void): Soltar;
    /** Escribe el plan (`pa --plan`) y/o la red de seguridad (`autoCompactWindow`); rechaza con el motivo; devuelve Ajustes como quedó. */
    guardarAjustes(cambio: { plan?: string; red_seguridad?: number | null }): Promise<unknown>;
    /** El acceso desde el celular (`remoto.json`) y dónde está escuchando; por la tailnet, `{ editable: false }`. */
    remoto(): Promise<unknown>;
    /** Guarda el acceso desde el celular y deja el servidor como dice; rechaza con el motivo (nada se escribe). */
    guardarRemoto(config: { activo: boolean; puerto: number; dispositivos: string[] }): Promise<unknown>;
    /** El brief del analista de Ramas (B22): commits, archivos, edad y líder de cada rama; el texto lo arma src/datos/analista.ts. */
    brief(
      hs: {
        id: string;
        proyecto: string;
        rama: string;
        estado: string;
        commits: number;
        tarea: string;
        resultado: string | null;
        decision: string | null;
        fin: number;
        jefe_id: string | null;
      }[],
    ): Promise<RamaBrief[]>;
    /** Lo que lleva el primer mensaje de "Pasárselo a un líder" (lo de arriba más la DECISION entera); el texto lo arma src/datos/asistente.ts. */
    pasar(h: {
      id: string;
      proyecto: string;
      rama: string | null;
      commits: number;
      tarea: string;
      resultado: string | null;
      decision: string | null;
    }): Promise<DatosPasar>;
    /** Lo de "Pasárselo" más cómo terminó y si el proyecto tiene `tests` (Retomar, B22; el texto, src/datos/retomar.ts). */
    retomar(h: {
      id: string;
      proyecto: string;
      rama: string | null;
      commits: number;
      tarea: string;
      resultado: string | null;
      decision: string | null;
      estado: string;
    }): Promise<DatosPasar & { estado: string; tests: boolean }>;
  };
  /** La salud de lo integrado (B25, electron/salud.ts), sin validar. */
  salud: {
    leer(): Promise<unknown>;
    /** Lo que lleva "Mandar a verificar y arreglar" (electron/paneles.ts, `arreglarDatos`); el texto, src/datos/arreglar.ts. */
    arreglar(h: { id: string; proyecto: string; rama: string | null }): Promise<unknown>;
    alCambiar(fn: (e: unknown) => void): Soltar;
  };
  /** "Integrar solo lo seguro" de Ramas (B22, electron/autointegrar.ts), sin validar. */
  auto: {
    leer(): Promise<unknown>;
    prender(si: boolean): Promise<void>;
    alCambiar(fn: (e: unknown) => void): Soltar;
  };
  /** El aviso de Claude Code nuevo: `null` si no hay (o no se pudo saber). */
  claude: {
    version(): Promise<unknown>;
    /** Dismiss: hasta que salga otra. */
    descartar(): Promise<void>;
    /** `claude update`: `{ ok, version | error, abiertos }`, sin validar. */
    actualizar(): Promise<unknown>;
    /** Relanza (al próximo mensaje, `--resume`) los líderes de la app que no responden: `{ reiniciados, ocupados }`. */
    reiniciar(): Promise<unknown>;
    /** Abre el CHANGELOG en el navegador. */
    changelog(): Promise<void>;
    alCambiar(fn: (a: unknown) => void): Soltar;
  };
  /** El aviso de Antigravity CLI (`agy`) nuevo: `null` si no hay, no se pudo saber o `agy` no está instalado. */
  agy: {
    version(): Promise<unknown>;
    descartar(): Promise<void>;
    /** Actualizar: abre una terminal con paru y espera a que la cierren: `{ ok, version | error }`, sin validar. */
    actualizar(): Promise<unknown>;
    alCambiar(fn: (a: unknown) => void): Soltar;
  };
  /** Lo que falta del setup (Handy, agy, Ollama, el login): `{ version, faltas: [{ id, url }] }`, sin validar. */
  setup: {
    estado(): Promise<unknown>;
    descartar(id: string): Promise<void>;
  };
  /** Si Claude y Gemini (agy) están conectados: `{ version, claude, agy }` con `{ instalado, logueado, cuenta, error }`, sin validar. */
  cuentas: {
    estado(): Promise<unknown>;
    /** Las cuentas del CLI `cuentas` (`{version,cuentas}` o `null` sin él), sin validar; `verificar` pregunta el login (lento). */
    lista(verificar: boolean): Promise<unknown>;
    agregar(proveedor: string, nombre: string): Promise<unknown>;
    renombrar(id: string, nombre: string): Promise<unknown>;
    quitar(id: string, borrarCredenciales: boolean): Promise<unknown>;
    login(id: string): Promise<unknown>;
  };
  /** Lo que tiene la carpeta de config de una cuenta de Claude (`"claude"` = la de siempre), sin validar; `importar` copia lo que falta desde la de siempre. */
  extensiones: {
    leer(cuenta: string): Promise<unknown>;
    importar(cuenta: string): Promise<unknown>;
  };
  /** Por la tailnet (el celular): `false` cuando se cae la conexión con la PC, `true` al volver. En la ventana no avisa nunca. */
  conexion: {
    alCambiar(fn: (conectado: unknown) => void): Soltar;
  };
  /** El tablero de pendientes del usuario (electron/tablero.ts): `leer`, sin validar; el resto corre el CLI `tablero`. */
  tablero: {
    leer(): Promise<unknown>;
    // Un id con prefijo (`dell:12`) es de un item de otra máquina: el main manda la acción a su tablero.
    mover(id: number | string, columna: string): Promise<void>;
    cerrar(id: number | string): Promise<void>;
    tirar(id: number | string): Promise<void>;
    posponer(id: number | string, hasta: string): Promise<void>;
    agregar(texto: string, proyecto: string | null, maquina?: string): Promise<unknown>;
    /** `tablero responder <id>`: la respuesta queda en el item (`null`: la saca). Ver electron/tablero.ts, `RespuestaCli`. */
    responder(id: number | string, r: unknown): Promise<void>;
    /** Cuántos esperan al usuario sin respuesta (el número del botón del pie), sin validar; `null` si no hay vista. */
    esperan(): Promise<unknown>;
    alCambiar(fn: () => void): Soltar;
  };
  /** Lo que el usuario tocó en el tablero nuevo y todavía no mandó (electron/pendientes.ts), sin validar. */
  pendientes: { leer(): Promise<unknown>; guardar(x: unknown): Promise<void> };
  /** Quién está compactando su contexto (electron/compactando.ts): id → epoch (s) desde cuándo, sin validar. */
  compactando: { leer(): Promise<unknown>; alCambiar(fn: (c: unknown) => void): Soltar };
  /** Los subagentes de cada sesión con proceso (electron/subagentes.ts): sesión → lista, sin validar; y el informe entero de uno. */
  subagentes: { leer(): Promise<unknown>; informe(sid: string, id: string): Promise<string | null>; alCambiar(fn: (x: unknown) => void): Soltar };
  pintado(): void;
  /** Cerrar del todo (Ctrl+Q, la bandeja) con lo elegido en el diálogo. Con líderes respondiendo y sin `forzar` no hace nada: devuelve cuántos son. Por la tailnet no existe. */
  salir(x: { modo: "seguir" | "parar"; forzar: boolean }): Promise<number>;
  /** La bandeja del sistema: sus textos traducidos, y el pedido de "Cerrar del todo" desde su menú. */
  bandeja?: { textos(t: { abrir: string; cerrar: string }): Promise<void>; alPedirSalida(fn: () => void): Soltar };
  /** "Te espera" en la pantalla de la PC: el número en la bandeja, la notificación y el toque a la notificación. Por la tailnet no existe. */
  espera?: {
    estado(x: { n: number; texto: string }): Promise<void>;
    notificar(x: { sid: string; titulo: string; cuerpo: string }): Promise<void>;
    alAbrir(fn: (sid: string) => void): Soltar;
  };
  /** El texto del portapapeles leído por el main (respaldo del Ctrl+V de la caja); por la tailnet no existe. */
  portapapeles?: { texto(): Promise<string> };
  /** El selector nativo de carpetas (campo "Carpeta" de un líder nuevo): la ruta o `null` si se canceló; por la web no existe. */
  carpeta?: { elegir(): Promise<string | null> };
  /** Vuelve a cargar la ventana (el cartel de error); por la tailnet no existe. */
  recargar?(): Promise<void>;
  /** Un error del renderer, al log del main (src/errores.ts). */
  bitacora?(x: { donde: string; detalle: string }): Promise<void>;
  /** Qué máquinas hay y cómo están (electron/nucleo.ts `estadoMaquinas`), sin validar: la barra pone el ícono y el "sin conexión". */
  maquinas: { leer(): Promise<unknown>; alCambiar(fn: (e: unknown) => void): Soltar };
  /** Los modelos que agrega `~/.config/trama/modelos.json` (Gemini, Ollama, el líder por defecto), sin validar; `null` sin el archivo. */
  modelos?: { config(): Promise<unknown> };
  /** El nombre del dueño de la máquina (electron/dueno.ts), sin validar; `null` si no se sabe. */
  dueno?: { nombre(): Promise<unknown> };
  /** El cartel "Hay una actualización disponible": un build de trama más nuevo que el que corre (electron/relanzar.ts), sin validar. */
  reinicio: { leer(): Promise<unknown>; pedir(igual?: boolean): Promise<void>; cancelar(): Promise<void>; marca(paso: string): Promise<void>; alCambiar(fn: (r: unknown) => void): Soltar };
  /** La PC que el Dell sabe prender (electron/pc-estado.ts): su estado y Prender; sin PC configurada, `leer` da null. */
  pc: { leer(): Promise<unknown>; prender(): Promise<unknown>; alCambiar(fn: (e: unknown) => void): Soltar };
  /** Volver como estaba tras ese reinicio (sólo la ventana): lo que tenía abierto y escrito (src/volver.ts). */
  volver: { leer(): Promise<unknown>; guardar(vista: unknown): Promise<void>; alPedir(fn: () => void): Soltar; anotar(vista: unknown): Promise<void> };
  /** Lo escrito sin mandar, en disco (sólo la ventana; electron/borradores.ts). */
  borradores: { leer(): Promise<unknown>; guardar(foto: unknown): Promise<void> };
  /** Controles de ventana en Windows (minimizar, maximizar, cerrar). */
  ventana?: {
    minimizar(): Promise<void>;
    maximizar(): Promise<boolean>;
    cerrar(): Promise<void>;
    esMaximizada(): Promise<boolean>;
  };
};

declare global {
  interface Window {
    hilos?: Main;
  }
}

const sinBench: Bench = {
  modo: async () => false,
  listo: async () => 0,
  cpu: async () => null,
  fin: async () => {},
};

// Sin preload (Vite abierto en un navegador) el bench queda apagado y los
// datos son los fixtures (ver MODO.fixtures).
export const bench: Bench = window.hilos?.bench ?? sinBench;
export const main: Main | null = window.hilos ?? null;

/**
 * Electron envuelve los rechazos del main ("Error invoking remote method 'x': Error: …"): queda sólo
 * el mensaje, traducido si el main lo mandó como clave (`textoMain`).
 */
export const mensaje = (e: unknown) =>
  textoMain(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""));
