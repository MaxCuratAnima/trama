// Lo puro de los líderes de la app (lider.ts): el argv y el entorno de
// `claude`, el parser de su stream-json, el de su transcript y el formato de
// `lideres.json`. Sin imports locales ni efectos al importar: lo prueba
// `tests/lider.test.ts`.
import path from "node:path";
import { ttlDeUso } from "./cache.ts";
import { errorT, textoT } from "./errores.ts";
import { deDueno } from "./dueno.ts";
import { entornoConLocal, type Plataforma } from "./plataforma.ts";
import { contenidoUsuario, imagenesDeContenido, type Imagen } from "./imagenes.ts";
import { HERRAMIENTA_PREGUNTAS, preguntasDe, type Pregunta } from "./preguntas.ts";

type Env = Record<string, string | undefined>;

export const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Los modos de permisos que maneja la app (los de Claude Code menos `auto`,
 * que no está habilitado, y `dontAsk`). El default es bypass, como el usuario en la terminal.
 */
export const MODOS = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
export type Modo = (typeof MODOS)[number];
export const MODO_DEFAULT: Modo = "bypassPermissions";
export const esModo = (m: unknown): m is Modo => (MODOS as readonly unknown[]).includes(m);

/** Un líder con modelo local: llama-server (su API compatible con la de Anthropic, `/v1/messages`) y el contexto que tiene cargado. */
export type Local = { url: string; ctx: number; contexto?: string };

/** Un líder con un modelo de Ollama (`modelos.json`): el mismo `claude` de siempre contra otro endpoint; `modelo` es el nombre que Ollama conoce. */
export type Ollama = { url: string; modelo: string };

export type ArmarLider = { modelo: string; effort: string; sid: string; nombre: string; resume: boolean; modo?: Modo; local?: Local; ollama?: Ollama };

/**
 * El prompt de sistema de un líder local, en lugar del de Claude Code (que con las herramientas pasa de 15K tokens y el
 * contexto de un modelo local es de 32K): corto, sin jefe ni `pa` ni tablero. Un líder local no lanza workers (no entran
 * dos modelos en la VRAM): `pa` además se niega solo con un `ANTHROPIC_BASE_URL` local (sale 88).
 */
export const PROMPT_LOCAL = [
  "Sos un asistente que corre entero en la GPU de esta máquina (un modelo local, no Claude), dentro de trama.",
  "Contestá en el idioma en que te escriben, claro y al grano.",
  "Tenés herramientas para leer, buscar y editar archivos y para correr comandos en esta máquina: usalas cuando hagan falta y contá qué hiciste.",
  "No lanzás workers ni delegás (no hay `pa` ni subagentes para vos): el trabajo lo hacés vos, acá.",
  `Los pendientes ${deDueno()} viven en \`tablero\`, que tenés por Bash: \`tablero listar\`, \`tablero ver <id>\`, \`tablero agregar\`, \`tablero cerrar <id>\`. Si no sabés algo ${deDueno()}, de sus proyectos o de sus pendientes, mirá abajo o consultalo ahí antes de decir que no existe.`,
  "Antes de algo que no se deshace (borrar, sobrescribir, publicar), preguntá.",
].join("\n");

/**
 * Las herramientas de un líder local: sin subagentes, skills, web ni tareas (cada una suma su esquema a cada pedido). `--bare`
 * ya deja sólo estas tres (≈ 1K tokens de esquemas; medido con claude 2.1.302 contra un servidor falso): se dicen igual por si cambia.
 */
export const HERRAMIENTAS_LOCAL = "Bash,Read,Edit";

/**
 * Lo que se le agrega al argv de un líder local. `--bare`: sin CLAUDE.md, hooks, plugins, skills de orquestación ni memoria
 * (lo del usuario sin lo del jefe se lo da `contexto`, `contexto-local.ts`, dentro del prompt de sistema); su auth es sólo una key o `apiKeyHelper`, y la key es de mentira (va sólo a
 * llama-server, que no la mira: nunca `ANTHROPIC_API_KEY`). `--system-prompt-snapshot off`: si la sesión fue de Claude, no
 * reusar el prompt grabado. Sin `--effort` (los niveles locales no son los de Claude): va en el entorno (`entornoLocal`).
 */
const argvLocal = (contexto?: string) => [
  "--bare",
  "--settings",
  JSON.stringify({ apiKeyHelper: "echo trama-local" }),
  "--strict-mcp-config",
  "--tools",
  HERRAMIENTAS_LOCAL,
  "--system-prompt",
  contexto ? `${PROMPT_LOCAL}\n\n${contexto}` : PROMPT_LOCAL,
  "--system-prompt-snapshot",
  "off",
];

/**
 * `claude -p` persistente que lee y escribe stream-json. En bypass,
 * `--dangerously-skip-permissions` (como el líder de la terminal); en otro modo,
 * `--allow-dangerously-skip-permissions --permission-mode <modo>` (bypass queda
 * disponible para volver con `set_permission_mode`). Siempre
 * `--permission-prompt-tool stdio`: los pedidos de permiso (ExitPlanMode en plan,
 * cualquier herramienta en default) llegan como `control_request can_use_tool`
 * y los contesta la app. Sesión nueva: `--session-id` + `--name`; retomada:
 * `--resume` (el nombre ya está en el transcript). Protocolo en docs/estado/B13.md.
 */
export function argvLider({ modelo, effort, sid, nombre, resume, modo = MODO_DEFAULT, local, ollama }: ArmarLider): string[] {
  if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid });
  if (!esModo(modo)) throw errorT("main.modoRaro", { v: String(modo) });
  for (const [clave, v] of [
    ["main.modeloRaro", ollama ? ollama.modelo : modelo],
    ["main.effortRaro", effort],
    ["main.nombreRaro", nombre],
  ])
    if (!v || v.startsWith("-") || /[\s\0]/.test(v)) throw errorT(clave, { v });
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...(modo === "bypassPermissions" ? ["--dangerously-skip-permissions"] : ["--allow-dangerously-skip-permissions", "--permission-mode", modo]),
    "--permission-prompt-tool",
    "stdio",
    "--model",
    // Ollama no entiende `claude-*` ni los esfuerzos de Claude: su modelo, y sin `--effort`.
    ollama ? ollama.modelo : modelo,
    ...(local ? argvLocal(local.contexto) : ollama ? [] : ["--effort", effort]),
  ];
  if (resume) args.push("--resume", sid);
  else args.push("--session-id", sid, "--name", nombre);
  return args;
}

