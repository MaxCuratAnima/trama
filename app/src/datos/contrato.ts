// Forma de los JSON del contrato con `pa` (ver CLAUDE.md). Todo trae
// `version`: si no es la conocida se muestra el error, no se adivina.

export const VERSION = 1;

export type { ArchivoTocado, Cambio, CambioPasos, Cortado, Detalle, Encabezado, EstadoPaso, Paso, TipoPaso, VistaPasos } from "./pasos";

export type Estado =
  | "trabajando"
  | "colgado"
  | "listo"
  | "decision"
  | "entregado"
  | "archivado"
  | "integrado"
  | "descartado"
  | "revertido"
  | "murio";

export type CacheFrio = null | "modelo" | "otro_dir" | "vencido";

/** "1", "2", … (cuántos hay lo decide `PA_PUESTOS`) o "aca" (tree principal). */
export type Puesto = string;

/** Una fila de `pa --hilos --json`. Tiempos en epoch (segundos). */
export type Hilo = {
  id: string;
  proyecto: string;
  tarea: string;
  modelo: string;
  effort: string;
  origen: string;
  /** El líder que la lanzó (nombre de su sesión, p. ej. "ana-e4") y su session_id. Sin líder: `null`. */
  jefe?: string | null;
  jefe_id?: string | null;
  /** Id del hilo que retomó (`--seguir`), si retomó uno. */
  sigue_de: string | null;
  estado: Estado;
  en_cola: boolean;
  inicio: number;
  duracion_s: number | null;
  puesto: Puesto | null;
  rama: string | null;
  commits: number;
  decision: string | null;
  /** El worker contestó "DECISION: nada". */
  decision_nada: boolean | null;
  resultado: string | null;
  archivado: boolean | null;
  /** Consulta de sólo lectura (`--leer`). Sin rama no hay nada que cerrar. */
  leer: boolean;
  cache_ttl_s: number | null;
  cache_vence: number | null;
  cache_frio: CacheFrio;
  cache_modelo: string | null;
  /** Lo pone el main, no `pa`: cuándo vio morir la app a este worker (electron/vigia.ts). Sin verlo, no viene. */
  murio_en?: number | null;
  /**
   * Lo pone el main, no `pa`: cuándo lo frenó a propósito `pa --parar` (lo dice el evento `parar`; la lista
   * lo trae como `murio`). Con esto no es un fallo: la barra dice "frenado", sin rojo.
   */
  frenado_en?: number | null;
  /** Lo pone el main (electron/cola-pa.ts): por qué espera un worker en cola ("tope global: 5 workers vivos"). */
  cola_motivo?: string | null;
  /** Lo pone el main: murió en la cola, sin llegar a arrancar (nunca tuvo tarea escrita ni rama). */
  sin_arrancar?: boolean;
  /** Lo arma la app con el evento `inicio`, antes de que la lista lo traiga: sin tarea, líder ni rama todavía. */
  arrancando?: boolean;
  /**
   * Lo pone el main, no `pa`: la máquina donde corre (`maquinas.json`, docs/estado/maquinas.md). Sin
   * venir es la de esta trama: sin otra máquina configurada no viene nunca. Con él, `id` lleva el prefijo
   * `maquina:` (`conMaquina`) para no chocar con un id igual de la otra.
   */
  maquina?: string;
};

/** El id de una fila de otra máquina: `dell:20261014-…` (los de esta máquina van sin prefijo). */
export const conMaquina = (maquina: string | undefined, id: string) => (maquina ? `${maquina}:${id}` : id);
/** Al revés: la máquina (`undefined`, esta) y el id como lo conoce su motor. */
export function sinMaquina(id: string): { maquina: string | undefined; id: string } {
  const i = id.indexOf(":");
  return i < 0 ? { maquina: undefined, id } : { maquina: id.slice(0, i), id: id.slice(i + 1) };
}

