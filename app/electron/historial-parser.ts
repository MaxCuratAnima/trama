// El registro histórico, línea por línea: de un transcript de Claude Code saca lo que una sesión
// consumió (por día y por modelo), lo que usó (skills, herramientas MCP, subagentes, herramientas) y
// lo que se le cargó (skills del listado, plugins y hooks, cada CLAUDE.md, MCP, herramientas) con su
// tamaño en caracteres. De acá salen **sólo números y nombres**: nunca el texto de un mensaje, una
// ruta ni un comando. Sin fs ni Electron: lo prueba `tests/historial.test.ts` y lo maneja
// `electron/historial.ts`, que es el que lee los archivos y guarda.
//
// El formato del transcript no es un contrato y cambia: lo que no se reconoce se saltea y se cuenta
// en `sinDato`. Al cambiar lo que se saca de una línea, subir `PARSER`: lo indexado con otro número
// se rehace mientras su transcript siga en disco.
import path from "node:path";
import { sumaVacia, type Suma } from "./transcripts.ts";

export const PARSER = 1;

export type Rol = "lider" | "worker" | "subagente";

/** Qué es una pieza de lo cargado. Las tres `mcp*` son del mismo servidor: instrucciones, definiciones y nombres diferidos. */
export type Clase =
  | "sistema"
  | "herramientas"
  | "skill"
  | "plugin"
  | "hook"
  | "claudemd"
  | "mcp"
  | "mcp-herramientas"
  | "mcp-diferidas"
  | "diferidas"
  | "agentes"
  | "estilo";

export type Pieza = {
  clase: Clase;
  nombre: string;
  /** Cuánto texto es (lo más que midió, si se anunció más de una vez). */
  chars: number;
  /** Cuántas veces entró al contexto (un hook por cada mensaje, lo que se vuelve a anunciar al compactar). */
  veces: number;
  /** Estaba en el primer pedido: es parte del peso del arranque. */
  inicial: boolean;
};

export type Usos = {
  skills: Record<string, number>;
  mcp: Record<string, number>;
  subagentes: Record<string, number>;
  herramientas: Record<string, number>;
};

/** Lo de un día (local) de la sesión. */
export type Dia = { modelos: Record<string, Suma>; mensajes: number; compactaciones: number; usos: Usos };

/** El primer mensaje del modelo: lo que pesa la sesión antes de hacer nada. Exacto. */
export type Arranque = { entrada: number; cacheCreado: number; cacheLeido: number };

/** Por dónde va la lectura de su archivo, para seguir sin releer. */
export type Estado = {
  leido: number;
  /** Los últimos mensajes contados: `[id, modelo, día, entrada, caché creado, caché leído, salida]`. */
  ids: [string, string, string, number, number, number, number][];
  /** Las últimas llamadas a herramienta contadas (su id). */
  usos: string[];
  /** Caracteres de lo que mandó el usuario antes del primer mensaje del modelo: sólo el número, para calibrar. */
  mensaje: number;
  /** Lo demás que viajó en el primer pedido (entorno, fecha, modelo…), en caracteres. */
  otros: number;
  /** Ya se anotaron las definiciones de las herramientas del primer pedido. */
  herramientas: boolean;
};

export type Sesion = {
  parser: number;
  sid: string;
  /** `agent-<id>` si es el transcript de un subagente; entonces `sid` es el de la sesión que lo lanzó. */
  agente: string | null;
  rol: Rol;
  /** De un subagente: quién lo lanzó. */
  rolPadre: "lider" | "worker" | null;
  /** De un subagente: su `subagent_type`. */
  tipo: string | null;
  /** De un worker: su id de `pa`. */
  worker: string | null;
  proyecto: string | null;
  /** Epoch ms del primer y del último mensaje. */
  inicio: number | null;
  fin: number | null;
  arranque: Arranque | null;
  dias: Record<string, Dia>;
  cargado: Pieza[];
  /** Líneas que el parser no reconoció (un tipo nuevo, JSON roto, un mensaje sin `usage`). */
  sinDato: number;
  estado: Estado;
};