/**
 * El entorno del líder: el de la app sin nada heredado de otra sesión de Claude
 * (con `CLAUDE_CODE_CHILD_SESSION` no guarda transcript) ni de un worker de `pa`
 * (`PA_WORKER` hace que `pa` se niegue; `PA_JEFE*` le pondría a sus workers el
 * jefe equivocado), y sin nada de `ANTHROPIC_*` (facturación: siempre la
 * suscripción). `PA_STATE` queda (las pruebas lo usan). `~/.local/bin` adelante.
 */
export function entornoLider(env: Env, home: string, plataforma: Plataforma = process.platform): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^CLAUDE/.test(k) || /^ANTHROPIC_/.test(k)) continue;
    if (/^PA_/.test(k) && k !== "PA_STATE") continue;
    out[k] = v;
  }
  return entornoConLocal(plataforma, out, home);
}

/** Sólo un llama-server de esta máquina: el endpoint de un líder local nunca sale de loopback (nada de proxies ni de Anthropic por otra puerta). */
export function esLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** El esfuerzo de un local, por el cuerpo de cada pedido (llama-server lo lleva a la plantilla): `off` apaga el razonamiento. */
export const cuerpoLocal = (effort: string) =>
  JSON.stringify({ chat_template_kwargs: effort === "off" ? { enable_thinking: false } : { reasoning_effort: effort } });

/**
 * El entorno de un líder local: el de siempre (sin nada de `ANTHROPIC_*` heredado) más el endpoint de llama-server SÓLO en
 * este proceso. Todo modelo (también el chico de los títulos) es el mismo local; el contexto y la compactación, los del
 * `-c` cargado (si no, Claude Code cree que tiene 200K y nunca compacta); sin tráfico a Anthropic que no haga falta.
 * `CLAUDE_LOCAL=1`: `pa` se niega a lanzar workers (no entran dos modelos en la GPU).
 */
export function entornoLocal(env: Env, home: string, x: { modelo: string; effort: string; local: Local }): Env {
  if (!esLoopback(x.local.url)) throw errorT("main.localNoLoopback", { v: x.local.url });
  const out = entornoLider(env, home);
  out.ANTHROPIC_BASE_URL = x.local.url;
  for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"])
    out[k] = x.modelo;
  out.CLAUDE_CODE_EXTRA_BODY = cuerpoLocal(x.effort);
  out.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(x.local.ctx);
  out.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(x.local.ctx);
  out.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(Math.min(16384, Math.floor(x.local.ctx / 4)));
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  out.DISABLE_AUTOUPDATER = "1";
  out.CLAUDE_LOCAL = "1";
  return out;
}

/**
 * El entorno de un líder de Ollama: el de siempre (sin nada de `ANTHROPIC_*` heredado) más el endpoint SÓLO en este
 * proceso (contrato `modelos.json`: nunca en otro proceso, nunca en `settings.json`, nunca para un modelo que no sea
 * `ollama:*`). `ANTHROPIC_API_KEY` vacía: ni la del usuario ni la de nadie. Todo modelo (también el chico de los títulos)
 * es el mismo de Ollama, si no Claude Code pediría un `claude-haiku` que Ollama no tiene.
 * `CLAUDE_LOCAL=1`: `pa` se niega a lanzar workers (sale 88); sus workers heredarían este endpoint y no entienden a Ollama.
 */
export function entornoOllama(env: Env, home: string, x: Ollama): Env {
  if (!/^https?:\/\//.test(x.url)) throw errorT("main.ollamaUrlRara", { v: x.url });
  const out = entornoLider(env, home);
  out.ANTHROPIC_BASE_URL = x.url;
  out.ANTHROPIC_AUTH_TOKEN = "ollama";
  out.ANTHROPIC_API_KEY = "";
  for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"])
    out[k] = x.modelo;
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  out.DISABLE_AUTOUPDATER = "1";
  out.CLAUDE_LOCAL = "1";
  return out;
}

/**
 * Dónde y con qué corre un líder de la app: en el home, como abrir Claude Code
 * en `~` (es el jefe que delega con `pa`). Nuevo líder no pide proyecto; en la
 * barra va a la carpeta del home hasta que tenga workers. `cwd`: el de uno que
 * nació en una terminal en otra carpeta y se retomó desde la app (`--resume`
 * busca la sesión en la carpeta donde corre).
 */
export const opcionesLider = (env: Env, home: string, cwd?: string, local?: { modelo: string; effort: string; local: Local }, ollama?: Ollama) => ({
  cwd: cwd || home,
  env: local ? entornoLocal(env, home, local) : ollama ? entornoOllama(env, home, ollama) : entornoLider(env, home),
});

/** "trama-" + 4 hex. */
export const nombreNuevo = (azar: () => number = Math.random) =>
  `trama-${Math.floor(azar() * 0x10000)
    .toString(16)
    .padStart(4, "0")}`;

/** Una línea de usuario para el stdin; con imágenes (B26), `content` va en bloques. */
export const lineaUsuario = (texto: string, imagenes: readonly Imagen[] = []) =>
  JSON.stringify({ type: "user", message: { role: "user", content: contenidoUsuario(texto, imagenes) } }) + "\n";

const pedido = (id: string, request: object) => JSON.stringify({ type: "control_request", request_id: id, request }) + "\n";

/** El pedido de interrupción (lo contesta con un `control_response`). */
export const lineaParar = (id: string) => pedido(id, { subtype: "interrupt" });

/** Cambiar el modo de permisos de la sesión viva (contesta `{ mode }` y manda `system/status` con `permissionMode`). */
export const lineaModo = (id: string, modo: Modo) => pedido(id, { subtype: "set_permission_mode", mode: modo });

/**
 * Cambiar el modelo de la sesión viva, sin relanzar (contesta `success` o `error` con el motivo).
 * Va con `await` de la respuesta antes del próximo mensaje: `claude` lo aplica diferido.
 */
export const lineaModelo = (id: string, modelo: string) => pedido(id, { subtype: "set_model", model: modelo });

/**
 * Cambiar el esfuerzo de la sesión viva (`apply_flag_settings` con `effortLevel`, como el Remote
 * Control). Ojo: con un nivel que no conoce contesta `success` igual; el filtro es la lista de la app.
 */
export const lineaEffort = (id: string, effort: string) => pedido(id, { subtype: "apply_flag_settings", settings: { effortLevel: effort } });

/**
 * El output style (`/output-style`) por la vía de `/config`: `update_settings` en
 * `localSettings` lo escribe en el settings.local.json del proyecto (el líder corre en
 * `~`: `~/.claude/settings.local.json`, el mismo que usa la terminal en `~`) y lo aplica en
 * vivo. Contesta `success` aunque el estilo no exista: el filtro es la lista del initialize.
 */
export const lineaEstilo = (id: string, estilo: string) =>
  pedido(id, { subtype: "update_settings", source: "localSettings", settings: { outputStyle: estilo } });

/** Lo que manda el Agent SDK al arrancar: la respuesta trae `commands` (los slash commands con descripción). */
export const lineaInicio = (id: string) => pedido(id, { subtype: "initialize" });

/**
 * El uso del plan como lo dice claude.ai (lo de su página de uso), pedido por `claude` mismo con su
 * sesión: experimental desde 2.1.300 (la forma puede cambiar: `oficialDe`, en `uso.ts`, la lee con cuidado). Sin
 * `skip_behaviors` también calcula qué conviene hacer con el uso, que acá no se muestra.
 */
export const lineaUso = (id: string) => pedido(id, { subtype: "get_usage", skip_behaviors: true });

/**
 * Un `claude` de un rato sólo para `get_usage` cuando no hay líder de la app vivo: no guarda
 * transcript, no levanta MCP ni corre hooks (un SessionStart avisaría de una sesión que no es).
 * Nunca `--bare`: apaga el login de la suscripción, que es justo lo que pregunta.
 */
export const argvUso = () => [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--settings",
  JSON.stringify({ disableAllHooks: true }),
];

/** La respuesta de la app a un `can_use_tool`: permitir (con el input tal cual) o negar con un mensaje para el modelo. */
export type Respuesta = { behavior: "allow"; updatedInput: unknown } | { behavior: "deny"; message: string };

export const lineaPermiso = (id: string, r: Respuesta, toolUseID: string | null) =>
  JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: id, response: toolUseID ? { ...r, toolUseID } : r },
  }) + "\n";

