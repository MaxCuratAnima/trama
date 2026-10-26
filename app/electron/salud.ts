// La salud de lo integrado (Ramas, "Integradas hace poco"): una integración
// salió mal si después se revirtió (`integradas.tsv` de `pa`, sólo lectura y por
// encabezado, como `medicion.tsv`), si su corrida quedó con `bien=no` en
// `medicion.tsv` o si los `tests` del registry dan rojo en main después de ella.
// Para eso último, un chequeo barato: tras cada integración (del usuario, sola o de
// un líder por terminal) los `tests` corren una vez sobre main, en la carpeta
// real del proyecto, en segundo plano, con el mismo tope que `pa` (1800 s). Si
// alguien integra en ese proyecto mientras corren, se cortan (`abortarChequeo`)
// y, si el HEAD de main se movió, el resultado se tira: la integración nueva
// trae su propio chequeo. Lo que da cada uno se guarda por id de integración en
// `~/.local/state/hilos/salud.json`. Sin polling: lo dispara cada lista nueva de
// `pa --hilos` (una corrida que pasa a `integrado`).
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { grupoPropio, matarArbol, shellDe } from "./procesos.js";
import { ENV, ESTADO, ID, PA_STATE, escribirAtomico } from "./pa.js";
import { registro, type Proyecto } from "./registro.js";
import { silencio } from "./log.js";

const ARCHIVO = path.join(ESTADO, "salud.json");
/** El mismo tope que `pa --integrar --tests` (`PA_TESTS_MAX`). */
const TOPE_S = Number(process.env.PA_TESTS_MAX) || 1800;
/** Lo que se guarda de la salida de unos tests rojos. */
const COLA_LINEAS = 40;
const COLA_BYTES = 4000;
/** Cuántos chequeos se recuerdan. */
const TOPE = 100;

/** La última fila de un id en `integradas.tsv`. */
export type FilaIntegrada = {
  id: string;
  proyecto: string;
  rama: string;
  head_antes: string;
  head_despues: string;
  commits: number;
  /** `PA_AUTO=1`: la integró "Integrar solo lo seguro", no un humano. */
  auto: boolean;
  /** "integrada", "revertida", "descartada". */
  accion: string;
  ts: number;
};

/** Los `tests` sobre main después de una integración: `rc` 0 = verdes; 124 = se pasaron del tope. */
export type Chequeo = { head: string; rc: number; cola: string; ts: number };

/** Lo que ve el panel de Ramas. */
export type EstadoSalud = {
  version: 1;
  integradas: Record<string, FilaIntegrada>;
  /** Las corridas con `bien=no` en `medicion.tsv`. */
  bienNo: string[];
  chequeos: Record<string, Chequeo>;
  /** Los ids cuyo chequeo está corriendo. */
  corriendo: string[];
};

/** En bench y capturas no se corre nada. */
const apagado = () => !!(process.env.HILOS_BENCH || process.env.HILOS_CAPTURA || process.env.HILOS_CAPTURA_PNG);

/** Un TSV con encabezado: cada fila como objeto (las columnas que falten, `undefined`). */
export function tsv(texto: string): Record<string, string | undefined>[] {
  const [cab, ...lineas] = texto.split("\n");
  const nombres = (cab ?? "").split("\t").map((n) => n.trim());
  return lineas
    .filter((l) => l.trim())
    .map((l) => {
      const c = l.split("\t");
      return Object.fromEntries(nombres.map((n, i) => [n, c[i]]));
    });
}

/** `integradas.tsv`: la última fila de cada id (nunca se reescribe: la última manda). */
export function filasIntegradas(texto: string): Record<string, FilaIntegrada> {
  const r: Record<string, FilaIntegrada> = {};
  for (const f of tsv(texto)) {
    if (!f.id || !ID.test(f.id)) continue;
    const ts = Date.parse(f.fecha ?? "") / 1000;
    r[f.id] = {
      id: f.id,
      proyecto: f.proyecto ?? "",
      rama: f.rama ?? "",
      head_antes: f.head_antes ?? "",
      head_despues: f.head_despues ?? "",
      commits: Number(f.commits) || 0,
      auto: f.auto === "1",
      accion: f.accion ?? "",
      ts: isNaN(ts) ? 0 : ts,
    };
  }
  return r;
}

/** `medicion.tsv`: los ids cuya columna `bien` empieza con "no". */
export function idsBienNo(texto: string): string[] {
  return tsv(texto)
    .filter((f) => f.id && /^no\b/.test((f.bien ?? "").trim().toLowerCase()))
    .map((f) => f.id!);
}

const leerTexto = (archivo: string) => readFile(archivo, "utf8").catch(() => "");