/** Lo que hace falta de afuera para poner nombres sin guardar rutas ni comandos. */
export type Contexto = {
  /** La carpeta del usuario: un `cwd` igual a ella es "~". */
  casa: string;
  /** Texto de un hook de plugin (su comando o su `statusMessage`) → nombre del plugin. */
  plugins: Map<string, string>;
};

export const usosVacios = (): Usos => ({ skills: {}, mcp: {}, subagentes: {}, herramientas: {} });

export function sesionNueva(sid: string, agente: string | null = null): Sesion {
  return {
    parser: PARSER,
    sid,
    agente,
    rol: agente ? "subagente" : "lider",
    rolPadre: null,
    tipo: null,
    worker: null,
    proyecto: null,
    inicio: null,
    fin: null,
    arranque: null,
    dias: {},
    cargado: [],
    sinDato: 0,
    estado: { leido: 0, ids: [], usos: [], mensaje: 0, otros: 0, herramientas: false },
  };
}

/** El día local de un instante, `AAAA-MM-DD`. */
export function diaDe(ms: number): string {
  const d = new Date(ms);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

const IDS = 8;
const USOS = 32;
const NOMBRE = 96;

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
const texto = (x: unknown): string => (typeof x === "string" ? x : "");
const largo = (x: unknown): number => (typeof x === "string" ? x.length : x == null ? 0 : (JSON.stringify(x) ?? "").length);
const lista = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const objeto = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
/** Un nombre: una línea, corto, sin caracteres de control. */
const limpio = (x: unknown): string => texto(x).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, NOMBRE);

/** El servidor de una herramienta MCP (`mcp__servidor__herramienta`), o `null` si no es de MCP. */
export function servidorMcp(herramienta: string): string | null {
  if (!herramienta.startsWith("mcp__")) return null;
  const resto = herramienta.slice(5);
  const corte = resto.indexOf("__");
  return (corte < 0 ? resto : resto.slice(0, corte)) || null;
}

/** El nombre de un servidor como lo llevan sus herramientas ("claude.ai Calendar" → `claude_ai_Calendar`). */
export const nombreMcp = (x: unknown): string => limpio(x).replace(/[^A-Za-z0-9_-]/g, "_");

/** El nombre de una carpeta; el worktree de un worker (`atlas@2`) es su proyecto. */
const carpetaDe = (dir: string, casa: string): string => (dir === casa ? "~" : path.basename(dir).replace(/@\d+$/, "") || "~");

/** El nombre de un CLAUDE.md: su carpeta y su archivo, nunca la ruta ("~/Proyectos/atlas/CLAUDE.md" → "atlas/CLAUDE.md"). */
export function nombreArchivo(ruta: string, casa: string): string {
  return limpio(`${carpetaDe(path.dirname(ruta), casa)}/${path.basename(ruta)}`);
}

/** El proyecto de una sesión: el nombre de la carpeta donde corre ("~" si es la del usuario). */
export const nombreProyecto = (cwd: string, casa: string): string => limpio(carpetaDe(cwd, casa)) || "~";
/** ¿Una ruta de Windows (`C:\...`, `C:/...`, `\\servidor\...`)? Con `\` ya alcanza para tratarla así. */
const esWindows = (dir: string): boolean => /^[a-zA-Z]:[\\/]/.test(dir) || dir.includes("\\");

/**
 * La ruta para comparar: sin separadores de más al final y sin el `@N` de un worktree de `pa`. En Windows, `/` en vez de
 * `\` y sin mayúsculas (`C:\Trama\Atlas` y `c:/trama/atlas` son la misma carpeta).
 */
function normalizada(dir: string): string {
  const r = dir.replace(/[\\/]+$/, "").replace(/@\d+$/, "");
  return esWindows(dir) ? r.replace(/\\/g, "/").toLowerCase() : r;
}

/**
 * La clave con que se agrupan los chats de una carpeta: su ruta completa normalizada (no sólo el nombre, que puede
 * repetirse). Un worktree de `pa` (`atlas@2`) cae en la de `atlas`. La carpeta del usuario es siempre "~".
 */
export function claveCarpeta(cwd: string, casa: string): string {
  return normalizada(cwd) === normalizada(casa) ? "~" : normalizada(cwd);
}

