// De dónde saca los datos la app: de `pa` por el main (`window.hilos`) o, en
// bench y capturas (o con HILOS_FIXTURES=1), de los fixtures. La UI no se entera.
import type { Compactando } from "../../electron/compactando";
import type { Subagente, Subagentes } from "../../electron/subagentes";
import type { Imagen } from "../../electron/imagenes";
import type { EstadoLocales, ResultadoProbar } from "../../electron/locales";
import type { EstadoVram, ResultadoLiberar } from "../../electron/vram";
import { MODELO_LARGE_V3, MODELO_TURBO, type ModelosDictado } from "../../electron/dictado-modelos";
import { main, mensaje, type Lectura } from "../puente";
import { aplicarDif, esDif } from "./hilos-dif";
import { MODO } from "../modo";
import { t, textoMain } from "../i18n";
import { comoSettle, GENERAL, type ComandoClaude, type Estilos, type EventoLider, type EventoPa, type Hilo, type Leidos, type Mensaje, type Nombres, type Orden, type RespuestaHilo, type RespuestaHilos, type RespuestaLideres, type Retomado, retomadoDe, type Statusline, type Traido, traidoDe, type Tokens, type Uso } from "./contrato";
import { hiloDePa } from "./paHilo";
import { listaValida, resultadoValido, type ListaCuentas, type PerfilCuenta, type ProveedorCuenta, type ResultadoCuenta } from "./cuentas";
import { extensionesValidas, importarValido, type Extensiones, type ResultadoImportar } from "./extensiones";
import { ordenDe } from "../barra/orden";
import { consumoDe, consumoFijo, type Consumo, type Pedido } from "./consumo";
import { cambioDe, vistaDe, type CambioPasos, type VistaPasos } from "./pasos";
import { pasosFijos } from "./pasos-fixture";
import { crearCola, type AvisoCola, type Encolado } from "../../electron/cola";
import { ARRANCANDO, EN_COLA, HILOS_DELL, LIDER_DELL, PENSANDO_FIJO, charlaFormato, charlaLarga, charlaListas, charlaLider, charlaPensando, charlaSistema, charlaTabla, conversacion, conversacionSistema, HILOS, HILOS_EN_COLA, HILOS_TERMINADOS, ICONOS, LIDERES, LIDER_MUERTO, LIDER_TERMINADOS, FRENADO, TITULOS, USO, USO_CUENTAS, USO_GOOGLE, USO_SIN_HORA, imagenFija, localesFalsos, vramFalsa, vramLiberarFalso } from "./fixtures";

export interface Fuente {
  /** La última lista buena de una corrida anterior, para pintar algo mientras `pa` contesta. */
  hilosGuardados(): Promise<RespuestaHilos | null>;
  /** `pa --hilos --json`. */
  hilos(): Promise<RespuestaHilos>;
  /** Avisa cuándo releer (`eventos.jsonl`). Devuelve cómo desuscribirse. */
  alCambiarHilos(fn: () => void): () => void;
  /** La sesión jefe de cada proyecto (statusline). */
  lideres(): Promise<RespuestaLideres>;
  alCambiarLideres(fn: (r: RespuestaLideres) => void): () => void;
  /** Avisa los ids que nombró cada tanda nueva de `eventos.jsonl` (la vista abierta relee si es la suya). */
  alEvento(fn: (ids: string[]) => void): () => void;
  /** Avisa cada línea nueva de `eventos.jsonl`: un worker que arranca o se frena se pinta ya, sin esperar a la lista. */
  alEventoPa(fn: (eventos: EventoPa[]) => void): () => void;
  /** `pa --hilo <id> --json`: los últimos mensajes, o los anteriores a `antes`. */
  conversacion(h: Hilo, antes: number | null): Promise<RespuestaHilo>;
  /** `pa --parar <id>`. */
  parar(h: Hilo): Promise<void>;
  /** slug → data URL del logo de cada proyecto que tiene uno (los demás llevan monograma). */
  iconos(): Promise<Record<string, string>>;
  /** slug → `titulo` del registry (cómo se ve la carpeta) de cada proyecto que tiene uno. */
  titulos(): Promise<Record<string, string>>;
  /** Settle (`comoSettle`): de la app y con rama, `pa <proy> --integrar <id> --tests`; si no, `pa --archivar <id>`. Rechaza con el error de `pa`. */
  cerrar(h: Hilo): Promise<void>;
  /** Barras de uso del plan (statusline). `null`: no hay statusline. */
  uso(): Promise<Uso | null>;
  alCambiarUso(fn: (u: Uso | null) => void): () => void;
  /** El botón de las barras: le pide a `claude` el uso como lo dice claude.ai y vuelve a leer todo. */
  releerUso(): Promise<Uso | null>;
  /** Qué abrió el usuario y cuándo (`~/.local/state/hilos/leidos.json`). */
  leidos(): Promise<Leidos>;
  marcarLeido(id: string, ts: number): void;
  /** Títulos, carpetas de líderes y carpetas con los terminados ocultos (B20, `nombres.json`). */
  nombres(): Promise<Nombres>;
  /** Renombrar un run o un líder; vacío vuelve al de siempre. */
  guardarTitulo(id: string, titulo: string): void;
  /** Mover un líder a otra carpeta; `null` lo deja donde caiga. */
  guardarProyecto(sid: string, slug: string | null): void;
  guardarOculto(slug: string, si: boolean): void;
  /** El orden de la barra tras arrastrar (carpetas, y líderes por carpeta): se guarda entero. */
  guardarOrden(orden: Orden): void;
  /** El orden que se guardó desde el otro lado (la ventana o el celular). */
  alCambiarOrden(fn: (orden: Orden) => void): () => void;
  /** Las carpetas a las que se puede mover un líder (los slugs del registry). */
  carpetas(): Promise<string[]>;
  /** Con qué nombre anota el tablero cada carpeta: nombre del registry (alias incluidos) → slug. */
  slugsPorNombre(): Promise<Record<string, string>>;
  /** El último esfuerzo elegido para cada modelo en Nueva tarea (`~/.local/state/hilos/preferencias.json`). */
  effortsPorModelo(): Promise<Record<string, string>>;
  guardarEffort(modelo: string, effort: string): void;
  /** El idioma de la interfaz (Ajustes), en el mismo archivo. */
  guardarIdioma(idioma: string): void;
  /** Tamaño de letra y fuentes (src/tipografia.ts): sólo lo que cambió. */
  guardarApariencia(a: { letra?: number; fuente?: string; mono?: string }): void;
  /** Los mensajes tiernos (Ajustes), en el mismo archivo. */
  guardarTiernos(si: boolean): void;
  /** La notificación de "te espera" (Ajustes), en el mismo archivo. */
  guardarAvisarEspera(si: boolean): void;
  /** La vista de la barra (B15): todo o sólo líderes. */
  guardarVista(vista: "todo" | "lideres"): void;
  /** El panel de consumo (a la derecha), a la vista u oculto: se recuerda en el mismo archivo. */
  guardarConsumo(si: boolean): void;
  /** ¿Hay que abrir la bienvenida sola? (nunca se vio; una prueba dice que no). */
  bienvenidaPendiente(): Promise<boolean>;
  /** Marca la bienvenida como vista. */
  guardarBienvenida(si: boolean): void;
  /** Empieza a mirar el consumo de esos líderes y workers (o cambia cuáles) y contesta cómo está. */
  consumoMirar(pedido: Pedido): Promise<Consumo>;
  /** El panel se ocultó: el main deja de mirar los transcripts. */
  consumoSoltar(): void;
  /** Un transcript creció: el consumo de nuevo, entero. */
  alCambiarConsumo(fn: (c: Consumo) => void): () => void;
  /** La vista de un worker: empieza a mirar sus pasos (suelta el que miraba) y contesta la vista entera. `null`: el main no la entendió. */
  pasosMirar(id: string): Promise<VistaPasos | null>;
  /** Se cerró la vista de worker: el main deja de mirar su transcript. */
  pasosSoltar(): void;
  /** Pasos nuevos o tocados del worker mirado, por lotes; se ponen al día con `aplicar` (src/datos/pasos.ts). */
  alCambiarPasos(fn: (c: CambioPasos) => void): () => void;
  /** Un líder nuevo de la app con su primer mensaje; devuelve su session_id. */
  liderNuevo(x: EnvioLider): Promise<string>;
  /** Escribirle a un líder de la app (lo relanza con `--resume` si no corre). */
  liderMandar(sid: string, x: EnvioLider): Promise<void>;
  /** Guarda un archivo adjunto que no es imagen; devuelve la ruta absoluta que va en el mensaje. */
  /** `maquina`: la del líder al que va (o la elegida para uno nuevo): la ruta que vuelve es de esa máquina. */
  liderArchivo(nombre: string, datos: Uint8Array, maquina?: string): Promise<string>;
  liderParar(sid: string): Promise<void>;
  /** Dictar: el WAV 16 kHz mono de lo grabado (src/hilo/dictado.ts) → el texto que dijo; no se manda solo. */
  dictar(datos: Uint8Array): Promise<string>;
  /** Con qué modelo de Handy se dicta (Ajustes): los que hay en la máquina del motor y el que rige. */
  dictadoModelos(): Promise<ModelosDictado>;
  /** Elige el modelo del dictado (preferencias.json); devuelve cómo quedó. */
  elegirDictadoModelo(id: string): Promise<ModelosDictado>;
  /** Los modelos locales: el contexto de cada uno y cuánto entra en la VRAM (estimado). */
  locales(): Promise<EstadoLocales>;
  /** Guarda el `-c` de un modelo local (rige en su próxima carga; no carga nada). */
  guardarLocal(id: string, ctx: number): Promise<EstadoLocales>;
  /** Carga el modelo con ese `-c` para confirmar que entra (usa la GPU: sólo con el clic del usuario). */
  probarLocal(id: string, ctx: number): Promise<ResultadoProbar>;
  /** Lo que se puede liberar de la GPU (la CLI `vram`): no toca nada. */
  vram(): Promise<EstadoVram>;
  /** Para o reinicia UN servicio de los que lista `vram()` (sólo con el clic y su confirmación del usuario). */
  liberarVram(id: string): Promise<ResultadoLiberar>;
  /** Cambiar el modo de permisos (B13): vivo, al toque; dormido, para cuando se retome. */
  liderModo(sid: string, modo: string): Promise<void>;
  /** Contestar un pedido de permiso (el plan de ExitPlanMode, o una herramienta fuera de bypass). */
  liderPermiso(sid: string, id: string, ok: boolean, mensaje?: string, respuestas?: Record<string, string>): Promise<void>;
  /** Los pedidos sin contestar de un líder de la app (para una vista recargada). */
  liderPendientes(sid: string): Promise<Extract<EventoLider, { tipo: "permiso" }>[]>;
  /** Los slash commands que dijo la última sesión (el menú de "/"). */
  liderComandos(): Promise<ComandoClaude[]>;
  /** Los output styles que dijo la última sesión (el submenú de /output-style). */
  liderEstilos(): Promise<Estilos>;
  /** `/output-style`: "vivo" si ya se aplicó, "pendiente" si va al próximo líder que arranque. */
  liderEstilo(sid: string, estilo: string): Promise<"vivo" | "pendiente">;
  /** Los umbrales del anillo de contexto (B16): `autoCompactWindow` (`null` si no está). */
  umbralContexto(): Promise<Umbrales>;
  /** Cerrar un líder de la app (termina su proceso, sale de lideres.json). `motivo`: por qué, para el log (`MOTIVOS`, electron/lider.ts). */
  liderCerrar(sid: string, motivo?: string): Promise<void>;
  /**
   * Retomar un líder sin proceso (`Lider.caido`): pasa a ser de la app y queda listo para
   * escribirle. No lanza nada ni le manda nada: sale con el primer mensaje del usuario.
   */
  liderRetomar(sid: string, x: { modelo: string; effort: string; nombre?: string }): Promise<Retomado>;
  /** Su transcript, con la forma de `pa --hilo --json`. */
  liderConversacion(sid: string, antes: number | null): Promise<RespuestaHilo>;
  /** Mirar el transcript del líder abierto (`null`: ninguno). */
  liderMirar(sid: string | null): void;
  /** El usuario abrió esa conversación (o volvió a la ventana con ella a la vista): el líder deja de esperarlo (electron/espera.ts). */
  liderVisto(sid: string): void;
  /** "Te espera" en la pantalla de la PC: cuántos esperan (tooltip y punto de la bandeja) y la notificación de escritorio. Sin ventana (navegador, fixtures) no hacen nada. */
  esperaEstado(x: { n: number; texto: string }): void;
  esperaNotificar(x: { sid: string; titulo: string; cuerpo: string }): void;
  /** El usuario tocó una notificación: abrir esa conversación. */
  alAbrirEspera(fn: (sid: string) => void): () => void;
  /**
   * Traer a la app un líder abierto en una terminal: cierra ese `claude` (por su pid) y queda
   * como líder de la app, listo para escribirle. Si está haciendo algo contesta `trabajando`
   * y no toca nada: se vuelve a pedir con `cortar` cuando el usuario dijo que sí.
   */
  liderTraer(sid: string, x: { modelo: string; effort: string; nombre?: string; modo?: string; cortar?: boolean }): Promise<Traido>;
  /** "Ir a la ventana" de un líder de la terminal; `false` si ya no se la pudo ubicar. */
  liderIr(pid: number): Promise<boolean>;
  /** ¿Se puede ubicar su ventana? Si no, no se ofrece el botón. */
  liderUbicable(pid: number): Promise<boolean>;
  /**
   * La cola de un líder (electron/cola.ts): lo que se le manda a mitad de un turno espera ahí
   * (en el main, guardado) y sale solo cuando queda libre. Al de una terminal, al terminar su
   * turno se lo trae y sale. Rechaza si el envío no sirve.
   */
  liderEncolar(sid: string, x: Omit<Encolado, "id">): Promise<void>;
  liderColaQuitar(sid: string, id: number): void;
  /** Ahora: reintenta lo que no había salido y, con `cortar`, corta lo que hace el de la terminal. */
  liderColaYa(sid: string, cortar: boolean): void;
  /** Las colas con algo (al abrir la vista). */
  liderColas(): Promise<AvisoCola[]>;
  alColaLider(fn: (a: AvisoCola) => void): () => void;
  alEventoLider(fn: (sid: string, e: EventoLider) => void): () => void;
  /** Cambió el transcript del líder mirado. */
  alTranscript(fn: (sid: string) => void): () => void;
  /** Quién está compactando su contexto ahora (electron/compactando.ts): id de un run o de un líder → epoch (s) desde cuándo. */
  compactando(): Promise<Compactando>;
  alCambiarCompactando(fn: (c: Compactando) => void): () => void;
  /** Los subagentes que lanzó cada sesión con proceso (electron/subagentes.ts): sesión → lista, y el informe entero de uno terminado. */
  subagentes(): Promise<Subagentes>;
  alCambiarSubagentes(fn: (s: Subagentes) => void): () => void;
  subagenteInforme(sid: string, id: string): Promise<string | null>;
  /** Cerrar del todo (Ctrl+Q, la bandeja) con lo elegido en el diálogo: sale, o devuelve cuántos líderes están respondiendo (para confirmar). */
  salir(x: { modo: "seguir" | "parar"; forzar: boolean }): Promise<number>;
  /** La bandeja del sistema pide Cerrar del todo: la vista abre su diálogo. Sin bandeja (navegador, fixtures) no llega nada. */
  alPedirSalida(fn: () => void): () => void;
  /** Los textos del menú de la bandeja, ya traducidos (se mandan al main con cada cambio de idioma). */
  textosBandeja(t: { abrir: string; cerrar: string }): void;
  /** Qué máquinas hay y cómo están: sin otra configurada, nada se muestra de ellas (src/maquinas.ts). */
  maquinas(): Promise<Maquinas>;
  alCambiarMaquinas(fn: (m: Maquinas) => void): () => void;
  /** Hay un build de trama más nuevo que el que corre: el cartel de la barra (src/barra/Reinicio.tsx). */
  reinicio(): Promise<Reinicio>;
  alCambiarReinicio(fn: (r: Reinicio) => void): () => void;
  /** La PC que este Dell sabe prender; null donde no hay (la PC misma). Se vuelve a mirar cada vez que se llama. */
  pc(): Promise<EstadoPc | null>;
  alCambiarPc(fn: (e: EstadoPc | null) => void): () => void;
  prenderPc(): void;
  /** Reiniciar: ya, o cuando terminen las tareas que cortaría. */
  pedirReinicio(igual?: boolean): void;
  /** Dejar de esperar: el cartel sigue. */
  cancelarReinicio(): void;
  /** Hay un Claude Code más nuevo que el instalado (`null`: no, o no se pudo saber). */
  avisoClaude(): Promise<AvisoClaude | null>;
  alCambiarAvisoClaude(fn: (a: AvisoClaude | null) => void): () => void;
  /** Dismiss: no avisar más de esa versión. */
  descartarAvisoClaude(): void;
  /** El CHANGELOG de Claude Code en el navegador. */
  abrirChangelog(): void;
  /** Actualizar Claude Code (`claude update`); `abiertos`: líderes de la app que siguen con la vieja. */
  actualizarClaude(): Promise<Actualizado>;
  /** Lo mismo para Antigravity CLI (`agy`): `null` también si no está instalado. */
  avisoAgy(): Promise<AvisoClaude | null>;
  alCambiarAvisoAgy(fn: (a: AvisoClaude | null) => void): () => void;
  descartarAvisoAgy(): void;
  /** Actualizar agy (una terminal con paru, hasta que se cierra); `abiertos` es siempre 0. */
  actualizarAgy(): Promise<Actualizado>;
  /** Qué falta del setup (Handy, agy, Ollama, el login); vacío si todo está o no se avisa en esta máquina. */
  faltasSetup(): Promise<FaltaSetup[]>;
  /** No avisar más de esa falta. */
  descartarSetup(id: FaltaSetup["id"]): void;
  /** Si Claude y Gemini (agy) están conectados, según el motor (electron/cuentas.ts); `null`: no se pudo preguntar. */
  cuentas(): Promise<EstadoCuentas | null>;
  /** Las cuentas por proveedor que dice el CLI `cuentas` del motor; `null`: no está instalado (todo se ve con una cuenta por proveedor). `verificar` le pregunta el login a cada una (lento). */
  listaCuentas(verificar: boolean): Promise<ListaCuentas | null>;
  /** Crea la cuenta (sin login) y devuelve su id. Un fallo vuelve como `{ ok: false, error }` (clave `main.*` o texto del CLI). */
  agregarCuenta(proveedor: ProveedorCuenta, nombre: string): Promise<ResultadoCuenta>;
  renombrarCuenta(id: string, nombre: string): Promise<ResultadoCuenta>;
  /** Saca la cuenta; con `borrarCredenciales`, también su carpeta de sesión. */
  quitarCuenta(id: string, borrarCredenciales: boolean): Promise<ResultadoCuenta>;
  /** El inicio de sesión de esa cuenta en una terminal de la PC; vuelve cuando la persona termina. */
  loginCuenta(id: string): Promise<ResultadoCuenta>;
  /** Skills, agentes, plugins y servidores MCP de la carpeta de config de esa cuenta de Claude (`"claude"` = la de siempre); `null`: no existe o no se pudo leer. */
  extensiones(cuenta: string): Promise<Extensiones | null>;
  /** Copia a esa cuenta las skills, agentes y MCP de la de siempre que no tiene (no pisa nada). */
  importarExtensiones(cuenta: string): Promise<ResultadoImportar>;
  /** Relanzar con la versión nueva los líderes que no están respondiendo. */
  reiniciarLideres(): Promise<{ reiniciados: number; ocupados: number }>;
}

