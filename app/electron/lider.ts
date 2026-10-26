// Los líderes de la app: sesiones de Claude Code en `~` con las que el usuario habla
// desde trama. Cada uno es un `claude -p` persistente que lee y escribe
// stream-json (argv y entorno en lider-arma.ts); se lanza con el primer mensaje
// y, si el proceso no está (trama se reinició), el siguiente lo relanza con
// `--resume`. Se recuerdan en `~/.local/state/hilos/lideres.json`. Node puro
// (sin `electron`): el claude falso de `scripts/claude-falso.mjs` lo prueba.
//
// Regla: nunca se le escribe a una sesión que tiene un proceso vivo que no es
// de la app (abierta en una terminal, u otra trama). A uno abierto en una terminal
// se lo trae (`traer`): se cierra ese `claude`, por su pid exacto, y sigue acá.
import { imagenesDe, type Imagen } from "./imagenes.ts";
import { inputRespondido, respuestasValidas, type Pregunta } from "./preguntas.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  argvLider,
  argvUso,
  paginaDe,
  cortar,
  cwdDeTranscript,
  dirProyecto,
  opcionesLider,
  type Ollama,
  escribirGuardados,
  esModo,
  leerGuardados,
  lineaInicio,
  lineaEffort,
  lineaEstilo,
  estilosDe,
  lineaModelo,
  lineaModo,
  lineaParar,
  lineaPermiso,
  autoaprueba,
  lineaUsuario,
  lineaUso,
  MODO_DEFAULT,
  nombreNuevo,
  nombreRetomado,
  avisoTraido,
  murioProceso,
  parsearLinea,
  SID,
  type Comando,
  type Evento,
  type Guardado,
  type Local,
  type Modo,
} from "./lider-arma.js";
import { asegurarLocal, destinoLocal, localDe } from "./locales.js";
import { armarContexto, prefacioGemini } from "./contexto-local.ts";
import { resolverPa } from "./binario.ts";
import { claseDeModelo, idAgy, localOllama, partirGemini, type Clase } from "./modelos-config.js";
import { pedidoDe } from "./cache.ts";
import { convDe } from "./conv-cache.ts";
import { guardada, igual, juntar, lecturaDe, oficialDe, type Lectura } from "./uso.ts";
import { errorT } from "./errores.ts";
import { ESTADO, escribirAtomico } from "./pa.js";
import { grupoPropio, matarArbol, spawnCmd } from "./procesos.js";
import { esElProceso, sesionesVivas, type Sesion } from "./sesiones.js";
import { irA, ubicar } from "./terminal.js";
import { log, silencio } from "./log.js";

const HOME = os.homedir();
const ARCHIVO = path.join(ESTADO, "lideres.json");
/** `claude` real, o el falso para las pruebas. */
const CLAUDE = process.env.HILOS_CLAUDE ?? "claude";
/** El puente de un líder de Gemini (electron/agy-puente.ts): habla como `claude -p` y por dentro corre `agy`. Mismo tipo de archivo que éste (`.js` compilado, `.ts` en las pruebas). */
const PUENTE_AGY = path.join(import.meta.dirname, `agy-puente${path.extname(import.meta.filename)}`);
const PROYECTOS = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, ".claude"), "projects");
/** Si el interrupt no contesta en esto, SIGINT. */
const PARAR_MS = 3000;
/** Si `set_model` o el esfuerzo no contestan en esto, se relanza con `--resume` como antes. */
const CONTROL_MS = 5000;

/** A mitad de un turno la barra se entera de que el caché se renovó a lo sumo cada esto (s): el numerito va en minutos. */
const AVISO_CACHE_S = 60;

/**
 * El uso del plan que dijo el stream del último líder que contestó (`uso.json`: sobrevive a un
 * relanzo). Es de la cuenta, no del líder: uno solo para todos. `undefined`: todavía no se leyó.
 */
const ARCHIVO_USO = path.join(ESTADO, "uso.json");
/** Sin cambios en las barras, `uso.json` se reescribe a lo sumo cada esto (s). */
const GUARDAR_USO_S = 60;
let usoStream: Lectura | null | undefined;
let usoGuardado = 0;
/** Cuántas respuestas de `get_usage` con datos llegaron (un contador y no la hora: dos pedidos seguidos caen en el mismo ms). */
let oficiales = 0;
/** Si `get_usage` no contesta en esto (ms), queda lo que había: un líder vivo contesta enseguida. */
const USO_VIVO_MS = 8000;
/** Lo mismo para el `claude` de un rato, que antes tiene que arrancar. */
const USO_RATO_MS = 20_000;
/** Lo que se le da a ese `claude` para salir solo tras cerrarle el stdin, antes del SIGTERM. */
const USO_SALIR_MS = 2000;
let pidiendoUso: Promise<boolean> | null = null;

/** Lo que el stream de los líderes de la app dijo del uso del plan; `null`, nada todavía. */
export async function usoVisto(): Promise<Lectura | null> {
  if (usoStream === undefined) {
    const g = guardada(await readFile(ARCHIVO_USO, "utf8").then((t) => JSON.parse(t), () => null));
    // Mientras se leía pudo haber llegado uno por el stream: ése es más nuevo.
    if (usoStream === undefined) usoStream = g;
  }
  return usoStream ?? null;
}

/** Una línea del stream que trae el uso: queda anotada y, si movió las barras, se avisa. */
function anotarUso(l: Lectura) {
  const antes = usoStream ?? null;
  usoStream = juntar(antes, l);
  const cambio = !igual(antes, usoStream);
  const ahora = Math.floor(Date.now() / 1000);
  // La oficial se guarda siempre: aunque diga lo mismo, desde ahora vale más que un statusline.
  const oficial = !!(l.five_hour?.oficial || l.seven_day?.oficial);
  if (oficial) oficiales++;
  if (cambio || oficial || ahora - usoGuardado >= GUARDAR_USO_S) {
    usoGuardado = ahora;
    void escribirAtomico(ARCHIVO_USO, JSON.stringify({ version: 1, ...usoStream })).catch(silencio("lider"));
  }
  if (cambio) alCambio();
}

/** Un pedido de permiso como lo ve la vista: sin el input crudo (queda acá). */
type EventoPedido = Omit<Extract<Evento, { tipo: "permiso" }>, "input">;

/** Lo que la vista recibe por cada líder de la app. */
export type EventoLider =
  | Exclude<Evento, { tipo: "permiso" }>
  | EventoPedido
  | { tipo: "estado"; ocupado: boolean; vivo: boolean }
  /**
   * El proceso terminó. `error` si salió mal (código ≠ 0, o a mitad de un turno) y no porque se lo
   * cerró: las últimas líneas del stderr, o "" si no dijo nada. `null`: salió bien.
   */
  | { tipo: "salio"; codigo: number | null; error: string | null };

type Proc = {
  p: ChildProcess;
  modelo: string;
  effort: string;
  /** Qué proceso es: el `claude` de siempre (también el de Ollama, que es el mismo contra otro endpoint) o el puente de agy. */
  clase: Clase;
  /** Un líder local: adónde le habla y con qué contexto arrancó (va en su entorno: cambiarlo es relanzarlo). */
  local?: Local;
  ocupado: boolean;
  /** Cuándo contestó su último pedido (epoch s; 0, ninguno todavía): cada uno renueva el caché, también a mitad de un turno. */
  pedido: number;
  /** El `pedido` con el que se avisó por última vez a la barra (`AVISO_CACHE_S`). */
  avisado: number;
  resto: string;
  stderr: string;
  /** Lo cerró la app (Cerrar, Settle, salir): que termine no es un error. */
  adrede: boolean;
  /** Quien espera a que termine el turno (salir de trama sin cortarlo). */
  libre: (() => void)[];
  /**
   * Los `can_use_tool` sin contestar: request_id → input y tool_use_id (la respuesta los devuelve)
   * y lo que vio la vista (`pendientes`: una vista recargada los vuelve a pedir).
   */
  pedidos: Map<string, { input: unknown; tool_use_id: string | null; herramienta: string; preguntas: Pregunta[] | null; ev: EventoPedido }>;
  /** Los `control_request` de la app que esperan respuesta: request_id → quien la espera. */
  controles: Map<string, (r: { ok: boolean; error?: string }) => void>;
  /** El `/output-style` pendiente que se le mandó al arrancar: la respuesta al initialize (anterior) no lo pisa. */
  estilo: string | null;
  /** El SIGINT de `parar` si el interrupt no contesta: se cancela al terminar el turno (si no, mata al siguiente). */
  parando?: ReturnType<typeof setTimeout>;
};

