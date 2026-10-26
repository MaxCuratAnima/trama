// Los subagentes que una sesión de Claude Code lanza con su herramienta Agent (en segundo plano o no).
// `pa` no sabe de ellos: cada uno escribe su transcript en
// `~/.claude/projects/<cwd>/<session_id>/subagents/agent-<id>.jsonl` (+ `.meta.json` con la descripción) y
// eso se mira con inotify: sin polling, y sin leer la conversación del líder. De ahí salen **sólo** lo que se
// muestra: descripción, modelo, estado, cuándo arrancó, la última herramienta o frase, los tokens y su informe.
// Estado: el último mensaje del subagente decide (cerró su turno → terminado; error de la API → error; si no,
// corriendo). Sólo se siguen sesiones con proceso vivo (`sincronizar`): una sin proceso no tiene a nadie corriendo.
// Sin Electron ni imports locales salvo mirar.ts: lo prueba `tests/subagentes.test.ts`.
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mirarCarpeta, type Mirada } from "./mirar.ts";
import { silencio } from "./log.ts";

export type EstadoSubagente = "corriendo" | "terminado" | "error";

export type Subagente = {
  id: string;
  /** La sesión que lo lanzó. */
  sid: string;
  descripcion: string;
  /** Lindo ("Haiku 5.5"); si no se vio todavía, lo que pidió ("haiku") o `null`. */
  modelo: string | null;
  /** El tipo de agente ("general-purpose", "Explore"…), si lo dice. */
  tipo: string | null;
  estado: EstadoSubagente;
  /** Epoch s: su primer mensaje. */
  inicio: number;
  /** Epoch s del último mensaje (de ahí sale cuándo terminó). */
  ultimo_en: number;
  /** Lo último que hizo, una línea: "Bash: sleep 20" o el principio de lo que dijo. */
  ultimo: string | null;
  /** Tamaño de la conversación del subagente en su último mensaje (entrada + caché + salida). */
  tokens: number;
  /** Las primeras líneas de su informe, ya terminado. */
  resultado: string | null;
  /** El informe tiene más que `resultado`: se pide entero con `informe`. */
  hay_mas: boolean;
};

const LINEAS_RESUMEN = 6;
const CARACTERES_RESUMEN = 700;
/** Tope de lo que se lee de atrás: el final del transcript alcanza para el último mensaje. */
const COLA_BYTES = 1024 * 1024;
const TOPE_INFORME = 200_000;
const DEBOUNCE_MS = 200;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** "claude-haiku-5-5" → "Haiku 5.5"; lo que no reconoce queda como vino. */
export function modeloCorto(m: string): string {
  const x = m.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
}

const unaLinea = (t: string) => t.replace(/\s+/g, " ").trim();

/** Lo que hace una herramienta, en pocas palabras: el comando, el archivo, la búsqueda. */
function detalleHerramienta(nombre: string, input: any): string {
  const i = input && typeof input === "object" ? input : {};
  const v = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt ?? "";
  const d = unaLinea(String(v)).slice(0, 300);
  return d ? `${nombre}: ${d}` : nombre;
}

type Mensaje = { tipo: "assistant" | "user"; ts: number; msg: any; error: boolean };

/** Las líneas de mensaje (assistant/user) de un trozo de transcript; ignora lo demás y lo ilegible. */
function mensajesDe(texto: string): Mensaje[] {
  const r: Mensaje[] = [];
  for (const linea of texto.split("\n")) {
    if (!linea.includes('"message":') || linea.length > 300_000) continue;
    let o: any;
    try {
      o = JSON.parse(linea);
    } catch {
      continue;
    }
    if ((o?.type !== "assistant" && o?.type !== "user") || !o.message) continue;
    const ts = Date.parse(o.timestamp);
    r.push({ tipo: o.type, ts: Number.isFinite(ts) ? Math.floor(ts / 1000) : 0, msg: o.message, error: o.isApiErrorMessage === true });
  }
  return r;
}

const textoDe = (msg: any): string =>
  typeof msg?.content === "string"
    ? msg.content
    : (Array.isArray(msg?.content) ? msg.content : [])
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("\n");

function tokensDe(u: any): number {
  if (!u || typeof u !== "object") return 0;
  return [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, u.output_tokens].reduce<number>((s, x) => s + (typeof x === "number" ? x : 0), 0);
}