export type Actualizado = { ok: true; version: string; abiertos: number } | { ok: false; error: string; abiertos: number };

/** Los umbrales del anillo de contexto (electron/contexto.ts); `null`, no se pudo leer. */
export type Umbrales = { autoCompact: number | null };

export type AvisoClaude = { instalada: string; ultima: string };

/** Una cuenta de un CLI: `cuenta` es con quién está conectada; `error`, por qué no se pudo saber. */
export type CuentaEstado = { instalado: boolean; logueado: boolean; cuenta: string | null; error: string | null };
export type EstadoCuentas = { claude: CuentaEstado; agy: CuentaEstado; codex?: CuentaEstado };
const cuentaValida = (x: unknown): CuentaEstado => {
  const o = (x ?? {}) as Partial<CuentaEstado>;
  return { instalado: o.instalado === true, logueado: o.logueado === true, cuenta: typeof o.cuenta === "string" && o.cuenta ? o.cuenta : null, error: typeof o.error === "string" && o.error ? o.error : null };
};
/** Sólo la forma esperada; cualquier otra cosa es «no se pudo preguntar». */
export const cuentasValidas = (x: unknown): EstadoCuentas | null => {
  const o = x as { version?: unknown; claude?: unknown; agy?: unknown; codex?: unknown } | null;
  return o && o.version === 1 && o.claude && o.agy ? { claude: cuentaValida(o.claude), agy: cuentaValida(o.agy), ...(o.codex ? { codex: cuentaValida(o.codex) } : {}) } : null;
};

/** Lo que falta del setup de esta máquina (electron/setup.ts) y el enlace para conseguirlo. */
export type FaltaSetup = { id: "handy" | "agy" | "ollama" | "login" | "claude" | "git"; url: string };
const IDS_SETUP = new Set<string>(["handy", "agy", "ollama", "login", "claude", "git"]);
/** Sólo ids conocidos y enlaces http(s): lo que llega de afuera no se pinta tal cual. */
const faltasValidas = (x: unknown): FaltaSetup[] => {
  const l = (x as { faltas?: unknown } | null)?.faltas;
  if (!Array.isArray(l)) return [];
  return l.flatMap((f) => {
    const { id, url } = (f ?? {}) as { id?: unknown; url?: unknown };
    return typeof id === "string" && IDS_SETUP.has(id) && typeof url === "string" && /^https?:\/\//.test(url) ? [{ id, url } as FaltaSetup] : [];
  });
};

/**
 * Las máquinas de `maquinas.json` vistas desde esta trama. `estado` de cada otra: `conectando` (todavía no contestó),
 * `conectada`, `soloLectura` (conectada con otra versión: sus filas se ven y nada se le manda) y `sinConexion`
 * (cayó, o no es un motor de trama: sus filas no están).
 */
export type EstadoMaquina = "conectando" | "conectada" | "soloLectura" | "sinConexion";
export type Maquinas = { esta: { id: string; nombre: string }; otras: { id: string; nombre: string; estado: EstadoMaquina }[] };
const SOLA: Maquinas = { esta: { id: "pc", nombre: "PC" }, otras: [] };
const textoNoVacio = (x: unknown, otro: string) => (typeof x === "string" && x !== "" ? x : otro);
const maquinasValidas = (x: unknown): Maquinas => {
  const m = x as { esta?: { id?: unknown; nombre?: unknown }; otras?: unknown } | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.otras)) return SOLA;
  const id = textoNoVacio(m.esta?.id, "pc");
  return {
    esta: { id, nombre: textoNoVacio(m.esta?.nombre, id) },
    otras: m.otras.flatMap((o: { id?: unknown; nombre?: unknown; fase?: unknown; acceso?: unknown }) => {
      if (!o || typeof o.id !== "string" || o.id === "") return [];
      const estado: EstadoMaquina =
        o.fase === "conectando" ? "conectando" : o.fase !== "conectada" || o.acceso === "no" ? "sinConexion" : o.acceso === "leer" ? "soloLectura" : "conectada";
      return [{ id: o.id, nombre: textoNoVacio(o.nombre, o.id), estado }];
    }),
  };
};
/** Las capturas de dos máquinas: `maquinas`, `maquinas-lider` (conectada), `maquinas-caida` (el Dell sin conexión), `maquinas-version` (otra versión, sólo lectura) y `maquinas-selector[-caida]` (la caja de un líder nuevo con el selector abierto). */
const EN_DOS = ["maquinas", "maquinas-caida", "maquinas-version", "maquinas-lider", "maquinas-selector", "maquinas-selector-caida"];
const maquinasDeCaptura = (): Maquinas =>
  MODO.captura && EN_DOS.includes(MODO.captura)
    ? {
        esta: { id: "pc", nombre: "PC" },
        otras: [{ id: "dell", nombre: "Dell", estado: MODO.captura === "maquinas-caida" || MODO.captura === "maquinas-selector-caida" ? "sinConexion" : MODO.captura === "maquinas-version" ? "soloLectura" : "conectada" }],
      }
    : SOLA;