/** La ruta de una carpeta como se muestra: con sus mayúsculas, sin el `@N` del worktree; la del usuario, "~". */
export function rutaProyecto(cwd: string, casa: string): string {
  if (normalizada(cwd) === normalizada(casa)) return "~";
  return cwd.replace(/[\\/]+$/, "").replace(/@\d+$/, "");
}

/**
 * El nombre con que se ve cada carpeta de un conjunto (clave → ruta): su nombre de carpeta. Si dos claves distintas se
 * llaman igual, se suma la carpeta padre (`app/atlas` y `otro/atlas`), y así hasta que no choquen o hasta la ruta entera.
 */
export function nombresDeCarpetas(rutas: ReadonlyMap<string, string>): Map<string, string> {
  const partes = new Map<string, string[]>();
  for (const [k, r] of rutas) partes.set(k, r === "~" ? ["~"] : r.split(/[\\/]/).filter(Boolean));
  const prof = new Map<string, number>([...partes.keys()].map((k) => [k, 1]));
  const nombre = (k: string): string => partes.get(k)!.slice(-prof.get(k)!).join("/") || "~";
  for (;;) {
    const porNombre = new Map<string, string[]>();
    for (const k of partes.keys()) porNombre.set(nombre(k), [...(porNombre.get(nombre(k)) ?? []), k]);
    let cambio = false;
    for (const ks of porNombre.values()) {
      if (ks.length < 2) continue;
      for (const k of ks) {
        if (prof.get(k)! < partes.get(k)!.length) {
          prof.set(k, prof.get(k)! + 1);
          cambio = true;
        }
      }
    }
    if (!cambio) break;
  }
  return new Map([...partes.keys()].map((k) => [k, nombre(k)]));
}

/** Un chat con la carpeta donde corrió (`cwd`) y su última actividad (`fin`, epoch ms). Sin `cwd`, no se agrupa. */
export type ChatConCarpeta = { cwd: string; fin: number | null };

/** Una carpeta con sus chats: el más reciente primero; las carpetas, por su chat más reciente. */
export type CarpetaDeChats<T> = { clave: string; ruta: string; nombre: string; ultimo: number; chats: T[] };

/**
 * Los chats agrupados por carpeta (la ruta completa normalizada, no el nombre), como Claude Code los guarda en
 * `projects/<carpeta>/`: dentro de cada una, por última actividad; las carpetas, por la de su chat más reciente.
 * Los que no tienen `cwd` se saltean. Es una función pura: quien la llama es el que sabe el `cwd` de cada chat.
 */