const procs = new Map<string, Proc>();
let guardados: Guardado[] | null = null;
let oyente: (sid: string, e: EventoLider) => void = () => {};
let alCambio: () => void = () => {};

/** Recibe lo que pasa en cada líder (el texto que va llegando, mensajes, fin, estado). */
export function alEvento(fn: typeof oyente) {
  oyente = fn;
}

/**
 * Cada cuánto sale el texto que va llegando (`parcial`): el primer delta sale ya y los que caen
 * antes de esto se juntan en un solo evento. Uno por token es mucho para el IPC y, por la
 * tailnet, una línea de SSE cada uno; así son a lo sumo 20 por segundo por líder.
 */
export const PARCIAL_MS = 50;
/** El texto que espera para salir, por líder; `ultimo`: cuándo salió el anterior. */
const juntas = new Map<string, { texto: string; pensado: string; t: ReturnType<typeof setTimeout> | null; ultimo: number }>();

function soltar(sid: string) {
  const j = juntas.get(sid);
  if (!j) return;
  if (j.t) clearTimeout(j.t);
  j.t = null;
  if (!j.texto && !j.pensado) return;
  const { texto, pensado } = j;
  j.texto = j.pensado = "";
  j.ultimo = Date.now();
  // El razonamiento termina antes de que empiece el texto: si caen juntos, va primero.
  if (pensado) oyente(sid, { tipo: "pensamiento", texto: pensado });
  if (texto) oyente(sid, { tipo: "parcial", texto });
}

/** Lo que pasa en un líder, a quien escucha: los `parcial` y `pensamiento` juntados, lo demás tal cual y en orden. */
function alEv(sid: string, e: EventoLider) {
  if (e.tipo !== "parcial" && e.tipo !== "pensamiento") {
    // Lo que se venía juntando sale antes: el mensaje entero nunca llega antes que su texto.
    soltar(sid);
    if (e.tipo === "salio") juntas.delete(sid);
    return oyente(sid, e);
  }
  let j = juntas.get(sid);
  if (!j) juntas.set(sid, (j = { texto: "", pensado: "", t: null, ultimo: 0 }));
  if (e.tipo === "parcial") j.texto += e.texto;
  else j.pensado += e.texto;
  if (j.t) return;
  const falta = j.ultimo + PARCIAL_MS - Date.now();
  if (falta <= 0) return soltar(sid);
  j.t = setTimeout(() => soltar(sid), falta);
  j.t.unref?.();
}
/** Cambió la lista o el estado de un líder: hay que releer el statusline. */
export function alCambiar(fn: () => void) {
  alCambio = fn;
}

export async function lideresApp(): Promise<Guardado[]> {
  if (!guardados) guardados = leerGuardados(await readFile(ARCHIVO, "utf8").catch(() => ""));
  return guardados;
}

const guardar = () => escribirAtomico(ARCHIVO, escribirGuardados(guardados ?? [])).catch(silencio("lider"));

// Los slash commands de la última sesión que los dijo (todos los líderes corren en `~` con la
// misma config): el menú de "/" de un líder nuevo, que todavía no tiene proceso, los ofrece igual.
const ARCHIVO_COMANDOS = path.join(ESTADO, "comandos.json");
let comandos: Comando[] | null = null;
let comandosAgy: Comando[] = [];

export async function comandosConocidos(): Promise<Comando[]> {
  if (!comandos) {
    try {
      const j = JSON.parse(await readFile(ARCHIVO_COMANDOS, "utf8"));
      comandos = j?.version === 1 && Array.isArray(j.comandos) ? j.comandos : [];
      if (j?.version === 1 && Array.isArray(j.comandosAgy))
        comandosAgy = j.comandosAgy.map((c: Comando) => ({ ...c, agy: true }));
    } catch {
      comandos = [];
    }
  }
  return comandosAgy.length ? [...comandos!, ...comandosAgy] : comandos!;
}

function recordarComandos(lista: Comando[]) {
  // El init trae sólo nombres: si ya se sabe la descripción (del initialize), se queda.
  const antes = new Map((comandos ?? []).map((c) => [c.nombre, c]));
  comandos = lista.map((c) => (c.descripcion || !antes.get(c.nombre) ? c : antes.get(c.nombre)!));
  guardarComandos();
}

function recordarComandosAgy(lista: Comando[]): Comando[] {
  comandosAgy = lista.map((c) => ({ ...c, agy: true }));
  guardarComandos();
  return comandosAgy;
}

const guardarComandos = () =>
  void escribirAtomico(
    ARCHIVO_COMANDOS,
    JSON.stringify({ version: 1, comandos: comandos ?? [], ...(comandosAgy.length ? { comandosAgy } : {}), estilos }) + "\n",
  ).catch(silencio("lider"));

// Los output styles (`/output-style`): los que lista el CLI y el que está en uso. Son de la config
// de `~` (la misma para todos los líderes): se recuerdan en comandos.json, como los comandos.
export type Estilos = { actual: string | null; lista: string[] };
let estilos: Estilos = { actual: null, lista: [] };

export async function estilosConocidos(): Promise<Estilos> {
  if (!comandos) {
    await comandosConocidos();
    try {
      const j = JSON.parse(await readFile(ARCHIVO_COMANDOS, "utf8"));
      const e = j?.version === 1 ? j.estilos : null;
      if (e) estilos = { actual: typeof e.actual === "string" ? e.actual : null, lista: estilosDe(e.lista) };
    } catch {}
  }
  return estilos;
}

function recordarEstilos(actual: string | null, lista: string[] | null) {
  const sigue = { actual: actual ?? estilos.actual, lista: lista?.length ? lista : estilos.lista };
  if (sigue.actual === estilos.actual && sigue.lista.join("\0") === estilos.lista.join("\0")) return;
  estilos = sigue;
  guardarComandos();
}

/** Un `/output-style` sin ningún líder vivo: lo aplica el próximo que arranque. */
let estiloPendiente: string | null = null;

/**
 * `/output-style <nombre>`: por el proceso de este líder o, si no tiene, el de cualquier
 * otro de la app (es la config de `~`, compartida). Sin ninguno vivo queda pendiente para
 * el próximo que arranque. "vivo": ya se aplicó; "pendiente": al próximo arranque.
 */
export async function ponerEstilo(sid: string, nombre: unknown): Promise<"vivo" | "pendiente"> {
  const lista = estilosDe([nombre]);
  if (!lista.length) throw errorT("main.estiloRaro", { v: String(nombre) });
  const estilo = lista[0];
  const p = procs.get(sid);
  const x = (p?.clase === "claude" ? p : undefined) ?? [...procs.values()].find((y) => y.clase === "claude");
  if (!x) {
    estiloPendiente = estilo;
    return "pendiente";
  }
  const r = await control(x, (id) => lineaEstilo(id, estilo));
  if (!r) throw errorT("main.estiloSinRespuesta");
  if (!r.ok) throw errorT("main.estiloFallo", { error: r.error ?? "" });
  estiloPendiente = null;
  recordarEstilos(estilo, null);
  alEv(sid, { tipo: "estilos", actual: estilo, lista: null });
  return "vivo";
}

/** Lo que la app sabe de su proceso: vivo, ocupado y pid. */
export function procDe(sid: string): { pid: number | null; ocupado: boolean; pedido: number; pide: boolean } | null {
  const p = procs.get(sid);
  return p ? { pid: p.p.pid ?? null, ocupado: p.ocupado, pedido: p.pedido, pide: p.pedidos.size > 0 } : null;
}