/** Las filas del Dell: están con el Dell conectado (también en sólo lectura); caído, no. */
const filasDelDell = () => MODO.captura === "maquinas" || MODO.captura === "maquinas-version" || MODO.captura === "maquinas-lider";

/**
 * La PC vista desde el Dell (electron/pc-estado.ts): `apagada` (no contesta), `prendiendo` (salió el paquete) o `prendida`.
 * `url`: la trama de la PC, para Abrir. `error`: por qué no prendió (lo que dijo el comando, o una clave del main).
 */
export type EstadoPc = { nombre: string; url: string; estado: "apagada" | "prendiendo" | "prendida"; error: string | null };
const pcValida = (x: unknown): EstadoPc | null => {
  const p = x as Partial<EstadoPc> | null;
  if (!p || typeof p.nombre !== "string" || typeof p.url !== "string") return null;
  const estado = p.estado === "prendiendo" || p.estado === "prendida" ? p.estado : "apagada";
  return { nombre: p.nombre, url: p.url, estado, error: typeof p.error === "string" && p.error ? p.error : null };
};
/** Capturas `pc-apagada`, `pc-prendiendo` y `pc-prendida`; fuera de ellas no hay PC (la PC no se prende a sí misma). */
const pcDeCaptura = (): EstadoPc | null => {
  const c = MODO.captura;
  if (c === "pc-apagada") return { nombre: "PC", url: "http://192.0.2.1:4545", estado: "apagada", error: null };
  if (c === "pc-prendiendo") return { nombre: "PC", url: "http://192.0.2.1:4545", estado: "prendiendo", error: null };
  if (c === "pc-prendida") return { nombre: "PC", url: "http://192.0.2.1:4545", estado: "prendida", error: null };
  return null;
};
let pcFija: EstadoPc | null = pcDeCaptura();
const oyentesPc = new Set<(e: EstadoPc | null) => void>();

/**
 * `pedido`: El usuario ya tocó Reiniciar y espera a `tareas` (los líderes de `espera`, por nombre, o una integración).
 * `colgado`: lo que espera lleva 20 min sin un evento y se puede "Reiniciar igual". `saliendo`: se está reiniciando.
 */
export type Reinicio = { hay: boolean; pedido: boolean; tareas: number; saliendo: boolean; espera: string[]; integrando: boolean; colgado: boolean };
const SIN_REINICIO: Reinicio = { hay: false, pedido: false, tareas: 0, saliendo: false, espera: [], integrando: false, colgado: false };
const reinicioValido = (x: unknown): Reinicio => {
  const r = x as Partial<Reinicio> | null;
  if (!r || r.hay !== true) return SIN_REINICIO;
  return {
    hay: true,
    pedido: r.pedido === true,
    tareas: typeof r.tareas === "number" && r.tareas > 0 ? Math.round(r.tareas) : 0,
    saliendo: r.saliendo === true,
    espera: Array.isArray(r.espera) ? r.espera.filter((n): n is string => typeof n === "string" && n !== "") : [],
    integrando: r.integrando === true,
    colgado: r.colgado === true,
  };
};
/**
 * Capturas `actualizacion` (el cartel), `actualizacion-espera` (pedido, esperando a un líder y a uno de sus workers)
 * y `actualizacion-colgado` (lo mismo, sin eventos hace 20 min: "Reiniciar igual").
 */
const reinicioDeCaptura = (): Reinicio => {
  const c = MODO.captura;
  if (c === "actualizacion") return { ...SIN_REINICIO, hay: true };
  if (c === "actualizacion-espera") return { ...SIN_REINICIO, hay: true, pedido: true, tareas: 2, espera: ["ana-ab"] };
  if (c === "actualizacion-colgado") return { ...SIN_REINICIO, hay: true, pedido: true, tareas: 2, espera: ["ana-ab"], colgado: true };
  return SIN_REINICIO;
};
let reinicioFijo: Reinicio = reinicioDeCaptura();
const oyentesReinicio = new Set<(r: Reinicio) => void>();
const ponerReinicioFijo = (r: Reinicio) => {
  reinicioFijo = r;
  oyentesReinicio.forEach((f) => f(r));
};

/** Lo que manda el main, mirado antes de creerle. */
const avisoValido = (x: unknown): AvisoClaude | null => {
  const a = x as AvisoClaude | null;
  return a && typeof a.instalada === "string" && typeof a.ultima === "string" ? { instalada: a.instalada, ultima: a.ultima } : null;
};

// Con fixtures el aviso sólo sale en sus capturas (las demás quedan como estaban).
let avisoFijo: AvisoClaude | null =
  MODO.captura === "claude" || MODO.captura === "claude-abierto" || MODO.captura === "claude-actualizado" ? { instalada: "2.1.287", ultima: "2.1.300" } : null;
const oyentesAviso = new Set<(a: AvisoClaude | null) => void>();
// Con fixtures no hay aviso de agy (ninguna captura lo muestra).
const sinAvisoAgy = async () => null;
const SETUP_FIJO: FaltaSetup[] = [
  { id: "handy", url: "https://handy.computer" },
  { id: "ollama", url: "https://ollama.com/download" },
];

/** Lo que avisa el main de una cola (`AvisoCola`); `null` si no tiene esa forma. */
function avisoCola(x: unknown): AvisoCola | null {
  const a = x as AvisoCola | null;
  const item = (e: unknown) => !!e && typeof (e as Encolado).id === "number" && typeof (e as Encolado).texto === "string";
  if (!a || typeof a.sid !== "string" || !Array.isArray(a.lista) || !a.lista.every(item)) return null;
  if (a.salio && !item(a.salio.item)) return null;
  return { ...a, error: typeof a.error === "string" ? a.error : null };
}

/** `modo`: sólo para un líder nuevo (el chip de la caja); después se cambia con `liderModo`. */
/** `maquina`: dónde nace un líder nuevo (el selector de la caja); sin él, esta máquina. */
export type EnvioLider = { texto: string; imagenes?: Imagen[]; modelo: string; effort: string; modo?: string; rol?: "analista"; maquina?: string; carpeta?: string };

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Para probar el camino del error: `?falla=cerrar` hace fallar todos los Cerrar; `?falla=lanzar`, retomar un líder. */
const fallaCerrar = MODO.falla === "cerrar" || MODO.falla === "settle";
const fallaLanzar = MODO.falla === "lanzar";

const leidosFijos: Leidos = {};
const nombresFijos: Nombres = { titulos: {}, proyectos: {}, ocultos: [], orden: { carpetas: [], lideres: {} } };

// Los líderes con fixtures: la charla vive en memoria y la respuesta llega por
// pedacitos, como el stream de `claude`.
const oyentesLider = new Set<(sid: string, e: EventoLider) => void>();
// La captura `lider-muerto`: un líder que mataron, con su worker colgando; retomado, pasa a ser de la app.
const oyentesLideres = new Set<(r: RespuestaLideres) => void>();

// Con fixtures no compacta nadie, salvo lo que fuerza la captura `compactando` (o el guion).
let compactandoFijo: Compactando = {};

/** El modelo del dictado de los fixtures: Turbo bajado y elegido, Large v3 sin bajar y otro que Handy ya tiene. */
let dictadoFijo: ModelosDictado = {
  version: 1,
  elegido: MODELO_TURBO,
  motor: "handy",
  modelos: [
    { id: MODELO_TURBO, nombre: "Whisper Large v3 Turbo", bajado: true },
    { id: MODELO_LARGE_V3, nombre: "Whisper Large v3", bajado: false },
    { id: "parakeet-tdt-0.6b-v3", nombre: "Parakeet V3", bajado: true },
  ],
};

/** Lo que dijo el main de los modelos del dictado, validado: versión que no se conoce → error. */
function comoModelosDictado(x: unknown): ModelosDictado {
  const r = x as ModelosDictado | null;
  if (!r || r.version !== 1 || !Array.isArray(r.modelos) || typeof r.elegido !== "string") throw new Error(t("error.version", { que: "dictado", v: String((r as { version?: unknown } | null)?.version), conozco: 1 }));
  return r;
}
const oyentesCompactando = new Set<(c: Compactando) => void>();
/** `id` (un run o un líder) empieza o deja de compactar. Sólo con fixtures. */
export function compactarFijo(id: string, si: boolean) {
  const { [id]: _, ...resto } = compactandoFijo;
  compactandoFijo = si ? { ...resto, [id]: Math.floor(Date.now() / 1000) - 38 } : resto;
  oyentesCompactando.forEach((f) => f(compactandoFijo));
}
/** Lo que manda el main, mirado: sólo los ids con su hora. */
const compactandoDe = (x: unknown): Compactando =>
  x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter((e): e is [string, number] => typeof e[1] === "number")) : {};
/** Lo que manda el main, mirado: sesión → subagentes con los campos de lo que se pinta. */
const subagentesDe = (x: unknown): Subagentes => {
  if (!x || typeof x !== "object") return {};
  const r: Subagentes = {};
  for (const [sid, lista] of Object.entries(x)) {
    if (!Array.isArray(lista)) continue;
    const ok = lista.filter(
      (u): u is Subagente =>
        !!u && typeof u === "object" && typeof u.id === "string" && typeof u.descripcion === "string" && typeof u.inicio === "number" && ["corriendo", "terminado", "error"].includes(u.estado),
    );
    if (ok.length) r[sid] = ok;
  }
  return r;
};
// La captura `subagentes`: un líder con dos subagentes corriendo, uno que terminó (con informe más largo) y uno que falló.
const subagentesFijos = (): Subagentes => {
  if (MODO.captura !== "subagentes") return {};
  const ahora = Math.floor(Date.now() / 1000);
  const base = { sid: "s-fix-a3", tipo: "general-purpose" };
  return {
    "s-fix-a3": [
      { ...base, id: "a0c1d2e3f4a5b6c7", descripcion: "Buscar dónde se arma el índice de cauce", modelo: "Haiku 5.5", estado: "corriendo", inicio: ahora - 42, ultimo_en: ahora - 3, ultimo: "Grep: indice_cauce en src/", tokens: 18400, resultado: null, hay_mas: false },
      { ...base, id: "b1d2e3f4a5b6c7d8", descripcion: "Revisar los tests del módulo de cauce", modelo: "Sonnet 5.5", estado: "corriendo", inicio: ahora - 128, ultimo_en: ahora - 9, ultimo: "Bash: npm test -- cauce", tokens: 61200, resultado: null, hay_mas: false },
      {
        ...base,
        id: "c2e3f4a5b6c7d8e9",
        descripcion: "Listar los canales IPC que quedan sin prueba",
        modelo: "Haiku 5.5",
        estado: "terminado",
        inicio: ahora - 400,
        ultimo_en: ahora - 310,
        ultimo: "Quedan 4 canales sin prueba.",
        tokens: 9300,
        resultado: "Quedan 4 canales sin prueba:\n- pasos:mirar\n- pasos:soltar\n- subagentes:leer\n- subagentes:informe",
        hay_mas: true,
      },
      { ...base, id: "d3f4a5b6c7d8e9f0", descripcion: "Medir el arranque en frío", modelo: "Haiku 5.5", estado: "error", inicio: ahora - 900, ultimo_en: ahora - 880, ultimo: "API Error: 529 overloaded", tokens: 2100, resultado: null, hay_mas: false },
    ],
  };
};
const oyentesSubagentes = new Set<(s: Subagentes) => void>();
const retomados = new Map<string, string>();
// La captura `lider-terminal`: al escribirle, el de la terminal pasa a ser de la app.
const traidos = new Set<string>();
// La captura `te-espera`: uno de terminal que terminó y uno de la app (el abierto) que pide un permiso.
const conEspera = (r: RespuestaLideres): RespuestaLideres =>
  MODO.captura !== "te-espera"
    ? r
    : {
        ...r,
        lideres: r.lideres.map((l) =>
          l.id === "s-fix-a3" ? { ...l, espera: { motivo: "listo" as const, desde: 1 } } : l.id === "s-fix-c7" ? { ...l, espera: { motivo: "pide" as const, desde: 2 }, pide: true } : l,
        ),
      };
