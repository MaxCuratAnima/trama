// `~/.config/trama/modelos.json`: la config de modelos que leen `pa` y trama (líder, modelo de cada tipo de worker,
// modelos locales de Ollama, cupo de Gemini). Acá se lee, se escribe (atómico, con `version`, sin perder las claves
// que no conoce) y se sondea Ollama. Sin archivo, Ajustes muestra lo de hoy y NO lo crea hasta que se guarda un cambio.
// Es EL lector del archivo: Ajustes (leer/guardar) y el líder (`modelosConfig`, `localOllama`, `vistaModelos`: qué modelo es el
// líder por defecto, qué locales de Ollama hay, si Gemini está habilitado) salen del mismo parseo (`analizar` + `leerConfig` de
// modelos-tipos.ts); el líder sólo le suma sus filtros de seguridad (nada que parezca un flag) y nunca escribe.
// Node puro: los tests lo usan directo (`TRAMA_MODELOS` o `HILOS_MODELOS` cambian la ruta; `pa` y Ollama, siempre falsos).
import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hayAgy, hayClaude } from "./capacidades.ts";
import { leerDestrabos, type CuentaDestrabos } from "./destrabar-registro.ts";
import { rutaModelos as rutaModelosDe } from "./plataforma.ts";
import { errorT, textoT } from "./errores.ts";
import { destrabarActivo, leerConfig, unir, urlOllama, validarConfig, TIPOS, type ConfigModelos, type Eleccion, type Tipo } from "./modelos-tipos.ts";

/** Dónde está el archivo (se mira cada vez: los tests lo cambian por el entorno). */
export const rutaModelos = () => rutaModelosDe(process.platform, process.env, os.homedir());
export const RUTA_MODELOS = rutaModelos();

/** Lo que `reparto` elegiría hoy para un tipo de worker (`workers.<tipo>.reparto` de `pa --modelos --json`); sólo para mostrar. */
export type RepartoHoy = { modelo: string; effort: string | null; motor: string; motivo: string };

/** Lo que la tabla efectiva de `pa --modelos --json` dice de cada tipo; `null` si `pa` todavía no tiene el comando. */
export type EfectivoPa = {
  lider: Eleccion | null;
  workers: Partial<Record<Tipo, Eleccion>>;
  /** Con `reparto` automático, lo que elegiría hoy por tipo (`null`: no pudo elegir). Sin la clave: este `pa` no lo dice. */
  reparto?: Partial<Record<Tipo, RepartoHoy | null>>;
};

export type EstadoModelos = {
  version: 1;
  ruta: string;
  /** El archivo existe: sin él se muestra lo de hoy y no se crea nada. */
  existe: boolean;
  config: ConfigModelos;
  /** Por qué no se pudo leer (JSON roto, otra versión): no se escribe encima. */
  error: string | null;
  efectivo: EfectivoPa | null;
  /** `agy` está instalado en esta máquina: los modelos de Google se ofrecen sin necesidad de `modelos.json`. */
  agy?: boolean;
  /** Hay `agy` y no `claude`: los defaults de los workers son los de Gemini. */
  solo_gemini?: boolean;
  /** Cuántas veces trama destrabó a un modelo que se repetía y cómo terminó (`destrabos.jsonl`); sin ninguna, todo en cero. */
  destrabo?: CuentaDestrabos;
};

export type CorrerPa = (args: string[]) => Promise<{ rc: number; out: string; dijo: string }>;

type Crudo = { texto: string | null; obj: Record<string, unknown> | null; error: string | null };