/**
 * En bypass, `claude` igual pide permiso para algunos Bash: se contestan solos.
 * ExitPlanMode y AskUserQuestion no: esperan una respuesta de verdad.
 */
export const autoaprueba = (modo: string, herramienta: string) =>
  modo === "bypassPermissions" && herramienta !== "ExitPlanMode" && herramienta !== "AskUserQuestion";

// --- Herramientas ------------------------------------------------------------

const DETALLE = ["command", "file_path", "path", "pattern", "url", "query", "description", "skill", "prompt"];

/**
 * Tope de seguridad de lo concreto que viaja en cada cambio de la tarjeta (un prompt de Agent puede pesar kilobytes y
 * pasa por el IPC, el celular y los pasos de atrás). Más largo que esto se corta; la vista lo pliega, no lo corta.
 */
export const TOPE_DETALLE = 2000;

/** Lo concreto en una sola línea, entero (espacios y saltos colapsados), con el tope de `TOPE_DETALLE`. */
function entero(s: string): string {
  const l = s.replace(/\s+/g, " ").trim();
  return l.length > TOPE_DETALLE ? l.slice(0, TOPE_DETALLE) : l;
}

/**
 * Lo que hizo una herramienta en un renglón corto ("git status", "/x/y.ts"), o `null`. Con `completo`, lo
 * entero (sin cortar a 80): lo usa la tarjeta del chat (`detalleHace`), que lo lee con wrap.
 */
export function detalle(input: unknown, completo = false): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  const k = DETALLE.find((c) => typeof i[c] === "string" && i[c]);
  if (!k) return null;
  if (completo) return entero(String(i[k]));
  const d = String(i[k]).split("\n")[0].trim();
  return d.length > 80 ? `${d.slice(0, 79)}…` : d;
}

/**
 * Lo concreto de una herramienta para el indicador del chat (`Hace`): lo mismo que `detalle` salvo que
 * Grep y Glob dicen el patrón (no la carpeta) y, aparte (`extra`), dónde buscan o a quién delega Agent.
 * Todo entero (sin "…"): la tarjeta lo pliega si es muy largo.
 */
export function detalleHace(nombre: string, input: unknown): { detalle: string | null; extra?: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const corto = (x: unknown) => (typeof x === "string" && x.trim() ? entero(x) : null);
  if (nombre === "Grep" || nombre === "Glob") {
    const extra = corto(i.path);
    return { detalle: corto(i.pattern), ...(extra ? { extra } : {}) };
  }
  if (nombre === "Agent" || nombre === "Task") {
    const extra = corto(i.subagent_type);
    return { detalle: detalle(input, true), ...(extra ? { extra } : {}) };
  }
  return { detalle: detalle(input, true) };
}

/** "Bash: git status", "Read: /x/y.ts": la herramienta con lo que hizo, en un renglón corto. */
export function herramienta(nombre: string, input: unknown): string {
  const d = detalle(input);
  return d ? `${nombre}: ${d}` : nombre;
}

// --- Stream ------------------------------------------------------------------

/**
 * Qué está haciendo el líder ahora (el indicador del chat y de su fila).
 * `pidiendo`: esperando a la API (`system/status requesting`); `pensando`: un
 * bloque `thinking`; `escribiendo`: un bloque de texto; `herramienta`: un
 * `tool_use` (al empezar sólo el nombre, con el mensaje entero también el detalle);
 * `compactando`: `system/status compacting`.
 */
export type Hace =
  | { que: "pidiendo" | "pensando" | "escribiendo" | "compactando"; nombre: null; detalle: null }
  | { que: "herramienta"; nombre: string; detalle: string | null; extra?: string };

/**
 * Un aviso en línea del chat (docs/estado/B12.md). Viene con datos, no con
 * texto: lo traduce la vista. Lo que ya viene escrito por `claude` (`texto`) no se traduce.
 */