const lideresFijos = (): RespuestaLideres => conEspera(MODO.captura === "lider-gemini" ? conGemini(lideresBase()) : lideresBase());
/** Captura `lider-gemini`: el líder de la app que se abre corre con Gemini (su razonamiento y sus comandos se ven, no la frase tierna). */
const conGemini = (r: RespuestaLideres): RespuestaLideres => {
  const id = r.lideres.find((l) => l.origen === "app" && l.vivo)?.id ?? r.lideres[0]?.id;
  return { ...r, lideres: r.lideres.map((l) => (l.id === id ? { ...l, modelo: "gemini-3.8-flash", effort: "low" } : l)) };
};
const lideresBase = (): RespuestaLideres =>
  filasDelDell()
    ? { ...LIDERES, lideres: [...LIDERES.lideres, LIDER_DELL] }
    : MODO.captura === "terminados"
    ? { ...LIDERES, lideres: [...LIDERES.lideres, LIDER_TERMINADOS] }
    : MODO.captura !== "lider-muerto" && MODO.captura !== "lider-app-muerto"
        ? traidos.size
          ? { ...LIDERES, lideres: LIDERES.lideres.map((l) => (traidos.has(l.id) ? { ...l, origen: "app" as const, effort: "high" } : l)) }
          : LIDERES
        : {
            ...LIDERES,
            lideres: [
              ...LIDERES.lideres,
              retomados.has(LIDER_MUERTO.id)
                ? { ...LIDER_MUERTO, caido: undefined, origen: "app" as const, effort: "high" }
                : MODO.captura === "lider-app-muerto"
                  ? { ...LIDER_MUERTO, origen: "app" as const, effort: "high", modo: "bypassPermissions" }
                  : LIDER_MUERTO,
            ],
          };
// La cola con fixtures: la misma del main, con líderes de mentira.
const ocupadosFijos = new Set<string>();
const oyentesCola = new Set<(a: AvisoCola) => void>();
const emitir = (sid: string, e: EventoLider) => {
  if (e.tipo === "estado") {
    if (e.ocupado) ocupadosFijos.add(sid);
    else ocupadosFijos.delete(sid);
  }
  oyentesLider.forEach((f) => f(sid, e));
  if (e.tipo === "estado" && !e.ocupado) void colaFija().libre(sid);
};
let laColaFija: ReturnType<typeof crearCola> | null = null;
function colaFija() {
  if (laColaFija) return laColaFija;
  const deTerminal = (sid: string) => !traidos.has(sid) && LIDERES.lideres.some((l) => l.id === sid && l.origen === "terminal");
  laColaFija = crearCola({
    // `HILOS_VARIANTE=trabajando`: el de la terminal está a mitad de algo y no termina solo.
    disponible: async (sid) => (ocupadosFijos.has(sid) ? "ocupado" : !deTerminal(sid) ? "app" : MODO.variante === "trabajando" ? "terminalOcupada" : "terminal"),
    async traer(sid) {
      traidos.add(sid);
      const r = lideresFijos();
      oyentesLideres.forEach((f) => f(r));
      return { ok: true };
    },
    async mandar(sid, x) {
      if (fallaLanzar) throw new Error("claude: could not resume the session");
      responderFijo(sid, x.texto, x.modelo, x.imagenes);
    },
    total: async (sid) => charla(sid).length,
    textoError: (x) => ("motivo" in x ? x.motivo : String((x.error as Error)?.message ?? x.error)),
    guardar: async () => {},
    avisar: (a) => oyentesCola.forEach((f) => f(a)),
  });
  // La captura del de la terminal trabajando: con un mensaje ya esperando en la cola.
  const t = LIDERES.lideres.find((l) => l.origen === "terminal");
  if (t && MODO.captura === "lider-terminal" && MODO.variante === "trabajando")
    laColaFija.cargar(JSON.stringify({ version: 1, colas: { [t.id]: [{ id: 1, texto: "When you finish that, check the staging deploy.", modelo: "claude-opus-5-5", effort: "high" }] } }));
  return laColaFija;
}
const charlas = new Map<string, Mensaje[]>();
const charla = (sid: string) => {
  let c = charlas.get(sid);
  if (!c) charlas.set(sid, (c = MODO.captura === "lider-sistema" ? charlaSistema(sid) : MODO.captura === "lider-imagenes" ? charlaImagenes(sid) : MODO.captura === "lider-tabla" ? charlaTabla(sid) : MODO.captura === "lider-listas" ? charlaListas(sid) : MODO.captura === "lider-pensando" && MODO.variante !== "vivo" ? charlaPensando(sid) : MODO.captura === "lider-formato" ? (MODO.variante === "larga" ? charlaLarga(sid) : charlaFormato(sid, MODO.variante === "pegado")) : charlaLider(sid)));
  return c;
};
// La conversación larga de las pruebas (`scripts/prueba-scroll-lideres.mjs`) recibe mensajes nuevos mientras otra está abierta.
if (MODO.captura === "lider-formato" && MODO.variante === "larga")
  (globalThis as { __crecerCharla?: (sid: string, n: number) => void }).__crecerCharla = (sid, n) => {
    const c = charla(sid);
    c.push(...charlaLarga(sid, c.length + n).slice(c.length));
  };
// Un turno que dura (`scripts/prueba-scroll-lideres.mjs`): el mensaje "novela" (como el gatillo de claude-falso) llega palabra por
// palabra, 120 ms cada una, hasta que `__pararTrabajo` lo cierra.
const paraFijo = new Set<string>();
if (MODO.captura === "lider-formato" && MODO.variante === "larga")
  (globalThis as { __pararTrabajo?: (sid: string) => void }).__pararTrabajo = (sid) => void paraFijo.add(sid);
let creados = 0;

/** Captura `lider-imagenes`: la charla de siempre con un pedido que trae dos capturas. */
function charlaImagenes(sid: string): Mensaje[] {
  const c = charlaLider(sid);
  const ts = c[0]?.ts ?? null;
  const yo: Mensaje = {
    i: 0,
    rol: "user",
    texto: "Mirá estas dos: el panel se corre al abrir Ajustes.",
    herramientas: [],
    ts,
    modelo: null,
    imagenes: [imagenFija(1280, 800, 210), imagenFija(1280, 800, 30)],
  };
  return [yo, ...c].map((m, i) => ({ ...m, i }));
}

/** Con fixtures, el analista de Ramas (B22) contesta un veredicto por rama, rotando los cuatro. */
const MOTIVOS: Record<string, string> = {
  integrar: "Complete, tests included.",
  retomar: "Half done: the second part is missing.",
  descartar: "Already done in another branch.",
  revisar: "Touches the schema; worth a look.",
};
function analisisFijo(texto: string): string | null {
  const ids = [...texto.matchAll(/^- id: (\S+)$/gm)].map((m) => m[1]);
  if (!ids.length) return null;
  const vs = Object.keys(MOTIVOS);
  const juicios = ids.map((id, i) => ({ id, veredicto: vs[i % vs.length], motivo: MOTIVOS[vs[i % vs.length]] }));
  return `I looked at the ${ids.length} branches. One is ready, one needs to be picked up again.\n\n\`\`\`json\n${JSON.stringify(juicios, null, 1)}\n\`\`\``;
}

function responderFijo(sid: string, texto: string, modelo: string, imagenes?: Imagen[]) {
  emitir(sid, { tipo: "estado", ocupado: true, vivo: true });
  emitir(sid, { tipo: "hace", hace: { que: "pidiendo", nombre: null, detalle: null } });
  const c = charla(sid);
  const ts = new Date().toISOString();
  c.push({ i: c.length, rol: "user", texto, herramientas: [], ts, modelo: null, ...(imagenes?.length ? { imagenes } : {}) });
  const resp =
    analisisFijo(texto) ??
    (imagenes?.length && !texto.trim()
      ? `Veo ${imagenes.length === 1 ? "la imagen" : `las ${imagenes.length} imágenes`}.`
      : `Dale. Miro el estado y te digo: ${texto.split("\n")[0].slice(0, 60)}.`);
  // La captura del analista lo quiere ya contestado: todo de una.
  const novela = texto.trim() === "novela";
  const palabras = MODO.captura === "ramas-analista" ? [resp] : novela ? Array.from({ length: 600 }, (_, i) => (i % 9 === 8 ? "palabra\n\n" : "palabra ")) : resp.split(/(?<= )/);
  let k = 0;
  const paso = () => {
    if (k === 0) {
      emitir(sid, { tipo: "tokens", salida: 12, nuevo: true });
      // Cada turno inventado pesa un poco más: el anillo se mueve en vivo.
      crecido.set(sid, (crecido.get(sid) ?? 0) + 2_400);
      emitir(sid, { tipo: "contexto", usage: { ...usoFijo(sid), output_tokens: 12 } });
      emitir(sid, { tipo: "hace", hace: { que: "herramienta", nombre: "Bash", detalle: "pa --hilos --json" } });
      emitir(sid, { tipo: "mensaje", mid: "f-herr", texto: "", herramientas: ["Bash: pa --hilos --json"], modelo });
      emitir(sid, { tipo: "tokens", salida: 9, nuevo: true });
      emitir(sid, { tipo: "hace", hace: { que: "escribiendo", nombre: null, detalle: null } });
    }
    if (k < palabras.length && !(novela && paraFijo.delete(sid))) {
      emitir(sid, { tipo: "tokens", salida: 9 + 4 * k, nuevo: false });
      emitir(sid, { tipo: "parcial", texto: palabras[k++] });
      setTimeout(paso, novela ? 120 : 45);
      return;
    }
    c.push({ i: c.length, rol: "assistant", texto: resp, herramientas: ["Bash: pa --hilos --json"], ts: new Date().toISOString(), modelo });
    emitir(sid, { tipo: "mensaje", mid: "f-resp", texto: resp, herramientas: [], modelo });
    emitir(sid, { tipo: "fin", error: null, ttl: 3600 });
    emitir(sid, { tipo: "estado", ocupado: false, vivo: true });
  };
  setTimeout(paso, 300);
}
const effortsFijos: Record<string, string> = {};

/**
 * Las cuentas con fixtures: sin variante, el `cuentas` instalado con una cuenta por proveedor; `cuentas-sin` = sin el comando
 * (la lista es `null`); `cupos-cuentas` = Claude con la de siempre y «Trabajo». Se puede agregar, renombrar, quitar y conectar
 * (el login tarda un instante y deja la cuenta conectada), todo en memoria.
 */
function cuentasFijas() {
  const nueva = (id: string, proveedor: ProveedorCuenta, nombre: string, logueado: boolean | null, defecto = false): PerfilCuenta => ({ id, proveedor, nombre, defecto, logueado });
  let lista: PerfilCuenta[] = [
    nueva("claude", "claude", "Claude", true, true),
    nueva("google", "google", "Google AI Pro", (MODO.variante ?? "").startsWith("cupos"), true),
    ...(MODO.variante === "cupos-cuentas" ? [nueva("trabajo", "claude", "Trabajo", true)] : []),
  ];
  const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const ok: ResultadoCuenta = { ok: true };
  const falta = (): ResultadoCuenta => ({ ok: false, error: "main.cuentasDato" });
  return {
    async listaCuentas(): Promise<ListaCuentas | null> {
      return MODO.variante === "cuentas-sin" ? null : { version: 1, cuentas: lista.map((c) => ({ ...c })) };
    },
    async agregarCuenta(proveedor: ProveedorCuenta, nombre: string): Promise<ResultadoCuenta> {
      const base = nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cuenta";
      let id = base;
      for (let n = 2; lista.some((c) => c.id === id); n++) id = `${base}-${n}`;
      lista = [...lista, nueva(id, proveedor, nombre, false)];
      return { ok: true, id };
    },
    async renombrarCuenta(id: string, nombre: string): Promise<ResultadoCuenta> {
      if (!lista.some((c) => c.id === id)) return falta();
      lista = lista.map((c) => (c.id === id ? { ...c, nombre } : c));
      return ok;
    },
    async quitarCuenta(id: string): Promise<ResultadoCuenta> {
      if (!lista.some((c) => c.id === id && !c.defecto)) return falta();
      lista = lista.filter((c) => c.id !== id);
      return ok;
    },
    async loginCuenta(id: string): Promise<ResultadoCuenta> {
      await pausa(MODO.variante === "cuentas-login-lento" ? 60_000 : 700);
      if (!lista.some((c) => c.id === id)) return falta();
      lista = lista.map((c) => (c.id === id ? { ...c, logueado: true } : c));
      return ok;
    },
  };
}