/** El texto del archivo → el objeto v1, o por qué no sirve (JSON roto, no es un objeto, otra versión). */
function analizar(texto: string, ruta: string): Crudo {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch (e) {
    return { texto, obj: null, error: textoT("main.modelosRoto", { ruta, e: (e as Error).message }) };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { texto, obj: null, error: textoT("main.modelosRoto", { ruta, e: "no es un objeto" }) };
  const v = (j as { version?: unknown }).version;
  if (v !== 1) return { texto, obj: null, error: textoT("main.modelosVersion", { ruta, v: String(v).slice(0, 20) }) };
  return { texto, obj: j as Record<string, unknown>, error: null };
}

async function leerCrudo(ruta: string): Promise<Crudo> {
  let texto: string;
  try {
    texto = await readFile(ruta, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { texto: null, obj: null, error: null };
    return { texto: null, obj: null, error: textoT("main.noLeo", { ruta, e: (e as Error).message }) };
  }
  return analizar(texto, ruta);
}

/** La tabla efectiva de `pa --modelos --json`, si `pa` la tiene y la entiendo; si no, `null` y el panel la arma del archivo. */
export async function efectivoDePa(correr?: CorrerPa): Promise<EfectivoPa | null> {
  if (!correr) return null;
  try {
    const r = await correr(["--modelos", "--json"]);
    if (r.rc !== 0) return null;
    const j: unknown = JSON.parse(r.out);
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    // Mismo molde que el archivo: `{ lider: {modelo, effort?}, workers: { tipo: {modelo, effort?} } }`.
    const c = leerConfig(j as Record<string, unknown>);
    const hay = c.lider || TIPOS.some((t) => c.workers[t]);
    if (!hay) return null;
    const reparto = repartoDe((j as { workers?: unknown }).workers);
    return { lider: c.lider ?? null, workers: c.workers, ...(reparto ? { reparto } : {}) };
  } catch {
    return null;
  }
}

/** `workers.<tipo>.reparto` de `pa --modelos --json`: sólo los campos de texto que se muestran; sin la clave (un `pa` viejo), `null`. */
function repartoDe(w: unknown): Partial<Record<Tipo, RepartoHoy | null>> | null {
  if (!w || typeof w !== "object") return null;
  const o: Partial<Record<Tipo, RepartoHoy | null>> = {};
  let vio = false;
  for (const t of TIPOS) {
    const r = (w as Record<string, unknown>)[t];
    if (!r || typeof r !== "object" || !("reparto" in r)) continue;
    vio = true;
    const x = (r as { reparto: unknown }).reparto;
    if (!x || typeof x !== "object") { o[t] = null; continue; }
    const { modelo, effort, motor, motivo } = x as Record<string, unknown>;
    if (typeof modelo !== "string" || !modelo) { o[t] = null; continue; }
    o[t] = { modelo, effort: typeof effort === "string" ? effort : null, motor: typeof motor === "string" ? motor : "", motivo: typeof motivo === "string" ? motivo.slice(0, 400) : "" };
  }
  return vio ? o : null;
}

export async function leerModelos(correr?: CorrerPa, ruta = rutaModelos()): Promise<EstadoModelos> {
  const [c, efectivo] = await Promise.all([leerCrudo(ruta), efectivoDePa(correr)]);
  return {
    version: 1,
    ruta,
    existe: c.texto !== null,
    config: c.obj ? leerConfig(c.obj) : leerConfig({}),
    error: c.error,
    efectivo,
    ...(hayAgy() ? { agy: true } : {}),
    ...(hayAgy() && !hayClaude() ? { solo_gemini: true } : {}),
    destrabo: leerDestrabos(),
  };
}

/**
 * Valida y escribe (tmp + rename en la misma carpeta; crea `~/.config/trama` si falta). Rechaza sin tocar nada si lo que
 * llega no vale o el archivo de ahora no se puede leer (no se escribe encima de un JSON roto ni de otra versión).
 */
export async function guardarModelos(x: unknown, correr?: CorrerPa, ruta = rutaModelos()): Promise<EstadoModelos> {
  const c = validarConfig(x);
  const crudo = await leerCrudo(ruta);
  if (crudo.error) throw new Error(crudo.error);
  const texto = JSON.stringify(unir(crudo.obj, c), null, 2) + "\n";
  if (texto !== crudo.texto) {
    await mkdir(path.dirname(ruta), { recursive: true });
    // Si es un enlace (dotfiles), se escribe el archivo al que apunta.
    const real = crudo.texto === null ? ruta : await realpath(ruta);
    const tmp = `${real}.trama-${process.pid}.tmp`;
    await writeFile(tmp, texto);
    await rename(tmp, real);
  }
  return leerModelos(correr, ruta);
}

// --- Ollama ----------------------------------------------------------------------

export type Sondeo = { ok: true; modelos: { nombre: string; bytes: number | null }[] } | { ok: false; motivo: string };

/** `GET <url>/api/tags`: los modelos que Ollama tiene instalados, o por qué no contesta. No carga ningún modelo. */
export async function sondearOllama(url: unknown, espera_ms = 3000): Promise<Sondeo> {
  const base = urlOllama(url);
  if (!base) throw errorT("main.modelosUrl", { v: String(url).slice(0, 60) });
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(espera_ms), redirect: "error" });
    if (!r.ok) return { ok: false, motivo: textoT("main.ollamaHttp", { n: r.status }) };
    const j = (await r.json()) as { models?: { name?: unknown; model?: unknown; size?: unknown }[] };
    if (!Array.isArray(j.models)) return { ok: false, motivo: textoT("main.ollamaNoEs") };
    const modelos = j.models.flatMap((m) => {
      const nombre = typeof m?.name === "string" ? m.name : typeof m?.model === "string" ? m.model : "";
      return nombre ? [{ nombre, bytes: typeof m.size === "number" ? m.size : null }] : [];
    });
    return { ok: true, modelos };
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return { ok: false, motivo: timeout ? textoT("main.ollamaTarda") : textoT("main.ollamaNoContesta") };
  }
}