// La promesa, no el objeto: dos lecturas a la vez comparten el mismo (si no, una pisa lo que guardó la otra).
let chequeos: Promise<Record<string, Chequeo>> | null = null;
function leerChequeos(): Promise<Record<string, Chequeo>> {
  chequeos ??= readFile(ARCHIVO, "utf8").then(
    (t) => {
      const j = JSON.parse(t);
      return j?.version === 1 && j.chequeos && typeof j.chequeos === "object" ? j.chequeos : {};
    },
    () => ({}),
  ).catch(() => ({}));
  return chequeos;
}

async function guardarChequeo(id: string, c: Chequeo) {
  const todos = await leerChequeos();
  todos[id] = c;
  const ids = Object.keys(todos).sort((a, b) => todos[b].ts - todos[a].ts);
  for (const viejo of ids.slice(TOPE)) delete todos[viejo];
  await escribirAtomico(ARCHIVO, JSON.stringify({ version: 1, chequeos: todos }) + "\n").catch(silencio("salud"));
}

/** Un chequeo que corre: de qué integración, cómo matarlo y si lo cortaron. */
type Corriendo = { id: string; matar: (() => void) | null; cortado: boolean };
/** proyecto (slug) → el chequeo que corre. */
const corriendo = new Map<string, Corriendo>();
/** proyecto (slug) → cuántas integraciones de la app corren ahí (mientras, ningún chequeo arranca). */
const ocupados = new Map<string, number>();
/** proyecto (slug) → el chequeo que espera (a que termine una integración o el chequeo viejo). */
const pendientes = new Map<string, { p: Proyecto; id: string }>();
let saliendo = false;

/** Cuántos proyectos tienen una integración (o un revertir) de la app corriendo ahora. */
export const integrando = () => ocupados.size;
/** Cuándo (ms) arrancó la última integración o revertir de la app que corre ahora; 0 si no hay ninguna. */
export const integrandoDesde = () => (ocupados.size ? ultimaIntegracion : 0);
let ultimaIntegracion = 0;

export async function estadoSalud(): Promise<EstadoSalud> {
  const [integ, med, ch] = await Promise.all([
    leerTexto(path.join(PA_STATE, "integradas.tsv")),
    leerTexto(path.join(PA_STATE, "medicion.tsv")),
    leerChequeos(),
  ]);
  return {
    version: 1,
    integradas: filasIntegradas(integ),
    bienNo: idsBienNo(med),
    chequeos: ch,
    corriendo: [...corriendo.values()].map((c) => c.id),
  };
}

let avisar: (e: EstadoSalud) => void = () => {};
/** Recibe cada cambio (para mandarlo al renderer). */
export function alCambiarSalud(fn: (e: EstadoSalud) => void) {
  avisar = fn;
}
const emitir = () => void estadoSalud().then(avisar, () => {});

/** El HEAD de la carpeta del proyecto, o `null` (no es git, o git no pudo). */
function head(ruta: string): Promise<string | null> {
  return new Promise((ok) =>
    execFile("git", ["-C", ruta, "rev-parse", "HEAD"], (err, out) => ok(err ? null : String(out).trim() || null)),
  );
}

/** Las últimas líneas de la salida (lo que importa de unos tests rojos). */
export function colaDe(salida: string): string {
  const l = salida.replace(/\s+$/, "").split("\n").slice(-COLA_LINEAS).join("\n");
  return l.length > COLA_BYTES ? l.slice(-COLA_BYTES) : l;
}

/** `bash -c <tests>` (`cmd /c` en Windows) en `ruta`, con tope; nunca rechaza. `null`: lo cortaron. */
function correrTests(ruta: string, cmd: string, c: Corriendo): Promise<{ rc: number; salida: string } | null> {
  return new Promise((ok) => {
    let salida = "";
    let pasado = false;
    // Su propio grupo de procesos: cortar (o el tope) mata también lo que lance.
    const sh = shellDe(cmd);
    const hijo = spawn(sh.bin, sh.args, { cwd: ruta, env: ENV, stdio: ["ignore", "pipe", "pipe"], ...grupoPropio(), ...sh.opciones });
    const juntar = (b: Buffer) => {
      salida += b.toString("utf8");
      if (salida.length > 64 * 1024) salida = salida.slice(-32 * 1024);
    };
    hijo.stdout?.on("data", juntar);
    hijo.stderr?.on("data", juntar);
    const matar = () => void matarArbol(hijo.pid, true);
    const reloj = setTimeout(() => {
      pasado = true;
      matar();
    }, TOPE_S * 1000);
    c.matar = matar;
    hijo.on("error", (e) => {
      clearTimeout(reloj);
      ok({ rc: 127, salida: String(e?.message ?? e) });
    });
    hijo.on("close", (code) => {
      clearTimeout(reloj);
      if (c.cortado) return ok(null);
      ok({ rc: pasado ? 124 : (code ?? 1), salida });
    });
  });
}