/**
 * Las extensiones con fixtures: la cuenta de siempre tiene de todo y las agregadas arrancan con una skill y un servidor; "Importar" suma
 * en memoria lo que falta (sin pisar), igual que el main.
 */
function extensionesFijas() {
  const item = (nombre: string, descripcion: string, origen: string, modelo: string | null = null) => ({ nombre, descripcion, origen, modelo });
  const base: Extensiones = {
    version: 1,
    cuenta: "claude",
    defecto: true,
    skills: [
      item("mapa-herramientas", "Qué agente, skill, MCP y script usar para cada tarea.", "skills"),
      item("texturizar-painter", "Cómo manejar Substance Painter por el MCP, sin mouse ni pantalla.", "skills"),
      item("escribir-humano", "Para que los textos suenen a una persona y no a una IA.", "skills"),
    ],
    agentes: [item("explorador", "Busca archivos en varias carpetas y devuelve sólo las rutas.", "agents", "haiku"), item("verificador", "Segunda mirada independiente sobre lo visual.", "agents", "opus")],
    plugins: [{ nombre: "panel-en-vivo", mercado: "local", version: "1.2.0", activo: true, origen: "installed_plugins.json" }],
    mcp: [
      { nombre: "unityVRC", tipo: "stdio", destino: "node", origen: ".claude.json" },
      { nombre: "context7", tipo: "http", destino: "mcp.context7.com", origen: ".claude.json" },
    ],
  };
  const propias = new Map<string, Extensiones>();
  const de = (id: string): Extensiones | null => {
    if (id === "claude") return base;
    if (MODO.variante === "cuentas-sin" || id !== "max-curat") return null;
    let e = propias.get(id);
    if (!e) {
      e = { version: 1, cuenta: id, defecto: false, skills: [base.skills[0]], agentes: [], plugins: [], mcp: [base.mcp[1]] };
      propias.set(id, e);
    }
    return e;
  };
  const sumar = <T extends { nombre: string }>(a: T[], b: T[]): [T[], number] => {
    const nuevos = b.filter((x) => !a.some((y) => y.nombre === x.nombre));
    return [[...a, ...nuevos], nuevos.length];
  };
  return {
    async extensiones(cuenta: string): Promise<Extensiones | null> {
      const e = de(cuenta);
      return e ? { ...e } : null;
    },
    async importarExtensiones(cuenta: string): Promise<ResultadoImportar> {
      const e = de(cuenta);
      if (!e || e.defecto) return { ok: false, error: "main.extMisma" };
      await new Promise((r) => setTimeout(r, 500));
      const [skills, ns] = sumar(e.skills, base.skills);
      const [agentes, na] = sumar(e.agentes, base.agentes);
      const [mcp, nm] = sumar(e.mcp, base.mcp);
      propias.set(cuenta, { ...e, skills, agentes, mcp });
      return { ok: true, skills: ns, agentes: na, mcp: nm, omitidos: base.skills.length + base.agentes.length + base.mcp.length - ns - na - nm };
    },
  };
}

/**
 * El `usage` del líder con fixtures: lo que pesa su conversación contra el
 * umbral de 200 mil. Las capturas del anillo (docs/estado/B16/) lo fuerzan a
 * 30, 75 y 95 %.
 */
const crecido = new Map<string, number>();
/**
 * Los tres casos del uso: todo (`USO`), el 5 h sin hora de reinicio (`uso-sin-hora`) y ningún límite
 * sabido (`uso-sin-dato`, o `HILOS_VARIANTE=sin-uso` para lo mismo en otra captura).
 */
const usoFixture = (): Uso => {
  if (MODO.captura === "uso-sin-hora") return USO_SIN_HORA;
  if (MODO.captura === "uso-sin-dato" || MODO.variante === "sin-uso") return { version: 1, ts: 0, five_hour: null, seven_day: null };
  if (MODO.variante === "cupos-google") return USO_GOOGLE;
  if (MODO.variante === "cupos-cuentas") return USO_CUENTAS;
  return USO;
};

function usoFijo(sid: string): Tokens {
  const leida = MODO.captura === "contexto-75" || MODO.captura === "contexto-abierto" ? 148_300 : MODO.captura === "contexto-95" ? 188_420 : 58_640;
  return { input_tokens: 12, cache_creation_input_tokens: 1_688, cache_read_input_tokens: leida + (crecido.get(sid) ?? 0), output_tokens: 642 };
}

/**
 * Las capturas del indicador y de los avisos (docs/estado/B12/): el líder
 * `sid` a mitad de un turno (corre un Bash, la API reintentó) o con un turno
 * que terminó mal (compactó, cerca del límite semanal, tope de 5 h y el
 * proceso que sale con código 1). Sólo con fixtures.
 */
export function escenaFija(sid: string, escena: "trabajando" | "avisos" | "plan" | "permiso" | "preguntas" | "preguntas-dos" | "compactando" | "relevo" | "relevado" | "pensando" | "gemini") {
  const ev = (e: EventoLider) => emitir(sid, e);
  const ahora = Math.floor(Date.now() / 1000);
  ev({ tipo: "estado", ocupado: true, vivo: true });
  if (escena === "compactando") {
    // B19: compacta y no termina nunca (la captura lo agarra a mitad).
    ev({ tipo: "hace", hace: { que: "compactando", nombre: null, detalle: null } });
    return;
  }
  if (escena === "gemini") {
    // Gemini a mitad de un turno: su razonamiento paso a paso y tres comandos (uno ok, uno con error, uno corriendo).
    const m = "gemini-3.8-flash";
    const paso = (mid: string, pensado: string, texto: string, nombre: string, entrada: Record<string, unknown>, id: string, resumen: string) =>
      ev({ tipo: "mensaje", mid, texto, herramientas: [`${nombre}: ${resumen}`], modelo: m, pensado, det: [{ nombre, entrada, id }] });
    paso("g1", "**Revisando el índice**\nPrimero miro qué pasa al correr los tests de cauce.", "", "Bash", { command: "npm test -- cauce", description: "Tests de cauce" }, "tg1", "npm test -- cauce");
    ev({ tipo: "resultado", id: "tg1", texto: "12 passing, 1 failing\n  1) índice · rechaza cauces vacíos", error: true });
    paso("g2", "**Buscando el índice**\nFalla el índice de cauce: busco dónde se arma antes de tocar nada.", "", "Bash", { command: "grep -rn \"armarIndice\" src/", description: "Dónde se arma el índice" }, "tg2", 'grep -rn "armarIndice" src/');
    ev({ tipo: "resultado", id: "tg2", texto: "src/cauce/indice.ts:41:export function armarIndice(cauces: Cauce[]) {", error: false });
    paso("g3", "**Leyendo el código**\nLa función no filtra los cauces vacíos: leo el archivo entero para ver el contexto antes de editar.", "", "Read", { file_path: "src/cauce/indice.ts" }, "tg3", "src/cauce/indice.ts");
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "Read", detalle: "src/cauce/indice.ts" } });
    ev({ tipo: "pensamiento", texto: "**Planeando el arreglo**\nDespués de leerlo, filtro los vacíos al armar el índice y agrego el caso a los tests." });
    return;
  }
  if (escena === "pensando") {
    // El líder razona y todavía no dijo nada: el texto de su razonamiento llega de a pedazos.
    ev({ tipo: "hace", hace: { que: "pensando", nombre: null, detalle: null } });
    for (const texto of PENSANDO_FIJO) ev({ tipo: "pensamiento", texto });
    return;
  }
  if (escena === "relevo" || escena === "relevado") {
    // B19: el líder corre `relevo` (bin/relevo); con "relevado", ya arrancó la sesión nueva.
    const command = "pa --nota 'B19 a medias: faltan las capturas' && relevo";
    ev({
      tipo: "mensaje",
      mid: "f-relevo",
      texto: "El contexto pasó el 70 %: dejo la nota y paso la posta.",
      herramientas: [`Bash: ${command}`],
      modelo: "claude-opus-5-5",
      det: [{ nombre: "Bash", entrada: { command, description: "Nota y relevo" }, id: "toolu_relevo" }],
    });
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "Bash", detalle: command } });
    if (escena === "relevo") return;
    ev({
      tipo: "resultado",
      id: "toolu_relevo",
      texto: "relevo: sesión nueva corriendo (pid 4242) · traspaso ~/.claude/plans/relevo-20261003-120000.md",
      error: false,
    });
    // Sin `estado` libre: así el chat sigue mostrando la tanda del stream (el transcript es el de las fixtures).
    ev({ tipo: "fin", error: null, ttl: 3600 });
    return;
  }
  if (escena === "plan") {
    // B13: el líder en plan mode terminó de planear y pide salir (ExitPlanMode).
    ev({ tipo: "modo", modo: "plan" });
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "ExitPlanMode", detalle: null } });
    ev({ tipo: "permiso", id: "f-plan", herramienta: "ExitPlanMode", detalle: null, plan: PLAN_FIJO, preguntas: null, tool_use_id: "toolu_f1" });
    return;
  }
  if (escena === "permiso") {
    ev({ tipo: "modo", modo: "default" });
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "Bash", detalle: "npm run build" } });
    ev({ tipo: "permiso", id: "f-bash", herramienta: "Bash", detalle: "npm run build", plan: null, preguntas: null, tool_use_id: "toolu_f2" });
    return;
  }
  if (escena === "preguntas") {
    // AskUserQuestion: dos preguntas, una de varias opciones.
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "AskUserQuestion", detalle: null } });
    ev({ tipo: "permiso", id: "f-preguntas", herramienta: "AskUserQuestion", detalle: null, plan: null, preguntas: PREGUNTAS_FIJAS, tool_use_id: "toolu_f3" });
    return;
  }
  if (escena === "preguntas-dos") {
    // Dos AskUserQuestion a la vez, cuatro preguntas largas cada una: se muestra una sola ("1 de 2").
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "AskUserQuestion", detalle: null } });
    ev({ tipo: "permiso", id: "f-preguntas-a", herramienta: "AskUserQuestion", detalle: null, plan: null, preguntas: tanda("Cómo se organiza el trabajo de la etapa"), tool_use_id: "toolu_f4" });
    ev({ tipo: "permiso", id: "f-preguntas-b", herramienta: "AskUserQuestion", detalle: null, plan: null, preguntas: tanda("Qué se prueba antes de integrar"), tool_use_id: "toolu_f5" });
    return;
  }
  if (escena === "trabajando") {
    ev({ tipo: "aviso", aviso: { clase: "reintento", intento: 2, max: 10, espera_ms: 4000, estado: 529, error: "overloaded" } });
    ev({ tipo: "tokens", salida: 1280, nuevo: true });
    // Los pasos de atrás de la tarjeta (src/hilo/Actividad.tsx): cinco, así se ve el "+N pasos".
    for (const [nombre, detalle, extra] of [
      ["Read", "src/barra/Barra.tsx", undefined],
      ["Grep", "cauce", "src"],
      ["Edit", "src/barra/cauce.ts", undefined],
      ["Edit", "tests/cauce.test.ts", undefined],
      ["WebFetch", "https://developer.mozilla.org/es/docs/Web/API", undefined],
    ] as const)
      ev({ tipo: "hace", hace: { que: "herramienta", nombre, detalle, ...(extra ? { extra } : {}) } });
    ev({ tipo: "hace", hace: { que: "herramienta", nombre: "Bash", detalle: "npm test -- --reporter dot" } });
    return;
  }
  const limite = "You've hit your session limit · resets 7pm";
  ev({ tipo: "aviso", aviso: { clase: "compacto", auto: true, antes: 167_000 } });
  ev({ tipo: "aviso", aviso: { clase: "limite", rechazado: false, ventana: "seven_day", hasta: ahora + 3 * 86_400, uso: 0.82 } });
  ev({ tipo: "aviso", aviso: { clase: "limite", rechazado: true, ventana: "five_hour", hasta: ahora + 2 * 3600 + 14 * 60, uso: 1 } });
  ev({ tipo: "aviso", aviso: { clase: "error", texto: limite, codigo: "rate_limit" } });
  ev({ tipo: "fin", error: limite, ttl: null });
  ev({ tipo: "salio", codigo: 1, error: "Error: socket hang up" });
  ev({ tipo: "estado", ocupado: false, vivo: false });
}