export type Aviso =
  /** `system/api_retry`: la API falló (529 sobrecarga, 429 límite, 5xx) y reintenta. */
  | { clase: "reintento"; intento: number; max: number; espera_ms: number; estado: number | null; error: string | null }
  /** `rate_limit_event` con status ≠ allowed: cerca del límite o rechazado; `hasta` en epoch s. */
  | { clase: "limite"; rechazado: boolean; ventana: string | null; hasta: number | null; uso: number | null }
  /** Un error del turno: `result` con `is_error` (o `errors[]`), o un `assistant` con `error`. */
  | { clase: "error"; texto: string; codigo: string | null }
  /** `system/compact_boundary`: compactó (auto o /compact), con los tokens de antes. */
  | { clase: "compacto"; auto: boolean; antes: number | null }
  /** `system/notification` (color error/warning) o `system/informational` warning: el texto de `claude`. */
  | { clase: "nota"; texto: string; grave: boolean }
  /** `system/model_fallback`: pasó a otro modelo. */
  | { clase: "modelo"; de: string; a: string }
  /** El proceso salió con código ≠ 0 o murió (lo arma lider.ts con el stderr resumido). */
  | { clase: "salio"; codigo: number | null; texto: string | null };

/** Lo que sale de una línea del stdout de `claude` y le importa a la vista. */
export type Evento =
  | { tipo: "parcial"; texto: string }
  /** El razonamiento que va llegando (`thinking_delta`); el entero viene en el `pensado` del mensaje. */
  | { tipo: "pensamiento"; texto: string }
  | { tipo: "mensaje"; mid: string | null; texto: string; herramientas: string[]; modelo: string | null; det: Det[]; pensado?: string }
  /** Lo que devolvió una herramienta (el final): va a su `det` por `id` (src/hilo/vivo.ts). */
  | { tipo: "resultado"; id: string; texto: string; error: boolean }
  | { tipo: "fin"; error: string | null; ttl: number | null }
  /** La respuesta a un `control_request` de la app; `error`: el motivo, si no salió. */
  | { tipo: "control"; id: string; ok: boolean; error?: string }
  | { tipo: "hace"; hace: Hace }
  /** Tokens de salida del mensaje en curso; `nuevo` al empezar un mensaje (el anterior ya cuenta entero). */
  | { tipo: "tokens"; salida: number; nuevo: boolean }
  | { tipo: "aviso"; aviso: Aviso }
  /** El modo de permisos de la sesión (init, `system/status`, la respuesta a `set_permission_mode`). */
  | { tipo: "modo"; modo: Modo }
  /**
   * `can_use_tool`: el líder pide permiso (ExitPlanMode en plan, cualquier
   * herramienta en default). Lo contesta la app (`lineaPermiso`); el input crudo
   * se queda en el main. `plan`: el plan de ExitPlanMode. `preguntas`: las de
   * AskUserQuestion (electron/preguntas.ts; `null` si es otra o vino rara).
   * `razon`/`ruta`: `decision_reason` y `blocked_path` del pedido, si vinieron
   * (qué regla del CLI lo disparó).
   */
  | { tipo: "permiso"; id: string; herramienta: string; detalle: string | null; plan: string | null; preguntas: Pregunta[] | null; input: unknown; tool_use_id: string | null; razon?: string; ruta?: string }
  /** `control_cancel_request`: `claude` retiró el pedido (lo interrumpieron). */
  | { tipo: "permisoFuera"; id: string }
  /** Los slash commands que ofrece la sesión (init: sólo nombres; initialize: con descripción). */
  | { tipo: "comandos"; lista: Comando[]; agy?: boolean }
  /**
   * El output style en uso y, del initialize, los que hay (los de fábrica y los de
   * `output-styles/` del usuario y del proyecto, como los lista el CLI); `null`: no lo dijo.
   */
  | { tipo: "estilos"; actual: string | null; lista: string[] | null }
  /**
   * Para el anillo de contexto (B16): el `usage` del mensaje que empieza (su
   * entrada es lo que pesa la conversación) y, al terminar el turno, la ventana
   * de cada modelo (`modelUsage.<modelo>.contextWindow` del `result`).
   */
  | { tipo: "contexto"; usage?: Tokens; ventanas?: Record<string, number> };

/** Los tokens de un mensaje, como los da la API (espejo de `Tokens` en src/datos/contrato.ts). */
export type Tokens = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

/** Un slash command de Claude Code (o skill) que se le puede mandar como prompt. */
export type Comando = { nombre: string; descripcion: string | null; args: string | null; agy?: boolean };

/** Los que sólo andan en la terminal (el init los lista en `terminal_slash_commands`). */
const DE_TERMINAL = new Set(["doctor", "color", "focus", "reload-plugins"]);