// --- Lo que lee el líder ----------------------------------------------------------

/** Un modelo local de Ollama del archivo. `id` lleva el prefijo (`ollama:…`); `modelo` es el nombre que Ollama conoce. */
export type LocalOllama = { id: string; nombre: string; url: string; modelo: string };

export type ModelosConfig = {
  lider: { modelo: string; effort: string | null } | null;
  locales: LocalOllama[];
  /** El archivo trae la sección `gemini` (Gemini habilitado). */
  gemini: boolean;
};

/** Qué clase de líder es un modelo: el `claude` de siempre, `agy` (Gemini) u Ollama (el mismo `claude` contra otro endpoint). */
export type Clase = "claude" | "gemini" | "ollama";

export const claseDeModelo = (modelo: string): Clase => (modelo.startsWith("ollama:") ? "ollama" : /^(?:gemini-|agy:)/.test(modelo) ? "gemini" : "claude");

export const EFFORTS_GEMINI = ["low", "medium", "high"] as const;
export const EFFORT_GEMINI_DEFECTO = "high";

/** `gemini-4-argon-high` → `{ modelo: "gemini-4-argon", effort: "high" }`; sin sufijo, el esfuerzo es el default. */
export function partirGemini(id: string, effort?: string | null): { modelo: string; effort: string } {
  const m = /^((?:gemini-|agy:).+?)-(low|medium|high)$/.exec(id);
  if (m) return { modelo: m[1], effort: m[2] };
  const def = id === "agy:gpt-oss-120b" ? "medium" : EFFORT_GEMINI_DEFECTO;
  return { modelo: id, effort: effort && (EFFORTS_GEMINI as readonly string[]).includes(effort) ? effort : def };
}

/** Lo que se le pasa a `agy --model`: el modelo con su esfuerzo (`gemini-3.8-flash-low`). */
export const idAgy = (modelo: string, effort: string) =>
  /-(low|medium|high)$/.test(modelo) ? modelo : `${modelo}-${(EFFORTS_GEMINI as readonly string[]).includes(effort) ? effort : EFFORT_GEMINI_DEFECTO}`;