const PREGUNTAS_FIJAS = [
  {
    question: "¿Dónde corre el chequeo de salud?",
    header: "Dónde",
    multiSelect: false,
    options: [
      { label: "En el main (Recommended)", description: "Un proceso de fondo por integración, con tope de 30 min." },
      { label: "En un worker", description: "Lo lanza pa; más aislado, pero tarda en arrancar." },
    ],
  },
  {
    question: "¿Qué se muestra en la fila?",
    header: "Fila",
    multiSelect: true,
    options: [
      { label: "Punto rojo", description: "Sólo si falló." },
      { label: "Badge auto", description: "Si la integró la app sola." },
      { label: "Hora", description: "Cuándo se chequeó por última vez." },
    ],
  },
];

/** Una tanda de cuatro preguntas largas (la captura `lider-preguntas-dos`): no entra en la pantalla. */
const tanda = (tema: string) =>
  ["Alcance", "Orden", "Riesgo", "Cierre"].map((header, i) => ({
    question: `${tema}: ¿cómo preferís resolver el punto ${i + 1}, sabiendo que cambiarlo después obliga a rehacer parte del trabajo ya integrado?`,
    header,
    multiSelect: i % 2 === 1,
    options: [
      { label: `Hacerlo ahora (${header})`, description: "Se resuelve en esta etapa, con su prueba, antes de seguir con lo demás; tarda más pero no deja deuda." },
      { label: "Dejarlo para la etapa siguiente", description: "Se anota como pendiente y se retoma después de integrar; es más rápido pero queda una costura a la vista." },
      { label: "Resolverlo a medias", description: "Sólo lo imprescindible hoy y el resto después, con el riesgo de que se olvide." },
    ],
  }));

const PLAN_FIJO = `# Settle en lote

## Qué cambia
- Un botón **Settle all** en el encabezado de cada carpeta.
- Archiva los workers terminados; los que tienen rama piden segundo clic.

## Pasos
1. \`src/barra/Barra.tsx\`: el botón y su confirmación en línea.
2. \`electron/settle.ts\`: la regla, una sola vez por hilo.
3. Tests: \`tests/settle.test.ts\`.`;

/** Los slash commands de una sesión inventada (con fixtures). */
const COMANDOS_FIJOS: ComandoClaude[] = [
  { nombre: "review", descripcion: "Review a pull request", args: null },
  { nombre: "init", descripcion: "Initialize a new CLAUDE.md file with codebase documentation", args: null },
  { nombre: "context", descripcion: "Visualize current context usage as a colored grid", args: null },
  { nombre: "cost", descripcion: "Show the total cost and duration of the current session", args: null },
  { nombre: "pr-comments", descripcion: "Get comments from a GitHub pull request", args: null },
  { nombre: "security-review", descripcion: "Complete a security review of the pending changes on the current branch", args: null },
  { nombre: "design", descripcion: "Open Claude Design access and settings", args: null },
  // Los de `agy` (con `agy: true`): una skill compartida con Claude (sin marca) y una sólo de Google.
  { nombre: "security-review", descripcion: "Complete a security review of the pending changes on the current branch", args: null, agy: true },
  { nombre: "review", descripcion: "Review a pull request", args: null, agy: true },
  { nombre: "brainstorm", descripcion: "Explore options with Gemini before deciding", args: null, agy: true },
];

const fija: Fuente = {
  async subagentes() {
    return subagentesFijos();
  },
  alCambiarSubagentes(fn) {
    oyentesSubagentes.add(fn);
    return () => void oyentesSubagentes.delete(fn);
  },
  async subagenteInforme(sid, id) {
    const u = subagentesFijos()[sid]?.find((x) => x.id === id);
    return u?.resultado ? `${u.resultado}\n\nEl informe entero sigue acá: cada canal con el archivo donde se registra y el test que le falta.` : null;
  },
  async compactando() {
    return compactandoFijo;
  },
  alCambiarCompactando(fn) {
    oyentesCompactando.add(fn);
    return () => void oyentesCompactando.delete(fn);
  },
  async salir(x) {
    return (await main?.salir(x)) ?? 0;
  },
  alPedirSalida() {
    return () => {};
  },
  textosBandeja() {},
  async maquinas() {
    return maquinasDeCaptura();
  },
  alCambiarMaquinas() {
    return () => {};
  },
  async reinicio() {
    return reinicioFijo;
  },
  alCambiarReinicio(fn) {
    oyentesReinicio.add(fn);
    return () => void oyentesReinicio.delete(fn);
  },
  pedirReinicio() {
    if (reinicioFijo.hay) ponerReinicioFijo({ ...reinicioFijo, pedido: true, tareas: 2, espera: ["ana-ab"] });
  },
  cancelarReinicio() {
    if (reinicioFijo.hay) ponerReinicioFijo({ ...reinicioFijo, pedido: false, tareas: 0, espera: [], colgado: false });
  },
  async pc() {
    return pcFija;
  },
  alCambiarPc(fn) {
    oyentesPc.add(fn);
    return () => void oyentesPc.delete(fn);
  },
  prenderPc() {
    if (pcFija?.estado === "apagada") {
      pcFija = { ...pcFija, estado: "prendiendo", error: null };
      oyentesPc.forEach((f) => f(pcFija));
    }
  },
  async avisoClaude() {
    return avisoFijo;
  },
  alCambiarAvisoClaude(fn) {
    oyentesAviso.add(fn);
    return () => void oyentesAviso.delete(fn);
  },
  descartarAvisoClaude() {
    avisoFijo = null;
    oyentesAviso.forEach((f) => f(null));
  },
  abrirChangelog() {},
  async actualizarClaude() {
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, version: avisoFijo?.ultima ?? "2.1.300", abiertos: 2 };
  },
  avisoAgy: sinAvisoAgy,
  // Con fixtures sólo sale en la captura `setup` (las demás quedan como estaban).
  async faltasSetup() {
    return MODO.captura === "setup" || MODO.captura === "setup-abierto" ? SETUP_FIJO : [];
  },
  descartarSetup() {},
  // Con fixtures: Claude conectado, Gemini sin conectar (la captura `cuentas` de Ajustes).
  async cuentas() {
    return {
      claude: { instalado: true, logueado: true, cuenta: "ana@ejemplo.org", error: null },
      agy: MODO.variante === "cuentas-error" ? { instalado: true, logueado: false, cuenta: null, error: "sin conexión con el servicio de Google" } : { instalado: true, logueado: (MODO.variante ?? "").startsWith("cupos"), cuenta: null, error: null },
      // Codex sin instalar: la tarjeta ChatGPT de Plan y cupos explica cómo conectarlo.
      codex: { instalado: false, logueado: false, cuenta: null, error: null },
    };
  },
  ...cuentasFijas(),
  ...extensionesFijas(),
  alCambiarAvisoAgy: () => () => {},
  descartarAvisoAgy() {},
  async actualizarAgy() {
    return { ok: true, version: "1.4.3", abiertos: 0 };
  },
  async reiniciarLideres() {
    return { reiniciados: 2, ocupados: 0 };
  },
  async hilosGuardados() {
    return null;
  },
  async hilos() {
    return MODO.captura === "terminados"
      ? HILOS_TERMINADOS
      : MODO.captura === "worker-en-cola"
        ? HILOS_EN_COLA
        : filasDelDell()
          ? { ...HILOS, hilos: [...HILOS.hilos, ...HILOS_DELL] }
          : HILOS;
  },
  alCambiarHilos() {
    return () => {};
  },
  async lideres() {
    return lideresFijos();
  },
  alCambiarLideres(fn) {
    oyentesLideres.add(fn);
    return () => void oyentesLideres.delete(fn);
  },
  alEvento() {
    return () => {};
  },
  alEventoPa(fn) {
    // Capturas: lo que `pa` dijo antes de que la lista (~11 s) lo trajera. Las horas son de la hora de ahora (quieta en las comparadas).
    const ahora = Math.floor(Date.now() / 1000);
    if (MODO.captura === "arrancando") setTimeout(() => fn([{ tipo: "inicio", ...ARRANCANDO, ts: ahora - 4 }]), 0);
    if (MODO.captura === "frenado") setTimeout(() => fn([{ tipo: "parar", ...FRENADO, ts: ahora - 95 }]), 0);
    return () => {};
  },
  async conversacion(h, antes) {
    // La captura `leyendo`: la lectura del transcript no termina nunca, para ver lo que se muestra mientras dura.
    if (MODO.captura === "leyendo") return new Promise<RespuestaHilo>(() => {});
    // Recién lanzado: todavía no hay transcript que leer.
    if (h.id === ARRANCANDO.id || h.id === EN_COLA.id) return { version: 1, id: h.id, proyecto: h.proyecto, transcript: null, total: 0, desde: 0, hasta: 0, mensajes: [], usage: null, modelo: null };
    return MODO.captura === "sistema" ? conversacionSistema(h) : conversacion(h, antes, 50, MODO.captura === "herramientas-resultados");
  },
  async parar() {
    await espera(300);
  },
  async iconos() {
    return ICONOS;
  },
  async titulos() {
    return TITULOS;
  },
  async cerrar(h) {
    await espera(350);
    if (fallaCerrar) throw new Error(comoSettle(h) === "integrar" ? "red tests: 2 fail in the integration" : "pa --archivar failed");
  },
  async uso() {
    return usoFixture();
  },
  alCambiarUso() {
    return () => {};
  },
  async releerUso() {
    return usoFixture();
  },
  async leidos() {
    return leidosFijos;
  },
  marcarLeido(id, ts) {
    leidosFijos[id] = ts;
  },
  async nombres() {
    return nombresFijos;
  },
  guardarTitulo(id, titulo) {
    const t = titulo.replace(/\s+/g, " ").trim();
    if (t) nombresFijos.titulos[id] = t;
    else delete nombresFijos.titulos[id];
  },
  guardarProyecto(sid, slug) {
    if (slug) nombresFijos.proyectos[sid] = slug;
    else delete nombresFijos.proyectos[sid];
  },
  guardarOculto(slug, si) {
    nombresFijos.ocultos = nombresFijos.ocultos.filter((x) => x !== slug).concat(si ? [slug] : []);
  },
  guardarOrden(orden) {
    nombresFijos.orden = orden;
  },
  alCambiarOrden() {
    return () => {};
  },
  async carpetas() {
    // Los de los hilos y otros del registry inventado: la lista de "Mover a proyecto…" larga, con su buscador.
    const otros = ["boceto", "campo", "delta", "ensayo", "faro", "grano", "huerta", "isla"];
    return [...new Set([...HILOS.hilos.map((h) => h.proyecto), ...otros])].sort();
  },
  async slugsPorNombre() {
    return Object.fromEntries(HILOS.hilos.filter((h) => h.proyecto !== GENERAL).map((h) => [h.proyecto, h.proyecto]));
  },
  async effortsPorModelo() {
    return effortsFijos;
  },
  guardarEffort(modelo, effort) {
    effortsFijos[modelo] = effort;
  },
  guardarIdioma() {},
  guardarApariencia() {},
  guardarTiernos() {},
  guardarAvisarEspera() {},
  guardarVista() {},
  guardarConsumo() {},
  async bienvenidaPendiente() {
    return false;
  },
  guardarBienvenida() {},
  async consumoMirar(pedido) {
    return consumoFijo(pedido);
  },
  consumoSoltar() {},
  alCambiarConsumo() {
    return () => {};
  },
  async pasosMirar(id) {
    // Sólo las capturas de la vista de worker traen pasos; las demás ven la conversación de siempre.
    if (MODO.captura === "worker-vista") return pasosFijos(id, false, MODO.variante === "largo");
    if (MODO.captura === "worker-vista-vivo") return pasosFijos(id, true);
    return vistaDe({ id, hay: false });
  },
  pasosSoltar() {},
  alCambiarPasos() {
    return () => {};
  },
  async liderNuevo(x) {
    await espera(150);
    const sid = `00000000-0000-4000-8000-${String(++creados).padStart(12, "0")}`;
    charlas.set(sid, []);
    responderFijo(sid, x.texto, x.modelo, x.imagenes);
    return sid;
  },
  async liderMandar(sid, x) {
    if (fallaLanzar) throw new Error("claude: could not resume the session");
    responderFijo(sid, x.texto, x.modelo, x.imagenes);
  },
  async liderArchivo(nombre) {
    return `/tmp/trama-adjuntos/${nombre}`;
  },
  async liderParar() {},
  async dictar() {
    return "texto dictado de muestra";
  },
  async dictadoModelos() {
    return dictadoFijo;
  },
  async elegirDictadoModelo(id) {
    dictadoFijo = { ...dictadoFijo, elegido: id };
    return dictadoFijo;
  },
  async locales() {
    return localesFalsos();
  },
  async guardarLocal(id, ctx) {
    localesFalsos(id, ctx);
    return localesFalsos();
  },
  async probarLocal(id, ctx) {
    // Nunca carga nada: dice que entra si cabe en la cuenta de las fixtures.
    const l = localesFalsos().modelos.find((m) => m.id === id);
    const entra = !!l?.est && ctx <= l.est.maxCtx;
    if (entra) localesFalsos(id, ctx);
    return entra
      ? { ok: true, nCtx: ctx, usadoMiB: 22400, total: 24576, error: null }
      : { ok: false, nCtx: null, usadoMiB: null, total: null, error: "\u0001i18n:main.localNoCargo\u0001{\"motivo\":\"out of memory\"}\u0001" };
  },
  async vram() {
    return vramFalsa();
  },
  async liberarVram(id) {
    // Nunca libera nada de verdad: quita al servicio de la lista de muestra.
    return vramLiberarFalso(id);
  },
  async liderModo(sid, modo) {
    emitir(sid, { tipo: "modo", modo });
  },
  async liderPermiso(sid, id, ok) {
    emitir(sid, { tipo: "permisoFuera", id });
    if (id === "f-preguntas" || id === "f-preguntas-b") emitir(sid, { tipo: "estado", ocupado: false, vivo: true });
    if (ok && id === "f-plan") emitir(sid, { tipo: "modo", modo: "bypassPermissions" });
  },
  async liderPendientes() {
    return [];
  },
  async liderComandos() {
    return COMANDOS_FIJOS;
  },
  async liderEstilos() {
    return { actual: "default", lista: ["default", "Explanatory", "Learning", "Concise"] };
  },
  async liderEstilo(sid, estilo) {
    emitir(sid, { tipo: "estilos", actual: estilo, lista: null });
    return "vivo" as const;
  },
  async umbralContexto() {
    return { autoCompact: 200_000 };
  },
  async liderCerrar() {},
  async liderRetomar(sid, x) {
    // `HILOS_VARIANTE=no`: la conversación ya no está en disco.
    if (MODO.variante === "no") return { ok: false, motivo: "sinSesion" };
    retomados.set(sid, x.modelo);
    const r = lideresFijos();
    oyentesLideres.forEach((f) => f(r));
    return { ok: true };
  },
  async liderConversacion(sid, antes) {
    if (MODO.captura === "leyendo") return new Promise<RespuestaHilo>(() => {});
    const c = charla(sid);
    const hasta = Math.min(c.length, antes ?? c.length);
    // La conversación larga llega entera: lo que se mide es pintarla, no paginarla.
    const desde = Math.max(0, hasta - (MODO.variante === "larga" && MODO.captura === "lider-formato" ? c.length : 50));
    return {
      version: 1,
      id: sid,
      proyecto: "",
      transcript: "/inventado.jsonl",
      total: c.length,
      desde,
      hasta,
      mensajes: c.slice(desde, hasta),
      usage: usoFijo(sid),
      modelo: null,
      compactaciones: MODO.captura === "contexto-abierto" ? 2 : 0,
    };
  },
  liderMirar() {},
  liderVisto() {},
  esperaEstado() {},
  esperaNotificar() {},
  alAbrirEspera() {
    return () => {};
  },
  async liderTraer(sid, x) {
    // `HILOS_VARIANTE=trabajando`: está a mitad de algo y hay que confirmar el corte.
    if (MODO.variante === "trabajando" && !x.cortar) return { ok: false, motivo: "trabajando" };
    traidos.add(sid);
    const r = lideresFijos();
    oyentesLideres.forEach((f) => f(r));
    return { ok: true };
  },
  async liderIr() {
    return true;
  },
  // `HILOS_VARIANTE=sin-ventana`: no se la pudo ubicar, no hay botón.
  async liderUbicable() {
    return MODO.variante !== "sin-ventana";
  },
  async liderEncolar(sid, x) {
    colaFija().encolar(sid, x);
  },
  liderColaQuitar(sid, id) {
    colaFija().quitar(sid, id);
  },
  liderColaYa(sid, cortar) {
    void colaFija().ya(sid, cortar);
  },
  async liderColas() {
    return colaFija().todas();
  },
  alColaLider(fn) {
    oyentesCola.add(fn);
    return () => void oyentesCola.delete(fn);
  },
  alEventoLider(fn) {
    oyentesLider.add(fn);
    return () => void oyentesLider.delete(fn);
  },
  alTranscript() {
    return () => {};
  },
};