export const ocupados = () => [...procs.values()].filter((p) => p.ocupado).length;
export const vivos = () => procs.size;
/** Los líderes con proceso de la app (lanzados o traídos por trama), respondan o no. */
export const conProceso = () => [...procs.keys()];
/** Los que un relanzo de trama cortaría: los que responden y los que están a mitad de un `mandar`. */
export const respondiendo = () => respondiendoSids().length;
/** Quiénes son: el cartel de la actualización dice a quién espera. */
export const respondiendoSids = () => [...new Set([...mandando, ...[...procs].filter(([, p]) => p.ocupado).map(([sid]) => sid)])];
/** El nombre con que se recuerda a un líder de la app (`null`: no se sabe). */
export const nombreDe = (sid: string) => guardados?.find((g) => g.sid === sid)?.nombre ?? null;

/**
 * Tras actualizar Claude Code: cierra los procesos de la app que no están respondiendo
 * (ni a mitad de un `mandar`); el próximo mensaje de cada uno lo relanza con `--resume` y
 * la versión nueva. Los que responden siguen con la vieja. Devuelve cuántos de cada uno.
 */
export async function reiniciarOciosos(): Promise<{ reiniciados: number; ocupados: number }> {
  const quedan = [...procs.entries()].filter(([sid, x]) => !x.ocupado && !mandando.has(sid));
  for (const [sid, x] of quedan) {
    x.adrede = true;
    rastro(sid, "reinicio", "se cierra su proceso por la actualización de Claude Code; el próximo mensaje lo relanza");
  }
  await Promise.all(quedan.map(([, x]) => terminar(x)));
  return { reiniciados: quedan.length, ocupados: procs.size };
}

let pedidosN = 0;
const idPedido = () => `trama-${++pedidosN}`;

/**
 * Lo de un líder local antes de escribirle: que llama-server sirva a su modelo (si no, lo carga: `asegurarLocal`) y con
 * qué contexto. `undefined`: no es local. Las pruebas lo cambian (`ponerLocales`): nunca cargan un modelo.
 */
let locales = { asegurar: (id: string) => asegurarLocal(id), destino: (id: string) => destinoLocal(id) };
export const ponerLocales = (x: typeof locales) => void (locales = x);
/**
 * El local con el contexto del usuario (sus CLAUDE.md sin lo del jefe, la memoria y los hooks de arranque) para el proceso que se
 * va a lanzar. Un archivo ilegible no tira el arranque: el líder sale igual, sin contexto. Lo lee una vez por proceso.
 */
async function conContexto(local: Local, cwd: string | undefined): Promise<Local> {
  try {
    const c = await armarContexto({ home: HOME, cwd, ctx: local.ctx });
    log.escribir("info", "lider", `contexto de un líder local: ~${c.tokens} tokens (${c.partes.map((p) => `${p.titulo.split(" (")[0]} ${p.tokens}${p.recortado ? "↓" : ""}`).join(", ")})`);
    return { ...local, contexto: c.texto };
  } catch (e) {
    silencio("contexto-local")(e);
    return local;
  }
}
const servirLocal = (modelo: string) => (localDe(modelo) ? locales.asegurar(modelo) : Promise.resolve(undefined));

/**
 * Al salir un líder, TERM (y KILL 3 s después) a todo su grupo de procesos: con `KillMode=process` lo que
 * lanzó desde sus herramientas sin `setsid` (un `qs`, un `watch.sh` con su `pactl subscribe`) quedaba huérfano
 * en el cgroup del motor para siempre (2026-10-22: 41 watchers llenaron el cupo de pipewire-pulse). Los workers
 * de `pa` salen con `setsid`: no están en este grupo. El grupo es del líder (`detached`), nunca el del motor.
 */
export function barrerGrupo(pid: number | undefined, kill: (pid: number, senal: NodeJS.Signals) => void = process.kill, esperaMs = 3000) {
  if (!pid || pid <= 1) return;
  // Grupo vacío (ESRCH): nada que barrer; `matarArbol` no lanza.
  matarArbol(pid, false, { kill });
  setTimeout(() => matarArbol(pid, true, { kill }), esperaMs).unref();
}

/** Lo que un líder de otra clase necesita para arrancar: adónde habla uno de Ollama, o el prefacio de uno de Gemini. */
type Extra = { ollama?: Ollama; prefacio?: string };

/**
 * Lo de otra clase para el proceso que se va a lanzar. Un `ollama:*` que ya no figura en `modelos.json` no se lanza: el error
 * lo dice. El prefacio de Gemini (sus CLAUDE.md, sin memoria ni hooks) se lee una vez por proceso y un archivo ilegible no lo tira.
 */
async function extraDe(modelo: string, cwd: string | undefined): Promise<Extra> {
  const clase = claseDeModelo(modelo);
  if (clase === "ollama") {
    const o = localOllama(modelo);
    if (!o) throw errorT("main.ollamaNoEsta", { v: modelo });
    return { ollama: { url: o.url, modelo: o.modelo } };
  }
  if (clase === "gemini") return { prefacio: await prefacioGemini({ home: HOME, cwd, pa: resolverPa(process.env, HOME) }).catch((e) => (silencio("contexto-gemini")(e), "")) };
  return {};
}

/** Un modelo de Gemini viene como `gemini-4-argon` + `low|medium|high` o todo junto (`gemini-4-argon-high`, el contrato de modelos.json): siempre queda partido. */
function normalizar(modelo: string, effort: string): { modelo: string; effort: string } {
  return claseDeModelo(modelo) === "gemini" ? partirGemini(modelo, effort) : { modelo, effort };
}