/** Primeras líneas de un informe, con tope; `mas` si había más. */
export function resumir(texto: string): { resumen: string; mas: boolean } {
  const lineas = texto.trim().split("\n");
  let r = lineas.slice(0, LINEAS_RESUMEN).join("\n");
  if (r.length > CARACTERES_RESUMEN) r = r.slice(0, CARACTERES_RESUMEN);
  return { resumen: r, mas: r.length < texto.trim().length };
}

/**
 * Lo que dicen el principio y el final del transcript de un subagente (y su meta). `cola`: el final, desde una línea
 * entera; `cabeza`: el principio, que trae el primer mensaje con la hora de arranque.
 */
export function leerSubagente(sid: string, id: string, meta: any, cabeza: string, cola: string, nacio: number): Subagente {
  const msgs = mensajesDe(cola);
  const primero = mensajesDe(cabeza)[0];
  const ultimoMsg = msgs[msgs.length - 1];
  let ultimoAsistente: Mensaje | undefined;
  for (let i = msgs.length - 1; i >= 0 && !ultimoAsistente; i--) if (msgs[i].tipo === "assistant") ultimoAsistente = msgs[i];
  const inicio = primero?.ts || nacio;

  let estado: EstadoSubagente = "corriendo";
  if (ultimoMsg && ultimoMsg.tipo === "assistant") {
    if (ultimoMsg.error) estado = "error";
    else if (ultimoMsg.msg.stop_reason === "end_turn" || ultimoMsg.msg.stop_reason === "stop_sequence" || ultimoMsg.msg.stop_reason === "max_tokens") estado = "terminado";
  }
  // `finished` lo escribe Claude Code al cerrar el subagente: si dice que terminó y el final no se pudo leer, terminó.
  if (estado === "corriendo" && meta?.finished === true && !ultimoMsg) estado = "terminado";

  // Lo último que hizo: la herramienta del último mensaje con una, o la frase con la que cerró.
  let ultimo: string | null = null;
  for (let i = msgs.length - 1; i >= 0 && ultimo === null; i--) {
    const m = msgs[i];
    if (m.tipo !== "assistant" || !Array.isArray(m.msg.content)) continue;
    for (let j = m.msg.content.length - 1; j >= 0; j--) {
      const b = m.msg.content[j];
      if (b?.type === "tool_use") {
        ultimo = detalleHerramienta(String(b.name ?? "?"), b.input);
        break;
      }
      if (b?.type === "text" && unaLinea(b.text ?? "")) {
        ultimo = unaLinea(b.text).slice(0, 300);
        break;
      }
    }
  }

  const informe = estado === "terminado" && ultimoAsistente ? textoDe(ultimoAsistente.msg).trim() : "";
  const r = informe ? resumir(informe) : null;
  return {
    id,
    sid,
    descripcion: typeof meta?.description === "string" && meta.description ? meta.description : id,
    modelo: ultimoAsistente?.msg?.model ? modeloCorto(String(ultimoAsistente.msg.model)) : typeof meta?.model === "string" ? meta.model : null,
    tipo: typeof meta?.agentType === "string" ? meta.agentType : null,
    estado,
    inicio,
    ultimo_en: ultimoMsg?.ts || inicio,
    ultimo,
    tokens: tokensDe(ultimoAsistente?.msg?.usage),
    resultado: r?.resumen ?? null,
    hay_mas: r?.mas ?? false,
  };
}

/** Los `n` bytes del final de un archivo, empezando en una línea entera. */
async function colaDe(archivo: string, tamano: number, n = COLA_BYTES): Promise<string> {
  const fh = await open(archivo, "r");
  try {
    const desde = Math.max(0, tamano - n);
    const buf = Buffer.alloc(tamano - desde);
    await fh.read(buf, 0, buf.length, desde);
    const t = buf.toString("utf8");
    return desde > 0 ? t.slice(t.indexOf("\n") + 1) : t;
  } finally {
    await fh.close();
  }
}

async function cabezaDe(archivo: string): Promise<string> {
  const fh = await open(archivo, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const t = buf.toString("utf8", 0, bytesRead);
    const i = t.indexOf("\n");
    return i >= 0 ? t.slice(0, i) : t;
  } finally {
    await fh.close();
  }
}