// --- Con `pa` ------------------------------------------------------------------

/** La última corrida aceptada y, por id, la fila que se le dio a la UI con su JSON. */
let ultima: Lectura | null = null;
let respuesta: RespuestaHilos | null = null;
let filas = new Map<string, { json: string; h: Hilo }>();

/** `pa --hilos` trae la tarea casi siempre (del transcript); la de las pocas corridas que no, no se adivina. */

/**
 * Lo que vino del main, como respuesta para la UI. Las filas que no cambiaron
 * conservan su objeto: `Fila` es `memo` y no vuelve a renderizar.
 */
function armar(datos: unknown): RespuestaHilos {
  const d = datos as { version?: unknown; hilos?: unknown };
  if (typeof d?.version !== "number") throw new Error(t("error.sinVersion"));
  if (!Array.isArray(d.hilos)) return { version: d.version, hilos: [] };
  const nuevas = new Map<string, { json: string; h: Hilo }>();
  const hilos = (d.hilos as Hilo[]).map((h) => {
    const json = JSON.stringify(h);
    const viejo = filas.get(h.id);
    const f = viejo && viejo.json === json ? viejo : { json, h: h.tarea ? h : { ...h, tarea: "" } };
    nuevas.set(h.id, f);
    return f.h;
  });
  filas = nuevas;
  return { version: d.version, hilos };
}

/** El número de la lectura entera a la que corresponden `filas` (más las diferencias aplicadas): una diferencia cierra si parte de ahí. */
let baseN: number | null = null;

/** La fila de un hilo que llegó: con `tarea` siempre y su JSON para compararla en la próxima lista entera. */
const filaDe = (h: Hilo) => ({ json: JSON.stringify(h), h: h.tarea ? h : { ...h, tarea: "" } });

/** Se queda con la lectura si es más nueva que la que había. */
function aceptar(l: Lectura): boolean {
  if (ultima && l.n <= ultima.n) return false;
  // Si `armar` tira (versión desconocida, JSON raro), no queda aceptada: la próxima vuelve a leer.
  const r = "datos" in l ? armar(l.datos) : null;
  ultima = l;
  respuesta = r;
  baseN = r ? l.n : null;
  return true;
}

/**
 * Aplica lo que cambió contra la lista que se tiene. `true`: quedó aplicada; `false`: era vieja, se ignora;
 * `null`: no cierra con esta lista (se perdió una) y hay que pedir la entera.
 */
function aceptarDif(l: { n: number; dif: Parameters<typeof aplicarDif>[1] }): boolean | null {
  if (ultima && l.n <= ultima.n) return false;
  if (baseN === null || l.dif.base !== baseN || !respuesta) return null;
  const nuevas = aplicarDif(filas, l.dif, (h) => filaDe(h as Hilo));
  if (!nuevas) return null;
  filas = nuevas;
  respuesta = { version: respuesta.version, hilos: [...nuevas.values()].map((f) => f.h) };
  ultima = { n: l.n, datos: null };
  baseN = l.n;
  return true;
}

let statusline: Promise<Statusline> | null = null;
const leerStatusline = () => (statusline ??= main!.statusline.leer());