/** Una línea de `eventos.jsonl` de `pa` (`inicio`, `fin`, `parar`, …): llega al instante, la lista tarda. */
export type EventoPa = { tipo: string; id: string; proyecto: string; ts: number; jefe_id?: string; jefe?: string | null };

export type RespuestaHilos = { version: number; hilos: Hilo[] };

/**
 * Ventana de uso del plan (`rate_limits.*` del statusline, o el `rate_limit_event` del stream de un líder).
 * `resets_at` `null`: hay porcentaje pero no se sabe cuándo se reinicia.
 */
export type Ventana = { pct: number; resets_at: number | null };

/** Una ventana de cupo de una suscripción (`5h`, `7d`…): `pct` 0..100 (`null`: sin dato) y cuándo vuelve (epoch s, `null`: no se sabe). */
export type VentanaCupo = { id: string; pct: number | null; vuelve: number | null };

/** Un grupo de modelos de una suscripción con sus propias ventanas; `hasta` (YYYY-MM-DD) si el cupo vence en una fecha. */
export type GrupoCupo = { id: string; nombre: string; ventanas: VentanaCupo[]; hasta?: string };

/**
 * Una suscripción conectada que no es Claude (esa sale de `five_hour`/`seven_day`), tal como la dice
 * `reparto --cupos --json`: con `ventanas` propias o repartida en `grupos`. `ts`: cuándo se leyó (epoch s).
 */
export type SuscripcionCupo = {
  id: string;
  nombre: string;
  /** De qué proveedor es (`claude`, `google`, `chatgpt`) y cuál es su cuenta (id); la de siempre tiene el id del proveedor. Falta en un `reparto` viejo. */
  proveedor?: string;
  cuenta?: string;
  ts: number;
  ventanas?: VentanaCupo[];
  grupos?: GrupoCupo[];
};

/**
 * Lo que el main arma con `~/.local/state/pa/statusline/*.json` y con lo que dijo el stream de
 * los líderes de la app (electron/uso.ts). Una ventana en `null`: no se sabe ("sin dato").
 */
export type Uso =
  | {
      version: 1;
      /** Cuándo se vio lo más nuevo que se muestra (0: nada). */
      ts: number;
      five_hour: Ventana | null;
      seven_day: Ventana | null;
      /** Las demás suscripciones conectadas (Google AI Pro, y las que vengan) y las cuentas agregadas de Claude, una fila cada una. */
      suscripciones?: SuscripcionCupo[];
      /** Cómo se llama la cuenta de siempre de Claude, si `reparto` lo dice. */
      claudeNombre?: string;
    }
  | { version: number; error: string };

/**
 * Un líder: una sesión interactiva de Claude Code que sigue viva (su
 * `~/.claude/sessions/<pid>.json` existe y el pid vive), una de la app sin
 * proceso, o una que quedó sin proceso y todavía importa (`caido`). Con ellos
 * habla el usuario; los workers (`pa`) cuelgan del líder que los lanzó (`jefe_id`).
 * Modelo y caché salen de su statusline, si tiene.
 */