function lanzar(g: Guardado, resume: boolean, local?: Local, extra: Extra = {}): Proc {
  // Vuelve a tener proceso: ya no está muerto.
  if (g.murio) {
    delete g.murio;
    delete g.motivo;
    void guardar();
  }
  const clase = claseDeModelo(g.modelo);
  const base = opcionesLider(process.env, HOME, g.cwd, local && { modelo: g.modelo, effort: g.effort, local }, extra.ollama) as { cwd: string; env: NodeJS.ProcessEnv };
  // Su propio grupo (setsid): lo que el líder deja corriendo desde sus herramientas (un `qs`, un watcher) se barre al salir.
  const opciones = { ...base, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"], ...grupoPropio() };
  const bin = clase === "gemini" ? "agy" : path.basename(CLAUDE);
  const p =
    clase === "gemini"
      ? spawn(
          process.execPath,
          [PUENTE_AGY, "--sid", g.sid, "--nombre", g.nombre, "--modelo", idAgy(g.modelo, g.effort), "--cwd", base.cwd],
          // El mismo Electron/Node que el motor, como Node pelado; el prefacio (agy no lee CLAUDE.md) va por el entorno.
          { ...opciones, env: { ...base.env, ELECTRON_RUN_AS_NODE: "1", TRAMA_AGY_PREFACIO: extra.prefacio ?? "" } },
        )
      : spawnCmd(CLAUDE, argvLider({ modelo: g.modelo, effort: g.effort, sid: g.sid, nombre: g.nombre, resume, modo: g.modo, local, ollama: extra.ollama }), opciones);
  const x: Proc = { p, modelo: g.modelo, effort: g.effort, clase, local, ocupado: false, pedido: 0, avisado: 0, resto: "", stderr: "", adrede: false, libre: [], pedidos: new Map(), controles: new Map(), estilo: null };
  procs.set(g.sid, x);
  p.stdout!.setEncoding("utf8");
  p.stdout!.on("data", (trozo: string) => {
    const c = cortar(x.resto, trozo);
    x.resto = c.resto;
    for (const l of c.lineas) {
      // Cada pedido contestado renueva el caché: a mitad de un turno la barra no espera al `fin`.
      const pd = pedidoDe(l);
      if (pd) {
        x.pedido = Math.floor(Date.now() / 1000);
        if (pd.ttl) g.cache_ttl_s = pd.ttl;
        if (x.pedido - x.avisado >= AVISO_CACHE_S) {
          x.avisado = x.pedido;
          alCambio();
        }
      }
      // El uso del plan: cada turno lo dice, y un líder de la app no tiene statusline que lo escriba.
      const lu = lecturaDe(l, Math.floor(Date.now() / 1000)) ?? oficialDe(l, Math.floor(Date.now() / 1000));
      if (lu) anotarUso(lu);
      for (const e of parsearLinea(l)) {
        if (e.tipo === "fin") {
          x.ocupado = false;
          clearTimeout(x.parando);
          x.pedidos.clear();
          g.ultimo = Math.floor(Date.now() / 1000);
          if (e.ttl) g.cache_ttl_s = e.ttl;
          void guardar();
          alEv(g.sid, e);
          alEv(g.sid, { tipo: "estado", ocupado: false, vivo: true });
          alCambio();
          for (const f of x.libre.splice(0)) f();
        } else if (e.tipo === "permiso" && autoaprueba(g.modo, e.herramienta)) {
          console.warn(`trama: ${e.herramienta} autoaprobado en bypass (decision_reason: ${e.razon ?? "-"}, blocked_path: ${e.ruta ?? "-"})`);
          p.stdin!.write(lineaPermiso(e.id, { behavior: "allow", updatedInput: e.input }, e.tool_use_id));
        } else if (e.tipo === "permiso") {
          const { input, ...resto } = e;
          x.pedidos.set(e.id, { input, tool_use_id: e.tool_use_id, herramienta: e.herramienta, preguntas: e.preguntas, ev: resto });
          alEv(g.sid, resto);
          // Un permiso o una pregunta sin contestar: el líder espera al usuario (electron/espera.ts).
          alCambio();
        } else {
          if (e.tipo === "control") {
            const f = x.controles.get(e.id);
            x.controles.delete(e.id);
            f?.(e);
          }
          if (e.tipo === "permisoFuera" && x.pedidos.delete(e.id)) alCambio();
          if (e.tipo === "comandos" && e.lista.length) {
            if (clase === "gemini") {
              const lista = recordarComandosAgy(e.lista);
              alEv(g.sid, { tipo: "comandos", lista, agy: true });
              continue;
            }
            recordarComandos(e.lista);
          }
          if (e.tipo === "estilos") {
            // La respuesta al initialize sale antes de aplicar el estilo pendiente: manda el pendiente.
            if (e.lista && x.estilo) e.actual = x.estilo;
            else if (!e.lista) x.estilo = null;
            recordarEstilos(e.actual, e.lista);
          }
          if (e.tipo === "modo" && g.modo !== e.modo) {
            g.modo = e.modo;
            void guardar();
          }
          alEv(g.sid, e);
        }
      }
    }
  });
  p.stderr!.setEncoding("utf8");
  p.stderr!.on("data", (t: string) => {
    x.stderr = (x.stderr + t).slice(-2000);
  });
  // Se ignora: un EPIPE al escribir cuando ya salió lo cuenta el "exit".
  p.stdin!.on("error", () => {});
  // Como el Agent SDK: la respuesta trae los slash commands con descripción (el menú de "/").
  p.stdin!.write(lineaInicio(idPedido()));
  // Un `/output-style` que se pidió sin ningún líder vivo: antes del primer mensaje.
  if (estiloPendiente && clase === "claude") {
    p.stdin!.write(lineaEstilo(idPedido(), estiloPendiente));
    x.estilo = estiloPendiente;
    recordarEstilos(estiloPendiente, null);
    estiloPendiente = null;
  }
  const fin = (codigo: number | null, error: string | null, seMurio = false) => {
    barrerGrupo(p.pid);
    if (procs.get(g.sid) !== x) return;
    procs.delete(g.sid);
    const dijo = x.stderr.trim().split("\n").filter(Boolean).slice(-2).join(" · ");
    // Lo mataron o se cayó (no lo cerró la app): la barra lo marca Murió hasta que el usuario lo retome.
    if (seMurio) {
      g.murio = Math.floor(Date.now() / 1000);
      const motivo = (dijo || error || (codigo === null ? "lo mataron (sin código de salida)" : `salió con el código ${codigo}`)).slice(0, 300);
      g.motivo = motivo;
      void guardar();
    }
    for (const f of x.libre.splice(0)) f();
    for (const f of x.controles.values()) f({ ok: false });
    x.controles.clear();
    const mal = !x.adrede && (x.ocupado || error !== null);
    // "" = salió mal sin decir nada (la vista lo cuenta igual, con el código si hay).
    alEv(g.sid, { tipo: "salio", codigo, error: mal ? error || dijo : null });
    alEv(g.sid, { tipo: "estado", ocupado: false, vivo: false });
    alCambio();
  };
  // No se pudo ni lanzar (la carpeta ya no está, `claude` no existe): Murió con el motivo, no un líder callado.
  p.on("error", (e) => fin(null, `${bin}: ${e.message}`, !x.adrede));
  p.on("exit", (code) => fin(code, code ? "" : null, murioProceso(x.adrede, code, code ? "" : null)));
  return x;
}

/** Espera que un proceso ocioso salga (stdin cerrado). */
function terminar(x: Proc): Promise<void> {
  return new Promise((ok) => {
    if (x.p.exitCode !== null || x.p.signalCode !== null) return ok();
    x.p.once("exit", () => ok());
    x.p.stdin!.end();
  });
}

/** Manda un `control_request` y espera su respuesta; `null` si no contesta a tiempo. */
function control(x: Proc, linea: (id: string) => string, ms = CONTROL_MS): Promise<{ ok: boolean; error?: string } | null> {
  const id = idPedido();
  return new Promise((ok) => {
    const t = setTimeout(() => {
      x.controles.delete(id);
      ok(null);
    }, ms);
    x.controles.set(id, (r) => {
      clearTimeout(t);
      ok(r);
    });
    x.p.stdin!.write(linea(id));
  });
}

/**
 * "Actualizar límites": le pide a `claude` el uso del plan como lo dice claude.ai (`get_usage`, con
 * el login de la suscripción de `claude` mismo: nada de claves ni de llamar a la API desde acá). Por
 * el primer líder de la app vivo (el uso es de la cuenta: cualquiera sirve; a mitad de un turno
 * también contesta); si no hay, o no contesta (uno lanzado antes de actualizar `claude` puede no
 * conocerlo), por un `claude` de un rato. La respuesta la anota quien lee el stdout (`oficialDe`).
 * `true`: llegó el dato. Uno a la vez: el que pide mientras otro espera, espera ése.
 */
export function pedirUsoOficial(): Promise<boolean> {
  pidiendoUso ??= (async () => {
    const antes = oficiales;
    const x = [...procs.values()].find((y) => y.clase === "claude" && y.p.exitCode === null && y.p.signalCode === null);
    if (x && (await control(x, lineaUso, USO_VIVO_MS))?.ok && oficiales > antes) return true;
    await usoDeUnRato();
    return oficiales > antes;
  })().finally(() => {
    pidiendoUso = null;
  });
  return pidiendoUso;
}

/** El `get_usage` por un `claude` que arranca, contesta y sale (`argvUso`): sin turno, no gasta nada del plan. */
function usoDeUnRato(): Promise<void> {
  const ID = "trama-uso";
  return new Promise((listo) => {
    let p: ChildProcess;
    try {
      p = spawnCmd(CLAUDE, argvUso(), { ...(opcionesLider(process.env, HOME) as { cwd: string; env: NodeJS.ProcessEnv }), stdio: ["pipe", "pipe", "ignore"] });
    } catch (e) {
      log.escribir("aviso", "lider", `get_usage: ${(e as Error).message}`);
      return listo();
    }
    let resto = "";
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(t);
      p.stdin!.end();
      setTimeout(() => {
        if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
      }, USO_SALIR_MS).unref();
      listo();
    };
    const t = setTimeout(() => {
      log.escribir("aviso", "lider", `get_usage: sin respuesta en ${USO_RATO_MS / 1000} s`);
      fin();
    }, USO_RATO_MS);
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (trozo: string) => {
      const c = cortar(resto, trozo);
      resto = c.resto;
      for (const l of c.lineas) {
        const lu = oficialDe(l, Math.floor(Date.now() / 1000));
        if (lu) anotarUso(lu);
        for (const e of parsearLinea(l))
          if (e.tipo === "control" && e.id === ID) {
            if (!e.ok) log.escribir("aviso", "lider", `get_usage: ${e.error || "error"}`);
            fin();
          }
      }
    });
    p.stdin!.on("error", () => {});
    p.on("error", (e) => {
      log.escribir("aviso", "lider", `get_usage: ${e.message}`);
      fin();
    });
    p.on("exit", fin);
    // Como el Agent SDK: primero el initialize.
    p.stdin!.write(lineaInicio(`${ID}-inicio`));
    p.stdin!.write(lineaUso(ID));
  });
}