const TABLA_AGY: Record<string, string> = {
  "gpt-oss-120b-low": "gpt-oss-120b-medium",
  "gpt-oss-120b-medium": "gpt-oss-120b-medium",
  "gpt-oss-120b-high": "gpt-oss-120b-medium",
};

/** El nombre real que acepta `agy --model` (`agy:claude-opus-5-5-high` → `claude-opus-5-5-high`). */
export function modeloAgy(modelo: string): string {
  const sin = modelo.startsWith("agy:") ? modelo.slice("agy:".length) : modelo;
  const con = /-(low|medium|high)$/.test(sin) ? sin : `${sin}-${sin === "gpt-oss-120b" ? "medium" : EFFORT_GEMINI_DEFECTO}`;
  return TABLA_AGY[con] ?? con;
}

/** Un valor que va a un archivo de config o a una línea de comandos: sin espacios ni nulos y que no empiece con guion (iría como flag). */
const sano = (v: unknown): v is string => typeof v === "string" && !!v && !/[\s\0]/.test(v) && !v.startsWith("-");

/**
 * El texto del archivo → lo que usa el líder. `null`: no es un contrato que se conozca (otra versión, no es un objeto). Lo roto
 * de a una entrada se descarta.
 */
export function leerLider(texto: string): ModelosConfig | null {
  const { obj } = analizar(texto, "");
  if (!obj) return null;
  const c = leerConfig(obj);
  const locales: LocalOllama[] = [];
  for (const l of c.locales) {
    if (!l.id.startsWith("ollama:") || !sano(l.id) || !sano(l.modelo) || locales.some((x) => x.id === l.id)) continue;
    locales.push({ id: l.id, nombre: l.nombre.trim().slice(0, 60) || l.modelo, url: l.url, modelo: l.modelo });
  }
  const lider = c.lider && sano(c.lider.modelo) ? { modelo: c.lider.modelo, effort: sano(c.lider.effort) ? c.lider.effort : null } : null;
  const g = obj.gemini;
  return { lider, locales, gemini: !!g && typeof g === "object" };
}

/** El archivo de verdad; `null` si no existe o no se entiende (y entonces todo es como siempre). */
export function modelosConfig(): ModelosConfig | null {
  try {
    return leerLider(readFileSync(rutaModelos(), "utf8"));
  } catch {
    return null;
  }
}

/** ¿«Destrabar solo cuando se repite» está prendido para este modelo? Lo mira el puente de agy en cada turno (sin archivo o roto: la fábrica). */
export function destrabarModelo(modelo: string): boolean {
  try {
    const { obj } = analizar(readFileSync(rutaModelos(), "utf8"), "");
    return destrabarActivo(modelo, obj ? leerConfig(obj).destrabar : undefined);
  } catch {
    return destrabarActivo(modelo, undefined);
  }
}

/** El local de Ollama que ese id nombra, del archivo; `null` si no está (un modelo `ollama:*` que no figura en `locales` no se lanza). */
export const localOllama = (id: string, cfg: ModelosConfig | null = modelosConfig()): LocalOllama | null => cfg?.locales.find((l) => l.id === id) ?? null;

/**
 * Lo que sabe el renderer: sin url ni nada que no sea para mostrar (`src/datos/modelos-config.ts`). Gemini está si el archivo
 * lo habilita o es el líder por defecto. `null`: no hay archivo y todo es como siempre.
 */
export function vistaModelos(cfg: ModelosConfig | null = modelosConfig(), agy = false, llama: { id: string; nombre: string; empresa: string }[] = []) {
  if (!cfg) return agy || llama.length ? { version: 1, gemini: agy, locales: [], llama, lider: null } : null;
  return {
    version: 1,
    gemini: agy || cfg.gemini || (cfg.lider !== null && claseDeModelo(cfg.lider.modelo) === "gemini"),
    locales: cfg.locales.map((l) => ({ id: l.id, nombre: l.nombre })),
    llama,
    lider: cfg.lider,
  };
}