export type Lider = {
  /** session_id: el `jefe_id` de sus workers. */
  id: string;
  /**
   * Su título (B20): el de Claude Code (/rename o el nombre de la sesión, salvo el
   * interno "trama-xxxx"), el que generó solo o su primer mensaje. "" si nada.
   */
  nombre: string;
  /**
   * La carpeta donde va: el proyecto de su primer worker o `GENERAL`. El main
   * pone la de su `cwd`; la barra la corrige con los workers (`src/barra/arbol.ts`).
   */
  proyecto: string;
  /** El modelo, lindo ("Opus 5.5"). */
  titulo: string;
  /** Última actividad (epoch). */
  actividad: number;
  /**
   * Cuándo se creó la conversación (epoch): lo primero de su transcript o, sin transcript
   * todavía, el arranque de su sesión. No cambia: de acá sale su lugar en la barra.
   */
  creado: number;
  cache_ttl_s: number | null;
  /** Cuándo vence su caché (epoch s); `null`: no se sabe, y entonces no se muestra nada. */
  cache_vence: number | null;
  /**
   * "app": lo lanzó trama (`claude -p` suyo, se le escribe desde acá). "terminal":
   * abierto en otro lado (kitty, otra trama): se lee nomás.
   */
  origen: "terminal" | "app";
  /** El pid de su proceso (para "Ir a la ventana"), o `null` si no corre. */
  pid: number | null;
  /** Hay un proceso vivo con la sesión (un líder de la app puede estar dormido: se retoma con `--resume`). */
  vivo: boolean;
  /** Está respondiendo. */
  ocupado: boolean;
  /**
   * Tiene un permiso o una pregunta sin contestar (uno de la app: un pedido pendiente de su stream; uno de
   * terminal: lo que dice su sesión en `waitingFor`). Sin venir, no.
   */
  pide?: boolean;
  /**
   * Lo pone el main (electron/espera.ts): el líder espera al usuario. `pide`: tiene un permiso o una pregunta
   * pendiente; `listo`: terminó su turno y quedó ocioso esperando respuesta. `desde` en ms: identifica el turno
   * (una notificación por líder y por turno). Se apaga cuando el usuario abre esa conversación o le escribe
   * (`fuente.liderVisto`). Sin venir, no espera.
   */
  espera?: EsperaLider;
  /** El id ("claude-opus-5-5") y el esfuerzo, si se saben. */
  modelo: string | null;
  effort: string | null;
  /** Cuántos subagentes suyos corren (lo suma la barra con `useSubagentes`; el main no lo manda). Con alguno corriendo la sesión está activa, no enfriándose. */
  subagentes?: number;
  /** El modo de permisos de un líder de la app ("bypassPermissions", "plan"…; src/hilo/modos.ts). */
  modo?: string;
  /** El proyecto (slug) que nombra su primer mensaje: su carpeta mientras no tenga workers (B20). */
  inferido?: string | null;
  /** Es la sesión de Shark (su cwd es `$SHARK_HOME`, default `/srv/shark`): va a la carpeta `SHARK`. Sin venir, no. */
  shark?: boolean;
  /**
   * Quedó sin proceso y no es de la app: no se le escribe hasta retomarlo (`fuente.liderRetomar`).
   * "murio": lo mataron (OOM, kill -9; lo dice el main o `caidos`). "cerro": ya no está su sesión
   * y dejó workers a la vista (lo arma la barra, `lideresSinProceso`).
   */
  caido?: "murio" | "cerro";
  /** Por qué murió, si se supo (lo que dijo su proceso o por qué no se pudo levantar): va en el tooltip de Murió. */
  motivo?: string;
  /**
   * La máquina donde corre (`maquinas.json`), como en `Hilo`: sin venir, la de esta trama. Con él, `id`
   * lleva el prefijo `maquina:` y también el `jefe_id` de sus workers de esa máquina.
   */
  maquina?: string;
};

/** Por qué un líder espera al usuario y desde cuándo (epoch ms). */
export type EsperaLider = { motivo: "pide" | "listo"; desde: number };

/** Lo que contesta retomar un líder: listo para escribirle, o por qué no se pudo. */
export type Retomado = { ok: true } | { ok: false; motivo: MotivoRetomar };
/** Está abierto en otro proceso (terminal, otra trama), su conversación ya no está en disco, o su carpeta no existe. */
export type MotivoRetomar = "abierto" | "sinSesion" | "sinCarpeta";

const MOTIVOS: readonly string[] = ["abierto", "sinSesion", "sinCarpeta"];

/** La respuesta del main, validada; lo que no tiene forma es un error. */
export function retomadoDe(x: unknown): Retomado {
  const r = x as { ok?: unknown; motivo?: unknown } | null;
  if (r?.ok === true) return { ok: true };
  if (r?.ok === false && typeof r.motivo === "string" && MOTIVOS.includes(r.motivo)) return { ok: false, motivo: r.motivo as MotivoRetomar };
  throw new Error("lider:retomar");
}