/**
 * Otro modelo o esfuerzo con el proceso vivo y ocioso: `set_model` y
 * `apply_flag_settings` (sin relanzar). `false`: no contestó (o salió); hay que
 * relanzar. Si `claude` rechaza el modelo, el error sube tal cual.
 */
async function cambiarEnVivo(x: Proc, modelo: string, effort: string): Promise<boolean> {
  // Lo de un local va en el entorno (adónde habla, su esfuerzo): de o hacia un local, se relanza.
  if (x.local || localDe(modelo)) return false;
  // Gemini y Ollama también van en el proceso (el puente, o el endpoint en el entorno): otro modelo de esas clases es relanzar.
  if (x.clase !== "claude" || claseDeModelo(modelo) !== "claude") return false;
  if (x.modelo !== modelo) {
    const r = await control(x, (id) => lineaModelo(id, modelo));
    if (!r || (!r.ok && !r.error)) return false;
    if (!r.ok) throw errorT("main.modeloRechazado", { v: modelo, error: r.error! });
    x.modelo = modelo;
  }
  if (x.effort !== effort) {
    const r = await control(x, (id) => lineaEffort(id, effort));
    if (!r?.ok) return false;
    x.effort = effort;
  }
  return true;
}

/** ¿Hay un proceso vivo con esta sesión que no es de la app? (terminal, otra trama). */
async function ajeno(sid: string): Promise<boolean> {
  const mio = procs.get(sid)?.p.pid;
  return (await sesionesVivas()).some((s) => s.id === sid && s.pid !== mio);
}

/**
 * Qué se puede hacer con un líder ahora (para la cola, electron/cola.ts): escribirle, esperar
 * a que termine el turno (el de la app o el de la terminal), traerlo de la terminal o retomarlo.
 */
export async function disponible(sid: string): Promise<"app" | "ocupado" | "terminal" | "terminalOcupada" | "nadie"> {
  const p = procs.get(sid);
  if (mandando.has(sid) || p?.ocupado) return "ocupado";
  const otras = (await sesionesVivas()).filter((s) => s.id === sid && s.pid !== p?.p.pid);
  if (otras.length) return otras.some((s) => s.status !== "idle") ? "terminalOcupada" : "terminal";
  return (await lideresApp()).some((l) => l.sid === sid) ? "app" : "nadie";
}

/** El texto de un envío; puede ir vacío si lleva imágenes (B26). */
const textoDe = (t: unknown, imagenes: readonly Imagen[] = []) => {
  const s = String(t ?? "");
  if (!s.trim() && !imagenes.length) throw errorT("main.mensajeVacio");
  return s;
};

const sueltoDe = (que: "modelo" | "effort", v: unknown) => {
  const s = String(v ?? "");
  if (!s || s.startsWith("-") || /[\s\0]/.test(s)) throw errorT(que === "modelo" ? "main.modeloRaro" : "main.effortRaro", { v: String(v) });
  return s;
};

const modoDe = (m: unknown): Modo => {
  if (m == null) return MODO_DEFAULT;
  if (!esModo(m)) throw errorT("main.modoRaro", { v: String(m) });
  return m;
};

/** Un envío para la cola, validado como lo valida `mandar`: lo que no sirve se rechaza al encolar, no al salir. */
export function paraCola(x: { sid?: unknown; texto?: unknown; imagenes?: unknown; modelo?: unknown; effort?: unknown; modo?: unknown; nombre?: unknown }) {
  const sid = String(x?.sid);
  if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid });
  const imagenes = imagenesDe(x.imagenes);
  return {
    sid,
    item: {
      texto: textoDe(x.texto, imagenes),
      modelo: sueltoDe("modelo", x.modelo),
      effort: sueltoDe("effort", x.effort),
      ...(imagenes.length ? { imagenes: [...imagenes] } : {}),
      ...(x.modo == null ? {} : { modo: modoDe(x.modo) as string }),
      ...(typeof x.nombre === "string" && x.nombre ? { nombre: x.nombre } : {}),
    },
  };
}

/**
 * La carpeta donde arranca un líder nuevo (el campo "Carpeta" de la caja): absoluta (o `~`, `~/x`), que exista y sea un
 * directorio. Vacía o el home: `undefined` (el líder de siempre, en `~`). Tira con el motivo; nada se crea.
 */
export async function carpetaDe(v: unknown, home = HOME): Promise<string | undefined> {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.includes("\0")) throw errorT("main.carpetaRara");
  let c = v.trim();
  if (!c) return undefined;
  if (c === "~" || c.startsWith("~/")) c = path.join(home, c.slice(1));
  if (!path.isAbsolute(c)) throw errorT("main.carpetaRelativa", { v: c.slice(0, 120) });
  c = path.resolve(c);
  const st = await stat(c).catch(() => null);
  if (!st) throw errorT("main.carpetaNoExiste", { v: c.slice(0, 120) });
  if (!st.isDirectory()) throw errorT("main.carpetaNoEsCarpeta", { v: c.slice(0, 120) });
  return c === path.resolve(home) ? undefined : c;
}

/** Un líder nuevo con su primer mensaje (en `carpeta` si viene, si no en `~`). Devuelve su session_id. */
export async function nuevo(x: { modelo: string; effort: string; texto: string; imagenes?: unknown; modo?: string; rol?: string; carpeta?: unknown }): Promise<string> {
  const imagenes = imagenesDe(x.imagenes);
  const texto = textoDe(x.texto, imagenes);
  const modo = modoDe(x.modo);
  const cwd = await carpetaDe(x.carpeta);
  const { modelo, effort } = normalizar(sueltoDe("modelo", x.modelo), sueltoDe("effort", x.effort));
  const extra = await extraDe(modelo, cwd);
  // Uno local, con su modelo ya servido antes de anotarlo: si no entra en la GPU, no queda un líder sin conversación.
  let local = await servirLocal(modelo);
  if (local) local = await conContexto(local, cwd);
  const ls = await lideresApp();
  const g: Guardado = {
    sid: randomUUID(),
    nombre: nombreNuevo(),
    modelo,
    effort,
    creado: Math.floor(Date.now() / 1000),
    ultimo: 0,
    cache_ttl_s: null,
    modo,
    ...(cwd ? { cwd } : {}),
    ...(x.rol === "analista" ? { rol: "analista" as const } : {}),
  };
  ls.push(g);
  await guardar();
  const p = lanzar(g, false, local, extra);
  p.ocupado = true;
  p.p.stdin!.write(lineaUsuario(texto, imagenes));
  alEv(g.sid, { tipo: "estado", ocupado: true, vivo: true });
  alCambio();
  return g.sid;
}

/**
 * Escribirle a un líder de la app. Si su proceso no está, se relanza con
 * `--resume`; si cambió modelo o esfuerzo, se cambian en vivo (`set_model`,
 * `apply_flag_settings`) y, si no contesta, se relanza con los nuevos.
 * Ocupado: rechaza (lo que el usuario manda mientras tanto va a la cola, electron/cola.ts).
 */
export async function mandar(x: { sid: string; texto: string; imagenes?: unknown; modelo: string; effort: string }): Promise<void> {
  // Dos a la vez (doble Enter con el proceso muerto) relanzaban dos `claude --resume`
  // con la misma sesión: el segundo pisaba al primero en `procs` y el otro quedaba huérfano.
  const sid = String(x.sid);
  if (mandando.has(sid)) throw errorT("main.respondiendo");
  mandando.add(sid);
  try {
    await mandarYa(x);
  } finally {
    mandando.delete(sid);
  }
}

/**
 * Mandarle algo a un líder que está a mitad de un turno SIN esperar a que termine: la línea de usuario va por el stdin
 * y `claude` la lee en el próximo paso (entre herramientas); el turno sigue siendo uno solo (un único `result`), así que
 * `ocupado` no se toca. Libre (o sin proceso), es un `mandar` de siempre. Sólo el `claude` de stream-json: el puente de
 * Gemini no va por acá: su puente metería el mensaje en su propia cola (agy-puente.ts), así que se rechaza y el mensaje queda
 * en la cola del main, que lo manda al terminar.
 */