/** Los nombres de output style que sirven (sin repetir, sin espacios raros ni guiones adelante). */
export function estilosDe(lista: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(lista) ? lista : []) {
    const s = typeof x === "string" ? x.trim() : "";
    if (s && s.length <= 100 && !s.startsWith("-") && !/[\0\n\r]/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function comandosDe(lista: unknown, terminal: unknown): Comando[] {
  const fuera = new Set([...DE_TERMINAL, ...(Array.isArray(terminal) ? terminal.filter((x) => typeof x === "string") : [])]);
  const out: Comando[] = [];
  const vistos = new Set<string>();
  for (const c of Array.isArray(lista) ? lista : []) {
    const nombre = typeof c === "string" ? c : str(c?.name);
    if (!nombre || fuera.has(nombre) || vistos.has(nombre) || /\s/.test(nombre)) continue;
    vistos.add(nombre);
    out.push({ nombre, descripcion: typeof c === "string" ? null : str(c.description), args: typeof c === "string" ? null : str(c.argumentHint) });
  }
  return out;
}

const hace = (que: "pidiendo" | "pensando" | "escribiendo" | "compactando"): Evento => ({
  tipo: "hace",
  hace: { que, nombre: null, detalle: null },
});
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

/** El `usage` de un mensaje si trae tokens de entrada (lo que pesa el contexto); si no, `null`. */
function usoDe(u: any): Tokens | null {
  const uso: Tokens = {};
  let hay = false;
  for (const k of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"] as const) {
    const n = num(u?.[k]);
    if (n === null) continue;
    uso[k] = n;
    if (k !== "output_tokens") hay = true;
  }
  return hay ? uso : null;
}

/** `modelUsage` del `result` → la ventana de contexto de cada modelo que la diga. */
function ventanasDe(mu: unknown): Record<string, number> | null {
  if (!mu || typeof mu !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mu)) {
    const n = num((v as any)?.contextWindow);
    if (n !== null && n > 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** El razonamiento de un mensaje: sus bloques `thinking` con texto, juntos (el redactado y el vacío no dicen nada). */
function pensadoDe(c: any[]): string {
  return c
    .filter((b) => b?.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim())
    .map((b) => b.thinking.trim())
    .join("\n\n");
}

function deStream(e: any): Evento[] {
  if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string")
    return [{ tipo: "parcial", texto: e.delta.text }];
  if (e?.type === "content_block_delta" && e.delta?.type === "thinking_delta" && typeof e.delta.thinking === "string")
    return [{ tipo: "pensamiento", texto: e.delta.thinking }];
  if (e?.type === "content_block_start") {
    const b = e.content_block;
    if (b?.type === "thinking" || b?.type === "redacted_thinking") return [hace("pensando")];
    if (b?.type === "text") return [hace("escribiendo")];
    if (b?.type === "tool_use" || b?.type === "server_tool_use")
      return [{ tipo: "hace", hace: { que: "herramienta", nombre: String(b.name ?? "?"), detalle: null } }];
    return [];
  }
  if (e?.type === "message_start") {
    const u = e.message?.usage;
    const n = num(u?.output_tokens);
    const uso = usoDe(u);
    return [{ tipo: "tokens", salida: n ?? 0, nuevo: true }, ...(uso ? [{ tipo: "contexto" as const, usage: uso }] : [])];
  }
  if (e?.type === "message_delta") {
    const n = num(e.usage?.output_tokens);
    return n === null ? [] : [{ tipo: "tokens", salida: n, nuevo: false }];
  }
  return [];
}

function deSistema(o: any): Evento[] {
  switch (o.subtype) {
    case "status": {
      const out: Evento[] = esModo(o.permissionMode) ? [{ tipo: "modo", modo: o.permissionMode }] : [];
      if (o.status === "requesting") out.push(hace("pidiendo"));
      if (o.status === "compacting") out.push(hace("compactando"));
      return out;
    }
    case "init": {
      const out: Evento[] = esModo(o.permissionMode) ? [{ tipo: "modo", modo: o.permissionMode }] : [];
      if (Array.isArray(o.slash_commands)) out.push({ tipo: "comandos", lista: comandosDe(o.slash_commands, o.terminal_slash_commands) });
      if (str(o.output_style)) out.push({ tipo: "estilos", actual: str(o.output_style), lista: null });
      return out;
    }
    case "api_retry":
      return [
        {
          tipo: "aviso",
          aviso: {
            clase: "reintento",
            intento: num(o.attempt) ?? 1,
            max: num(o.max_retries) ?? 0,
            espera_ms: num(o.retry_delay_ms) ?? 0,
            estado: num(o.error_status),
            error: str(o.error),
          },
        },
      ];
    case "compact_boundary": {
      const m = o.compact_metadata ?? o.compactMetadata ?? {};
      return [{ tipo: "aviso", aviso: { clase: "compacto", auto: m.trigger === "auto", antes: num(m.pre_tokens ?? m.preTokens) } }];
    }
    case "notification": {
      const texto = str(o.text);
      if (!texto || (o.color !== "error" && o.color !== "warning")) return [];
      return [{ tipo: "aviso", aviso: { clase: "nota", texto, grave: o.color === "error" } }];
    }
    case "informational": {
      const texto = str(o.content);
      if (!texto || o.level !== "warning") return [];
      return [{ tipo: "aviso", aviso: { clase: "nota", texto, grave: false } }];
    }
    case "model_fallback": {
      const de = str(o.original_model ?? o.originalModel);
      const a = str(o.fallback_model ?? o.fallbackModel);
      return de && a ? [{ tipo: "aviso", aviso: { clase: "modelo", de, a } }] : [];
    }
    default:
      return [];
  }
}

// --- Cada herramienta con su entrada (B19, espejo de `Herramienta` en src/datos/contrato.ts) ---

/** Lo mismo que deja `pa --hilo` de cada texto de la entrada. */
const CORTE = 2000;
/** Del resultado de una herramienta se guarda el final: las últimas líneas, hasta tantos caracteres. */
const COLA_LINEAS = 15;
const COLA_CHARS = 1500;

export type Det = {
  nombre: string;
  entrada: Record<string, unknown>;
  cortado?: boolean;
  id: string | null;
  resultado?: { texto: string; error: boolean } | null;
};

/** Un `tool_use` → nombre y entrada con los textos recortados (como `pa --hilo`). */
export function detDe(b: any): Det {
  const entrada: Record<string, unknown> = {};
  let cortado = false;
  const recorta = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.length > CORTE) cortado = true;
      return v.length > CORTE ? v.slice(0, CORTE) : v;
    }
    if (Array.isArray(v)) return v.map(recorta);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, recorta(x)]));
    return v;
  };
  const inp = b?.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input : {};
  for (const [k, v] of Object.entries(inp)) entrada[k] = recorta(v);
  return { nombre: String(b?.name ?? "?"), entrada, ...(cortado ? { cortado } : {}), id: str(b?.id) };
}

/** El final del texto de un `tool_result`. */
export function colaDe(content: unknown): string {
  const t =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((b: any) => b?.type === "text" && typeof b.text === "string")
            .map((b: any) => b.text)
            .join("\n")
        : "";
  const ls = t.trimEnd().split("\n");
  let cola = ls.slice(-COLA_LINEAS).join("\n");
  if (cola.length > COLA_CHARS) cola = cola.slice(-COLA_CHARS);
  return ls.length > COLA_LINEAS || cola.length < t.trimEnd().length ? `…\n${cola}` : cola;
}

/** Los `tool_result` de un mensaje del usuario. */
function resultadosDe(c: unknown): { id: string; texto: string; error: boolean }[] {
  if (!Array.isArray(c)) return [];
  return c
    .filter((b: any) => b?.type === "tool_result" && typeof b.tool_use_id === "string")
    .map((b: any) => ({ id: b.tool_use_id, texto: colaDe(b.content), error: b.is_error === true }));
}

/**
 * Una línea de stream-json → los eventos que le importan a la vista (vacío si
 * nada). Sólo lo del líder (`parent_tool_use_id` nulo): lo de sus subagentes no
 * se muestra, como en `pa --hilo` (`isSidechain`). Tipos y ejemplos en
 * docs/estado/B12.md y `tests/fixtures/stream-*.jsonl`.
 */