/** Lo que contesta traer a la app un líder abierto en una terminal (`fuente.liderTraer`). */
export type Traido = { ok: true } | { ok: false; motivo: MotivoTraer };
/** `trabajando`: está haciendo algo y traerlo lo corta (hay que confirmarlo). `abierto`: no se lo pudo cerrar allá. */
export type MotivoTraer = MotivoRetomar | "trabajando";

export function traidoDe(x: unknown): Traido {
  const r = x as { ok?: unknown; motivo?: unknown } | null;
  if (r?.ok === false && r.motivo === "trabajando") return { ok: false, motivo: "trabajando" };
  try {
    return retomadoDe(x);
  } catch {
    throw new Error("lider:traer");
  }
}

/** Qué está haciendo un líder de la app (espejo de `Hace` en electron/lider-arma.ts). */
export type HaceLider =
  | { que: "pidiendo" | "pensando" | "escribiendo" | "compactando"; nombre: null; detalle: null }
  /** `extra`: dónde busca Grep/Glob (su carpeta) o a quién delega Agent (su tipo de subagente). */
  | { que: "herramienta"; nombre: string; detalle: string | null; extra?: string };

/** Un aviso en línea del chat de un líder (espejo de `Aviso` en electron/lider-arma.ts; tabla en docs/estado/B12.md). */
export type AvisoLider =
  | { clase: "reintento"; intento: number; max: number; espera_ms: number; estado: number | null; error: string | null }
  | { clase: "limite"; rechazado: boolean; ventana: string | null; hasta: number | null; uso: number | null }
  | { clase: "error"; texto: string; codigo: string | null }
  | { clase: "compacto"; auto: boolean; antes: number | null }
  | { clase: "nota"; texto: string; grave: boolean }
  | { clase: "modelo"; de: string; a: string }
  | { clase: "salio"; codigo: number | null; texto: string | null };

/** Un slash command de Claude Code o una skill (espejo de `Comando` en electron/lider-arma.ts). */
export type ComandoClaude = { nombre: string; descripcion: string | null; args: string | null; agy?: boolean };

/** Los output styles (`/output-style`): el que está en uso y los que lista el CLI (espejo de `Estilos` en electron/lider.ts). */
export type Estilos = { actual: string | null; lista: string[] };

/** Una pregunta de AskUserQuestion (espejo de `Pregunta` en electron/preguntas.ts). */
export type Pregunta = { question: string; header: string; options: { label: string; description: string }[]; multiSelect: boolean };

/** Lo que llega del stream de un líder de la app (electron/lider.ts). */
export type EventoLider =
  | { tipo: "parcial"; texto: string }
  /** El razonamiento que va llegando; el mensaje entero trae el suyo en `pensado`. */
  | { tipo: "pensamiento"; texto: string }
  | { tipo: "mensaje"; mid: string | null; texto: string; herramientas: string[]; modelo: string | null; det?: Herramienta[]; pensado?: string }
  /** Lo que devolvió una herramienta (el final, recortado): se pega a su `det` por `id`. */
  | { tipo: "resultado"; id: string; texto: string; error: boolean }
  | { tipo: "fin"; error: string | null; ttl: number | null }
  | { tipo: "control"; id: string; ok: boolean; error?: string }
  | { tipo: "hace"; hace: HaceLider }
  | { tipo: "tokens"; salida: number; nuevo: boolean }
  | { tipo: "aviso"; aviso: AvisoLider }
  | { tipo: "estado"; ocupado: boolean; vivo: boolean }
  /** El modo de permisos de la sesión (B13). */
  | { tipo: "modo"; modo: string }
  /**
   * Un pedido de permiso (`can_use_tool`); `plan`: el de ExitPlanMode; `preguntas`: las de
   * AskUserQuestion (`null` si no). Se contesta con `fuente.liderPermiso`.
   */
  | { tipo: "permiso"; id: string; herramienta: string; detalle: string | null; plan: string | null; preguntas: Pregunta[] | null; tool_use_id: string | null }
  /** El pedido se contestó o `claude` lo retiró. */
  | { tipo: "permisoFuera"; id: string }
  /** Los slash commands que ofrece la sesión. */
  | { tipo: "comandos"; lista: ComandoClaude[]; agy?: boolean }
  /** El output style en uso y, si lo dijo el initialize, los que hay. */
  | { tipo: "estilos"; actual: string | null; lista: string[] | null }
  /** Para el anillo de contexto (B16): el `usage` del mensaje que empieza y la ventana de cada modelo (del `result`). */
  | { tipo: "contexto"; usage?: Tokens; ventanas?: Record<string, number> }
  /** `error`: salió mal (stderr resumido, o "" si no dijo nada); `null`, bien o cerrado adrede. */
  | { tipo: "salio"; codigo: number | null; error: string | null };