const conPa = (m: NonNullable<typeof main>): Fuente => ({
  async subagentes() {
    return subagentesDe(await m.subagentes.leer().catch(() => null));
  },
  alCambiarSubagentes(fn) {
    return m.subagentes.alCambiar((s) => fn(subagentesDe(s)));
  },
  subagenteInforme(sid, id) {
    return m.subagentes.informe(sid, id).catch(() => null);
  },
  async compactando() {
    return compactandoDe(await m.compactando.leer().catch(() => null));
  },
  alCambiarCompactando(fn) {
    return m.compactando.alCambiar((c) => fn(compactandoDe(c)));
  },
  async salir(x) {
    return m.salir(x).catch(() => 0);
  },
  alPedirSalida(fn) {
    return m.bandeja?.alPedirSalida(fn) ?? (() => {});
  },
  textosBandeja(t) {
    void m.bandeja?.textos(t).catch(() => {});
  },
  async maquinas() {
    return maquinasValidas(await m.maquinas.leer().catch(() => null));
  },
  alCambiarMaquinas(fn) {
    return m.maquinas.alCambiar((e) => fn(maquinasValidas(e)));
  },
  async reinicio() {
    return reinicioValido(await m.reinicio.leer().catch(() => null));
  },
  alCambiarReinicio(fn) {
    return m.reinicio.alCambiar((r) => fn(reinicioValido(r)));
  },
  pedirReinicio(igual) {
    void m.reinicio.pedir(igual === true).catch(() => {});
  },
  cancelarReinicio() {
    void m.reinicio.cancelar().catch(() => {});
  },
  async pc() {
    return pcValida(await m.pc.leer().catch(() => null));
  },
  alCambiarPc(fn) {
    return m.pc.alCambiar((e) => fn(pcValida(e)));
  },
  prenderPc() {
    void m.pc.prender().catch(() => {});
  },
  async avisoClaude() {
    return avisoValido(await m.claude.version().catch(() => null));
  },
  alCambiarAvisoClaude(fn) {
    return m.claude.alCambiar((a) => fn(avisoValido(a)));
  },
  descartarAvisoClaude() {
    void m.claude.descartar().catch(() => {});
  },
  abrirChangelog() {
    void m.claude.changelog().catch(() => {});
  },
  async actualizarClaude() {
    const r = (await m.claude.actualizar().catch((e) => ({ ok: false, error: mensaje(e) }))) as Record<string, unknown> | null;
    const abiertos = typeof r?.abiertos === "number" ? r.abiertos : 0;
    if (r?.ok === true && typeof r.version === "string") return { ok: true, version: r.version, abiertos };
    return { ok: false, error: typeof r?.error === "string" && r.error ? r.error : "?", abiertos };
  },
  async avisoAgy() {
    return avisoValido(await m.agy.version().catch(() => null));
  },
  async faltasSetup() {
    return faltasValidas(await m.setup.estado().catch(() => null));
  },
  descartarSetup(id) {
    void m.setup.descartar(id).catch(() => {});
  },
  async cuentas() {
    return cuentasValidas(await m.cuentas.estado().catch(() => null));
  },
  async listaCuentas(verificar) {
    return listaValida(await m.cuentas.lista(verificar).catch(() => null));
  },
  async agregarCuenta(proveedor, nombre) {
    return resultadoValido(await m.cuentas.agregar(proveedor, nombre).catch(() => null));
  },
  async renombrarCuenta(id, nombre) {
    return resultadoValido(await m.cuentas.renombrar(id, nombre).catch(() => null));
  },
  async quitarCuenta(id, borrar) {
    return resultadoValido(await m.cuentas.quitar(id, borrar).catch(() => null));
  },
  async loginCuenta(id) {
    return resultadoValido(await m.cuentas.login(id).catch(() => null));
  },
  async extensiones(cuenta) {
    return extensionesValidas(await m.extensiones.leer(cuenta).catch(() => null));
  },
  async importarExtensiones(cuenta) {
    return importarValido(await m.extensiones.importar(cuenta).catch(() => null));
  },
  alCambiarAvisoAgy(fn) {
    return m.agy.alCambiar((a) => fn(avisoValido(a)));
  },
  descartarAvisoAgy() {
    void m.agy.descartar().catch(() => {});
  },
  async actualizarAgy() {
    const r = (await m.agy.actualizar().catch((e) => ({ ok: false, error: mensaje(e) }))) as Record<string, unknown> | null;
    if (r?.ok === true && typeof r.version === "string") return { ok: true, version: r.version, abiertos: 0 };
    // El error puede venir como clave de `main.*` (electron/errores.ts): se traduce acá, antes de que el globito lo corte.
    return { ok: false, error: typeof r?.error === "string" && r.error ? textoMain(r.error) : "?", abiertos: 0 };
  },
  async reiniciarLideres() {
    const r = (await m.claude.reiniciar().catch(() => null)) as { reiniciados?: unknown; ocupados?: unknown } | null;
    const n = (x: unknown) => (typeof x === "number" ? x : 0);
    return { reiniciados: n(r?.reiniciados), ocupados: n(r?.ocupados) };
  },
  async hilosGuardados() {
    const d = await m.hilos.guardados().catch(() => null);
    if (!d || ultima) return null;
    try {
      return armar(d);
    } catch {
      return null;
    }
  },
  async hilos() {
    if (!ultima) aceptar(await m.hilos.leer());
    if (ultima && "error" in ultima) throw new Error(ultima.error);
    if (!respuesta) throw new Error(t("error.sinVersion"));
    return respuesta;
  },
  alCambiarHilos(fn) {
    let pidiendo = false;
    let otraVez = false;
    // No cierra con la lista de acá: se pide la entera. Si llega otra diferencia mientras tanto, se pide de nuevo al volver.
    const pedir = () => {
      if (pidiendo) return void (otraVez = true);
      pidiendo = true;
      otraVez = false;
      void m.hilos
        .completa()
        .then((c) => aceptar(c) && fn())
        .catch(() => {})
        .finally(() => {
          pidiendo = false;
          if (otraVez) pedir();
        });
    };
    return m.hilos.alCambiar((l) => {
      if (!esDif(l)) return void (aceptar(l) && fn());
      const r = aceptarDif(l);
      if (r) fn();
      else if (r === null) pedir();
    });
  },
  async lideres() {
    return (await leerStatusline()).lideres;
  },
  alCambiarLideres(fn) {
    return m.statusline.alCambiar((s) => fn(s.lideres));
  },
  alEvento(fn) {
    return m.hilos.alEvento(fn);
  },
  alEventoPa(fn) {
    return m.hilos.alEventoPa((x) => {
      const es = (Array.isArray(x) ? x : []).filter(
        (e): e is EventoPa => typeof e?.tipo === "string" && typeof e.id === "string" && typeof e.proyecto === "string" && typeof e.ts === "number",
      );
      if (es.length) fn(es);
    });
  },
  async conversacion(h, antes) {
    // `pa` nombra distinto los campos del transcript: a la forma de `Mensaje` (src/datos/paHilo.ts).
    return hiloDePa(
      await m.pa.hilo({ id: h.id, n: 50, antes }).catch((e) => {
        throw new Error(mensaje(e));
      }),
    );
  },
  async parar(h) {
    await m.pa.parar(h.id).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async iconos() {
    return m.iconos().catch(() => ({}));
  },
  async titulos() {
    const j = await m.titulos().catch(() => null);
    return j && typeof j === "object" ? Object.fromEntries(Object.entries(j).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
  },
  async cerrar(h) {
    await m.pa.cerrar({ id: h.id, proyecto: h.proyecto, rama: h.rama, origen: h.origen }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async uso() {
    return (await leerStatusline()).uso;
  },
  alCambiarUso(fn) {
    return m.statusline.alCambiar((s) => fn(s.uso));
  },
  async releerUso() {
    const nueva = m.statusline.sincronizar();
    const s = await nueva;
    statusline = nueva;
    return s.uso;
  },
  async leidos() {
    return m.leidos.leer().catch(() => ({}));
  },
  marcarLeido(id, ts) {
    void m.leidos.marcar(id, ts).catch(() => {});
  },
  async nombres() {
    const j = (await m.nombres.leer().catch(() => null)) as Partial<Nombres> | null;
    const mapa = (x: unknown) =>
      x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    return {
      titulos: mapa(j?.titulos),
      proyectos: mapa(j?.proyectos),
      ocultos: Array.isArray(j?.ocultos) ? j.ocultos.filter((x): x is string => typeof x === "string") : [],
      orden: ordenDe(j?.orden),
    };
  },
  guardarTitulo(id, titulo) {
    void m.nombres.titulo(id, titulo).catch(() => {});
  },
  guardarProyecto(sid, slug) {
    void m.nombres.proyecto(sid, slug).catch(() => {});
  },
  guardarOculto(slug, si) {
    void m.nombres.oculto(slug, si).catch(() => {});
  },
  guardarOrden(orden) {
    void m.nombres.orden(orden).catch(() => {});
  },
  alCambiarOrden(fn) {
    return m.nombres.alOrden((o) => fn(ordenDe(o)));
  },
  async carpetas() {
    const j = await m.carpetas().catch(() => []);
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string").sort() : [];
  },
  async slugsPorNombre() {
    const j = await m.slugsPorNombre().catch(() => null);
    return j && typeof j === "object" ? Object.fromEntries(Object.entries(j).filter((x): x is [string, string] => typeof x[1] === "string")) : {};
  },
  async effortsPorModelo() {
    return m.preferencias
      .leer()
      .then((p) => ({ ...p.effort }))
      .catch(() => ({}));
  },
  guardarEffort(modelo, effort) {
    void m.preferencias.effort(modelo, effort).catch(() => {});
  },
  guardarIdioma(idioma) {
    void m.preferencias.idioma(idioma).catch(() => {});
  },
  guardarApariencia(a) {
    void m.preferencias.apariencia(a).catch(() => {});
  },
  guardarTiernos(si) {
    void m.preferencias.tiernos(si).catch(() => {});
  },
  guardarAvisarEspera(si) {
    void m.preferencias.avisarEspera(si).catch(() => {});
  },
  guardarVista(vista) {
    void m.preferencias.vista(vista).catch(() => {});
  },
  guardarConsumo(si) {
    void m.preferencias.consumo(si).catch(() => {});
  },
  bienvenidaPendiente() {
    return m.preferencias.bienvenidaPendiente().catch(() => false);
  },
  guardarBienvenida(si) {
    void m.preferencias.bienvenida(si).catch(() => {});
  },
  async consumoMirar(pedido) {
    return consumoDe(await m.consumo.mirar(pedido));
  },
  consumoSoltar() {
    void m.consumo.soltar().catch(() => {});
  },
  alCambiarConsumo(fn) {
    return m.consumo.alCambiar((c) => fn(consumoDe(c)));
  },
  async pasosMirar(id) {
    return vistaDe(await m.pasos.mirar(id));
  },
  pasosSoltar() {
    void m.pasos.soltar().catch(() => {});
  },
  alCambiarPasos(fn) {
    return m.pasos.alCambiar((c) => {
      const x = cambioDe(c);
      if (x) fn(x);
    });
  },
  async liderNuevo(x) {
    return m.lider.nuevo(x).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async liderMandar(sid, x) {
    await m.lider.mandar({ sid, ...x }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  liderArchivo(nombre, datos, maquina) {
    return m.lider.archivo({ nombre, datos, ...(maquina ? { maquina } : {}) }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async liderParar(sid) {
    await m.lider.parar(sid).catch(() => {});
  },
  locales() {
    return m.locales.leer().catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  guardarLocal(id, ctx) {
    return m.locales.guardar({ id, ctx }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  probarLocal(id, ctx) {
    return m.locales.probar({ id, ctx }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  vram() {
    return m.vram.leer().catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  liberarVram(id) {
    return m.vram.liberar({ id }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  dictar(datos) {
    return m.dictado.transcribir({ datos }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  dictadoModelos() {
    return m.dictado.modelos().then(comoModelosDictado, (e) => {
      throw new Error(mensaje(e));
    });
  },
  elegirDictadoModelo(id) {
    return m.dictado.elegirModelo(id).then(comoModelosDictado, (e) => {
      throw new Error(mensaje(e));
    });
  },
  async liderModo(sid, modo) {
    await m.lider.modo({ sid, modo }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async liderPermiso(sid, id, ok, msj, respuestas) {
    await m.lider.permiso({ sid, id, ok, mensaje: msj, respuestas }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async liderPendientes(sid) {
    const l = await m.lider.pendientes(sid).catch(() => []);
    return Array.isArray(l) ? (l as Extract<EventoLider, { tipo: "permiso" }>[]).filter((p) => p?.tipo === "permiso" && typeof p.id === "string") : [];
  },
  async liderComandos() {
    const l = await m.lider.comandos().catch(() => []);
    return Array.isArray(l) ? (l as ComandoClaude[]).filter((c) => typeof c?.nombre === "string") : [];
  },
  async liderEstilos() {
    const e = (await m.lider.estilos().catch(() => null)) as { actual?: unknown; lista?: unknown } | null;
    return {
      actual: typeof e?.actual === "string" ? e.actual : null,
      lista: Array.isArray(e?.lista) ? e.lista.filter((x): x is string => typeof x === "string") : [],
    };
  },
  async liderEstilo(sid, estilo) {
    const r = await m.lider.estilo({ sid, estilo }).catch((e) => {
      throw new Error(mensaje(e));
    });
    return r === "pendiente" ? "pendiente" : "vivo";
  },
  async umbralContexto() {
    const u = (await m.paneles.umbralContexto().catch(() => null)) as { autoCompact?: unknown } | null;
    const n = (x: unknown) => (typeof x === "number" && x > 0 ? x : null);
    return { autoCompact: n(u?.autoCompact) };
  },
  async liderCerrar(sid, motivo) {
    await m.lider.cerrar(sid, motivo).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  async liderRetomar(sid, x) {
    return retomadoDe(
      await m.lider.retomar({ sid, ...x }).catch((e) => {
        throw new Error(mensaje(e));
      }),
    );
  },
  async liderConversacion(sid, antes) {
    return (await m.lider.conversacion({ sid, antes }).catch((e) => {
      throw new Error(mensaje(e));
    })) as RespuestaHilo;
  },
  liderMirar(sid) {
    void m.lider.mirar(sid).catch(() => {});
  },
  liderVisto(sid) {
    void m.lider.visto(sid).catch(() => {});
  },
  esperaEstado(x) {
    void m.espera?.estado(x).catch(() => {});
  },
  esperaNotificar(x) {
    void m.espera?.notificar(x).catch(() => {});
  },
  alAbrirEspera(fn) {
    return m.espera?.alAbrir(fn) ?? (() => {});
  },
  async liderTraer(sid, x) {
    return traidoDe(
      await m.lider.traer({ sid, ...x }).catch((e) => {
        throw new Error(mensaje(e));
      }),
    );
  },
  liderIr(pid) {
    return m.lider.ir(pid).catch(() => false);
  },
  liderUbicable(pid) {
    return m.lider.ubicable(pid).catch(() => false);
  },
  async liderEncolar(sid, x) {
    await m.lider.encolar({ sid, ...x }).catch((e) => {
      throw new Error(mensaje(e));
    });
  },
  liderColaQuitar(sid, id) {
    void m.lider.colaQuitar({ sid, id }).catch(() => {});
  },
  liderColaYa(sid, cortar) {
    void m.lider.colaYa({ sid, cortar }).catch(() => {});
  },
  async liderColas() {
    const r = await m.lider.colas().catch(() => []);
    return (Array.isArray(r) ? r : []).flatMap((x) => avisoCola(x) ?? []);
  },
  alColaLider(fn) {
    return m.lider.alCola((x) => {
      const a = avisoCola(x);
      if (a) fn(a);
    });
  },
  alEventoLider(fn) {
    return m.lider.alEvento(({ sid, e }) => fn(sid, e));
  },
  alTranscript(fn) {
    return m.lider.alTranscript(fn);
  },
});

export const fuente: Fuente = MODO.fixtures || !main ? fija : conPa(main);