export function agruparPorCarpeta<T extends ChatConCarpeta>(chats: readonly T[], casa: string): CarpetaDeChats<T>[] {
  const rutas = new Map<string, string>();
  const grupos = new Map<string, T[]>();
  for (const c of chats) {
    if (!c.cwd) continue;
    const k = claveCarpeta(c.cwd, casa);
    if (!rutas.has(k)) rutas.set(k, rutaProyecto(c.cwd, casa));
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  const nombres = nombresDeCarpetas(rutas);
  return [...grupos]
    .map(([clave, lista]) => {
      const ordenados = [...lista].sort((a, b) => (b.fin ?? 0) - (a.fin ?? 0));
      return { clave, ruta: rutas.get(clave)!, nombre: nombres.get(clave)!, ultimo: ordenados[0]?.fin ?? 0, chats: ordenados };
    })
    .sort((a, b) => b.ultimo - a.ultimo || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
}

const GUION = /([\w.-]+\.(?:sh|bash|fish|zsh|py|mjs|cjs|js|ts|rb|pl))(?![\w.-])/;
const DE_PLUGIN = /\/plugins\/(?:cache|marketplaces)\/[^/\s]+\/([^/\s]+)\//;

/**
 * Cómo se llama lo que inyectó un hook, sin guardar su comando (trae rutas): el plugin si es de uno,
 * si no el nombre de su script, y si no el evento.
 */
export function nombreHook(comando: string, evento: string, plugins: Map<string, string>): { clase: "plugin" | "hook"; nombre: string } {
  const plugin = plugins.get(comando.trim()) ?? DE_PLUGIN.exec(comando)?.[1];
  if (plugin) return { clase: "plugin", nombre: limpio(plugin) };
  const guion = GUION.exec(comando)?.[1];
  return { clase: "hook", nombre: limpio(guion ?? evento) || "hook" };
}

/** Lo que el modelo contestó o lo que se le cargó: lo único que se parsea. */
const QUIERE = /"type":"(?:assistant|attachment)"|"compact_boundary"/;
/** Los adjuntos de los que sale una pieza. */
const CON_PIEZA = new Set([
  "skill_listing", "instructions", "nested_memory", "hook_success", "hook_additional_context", "mcp_instructions_delta",
  "deferred_tools_delta", "deferred_tools_record", "agent_listing_delta", "prompt_snapshot", "output_style_instructions",
]);
/** El tipo de un adjunto sin parsear la línea (Claude Code lo escribe primero). */
const TIPO_ADJUNTO = /"attachment":\{"type":"([A-Za-z_-]+)"/;
/** Líneas que se conocen y no traen nada para el registro. */
const CONOCIDA =
  /"type":"(?:user|system|last-prompt|atis-latch|agent-name|custom-title|ai-title|queue-operation|mode|permission-mode|cost-state|file-history-snapshot|file-history-delta|bridge-session|summary)"/;
/** Adjuntos que se conocen y no se guardan (los del arranque sólo suman su tamaño). */
const ADJUNTOS_SIN_PIEZA = new Set([
  "total_tokens_reminder", "output_style", "silent_turn_reminder", "environment", "batching_reminder_sent", "date", "remote_session_change",
  "model", "session_context", "credential_org", "compact_file_reference", "file", "task_status", "auto_mode", "edited_text_file",
  "queued_command", "thinking_drop", "hook_non_blocking_error", "bash_output_audience_note", "command_permissions", "invoked_skills",
  "plan_file_reference", "hook_system_message", "plan_mode", "plan_mode_exit", "read_truncation_notice", "dynamic_skill",
]);

function dia(s: Sesion, clave: string): Dia {
  return (s.dias[clave] ??= { modelos: {}, mensajes: 0, compactaciones: 0, usos: usosVacios() });
}

function tokens(en: Dia, modelo: string, e: number, cc: number, cl: number, sa: number, signo: 1 | -1): void {
  const x = (en.modelos[modelo] ??= sumaVacia());
  x.entrada += signo * e;
  x.cacheCreado += signo * cc;
  x.cacheLeido += signo * cl;
  x.salida += signo * sa;
}

/** Una pieza cargada: si ya estaba, cuenta una vez más y se queda con su tamaño mayor. */
function pieza(s: Sesion, clase: Clase, nombre: string, chars: number, inicial = s.arranque === null): void {
  if (!nombre || chars <= 0) return;
  const p = s.cargado.find((x) => x.clase === clase && x.nombre === nombre);
  if (!p) {
    s.cargado.push({ clase, nombre, chars, veces: 1, inicial });
    return;
  }
  p.veces++;
  if (chars > p.chars) p.chars = chars;
}

/** La hora de una línea (y de paso el principio y el fin de la sesión). `null`: no la trae. */
function hora(s: Sesion, d: Record<string, unknown>): number | null {
  const ms = typeof d.timestamp === "string" ? Date.parse(d.timestamp) : NaN;
  if (!Number.isFinite(ms)) return null;
  if (s.inicio === null || ms < s.inicio) s.inicio = ms;
  if (s.fin === null || ms > s.fin) s.fin = ms;
  return ms;
}

/**
 * Una línea del transcript. Nunca tira: lo que no se entiende suma en `sinDato`. `true` si la
 * línea se parseó (para medir cuánto del archivo hizo falta mirar).
 */
export function linea(s: Sesion, cruda: string, ctx: Contexto): boolean {
  if (!cruda) return false;
  if (!QUIERE.test(cruda)) {
    // Lo que escribió el usuario antes de la primera respuesta viajó en el primer pedido: cuenta su tamaño.
    if (s.arranque === null && cruda.includes('"type":"user"')) return previo(s, cruda);
    if (!CONOCIDA.test(cruda)) s.sinDato++;
    return false;
  }
  // Un adjunto que no es de los que se guardan, pasado el arranque: ni se parsea.
  if (s.arranque !== null && !cruda.includes('"type":"assistant"') && !cruda.includes('"compact_boundary"')) {
    const tipo = TIPO_ADJUNTO.exec(cruda)?.[1];
    if (tipo && !CON_PIEZA.has(tipo)) {
      if (!ADJUNTOS_SIN_PIEZA.has(tipo)) s.sinDato++;
      return false;
    }
  }
  let d: Record<string, unknown> | null;
  try {
    d = objeto(JSON.parse(cruda));
  } catch {
    d = null;
  }
  if (!d) {
    s.sinDato++;
    return false;
  }
  if (!s.proyecto && typeof d.cwd === "string" && d.cwd) s.proyecto = nombreProyecto(d.cwd, ctx.casa);
  if (d.type === "assistant") asistente(s, d);
  else if (d.type === "attachment") adjunto(s, d, ctx);
  else if (d.type === "system" && d.subtype === "compact_boundary") {
    const ms = hora(s, d) ?? s.fin;
    if (ms === null) s.sinDato++;
    else dia(s, diaDe(ms)).compactaciones++;
  } else if (d.type === "user") {
    // Un mensaje del usuario que cita una de las marcas: no es nada de lo buscado.
    if (s.arranque === null) s.estado.mensaje += largo(objeto(d.message)?.content);
  } else if (typeof d.type !== "string" || !CONOCIDA.test(`"type":"${d.type}"`)) s.sinDato++;
  return true;
}

function previo(s: Sesion, cruda: string): boolean {
  try {
    const d = objeto(JSON.parse(cruda));
    if (d?.type !== "user") return false;
    hora(s, d);
    s.estado.mensaje += largo(objeto(d.message)?.content);
    return true;
  } catch {
    s.sinDato++;
    return false;
  }
}

function asistente(s: Sesion, d: Record<string, unknown>): void {
  const m = objeto(d.message);
  const modelo = texto(m?.model);
  // Los mensajes sintéticos (un error, un corte) no los contestó ningún modelo.
  if (modelo === "<synthetic>") return;
  const u = objeto(m?.usage);
  const ms = hora(s, d) ?? s.fin;
  if (!m || !modelo || !u || ms === null) {
    s.sinDato++;
    return;
  }
  const hoy = diaDe(ms);
  const e = num(u.input_tokens);
  const cc = num(u.cache_creation_input_tokens);
  const cl = num(u.cache_read_input_tokens);
  const sa = num(u.output_tokens);
  // Un mensaje ocupa varias líneas (una por bloque) con el mismo id y el mismo `usage`: se cuenta
  // una vez, y si una línea posterior trae otro `usage`, vale el último.
  const id = texto(m.id);
  const ids = s.estado.ids;
  const i = id ? ids.findIndex((x) => x[0] === id) : -1;
  if (i >= 0) {
    const [, mo, di, e0, cc0, cl0, sa0] = ids[i];
    tokens(dia(s, di), mo, e0, cc0, cl0, sa0, -1);
    tokens(dia(s, di), modelo, e, cc, cl, sa, 1);
    ids[i] = [id, modelo, di, e, cc, cl, sa];
  } else {
    const x = dia(s, hoy);
    tokens(x, modelo, e, cc, cl, sa, 1);
    x.mensajes++;
    if (id) {
      ids.push([id, modelo, hoy, e, cc, cl, sa]);
      if (ids.length > IDS) ids.shift();
    }
    s.arranque ??= { entrada: e, cacheCreado: cc, cacheLeido: cl };
  }
  for (const b of lista(m.content)) {
    const bloque = objeto(b);
    if (bloque?.type !== "tool_use") continue;
    const nombre = limpio(bloque.name);
    if (!nombre) continue;
    const uid = texto(bloque.id);
    if (uid) {
      if (s.estado.usos.includes(uid)) continue;
      s.estado.usos.push(uid);
      if (s.estado.usos.length > USOS) s.estado.usos.shift();
    }
    const usos = dia(s, hoy).usos;
    const mas = (en: Record<string, number>, k: string) => void (en[k] = (en[k] ?? 0) + 1);
    mas(usos.herramientas, nombre);
    const entrada = objeto(bloque.input);
    if (nombre === "Skill") {
      const skill = limpio(entrada?.skill);
      if (skill) mas(usos.skills, skill);
    } else if (nombre === "Agent" || nombre === "Task") {
      // Sin `subagent_type`, Claude Code lanza el de uso general.
      mas(usos.subagentes, limpio(entrada?.subagent_type) || "general-purpose");
    } else if (nombre.startsWith("mcp__")) mas(usos.mcp, nombre);
  }
}

/** Reparte un listado ("- nombre: descripción", a veces en varios renglones) entre sus nombres. */
function listado(contenido: string, nombres: string[]): Map<string, number> {
  const r = new Map<string, number>();
  const de = new Set(nombres);
  let actual: string | null = null;
  const renglones = contenido.split("\n");
  renglones.forEach((renglon, i) => {
    if (renglon.startsWith("- ")) {
      // El nombre puede traer ":" (el prefijo de su plugin): se prueba del más largo al más corto.
      let corte = renglon.length;
      let nombre: string | null = null;
      while ((corte = renglon.lastIndexOf(":", corte - 1)) > 2) {
        const candidato = renglon.slice(2, corte);
        if (de.size ? de.has(candidato) : !/\s/.test(candidato)) {
          nombre = candidato;
          break;
        }
      }
      if (nombre) actual = nombre;
    }
    // Con su salto de línea, salvo el último renglón, que no lo tiene.
    if (actual) r.set(actual, (r.get(actual) ?? 0) + renglon.length + (i < renglones.length - 1 ? 1 : 0));
  });
  return r;
}

function adjunto(s: Sesion, d: Record<string, unknown>, ctx: Contexto): void {
  hora(s, d);
  const a = objeto(d.attachment);
  const tipo = texto(a?.type);
  if (!a || !tipo) {
    s.sinDato++;
    return;
  }
  const inicial = s.arranque === null;
  switch (tipo) {
    case "skill_listing": {
      const contenido = texto(a.content);
      const partes = listado(contenido, lista(a.names).map(texto).filter(Boolean));
      let repartido = 0;
      for (const [nombre, chars] of partes) {
        pieza(s, "skill", limpio(nombre), chars);
        repartido += chars;
      }
      // El encabezado del listado (o un listado que no se pudo repartir) no es de ninguna skill.
      if (inicial) s.estado.otros += Math.max(0, contenido.length - repartido);
      if (!partes.size && contenido) s.sinDato++;
      return;
    }
    case "instructions":
      for (const f of lista(a.files)) {
        const archivo = objeto(f);
        if (typeof archivo?.path === "string") pieza(s, "claudemd", nombreArchivo(archivo.path, ctx.casa), largo(archivo.content));
      }
      return;
    case "nested_memory": {
      const c = objeto(a.content);
      const ruta = texto(c?.path) || texto(a.path);
      if (ruta) pieza(s, "claudemd", nombreArchivo(ruta, ctx.casa), largo(c?.content));
      return;
    }
    case "hook_success": {
      // Un hook que no devolvió texto (un latido) no cargó nada.
      const chars = largo(a.content);
      if (!chars) return;
      const evento = limpio(a.hookEvent) || limpio(a.hookName);
      const { clase, nombre } = nombreHook(texto(a.command), evento, ctx.plugins);
      pieza(s, clase, nombre, chars);
      return;
    }
    case "hook_additional_context": {
      const chars = lista(a.content).reduce<number>((n, x) => n + largo(x), 0);
      pieza(s, "hook", limpio(a.hookName) || limpio(a.hookEvent) || "hook", chars);
      return;
    }
    case "mcp_instructions_delta": {
      const bloques = lista(a.addedBlocks);
      lista(a.addedNames).forEach((n, i) => pieza(s, "mcp", nombreMcp(n), largo(bloques[i])));
      return;
    }
    case "deferred_tools_delta": {
      // Las diferidas sólo cargan su nombre; la definición entra recién cuando se la busca.
      const renglones = lista(a.addedLines);
      const por = new Map<string, number>();
      lista(a.addedNames).forEach((n, i) => {
        const nombre = texto(n);
        const k = servidorMcp(nombre) ?? "";
        por.set(k, (por.get(k) ?? 0) + (largo(renglones[i]) || nombre.length) + 1);
      });
      for (const [servidor, chars] of por) {
        if (servidor) pieza(s, "mcp-diferidas", limpio(servidor), chars);
        else pieza(s, "diferidas", "nombres", chars);
      }
      return;
    }
    case "deferred_tools_record": {
      // Las que se fueron a buscar: ahora sí viaja su definición entera.
      const por = new Map<string, number>();
      for (const x of lista(a.entries)) {
        const h = objeto(x);
        if (!h) continue;
        const k = servidorMcp(texto(h.name)) ?? "";
        por.set(k, (por.get(k) ?? 0) + largo(h));
      }
      for (const [servidor, chars] of por) {
        if (servidor) pieza(s, "mcp-herramientas", limpio(servidor), chars, false);
        else pieza(s, "diferidas", "cargadas", chars, false);
      }
      return;
    }
    case "agent_listing_delta":
      pieza(s, "agentes", "agentes", lista(a.addedLines).reduce<number>((n, x) => n + largo(x) + 1, 0));
      return;
    case "output_style_instructions": {
      const estilo = objeto(a.style);
      pieza(s, "estilo", limpio(estilo?.name) || "estilo", largo(estilo?.prompt));
      return;
    }
    case "prompt_snapshot": {
      const sistema = lista(a.systemPrompt).reduce<number>((n, x) => n + largo(x), 0);
      if (!s.cargado.some((p) => p.clase === "sistema")) pieza(s, "sistema", "sistema", sistema, true);
      // Las definiciones de las herramientas llegan una vez, un par de líneas después de la primera
      // respuesta: son las del primer pedido.
      if (Array.isArray(a.tools) && !s.estado.herramientas) {
        s.estado.herramientas = true;
        const por = new Map<string, number>();
        for (const x of a.tools) {
          const k = servidorMcp(texto(objeto(x)?.name)) ?? "";
          por.set(k, (por.get(k) ?? 0) + largo(x));
        }
        for (const [servidor, chars] of por) {
          if (servidor) pieza(s, "mcp-herramientas", limpio(servidor), chars, true);
          else pieza(s, "herramientas", "herramientas", chars, true);
        }
      }
      return;
    }
    default:
      if (!ADJUNTOS_SIN_PIEZA.has(tipo)) s.sinDato++;
      if (inicial) s.estado.otros += largo(a);
  }
}

/** Caracteres por token cuando no se puede calibrar (lo que decidió el usuario). */
export const CHARS_POR_TOKEN = 3.5;

export const pesoArranque = (a: Arranque): number => a.entrada + a.cacheCreado + a.cacheLeido;

/**
 * Cuántos caracteres hacen un token **en esta sesión**: todo el texto conocido del primer pedido
 * contra su peso exacto. Sólo vale (`calibrada`) si el transcript trae el sistema y las definiciones
 * de las herramientas; si no, 3,5, achicado si con eso lo conocido pesara más que el arranque entero.
 * Siempre es una estimación: el peso de una pieza es `chars / k`.
 */
export function calibrar(s: Sesion): { k: number; calibrada: boolean } {
  const exacto = s.arranque ? pesoArranque(s.arranque) : 0;
  let chars = s.estado.mensaje + s.estado.otros;
  for (const p of s.cargado) if (p.inicial) chars += p.chars;
  if (exacto <= 0 || chars <= 0) return { k: CHARS_POR_TOKEN, calibrada: false };
  const k = chars / exacto;
  const completo = s.estado.herramientas && s.cargado.some((p) => p.clase === "sistema");
  // Fuera de 1,5 a 8 no es un tokenizador: algo del arranque no se entendió.
  if (completo && k >= 1.5 && k <= 8) return { k, calibrada: true };
  return { k: Math.max(CHARS_POR_TOKEN, k), calibrada: false };
}