/** Los subagentes de una carpeta `subagents/`, los más nuevos primero. `cache` evita releer lo que no cambió. */
export async function leerCarpeta(dir: string, sid: string, cache?: Map<string, { firma: string; sub: Subagente }>): Promise<Subagente[]> {
  const nombres = await readdir(dir).catch(() => [] as string[]);
  const r: Subagente[] = [];
  for (const n of nombres) {
    const m = n.match(/^agent-(.+)\.jsonl$/);
    if (!m || !ID.test(m[1])) continue;
    const archivo = path.join(dir, n);
    const s = await stat(archivo).catch(() => null);
    if (!s?.isFile()) continue;
    const metaArchivo = path.join(dir, `agent-${m[1]}.meta.json`);
    const sm = await stat(metaArchivo).catch(() => null);
    const firma = `${s.size}:${s.mtimeMs}:${sm?.mtimeMs ?? 0}`;
    const previo = cache?.get(archivo);
    if (previo && previo.firma === firma) {
      r.push(cortado(previo.sub, s.mtimeMs));
      continue;
    }
    try {
      const meta = sm ? JSON.parse(await readFile(metaArchivo, "utf8")) : null;
      const sub = leerSubagente(sid, m[1], meta, await cabezaDe(archivo), await colaDe(archivo, s.size), Math.floor(s.birthtimeMs / 1000));
      cache?.set(archivo, { firma, sub });
      r.push(cortado(sub, s.mtimeMs));
    } catch (e) {
      silencio("subagentes")(e);
    }
  }
  return r.sort((a, b) => b.inicio - a.inicio || (a.id < b.id ? -1 : 1));
}

/** Sin escribir hace esto, uno "corriendo" murió (su sesión se reinició o lo mataron sin aviso). */
const MUDO_MS = 20 * 60 * 1000;

/** Un "corriendo" cuyo transcript no se toca hace más de MUDO_MS pasa a error: si no, queda fantasma en la barra. */
export function cortado(sub: Subagente, mtimeMs: number, ahora = Date.now()): Subagente {
  return sub.estado === "corriendo" && ahora - mtimeMs > MUDO_MS ? { ...sub, estado: "error" } : sub;
}

/** El informe entero de un subagente (el texto con el que cerró), con tope. `null` si no terminó o no se encuentra. */
export async function informeDe(dir: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !ID.test(id)) return null;
  const archivo = path.join(dir, `agent-${id}.jsonl`);
  const s = await stat(archivo).catch(() => null);
  if (!s?.isFile()) return null;
  const msgs = mensajesDe(await colaDe(archivo, s.size));
  const ultimo = msgs[msgs.length - 1];
  if (!ultimo || ultimo.tipo !== "assistant") return null;
  const t = textoDe(ultimo.msg).trim();
  return t ? t.slice(0, TOPE_INFORME) : null;
}

/**
 * Los cierres que la sesión recibió de sus subagentes (`<task-notification>` en su transcript): id → último estado
 * y cuándo. Un subagente al que cortaron (`killed`, `stopped`) o que falló no escribe un último mensaje propio.
 */
export function avisosDe(texto: string): Map<string, { status: string; ts: number }> {
  const r = new Map<string, { status: string; ts: number }>();
  for (const linea of texto.split("\n")) {
    if (!linea.includes("<task-id>") || linea.length > 300_000) continue;
    const id = linea.match(/<task-id>([A-Za-z0-9._-]+)<\/task-id>/)?.[1];
    const status = linea.match(/<status>([a-z_]+)<\/status>/)?.[1];
    const ts = Date.parse(linea.match(/"timestamp":"([^"]+)"/)?.[1] ?? "");
    if (id && status) r.set(id, { status, ts: Number.isFinite(ts) ? Math.floor(ts / 1000) : 0 });
  }
  return r;
}

const MAL_CERRADOS = new Set(["failed", "killed", "stopped"]);

export type Subagentes = Record<string, Subagente[]>;

type Opciones = {
  /** Dónde está el transcript de la sesión (su `.jsonl`); de ahí cuelga su carpeta. `null`: no se encontró. */
  transcript: (sid: string) => Promise<string | null>;
  alCambiar: (todos: Subagentes) => void;
};

type Seguida = { sid: string; dir: string; avisos: { firma: string; por: Map<string, { status: string; ts: number }> } | null; cache: Map<string, { firma: string; sub: Subagente }>; miradas: Mirada[]; nivel: number; lista: Subagente[] };