/** `analista`: el chat de Ramas (B22), que no va en la barra. */
/** Un líder de terminal que murió sin cerrar: su sesión quedó en `~/.claude/sessions` sin proceso (electron/vigia.ts). */
export type Caido = { id: string; nombre: string; ts: number; cwd?: string; actividad?: number };

export type RespuestaLideres = { version: number; lideres: Lider[]; analista?: Lider | null; caidos?: Caido[] };

/** La carpeta de los líderes sin workers. Va primera. */
export const GENERAL = "general";

/**
 * La carpeta de Shark (el asistente de voz de `asistente-voz`): su sesión jefe y los workers que lanza van
 * acá y no a la de `asistente-voz`. Qué líder es de Shark: `Lider.shark` (el main, por su cwd) o, si no
 * vino, un nombre que empieza con "shark-" (el que Claude Code deriva de esa carpeta). Ver `esShark`.
 */
export const SHARK = "Shark";

/** Un líder de Shark: lo marcó el main por su cwd (`$SHARK_HOME`, `/srv/shark`) o su nombre empieza con "shark-". */
export const esShark = (l: { shark?: boolean; nombre: string }) => l.shark === true || /^shark-/i.test(l.nombre);

/** Lo que el main arma con los statusline: las barras de uso y los líderes. `uso` es `null` si no hay de dónde sacarlo. */
export type Statusline = { uso: Uso | null; lideres: RespuestaLideres };

/** `~/.local/state/hilos/leidos.json`: id → epoch en que el usuario lo abrió. */
export type Leidos = Record<string, number>;

/**
 * `~/.local/state/hilos/nombres.json` (B20): lo que el usuario le cambió a la barra.
 * `titulos`: id de un run o session_id → título que gana sobre la tarea o el
 * nombre; `proyectos`: session_id → carpeta a la que movió un líder; `ocultos`:
 * carpetas con los workers terminados escondidos; `orden`: lo que reordenó arrastrando.
 */
export type Nombres = { titulos: Record<string, string>; proyectos: Record<string, string>; ocultos: string[]; orden: Orden };

/**
 * El orden puesto a mano (arrastrando en la barra): `carpetas`, los proyectos en el orden
 * elegido; `lideres`, por carpeta, los session_id en el orden elegido. Lo que no está en una
 * lista va después, con el orden de siempre (`src/barra/orden.ts`).
 */
export type Orden = { carpetas: string[]; lideres: Record<string, string[]>; /** Orden por prioridad (`prioridadDe`, arbol.ts): sin venir o `true`, prendido (de fábrica); `false`, el orden fijo a mano. */ prioridad?: boolean };