export async function inyectar(x: { sid: string; texto: string; imagenes?: unknown; modelo: string; effort: string }): Promise<void> {
  const sid = String(x.sid);
  const p = procs.get(sid);
  if (!p?.ocupado || mandando.has(sid)) return mandar(x);
  if (p.clase === "gemini") throw errorT("main.inyectarGemini");
  const imagenes = imagenesDe(x.imagenes);
  const texto = textoDe(x.texto, imagenes);
  if (!p.p.stdin?.writable) throw errorT("main.inyectarSinProceso");
  p.p.stdin.write(lineaUsuario(texto, imagenes));
  alCambio();
}

/**
 * Los que acaban de traerse de una terminal, o de retomarse tras morir sin cerrar: su próximo mensaje lleva el
 * aviso de recoger a sus workers (`avisoTraido`, con el motivo que lo trajo).
 */
const recienTraidos = new Map<string, "terminal" | "murio">();
let workersVivos: (sid: string) => number = () => 0;
/** Cuántos workers de `pa` vivos tiene un líder (lo sabe nucleo.ts, que lee `pa --hilos`). */
export const ponerWorkersVivos = (fn: typeof workersVivos) => void (workersVivos = fn);

/** Los sids con un `mandar` a mitad de camino (esperando `ajeno`, el cambio en vivo o el relanzar). */
const mandando = new Set<string>();

async function mandarYa(x: { sid: string; texto: string; imagenes?: unknown; modelo: string; effort: string }): Promise<void> {
  const imagenes = imagenesDe(x.imagenes);
  const texto = textoDe(x.texto, imagenes);
  const g = (await lideresApp()).find((l) => l.sid === x.sid);
  if (!g) throw errorT("main.noEsDeLaApp");
  const { modelo, effort } = normalizar(sueltoDe("modelo", x.modelo), sueltoDe("effort", x.effort));
  if ((claseDeModelo(g.modelo) === "gemini") !== (claseDeModelo(modelo) === "gemini"))
    throw errorT("main.cambioProveedor");
  let p = procs.get(g.sid);
  if (p?.ocupado) throw errorT("main.respondiendo");
  if (await ajeno(g.sid)) throw errorT("main.otroProceso");
  let local: Local | undefined;
  if (localDe(modelo)) {
    // Cargar el modelo puede tardar un minuto: mientras, el líder se ve trabajando.
    alEv(g.sid, { tipo: "estado", ocupado: true, vivo: !!p });
    try {
      local = await servirLocal(modelo);
    } catch (e) {
      alEv(g.sid, { tipo: "estado", ocupado: false, vivo: !!procs.get(g.sid) });
      throw e;
    }
    p = procs.get(g.sid);
    if (p?.ocupado) throw errorT("main.respondiendo");
    // Lo del usuario va en el prompt de un proceso nuevo: se lee sólo si éste se va a (re)lanzar.
    if (!p || p.modelo !== modelo || p.effort !== effort || p.local?.url !== local!.url || p.local?.ctx !== local!.ctx) {
      local = await conContexto(local!, g.cwd);
      p = procs.get(g.sid);
      if (p?.ocupado) throw errorT("main.respondiendo");
    }
    // Con otro contexto cargado (se guardó otro `-c`), su `claude` tiene el viejo en el entorno: se relanza.
    if (p && (p.local?.url !== local!.url || p.local?.ctx !== local!.ctx)) {
      await terminar(p);
      p = undefined;
    }
  }
  if (p && (p.modelo !== modelo || p.effort !== effort) && !(await cambiarEnVivo(p, modelo, effort))) {
    // Pudo haber salido mientras esperaba: si sigue, se cierra y se relanza con los nuevos.
    if (procs.get(g.sid) === p) await terminar(p);
    p = undefined;
  }
  if (p && procs.get(g.sid) !== p) p = undefined;
  if (p?.ocupado) throw errorT("main.respondiendo");
  if (g.modelo !== modelo || g.effort !== effort) {
    g.modelo = modelo;
    g.effort = effort;
    await guardar();
  }
  p ??= lanzar(g, true, local, await extraDe(modelo, g.cwd));
  p.ocupado = true;
  // Recién traído de una terminal: se cortaron sus esperas, y sus workers siguen sin quien los recoja.
  const origen = recienTraidos.get(g.sid);
  recienTraidos.delete(g.sid);
  const aviso = origen ? avisoTraido(workersVivos(g.sid), origen) : "";
  p.p.stdin!.write(lineaUsuario(aviso + texto, imagenes));
  alEv(g.sid, { tipo: "estado", ocupado: true, vivo: true });
  alCambio();
}

/** Por qué no se pudo retomar: abierto en otro proceso, sin transcript, o su carpeta ya no existe. */
export type Retomado = { ok: true } | { ok: false; motivo: "abierto" | "sinSesion" | "sinCarpeta" };

/** Cuánto del principio del transcript se lee para saber su `cwd`. */
const CABEZA = 256 * 1024;

/**
 * Retomar un líder sin proceso (lo mataron, cerró, o nació en una terminal): pasa a ser
 * de la app (`lideres.json`) y queda listo para escribirle. No lanza nada ni le manda
 * nada: el `claude -p --resume` sale con el primer mensaje del usuario (`mandar`), en la
 * carpeta donde vivía la sesión. Si no se puede, dice por qué.
 */
export async function retomar(x: { sid: string; modelo: string; effort: string; nombre?: unknown }): Promise<Retomado> {
  const sid = String(x?.sid);
  if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid });
  const modelo = sueltoDe("modelo", x.modelo);
  const effort = sueltoDe("effort", x.effort);
  if (await ajeno(sid)) return { ok: false, motivo: "abierto" };
  // Antes de anotarlo (`anotar` le borra la marca): si murió sin cerrar, sus workers siguen sin quien los recoja.
  const murio = await murioSinCerrar(sid);
  const r = await anotar(sid, { modelo, effort, nombre: x.nombre, modo: MODO_DEFAULT });
  if (!r.ok) return r;
  if (murio) recienTraidos.set(sid, "murio");
  await guardar();
  alCambio();
  return { ok: true };
}

/**
 * ¿Murió sin cerrar? Uno de la app (`murio`, de `lideres.json`) o uno de terminal que el vigía anotó en
 * `caidos.json` (`statusline.ts` lo lee desde ahí; no se importa para no hacer un ciclo con este módulo).
 */
async function murioSinCerrar(sid: string): Promise<boolean> {
  if ((await lideresApp()).find((l) => l.sid === sid)?.murio) return true;
  const g = await readFile(path.join(ESTADO, "caidos.json"), "utf8").then((t) => JSON.parse(t)).catch(() => null);
  return Array.isArray(g?.caidos) && g.caidos.some((c: { id?: unknown }) => c?.id === sid);
}

/**
 * Anota (en memoria; falta `guardar`) a una sesión como líder de la app, con la carpeta
 * donde nació. `nuevo`: no estaba en `lideres.json` (para deshacerlo si lo demás falla).
 */