/**
 * Alguien va a integrar o revertir en ese proyecto: el chequeo que corre se
 * corta (sin resultado). La integración nueva trae el suyo.
 */
export function abortarChequeo(proyecto: string) {
  const c = corriendo.get(proyecto);
  if (!c) return;
  c.cortado = true;
  c.matar?.();
}

/** La app sale: ningún chequeo queda huérfano (corren en su propio grupo de procesos). */
export function cortarChequeos() {
  saliendo = true;
  pendientes.clear();
  for (const p of corriendo.keys()) abortarChequeo(p);
}

/** Arranca el chequeo que esperaba, si el proyecto quedó libre. */
function soltar(slug: string) {
  const x = pendientes.get(slug);
  if (!x || saliendo || ocupados.has(slug) || corriendo.has(slug)) return;
  pendientes.delete(slug);
  void chequear(x.p, x.id).catch(silencio("salud"));
}

/**
 * `fn` integra o revierte en ese proyecto: el chequeo que corre se corta y
 * ninguno arranca hasta que termine (el que llegue en el medio, espera).
 */
export async function mientrasIntegra<T>(proyecto: string, fn: () => Promise<T>): Promise<T> {
  ocupados.set(proyecto, (ocupados.get(proyecto) ?? 0) + 1);
  ultimaIntegracion = Date.now();
  abortarChequeo(proyecto);
  try {
    return await fn();
  } finally {
    const n = (ocupados.get(proyecto) ?? 1) - 1;
    if (n > 0) ocupados.set(proyecto, n);
    else {
      ocupados.delete(proyecto);
      soltar(proyecto);
    }
  }
}

/** Los `tests` sobre main de ese proyecto, por la integración `id` (o la que dejó main en su HEAD). */
async function chequear(p: Proyecto, id: string) {
  if (!p.tests || saliendo) return;
  // Alguien integra, o corre el chequeo de una integración anterior (main ya se
  // movió: su resultado se tiraría): éste espera y el viejo se corta.
  if (ocupados.has(p.slug) || corriendo.has(p.slug)) {
    pendientes.set(p.slug, { p, id });
    abortarChequeo(p.slug);
    return;
  }
  const c: Corriendo = { id, matar: null, cortado: false };
  corriendo.set(p.slug, c);
  try {
    const antes = await head(p.ruta);
    if (!antes) return;
    // El HEAD de main es de la integración cuyo head_despues coincide (si `pa` la anotó).
    const filas = filasIntegradas(await leerTexto(path.join(PA_STATE, "integradas.tsv")));
    const suya = Object.values(filas)
      .filter((f) => f.head_despues === antes && f.accion === "integrada")
      .sort((a, b) => b.ts - a.ts)[0];
    c.id = suya?.id ?? id;
    if ((await leerChequeos())[c.id] || c.cortado) return;
    emitir();
    const r = await correrTests(p.ruta, p.tests, c);
    if (!r) return;
    // Main se movió mientras corrían: el resultado no es de esta integración.
    if ((await head(p.ruta)) !== antes) return;
    await guardarChequeo(c.id, { head: antes, rc: r.rc, cola: r.rc === 0 ? "" : colaDe(r.salida), ts: Math.floor(Date.now() / 1000) });
  } finally {
    corriendo.delete(p.slug);
    soltar(p.slug);
    emitir();
  }
}

type HiloSalud = { id: string; proyecto: string; estado: string };

/** Los que ya estaban integrados la última vez: sólo una transición dispara el chequeo. */
let vistos: Set<string> | null = null;

/**
 * Una lista nueva de `pa --hilos`: lo que pasó a `integrado` desde la anterior
 * se chequea (la primera lista sólo siembra: lo viejo no se chequea al abrir).
 */
export async function barrerSalud(hilos: HiloSalud[]) {
  const integrados = hilos.filter((h) => h.estado === "integrado" && ID.test(String(h.id)));
  if (!vistos) {
    vistos = new Set(integrados.map((h) => h.id));
    return;
  }
  const nuevos = integrados.filter((h) => !vistos!.has(h.id));
  for (const h of nuevos) vistos.add(h.id);
  if (apagado() || !nuevos.length) return;
  const reg = await registro();
  // De cada proyecto, la más nueva (el chequeo es de main, no de cada una).
  const porProyecto = new Map(nuevos.map((h) => [h.proyecto, h]));
  for (const [slug, h] of porProyecto) {
    const p = reg.find((x) => x.slug === slug || x.nombre === slug);
    if (p?.tests) void chequear(p, h.id).catch(silencio("salud"));
  }
  emitir();
}