export function parsearLinea(linea: string): Evento[] {
  let o: any;
  try {
    o = JSON.parse(linea);
  } catch {
    return [];
  }
  if (!o || typeof o !== "object") return [];
  if (o.parent_tool_use_id) return [];
  if (o.type === "stream_event") return deStream(o.event);
  if (o.type === "system") return deSistema(o);
  if (o.type === "user") return resultadosDe(o.message?.content).map((r) => ({ tipo: "resultado" as const, ...r }));
  if (o.type === "assistant") {
    const c: any[] = Array.isArray(o.message?.content) ? o.message.content : [];
    const texto = c
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    const pensado = pensadoDe(c);
    // Un mensaje de error (límite, sobrecarga, auth…) no es una respuesta: va como aviso.
    if (typeof o.error === "string" && o.error)
      return [{ tipo: "aviso", aviso: { clase: "error", texto: texto || o.error, codigo: o.error } }];
    const usos = c.filter((b) => b?.type === "tool_use");
    const herramientas = usos.map((b) => herramienta(String(b.name ?? "?"), b.input));
    if (!texto && !herramientas.length && !pensado) return [];
    const out: Evento[] = [
      {
        tipo: "mensaje",
        mid: typeof o.message?.id === "string" ? o.message.id : null,
        texto,
        herramientas,
        modelo: typeof o.message?.model === "string" ? o.message.model : null,
        det: usos.map(detDe),
        ...(pensado ? { pensado } : {}),
      },
    ];
    // El mensaje entero llega antes de que corra la herramienta: ahora se sabe qué hace.
    const u = usos.at(-1);
    if (u) {
      const nombre = String(u.name ?? "?");
      out.push({ tipo: "hace", hace: { que: "herramienta", nombre, ...detalleHace(nombre, u.input) } });
    }
    return out;
  }
  if (o.type === "rate_limit_event") {
    const r = o.rate_limit_info ?? {};
    if (r.status !== "allowed_warning" && r.status !== "rejected") return [];
    const ventana = str(r.rateLimitType);
    const uso = num(r.utilization) ?? (ventana ? num(r.unifiedWindows?.[ventana]?.utilization) : null);
    return [{ tipo: "aviso", aviso: { clase: "limite", rechazado: r.status === "rejected", ventana, hasta: num(r.resetsAt), uso } }];
  }
  if (o.type === "result") {
    const ttl = ttlDeUso(o.usage);
    const errores = Array.isArray(o.errors) ? o.errors.filter((e: unknown) => typeof e === "string" && e) : [];
    const error = o.is_error ? errores.join(" · ") || String(o.result || o.subtype || textoT("main.fallo")) : null;
    const ventanas = ventanasDe(o.modelUsage);
    return [...(ventanas ? [{ tipo: "contexto" as const, ventanas }] : []), { tipo: "fin", error, ttl }];
  }
  if (o.type === "control_response" && typeof o.response?.request_id === "string") {
    const ok = o.response.subtype === "success";
    const out: Evento[] = [{ tipo: "control", id: o.response.request_id, ok, ...(ok ? {} : { error: String(o.response.error ?? "") }) }];
    const r = o.response.response ?? {};
    // `set_permission_mode` contesta `mode`; `initialize`, `current_permission_mode`.
    const modo = esModo(r.mode) ? r.mode : esModo(r.current_permission_mode) ? r.current_permission_mode : null;
    if (ok && modo) out.push({ tipo: "modo", modo });
    if (ok && Array.isArray(r.commands)) out.push({ tipo: "comandos", lista: comandosDe(r.commands, null) });
    if (ok && Array.isArray(r.available_output_styles))
      out.push({ tipo: "estilos", actual: str(r.output_style), lista: estilosDe(r.available_output_styles) });
    return out;
  }
  if (o.type === "control_request" && typeof o.request_id === "string" && o.request?.subtype === "can_use_tool") {
    const r = o.request;
    const nombre = String(r.tool_name ?? "?");
    const plan = nombre === "ExitPlanMode" && typeof r.input?.plan === "string" ? r.input.plan : null;
    const preguntas = nombre === HERRAMIENTA_PREGUNTAS ? preguntasDe(r.input) : null;
    return [
      {
        tipo: "permiso",
        id: o.request_id,
        herramienta: nombre,
        detalle: plan === null && preguntas === null ? (str(r.description) ?? detalle(r.input)) : null,
        plan,
        preguntas,
        input: r.input ?? {},
        tool_use_id: str(r.tool_use_id),
        ...(str(r.decision_reason) ? { razon: str(r.decision_reason)! } : {}),
        ...(str(r.blocked_path) ? { ruta: str(r.blocked_path)! } : {}),
      },
    ];
  }
  if (o.type === "control_cancel_request" && typeof o.request_id === "string") return [{ tipo: "permisoFuera", id: o.request_id }];
  return [];
}

/** Corta lo que llega por stdout en líneas completas; lo que queda a medias vuelve como resto. */
export function cortar(resto: string, trozo: string): { lineas: string[]; resto: string } {
  const t = resto + trozo;
  const fin = t.lastIndexOf("\n");
  if (fin < 0) return { lineas: [], resto: t };
  return { lineas: t.slice(0, fin).split("\n").filter(Boolean), resto: t.slice(fin + 1) };
}

// --- lideres.json --------------------------------------------------------------

export const VERSION_LIDERES = 1;

/** Un líder lanzado desde la app (`~/.local/state/hilos/lideres.json`). */
export type Guardado = {
  sid: string;
  nombre: string;
  modelo: string;
  effort: string;
  /** Epoch: cuándo se creó y cuándo terminó su último turno (0 si nunca). */
  creado: number;
  ultimo: number;
  /** El TTL del caché de su último turno (s), si se supo. */
  cache_ttl_s: number | null;
  /** El último modo de permisos que se le vio (con el que se retoma). */
  modo: Modo;
  /** "analista": el chat de Ramas (B22), que no va en la barra con los demás. */
  rol?: "analista";
  /** Dónde corre, si no es el home: uno que nació en una terminal y se retomó desde la app. */
  cwd?: string;
  /** Epoch: cuándo se lo retomó desde la app sin proceso (vuelve a la barra un día más). */
  retomado?: number;
  /** Epoch: cuándo se vio morir a su proceso sin que la app lo cerrara (kill, OOM, se cayó). Hasta que se lo retome, la barra lo marca Murió. */
  murio?: number;
  /** Por qué murió (lo que dijo su proceso, o por qué no se pudo levantar): se muestra en Murió. */
  motivo?: string;
  /** Epoch: trama se cerró (reinicio, salida) con su proceso vivo. Al arrancar se lo levanta de nuevo con `--resume`. */
  dormido?: number;
};