export function crearSubagentes(o: Opciones) {
  const seguidas = new Map<string, Seguida>();
  let espera: NodeJS.Timeout | null = null;
  let ultimo = "{}";
  let cerrado = false;

  const hay = (d: string) => stat(d).then((s) => s.isDirectory(), () => false);
  const dirDe = (x: Seguida) => path.join(x.dir, "subagents");

  /** Un subagente que parece correr pero la sesión ya recibió que lo cortaron o falló: error. */
  async function conAvisos(x: Seguida, lista: Subagente[]): Promise<Subagente[]> {
    if (!lista.some((u) => u.estado === "corriendo")) return lista;
    const archivo = `${x.dir}.jsonl`;
    const s = await stat(archivo).catch(() => null);
    if (!s) return lista;
    const firma = `${s.size}:${s.mtimeMs}`;
    if (x.avisos?.firma !== firma) x.avisos = { firma, por: avisosDe(await colaDe(archivo, s.size, 2 * COLA_BYTES).catch(() => "")) };
    return lista.map((u) => {
      const a = x.avisos!.por.get(u.id);
      return u.estado === "corriendo" && a && MAL_CERRADOS.has(a.status) && a.ts >= u.ultimo_en ? { ...u, estado: "error" as const } : u;
    });
  }

  /** Mira lo más cerca que exista: la carpeta de subagentes, la de la sesión o la de proyectos (para ver nacer a la sesión). */
  async function armar(x: Seguida) {
    const sub = await hay(dirDe(x));
    const ses = sub || (await hay(x.dir));
    const nivel = sub ? 2 : ses ? 1 : 0;
    if (nivel === x.nivel && x.miradas.length > 0) return;
    for (const m of x.miradas) m.cerrar();
    x.miradas = [];
    x.nivel = nivel;
    const objetivo = nivel === 2 ? dirDe(x) : nivel === 1 ? x.dir : path.dirname(x.dir);
    const programar = (_t?: string, nombre?: string | Buffer | null) => {
      // En la carpeta de proyectos suena todo lo que escribe cualquier sesión: sólo importa si nace la de ésta.
      if (nivel === 0 && String(nombre ?? "") !== x.sid) return;
      salir(x);
    };
    const m = mirarCarpeta(objetivo, programar, { donde: "subagentes", alRearmar: () => salir(x) });
    if (m) x.miradas.push(m);
  }

  function salir(_x?: Seguida) {
    if (cerrado) return;
    if (espera) clearTimeout(espera);
    espera = setTimeout(() => void avisar(), DEBOUNCE_MS);
  }

  /** Lo de ahora de todas las sesiones seguidas: relee lo que cambió y mira dónde estar. */
  async function ahora(): Promise<Subagentes> {
    const todos: Subagentes = {};
    for (const x of seguidas.values()) {
      await armar(x);
      x.lista = await conAvisos(x, await leerCarpeta(dirDe(x), x.sid, x.cache));
      if (x.lista.length) todos[x.sid] = x.lista;
    }
    return todos;
  }

  async function avisar() {
    espera = null;
    const todos = await ahora();
    const j = JSON.stringify(todos);
    if (j === ultimo || cerrado) return;
    ultimo = j;
    o.alCambiar(todos);
  }

  /** Sigue a estas sesiones (las que tienen proceso) y deja de seguir a las demás. */
  async function sincronizar(sids: readonly string[]) {
    const quiero = new Set(sids.filter((s) => ID.test(s)));
    let cambio = false;
    for (const [sid, x] of seguidas)
      if (!quiero.has(sid)) {
        for (const m of x.miradas) m.cerrar();
        seguidas.delete(sid);
        cambio = true;
      }
    for (const sid of quiero) {
      if (seguidas.has(sid)) continue;
      const t = await o.transcript(sid).catch(() => null);
      if (!t) continue;
      seguidas.set(sid, { sid, dir: t.replace(/\.jsonl$/, ""), avisos: null, cache: new Map(), miradas: [], nivel: -1, lista: [] });
      cambio = true;
    }
    if (cambio) await avisar();
  }

  /** Lo de ahora de todas las sesiones seguidas (lo pide la ventana al abrir). */
  async function leer(): Promise<Subagentes> {
    if (espera) {
      clearTimeout(espera);
      espera = null;
    }
    const todos = await ahora();
    ultimo = JSON.stringify(todos);
    return todos;
  }

  /** El informe entero de un subagente de una sesión seguida. */
  async function informe(sid: unknown, id: unknown): Promise<string | null> {
    const x = typeof sid === "string" ? seguidas.get(sid) : undefined;
    return x ? informeDe(dirDe(x), id) : null;
  }

  function cerrar() {
    cerrado = true;
    if (espera) clearTimeout(espera);
    for (const x of seguidas.values()) for (const m of x.miradas) m.cerrar();
    seguidas.clear();
  }

  return { sincronizar, leer, informe, cerrar };
}