/** Un mensaje de `pa --hilo <id> --json` (src/datos/paHilo.ts) o del transcript de un líder. */
export type Mensaje = {
  /** Posición en la conversación entera (0 = el pedido). */
  i: number;
  rol: "user" | "assistant";
  texto: string;
  herramientas: string[];
  /** ISO 8601. */
  ts: string | null;
  modelo: string | null;
  /**
   * De dónde salió, si no lo escribió el usuario ni lo contestó el modelo (B18,
   * src/hilo/sistema-datos.ts). Los trae el transcript de un líder y `pa --hilo` (B19).
   */
  /** `isMeta`: lo inyectó Claude Code (el cuerpo de una skill, una imagen, un caveat). */
  meta?: boolean;
  /** `isCompactSummary`: el resumen con que sigue después de compactar. */
  resumen?: boolean;
  /** `origin.kind`: "human", "task-notification", "peer", "auto-continuation"… */
  origen?: string | null;
  /** Mensaje sintético de error de la API (`isApiErrorMessage`): su código ("rate_limit", "server_error"…). */
  error?: string | null;
  /** `system/compact_boundary`: compactó acá (texto vacío). `pa --hilo` no dice si fue auto (`null`). */
  compacto?: { auto: boolean | null; antes: number | null };
  /** `system/trama_destrabo`: trama cortó un bucle de un líder Gemini y le mandó el aviso (`agotado`: a la segunda vez para). */
  destrabo?: { que: string; agotado: boolean };
  /** Cada herramienta con su entrada (B19, src/hilo/herramientas.ts), en el orden de `herramientas`. */
  det?: Herramienta[];
  /** Las imágenes que mandó el usuario a un líder (B26), en base64. */
  imagenes?: { tipo: string; datos: string }[];
  /** El razonamiento del modelo en ese mensaje (sólo un líder, si su transcript lo trae). */
  pensado?: string;
};

/**
 * Una herramienta que usó el modelo: el nombre y la entrada, con los textos
 * recortados a 2000 caracteres (`cortado`: alguno se recortó). `resultado`: el
 * final de lo que devolvió, sólo en un líder (`pa --hilo` no trae los tool_result).
 */
export type Herramienta = {
  nombre: string;
  entrada: Record<string, unknown>;
  cortado?: boolean;
  /** El `tool_use_id`, para pegarle el resultado cuando llega. */
  id?: string | null;
  resultado?: { texto: string; error: boolean } | null;
};

/** Los tokens del último turno: lo que pesa la conversación si se relee entera. */
export type Tokens = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

/**
 * Una página de `pa --hilo <id> --json [-n N] [--antes N]`: los mensajes
 * `[desde, hasta)` de `total`. Sin transcript (`null`), `mensajes` viene vacío.
 */
export type RespuestaHilo = {
  version: number;
  id: string;
  proyecto: string;
  transcript: string | null;
  total: number;
  desde: number;
  hasta: number;
  mensajes: Mensaje[];
  usage: Tokens | null;
  modelo: string | null;
  /** Cuántas veces compactó la sesión. Sólo en el transcript de un líder: `pa --hilo` no lo trae. */
  compactaciones?: number | null;
  /** Compactó después del último mensaje del asistente: `usage` es de antes de compactar. */
  compactada?: boolean;
};

const CERRADOS: ReadonlySet<Estado> = new Set(["archivado", "integrado", "descartado", "revertido"]);

/** Ya cerrado: vive en "Cerrados", al fondo de la lista. */
export const cerrado = (e: Estado) => CERRADOS.has(e);

/**
 * Settle (darlo por cerrado) sólo lo que terminó y sigue en la lista: queda
 * a la vista hasta entonces.
 */
export const cerrable = (e: Estado) => e === "listo" || e === "decision" || e === "entregado" || e === "murio";

/**
 * Qué hace el Settle (la misma regla que electron/settle.ts, que es la que
 * manda): lo de la app con rama sin integrar se integra; lo que lanzó un líder
 * (`origen` "jefe") sólo se archiva, la rama es del líder; sin rama, se archiva.
 */
export const comoSettle = (h: Pick<Hilo, "origen" | "rama">): "integrar" | "archivar" =>
  h.rama && h.origen !== "jefe" ? "integrar" : "archivar";