/** El contenido de `lideres.json` → la lista; lo que no tiene forma se descarta (versión rara: vacío). */
export function leerGuardados(texto: string): Guardado[] {
  let j: any;
  try {
    j = JSON.parse(texto);
  } catch {
    return [];
  }
  if (j?.version !== VERSION_LIDERES || !Array.isArray(j.lideres)) return [];
  return j.lideres
    .filter(
      (l: any) =>
        typeof l?.sid === "string" &&
        SID.test(l.sid) &&
        typeof l.nombre === "string" &&
        typeof l.modelo === "string" &&
        typeof l.effort === "string",
    )
    .map(
      (l: any): Guardado => ({
        sid: l.sid,
        nombre: l.nombre,
        modelo: l.modelo,
        effort: l.effort,
        creado: Number(l.creado) || 0,
        ultimo: Number(l.ultimo) || 0,
        cache_ttl_s: typeof l.cache_ttl_s === "number" ? l.cache_ttl_s : null,
        modo: esModo(l.modo) ? l.modo : MODO_DEFAULT,
        ...(l.rol === "analista" ? { rol: "analista" as const } : {}),
        ...(typeof l.cwd === "string" && path.isAbsolute(l.cwd) ? { cwd: l.cwd } : {}),
        ...(Number(l.retomado) > 0 ? { retomado: Number(l.retomado) } : {}),
        ...(Number(l.murio) > 0 ? { murio: Number(l.murio) } : {}),
        ...(typeof l.motivo === "string" && l.motivo ? { motivo: l.motivo.slice(0, 300) } : {}),
        ...(Number(l.dormido) > 0 ? { dormido: Number(l.dormido) } : {}),
      }),
    );
}

/** El `cwd` de una sesión, del principio de su transcript (las primeras líneas pueden no traerlo). */
export function cwdDeTranscript(texto: string): string | null {
  for (const l of texto.split("\n")) {
    try {
      const cwd = JSON.parse(l)?.cwd;
      if (typeof cwd === "string" && path.isAbsolute(cwd)) return cwd;
    } catch {}
  }
  return null;
}

/** El nombre de sesión de un líder que se retoma: el suyo si sirve para `argvLider`, si no uno interno. */
export const nombreRetomado = (nombre: unknown, azar?: () => number) =>
  typeof nombre === "string" && /^[^\s\0-][^\s\0]*$/.test(nombre) ? nombre : nombreNuevo(azar);

/**
 * Un líder murió si su proceso se fue sin que la app lo cerrara y no fue una salida limpia: lo mató una señal
 * (`codigo` null: OOM, `kill -9`) o salió con error. Lo que cierra la app (`adrede`) o sale con 0 no cuenta.
 */
export const murioProceso = (adrede: boolean, codigo: number | null, error: string | null) => !adrede && (codigo === null || codigo !== 0 || error !== null);

/** La marca con que empieza el aviso que Trama le antepone a un mensaje: la vista no lo muestra. */
const MARCA_AVISO = "[trama] ";

/**
 * Al traer un líder de una terminal a Trama (o retomar uno que murió sin cerrar) se cortan las esperas en
 * segundo plano de ese proceso (un `pa --esperar`): sus workers siguen, pero nadie los recoge. El primer
 * mensaje que sale lo avisa.
 */
export const avisoTraido = (workers: number, origen: "terminal" | "murio" = "terminal") =>
  workers > 0
    ? `${MARCA_AVISO}${origen === "murio" ? "Te retomaron en Trama después de que murió tu proceso" : "Te trajeron de una terminal a Trama"} y se cortaron tus esperas: ${workers === 1 ? "tenés 1 worker corriendo" : `tenés ${workers} workers corriendo`}. Recogé ${workers === 1 ? "su resultado" : "sus resultados"} con pa --esperar-todos antes de seguir con lo demás.\n\n`
    : "";

/** El texto de un mensaje del usuario sin el aviso que le antepuso Trama (`avisoTraido`). */
export const sinAviso = (texto: string) => {
  if (!texto.startsWith(MARCA_AVISO)) return texto;
  const i = texto.indexOf("\n\n");
  return i < 0 ? texto : texto.slice(i + 2);
};

export const escribirGuardados = (ls: Guardado[]) => JSON.stringify({ version: VERSION_LIDERES, lideres: ls }, null, 1) + "\n";

// --- Transcript ----------------------------------------------------------------
// La conversación de un líder, leída de su transcript
// (`~/.claude/projects/<dir>/<sid>.jsonl`) con las mismas reglas que
// `pa --hilo --json` (bin/pa, cmd_hilo): usuario con texto, asistente con texto
// y herramientas, los pedazos del mismo mensaje juntos, sin subagentes, y la
// misma paginación. Diferencia: cada herramienta lleva lo que hizo ("Bash: git status").

type Crudo = {
  rol: "user" | "assistant";
  texto: string;
  herramientas: string[];
  det: Det[];
  ts: string | null;
  modelo: string | null;
  mid: string | null;
  usage: unknown;
  /** Lo que dice de dónde salió (espejo de `Mensaje` en src/datos/contrato.ts; src/hilo/sistema-datos.ts). */
  marcas: Marcas;
  /** Las imágenes que mandó el usuario (B26). */
  imagenes?: Imagen[];
  /** Su razonamiento (los bloques `thinking` con texto), si el transcript lo trae. */
  pensado?: string;
};

type Marcas = {
  meta?: boolean;
  resumen?: boolean;
  origen?: string | null;
  error?: string | null;
  compacto?: { auto: boolean; antes: number | null };
  /** `system/trama_destrabo` (agy-puente): trama cortó un bucle del modelo y le mandó el aviso; `agotado`: ya no lo intenta más. */
  destrabo?: { que: string; agotado: boolean };
};

/** Los campos del transcript que dicen que una línea no la escribió el usuario ni la contestó el modelo. */
function marcasDe(o: any): Marcas {
  const m: Marcas = {};
  if (o.isMeta === true) m.meta = true;
  if (o.isCompactSummary === true) m.resumen = true;
  const k = str(o.origin?.kind);
  if (k) m.origen = k;
  if (o.type === "assistant" && (o.isApiErrorMessage === true || o.message?.model === "<synthetic>"))
    m.error = str(o.error) ?? (o.isApiErrorMessage === true ? "unknown" : null);
  return m;
}

const sintetico = (m: Crudo) => m.modelo === "<synthetic>" || m.marcas.error != null;

export type Pagina = { n?: number; antes?: number | null };