async function anotar(
  sid: string,
  x: { modelo: string; effort: string; nombre?: unknown; modo: Modo },
): Promise<{ ok: true; nuevo: boolean } | { ok: false; motivo: "sinSesion" | "sinCarpeta" }> {
  const ahora = Math.floor(Date.now() / 1000);
  const ls = await lideresApp();
  const ya = ls.find((l) => l.sid === sid);
  if (ya) {
    if ((claseDeModelo(ya.modelo) === "gemini") !== (claseDeModelo(x.modelo) === "gemini"))
      throw errorT("main.cambioProveedor");
    // Ya era de la app y se había ido de la barra (un día sin turnos) o lo mataron: vuelve, ya no es Murió.
    if (!procs.has(sid)) ya.retomado = ahora;
    delete ya.murio;
    delete ya.motivo;
    return { ok: true, nuevo: false };
  }
  const t = await transcriptDe(sid);
  if (!t) return { ok: false, motivo: "sinSesion" };
  if ((t === path.join(ESTADO, "gemini", `${sid}.jsonl`)) !== (claseDeModelo(x.modelo) === "gemini"))
    throw errorT("main.cambioProveedor");
  const f = await open(t, "r").catch(() => null);
  if (!f) return { ok: false, motivo: "sinSesion" };
  let cwd: string | null;
  try {
    const b = Buffer.alloc(CABEZA);
    const { bytesRead } = await f.read(b, 0, CABEZA, 0);
    cwd = cwdDeTranscript(b.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await f.close();
  }
  cwd ??= HOME;
  if (!(await stat(cwd).then((s) => s.isDirectory(), () => false))) return { ok: false, motivo: "sinCarpeta" };
  ls.push({
    sid,
    nombre: nombreRetomado(x.nombre),
    modelo: x.modelo,
    effort: x.effort,
    creado: ahora,
    ultimo: 0,
    cache_ttl_s: null,
    modo: x.modo,
    ...(cwd !== HOME ? { cwd } : {}),
    retomado: ahora,
  });
  return { ok: true, nuevo: true };
}

/**
 * Por qué no se pudo traer: está haciendo algo y falta el permiso de cortarlo
 * (`trabajando`), no se lo pudo cerrar allá (`abierto`), o lo de `retomar`.
 */
export type Traido = { ok: true } | { ok: false; motivo: "trabajando" | "abierto" | "sinSesion" | "sinCarpeta" };

/** Cuánto se espera a que el `claude` de la terminal salga con SIGTERM antes del SIGKILL, y después. */
const TERM_MS = Number(process.env.HILOS_TERM_MS) || 6000;
const KILL_MS = 2000;

/** Espera a que el proceso de una sesión deje de existir. `false`: sigue ahí. */
async function hastaMorir(s: Sesion, ms: number): Promise<boolean> {
  for (const t0 = Date.now(); ; ) {
    if (!(await esElProceso(s.pid, s.procStart))) return true;
    if (Date.now() - t0 >= ms) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Traer a la app un líder abierto en una terminal: cierra ese `claude` y lo anota como
 * líder de la app (lo de `retomar`), para escribirle desde acá. Como `retomar`, no lanza
 * nada: el `--resume` sale con el mensaje que sigue. Nunca quedan dos procesos con la
 * misma sesión: recién contesta `ok` cuando el de la terminal ya no existe.
 *
 * Sólo se le manda la señal al pid exacto de la sesión (`sessions/<pid>.json`), y sólo si
 * su `procStart` es el del proceso de ahora: nunca por nombre, nunca a un padre (kitty es
 * un solo proceso para todas las ventanas). Si la sesión no es de una terminal (un `-p`:
 * otra trama, un worker) o no se puede confirmar el proceso, no se toca: `abierto`.
 * Si está haciendo algo (cualquier estado que no sea `idle`), sin `cortar` no se hace nada
 * y contesta `trabajando`: la vista avisa que se corta lo que está en vuelo y vuelve a pedir.
 */
export async function traer(x: { sid: string; modelo: string; effort: string; nombre?: unknown; modo?: unknown; cortar?: unknown }): Promise<Traido> {
  const sid = String(x?.sid);
  if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid });
  const modelo = sueltoDe("modelo", x.modelo);
  const effort = sueltoDe("effort", x.effort);
  const modo = modoDe(x.modo);
  // Como un `mandar` a medias: mientras tanto no sale ningún `--resume` de esta sesión.
  if (mandando.has(sid)) throw errorT("main.respondiendo");
  mandando.add(sid);
  try {
    const mio = procs.get(sid)?.p.pid;
    const otras = (await sesionesVivas()).filter((s) => s.id === sid && s.pid !== mio);
    for (const s of otras) {
      const terminal = s.kind === "interactive" && s.entrypoint !== "sdk-cli" && s.pid !== process.pid;
      if (!terminal || !(await esElProceso(s.pid, s.procStart))) return { ok: false, motivo: "abierto" };
    }
    if (x.cortar !== true && otras.some((s) => s.status !== "idle")) return { ok: false, motivo: "trabajando" };
    const r = await anotar(sid, { modelo, effort, nombre: x.nombre ?? otras[0]?.nombre, modo });
    if (!r.ok) return r;
    for (const s of otras) {
      for (const [senal, ms] of [["SIGTERM", TERM_MS], ["SIGKILL", KILL_MS]] as const) {
        // Otra vez, justo antes de la señal: el pid pudo haber cambiado de dueño.
        if (!(await esElProceso(s.pid, s.procStart))) break;
        try {
          process.kill(s.pid, senal);
        } catch {}
        if (await hastaMorir(s, ms)) break;
      }
      if (await esElProceso(s.pid, s.procStart)) {
        // No se dejó cerrar: queda como estaba, abierto allá.
        if (r.nuevo) {
          rastro(sid, "traer-fallido", "no se pudo cerrar su terminal: se borra el líder recién anotado");
          guardados = (await lideresApp()).filter((g) => g.sid !== sid);
        }
        return { ok: false, motivo: "abierto" };
      }
    }
    recienTraidos.set(sid, "terminal");
    await guardar();
    alCambio();
    return { ok: true };
  } finally {
    mandando.delete(sid);
  }
}

/**
 * Cambiar el modo de permisos (Shift+Tab, /plan…). Con proceso, por stdin
 * (`set_permission_mode`, también a mitad de un turno): el modo nuevo vuelve
 * por el stream. Sin proceso, queda guardado y se retoma con `--permission-mode`.
 */
export async function cambiarModo(sid: string, m: unknown): Promise<void> {
  const modo = modoDe(m);
  const g = (await lideresApp()).find((l) => l.sid === sid);
  if (!g) throw errorT("main.noEsDeLaApp");
  const p = procs.get(sid);
  if (p) {
    p.p.stdin!.write(lineaModo(idPedido(), modo));
    return;
  }
  g.modo = modo;
  await guardar();
  alEv(sid, { tipo: "modo", modo });
}

/** Los pedidos sin contestar de un líder (una vista recargada no los vio llegar). */
export const pendientes = (sid: string): EventoPedido[] => [...(procs.get(sid)?.pedidos.values() ?? [])].map((q) => q.ev);

/**
 * Contestar un pedido de permiso. `ok`: se permite con el input tal cual; si
 * no, se niega con `mensaje` (lo lee el modelo: "seguí planeando…"). Aprobar un
 * plan (ExitPlanMode) vuelve a bypass: `claude` volvería al modo de antes del plan.
 * AskUserQuestion: `ok` con `respuestas` (pregunta → lo elegido) va como `answers`
 * en el input; sin todas las respuestas no se contesta (error).
 */
export function responderPermiso(sid: string, id: string, r: { ok: boolean; mensaje?: string; respuestas?: unknown }) {
  const p = procs.get(sid);
  const q = p?.pedidos.get(id);
  if (!p || !q) return;
  let input = q.input;
  if (r.ok && q.preguntas) {
    const answers = respuestasValidas(q.preguntas, r.respuestas);
    if (!answers) throw errorT("main.respuestasRaras");
    input = inputRespondido(q.input, answers);
  }
  p.pedidos.delete(id);
  const resp = r.ok
    ? ({ behavior: "allow", updatedInput: input } as const)
    : ({ behavior: "deny", message: String(r.mensaje ?? "").trim() || "The user denied this." } as const);
  p.p.stdin!.write(lineaPermiso(id, resp, q.tool_use_id));
  if (r.ok && q.herramienta === "ExitPlanMode") p.p.stdin!.write(lineaModo(idPedido(), MODO_DEFAULT));
  alEv(sid, { tipo: "permisoFuera", id });
  alCambio();
}

/** Parar la respuesta: interrupt por stdin; si no contesta, SIGINT. */
export function parar(sid: string) {
  const p = procs.get(sid);
  if (!p || !p.ocupado) return;
  p.p.stdin!.write(lineaParar(idPedido()));
  const pid = p.p;
  clearTimeout(p.parando);
  p.parando = setTimeout(() => {
    if (procs.get(sid) === p && p.ocupado) {
      // Lo corta el usuario con Parar: que salga por la señal no es que haya muerto.
      p.adrede = true;
      pid.kill("SIGINT");
    }
  }, PARAR_MS);
  p.parando.unref();
}

/**
 * Por qué se cerró o se borró un líder (queda en el log): a mano con "Cerrar líder", Archivar, Borrar, Quitar
 * (uno sin proceso), el analista de Ramas, un traer que falló, el reinicio por Claude Code y la salida de trama.
 */
export const MOTIVOS = ["cerrar", "archivar", "borrar", "quitar", "analista", "traer-fallido", "reinicio", "salida"] as const;
export type Motivo = (typeof MOTIVOS)[number];

/** Una línea en el log por cada cierre o borrado de un líder: cuál (nombre e id) y por qué. La hora la pone el log. */
function rastro(sid: string, motivo: Motivo | "sin-motivo", detalle: string) {
  log.escribir("info", "lider", `${motivo}: "${nombreDe(sid) ?? "?"}" (${sid}) · ${detalle}`);
}

/**
 * Cerrar un líder de la app: corta la respuesta si la hay (SIGTERM), cierra
 * su proceso y lo saca de lideres.json. La sesión de Claude queda en disco.
 * `motivo` (de `MOTIVOS`; otra cosa cuenta como "sin-motivo") sólo va al log.
 */
export async function cerrar(sid: string, motivo?: unknown): Promise<void> {
  const p = procs.get(sid);
  const m = MOTIVOS.find((x) => x === motivo) ?? "sin-motivo";
  rastro(sid, m, `${p ? (p.ocupado ? "respondiendo, se corta" : "con proceso") : "sin proceso"}; sale de lideres.json`);
  if (p) {
    p.adrede = true;
    if (p.ocupado) p.p.kill("SIGTERM");
    await terminar(p);
  }
  guardados = (await lideresApp()).filter((g) => g.sid !== sid);
  await guardar();
  alCambio();
}

/** Cuánto se espera, como mucho, a que los líderes cierren al salir de trama: la sesión que se cierra no espera más (systemd mata a los 90 s). */
export const TOPE_SALIDA_MS = 10_000;

/**
 * Al salir de trama: los ociosos se cierran (stdin), y con `forzar` también
 * los ocupados (SIGTERM). Sin `forzar`, espera a que los ocupados terminen, pero
 * nunca más de `topeMs`: lo que siga vivo entonces se corta (SIGTERM; su
 * conversación queda en disco y se retoma con `--resume`) y queda en el log.
 * Devuelve los nombres de los que no cerraron a tiempo.
 */
export async function cerrarTodos(forzar: boolean, topeMs: number = TOPE_SALIDA_MS): Promise<string[]> {
  const vivos = [...procs.entries()];
  // Antes de cerrar nada: quién tenía proceso, para levantarlo al arrancar (`reanudarDormidos`). Si algo corta la salida a
  // medias (SIGKILL de systemd), la marca ya está en disco.
  const ls = await lideresApp();
  const ahora = Math.floor(Date.now() / 1000);
  let marcados = 0;
  for (const [sid, p] of vivos) {
    const g = ls.find((l) => l.sid === sid);
    if (g && g.rol !== "analista") {
      g.dormido = ahora;
      marcados++;
    }
    rastro(sid, "salida", `trama sale (cerrar, reiniciar o apagar): ${forzar && p.ocupado ? "respondiendo, se corta" : "se cierra"}${g && g.rol !== "analista" ? "; queda dormido y vuelve al arrancar" : ""}`);
  }
  if (marcados) await guardar();
  const hechos = new Set<string>();
  const todos = Promise.all(
    vivos.map(async ([sid, p]) => {
      p.adrede = true;
      if (forzar && p.ocupado) p.p.kill("SIGTERM");
      if (!p.ocupado || forzar) await terminar(p);
      else await new Promise<void>((ok) => p.libre.push(() => void terminar(p).then(ok)));
      hechos.add(sid);
    }),
  );
  let reloj: NodeJS.Timeout | undefined;
  const tarde = new Promise<boolean>((ok) => (reloj = setTimeout(() => ok(true), topeMs)));
  const pasoElTope = await Promise.race([todos.then(() => false), tarde]);
  clearTimeout(reloj);
  if (!pasoElTope) return [];
  const sin = vivos.filter(([sid]) => !hechos.has(sid));
  for (const [, p] of sin) if (p.p.exitCode === null && p.p.signalCode === null) p.p.kill("SIGTERM");
  const nombres = sin.map(([sid]) => nombreDe(sid) ?? sid.slice(0, 8));
  log.escribir("aviso", "salida", `${nombres.length} líder(es) no cerraron en ${topeMs / 1000} s y se cortaron: ${nombres.join(", ")}`);
  return nombres;
}

/**
 * Al arrancar: levanta de nuevo (`--resume`) a los líderes de la app que tenían proceso cuando trama se cerró
 * (`dormido`, lo anota `cerrarTodos`). Uno que nunca tuvo un turno no tiene transcript: se lo lanza con
 * `--session-id`, no con `--resume`. Sin mandarles nada (no gasta tokens). Los de una terminal (`ajeno`) no se tocan. El que no se pueda
 * levantar queda Murió con el motivo (`lanzar`: `fin`), nunca callado. Escalonado: no son N `claude` arrancando juntos.
 * Devuelve los sids que quedaron con proceso.
 */
export async function reanudarDormidos(escalonMs = 150): Promise<string[]> {
  const ls = (await lideresApp()).filter((g) => g.dormido);
  const hechos: string[] = [];
  for (const g of ls) {
    delete g.dormido;
    if (g.rol === "analista" || procs.has(g.sid) || mandando.has(g.sid) || (await ajeno(g.sid))) continue;
    const hay = (await transcriptDe(g.sid, g.cwd)) !== null;
    // Uno local vuelve ocioso sin cargar el modelo (nada de GPU al arrancar trama): lo carga su próximo mensaje.
    const local = localDe(g.modelo) ? await locales.destino(g.modelo).catch(() => undefined) : undefined;
    if (localDe(g.modelo) && !local) continue;
    const extra = await extraDe(g.modelo, g.cwd).catch((e) => (silencio("reanudar-extra")(e), null));
    if (!extra) continue;
    lanzar(g, hay, local && (await conContexto(local, g.cwd)), extra);
    hechos.push(g.sid);
    if (escalonMs > 0) await new Promise((ok) => setTimeout(ok, escalonMs));
  }
  if (ls.length) {
    await guardar();
    alCambio();
  }
  return hechos;
}

// --- Leer (también los de la terminal) -------------------------------------------

/** Dónde está el transcript de una sesión: el de su cwd o, si no, el que aparezca en `projects/`. */
export async function transcriptDe(sid: string, cwd?: string): Promise<string | null> {
  if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid });
  const directa = path.join(PROYECTOS, dirProyecto(cwd ?? HOME), `${sid}.jsonl`);
  const hay = (f: string) => access(f).then(() => true, () => false);
  if (await hay(directa)) return directa;
  // Un líder de Gemini guarda el suyo aparte (agy-puente.ts): no entra al consumo ni al historial de Claude.
  const gemini = transcriptGemini(sid);
  if (await hay(gemini)) return gemini;
  for (const d of await readdir(PROYECTOS).catch(() => [] as string[])) {
    const f = path.join(PROYECTOS, d, `${sid}.jsonl`);
    if (await hay(f)) return f;
  }
  return null;
}

/** El transcript de un líder de Gemini (lo escribe su puente): `$HILOS_STATE/gemini/<sid>.jsonl`. */
const transcriptGemini = (sid: string) => path.join(ESTADO, "gemini", `${sid}.jsonl`);

/** Dónde va a estar el transcript de un líder de la app (antes de su primer turno no existe). */
export const transcriptPorDefecto = (sid: string) => path.join(PROYECTOS, dirProyecto(HOME), `${sid}.jsonl`);

/** Una página de la conversación de un líder, con la forma de `pa --hilo --json`. */
export async function conversacionLider(x: { sid: string; n?: number; antes?: number | null }) {
  const t = await transcriptDe(String(x.sid));
  return paginaDe(await convDe(x.sid, t), x.sid, t, { n: Number(x.n) || 50, antes: x.antes ?? null });
}

/** "Ir a la ventana" de un líder de la terminal (electron/terminal.ts). */
export const irAVentana = (pid: number): Promise<boolean> => irA(pid);
/** ¿Se puede ubicar su ventana? Si no, la vista no ofrece el botón. */
export const ventanaUbicable = async (pid: number): Promise<boolean> => (await ubicar(pid)) !== null;