/** El directorio de `~/.claude/projects` de una sesión abierta en `cwd` ("/Users/ana" → "-Users-ana"). */
export const dirProyecto = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

/** Lo que se va sabiendo de una conversación mientras se lee su transcript: sigue de donde quedó (`avanzarConv`). */
export type EstadoConv = {
  todos: Crudo[];
  /** Cada `tool_use` por su id, para pegarle el final de su `tool_result` (llega en un mensaje del usuario). */
  porId: Map<string, Det>;
  compactaciones: number;
  /** Compactó después del último mensaje del asistente: su `usage` es de antes. */
  compactada: boolean;
};

export const convNueva = (): EstadoConv => ({ todos: [], porId: new Map(), compactaciones: 0, compactada: false });

/** Suma al estado las líneas de `texto` (un transcript entero o sólo lo que creció). */
export function avanzarConv(est: EstadoConv, texto: string): void {
  const { todos, porId } = est;
  for (const linea of texto.split("\n")) {
    if (!linea) continue;
    let o: any;
    try {
      o = JSON.parse(linea);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || o.isSidechain === true) continue;
    if (o.type === "system" && o.subtype === "compact_boundary") {
      est.compactaciones++;
      est.compactada = true;
      const cm = o.compactMetadata ?? o.compact_metadata ?? {};
      const compacto = { auto: cm.trigger === "auto", antes: num(cm.preTokens ?? cm.pre_tokens) };
      todos.push({ rol: "assistant", texto: "", herramientas: [], det: [], ts: o.timestamp ?? null, modelo: null, mid: null, usage: null, marcas: { compacto } });
      continue;
    }
    if (o.type === "system" && o.subtype === "trama_destrabo") {
      const destrabo = { que: str(o.que) ?? "", agotado: o.agotado === true };
      todos.push({ rol: "assistant", texto: "", herramientas: [], det: [], ts: o.timestamp ?? null, modelo: null, mid: null, usage: null, marcas: { destrabo } });
      continue;
    }
    if (o.type !== "user" && o.type !== "assistant") continue;
    const c = o.message?.content;
    let m: Crudo;
    if (o.type === "user") {
      for (const r of resultadosDe(c)) {
        const d = porId.get(r.id);
        if (d) d.resultado = { texto: r.texto, error: r.error };
      }
      const t =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c
                .filter((b: any) => b?.type === "text")
                .map((b: any) => b.text)
                .join("\n")
            : "";
      const imagenes = imagenesDeContenido(c);
      if (!t && !imagenes.length) continue;
      m = { rol: "user", texto: sinAviso(t), herramientas: [], det: [], ts: o.timestamp ?? null, modelo: null, mid: null, usage: null, marcas: marcasDe(o) };
      if (imagenes.length) m.imagenes = imagenes;
    } else {
      // El mensaje sintético (límite, error de la API) no pasó por el modelo: su `usage` va en cero.
      if (o.message?.usage && o.message?.model !== "<synthetic>") est.compactada = false;
      const bs: any[] = Array.isArray(c) ? c : [];
      const usos = bs.filter((b) => b?.type === "tool_use");
      const det = usos.map(detDe);
      for (const d of det) if (d.id) porId.set(d.id, d);
      m = {
        rol: "assistant",
        texto: bs
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n"),
        herramientas: usos.map((b) => herramienta(String(b.name ?? "?"), b.input)),
        det,
        ts: o.timestamp ?? null,
        modelo: o.message?.model ?? null,
        mid: o.message?.id ?? null,
        usage: o.message?.usage ?? null,
        marcas: marcasDe(o),
      };
      const pensado = pensadoDe(bs);
      if (pensado) m.pensado = pensado;
    }
    const prev = todos[todos.length - 1];
    if (m.rol === "assistant" && prev?.rol === "assistant" && m.mid !== null && prev.mid === m.mid && !sintetico(m) && !sintetico(prev)) {
      prev.texto = [prev.texto, m.texto].filter((x) => x !== "").join("\n");
      prev.herramientas.push(...m.herramientas);
      prev.det.push(...m.det);
      if (m.pensado) prev.pensado = [prev.pensado, m.pensado].filter(Boolean).join("\n\n");
      prev.usage = m.usage ?? prev.usage;
      prev.modelo = m.modelo ?? prev.modelo;
    } else todos.push(m);
  }
}

export function conversacionDe(id: string, transcript: string | null, texto: string, pag: Pagina = {}) {
  const est = convNueva();
  avanzarConv(est, texto);
  return paginaDe(est, id, transcript, pag);
}

/** Una página de la conversación, con la forma de `pa --hilo --json`. */
export function paginaDe(est: EstadoConv, id: string, transcript: string | null, { n = 50, antes = null }: Pagina = {}) {
  const { todos, compactaciones, compactada } = est;
  // Un paso que sólo razonó (Gemini: el razonamiento y su herramienta son mensajes aparte) cuenta: la tanda del stream lo tiene igual.
  const lista = todos.filter((m) => m.texto !== "" || m.herramientas.length > 0 || m.pensado || m.marcas.compacto || m.marcas.destrabo || m.imagenes);
  const total = lista.length;
  const k = Math.max(1, Math.min(500, Math.floor(n) || 50));
  const hasta = antes == null ? total : Math.min(total, Math.max(0, Math.floor(antes)));
  const desde = Math.max(0, hasta - k);
  // El último que contestó el modelo: el sintético y la marca de compactar no traen `usage`.
  const ult = lista.findLast((m) => m.rol === "assistant" && !sintetico(m) && !m.marcas.compacto && !m.marcas.destrabo);
  return {
    version: 1,
    id,
    proyecto: "",
    transcript,
    total,
    desde,
    hasta,
    mensajes: lista.slice(desde, hasta).map((m, j) => ({
      i: desde + j,
      rol: m.rol,
      texto: m.texto,
      herramientas: m.herramientas,
      ...(m.det.length ? { det: m.det } : {}),
      ...(m.imagenes ? { imagenes: m.imagenes } : {}),
      ...(m.pensado ? { pensado: m.pensado } : {}),
      ts: m.ts,
      modelo: m.modelo,
      ...m.marcas,
    })),
    usage: ult?.usage ?? null,
    modelo: ult?.modelo ?? null,
    /** Cuántas veces compactó la sesión (`system/compact_boundary`); `pa --hilo` no lo trae. */
    compactaciones,
    compactada,
  };
}
