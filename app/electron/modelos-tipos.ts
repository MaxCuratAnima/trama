// La config de modelos que comparten `pa` y trama (`~/.config/trama/modelos.json`): qué forma tiene, qué vale y cómo se
// junta lo que se edita en Ajustes con lo que ya hay en el archivo. Puro y sin imports de Node: lo usan el main (para no
// escribir nada inválido) y el panel (el borrador). Lo que no conoce lo deja como estaba: otra versión de trama o de `pa`
// puede haber agregado claves, y un Guardar no las borra. Lo prueba tests/modelos-config.test.ts.
import { errorT } from "./errores.ts";

export const TIPOS = ["default", "codigo-acotado", "codigo-multi", "frontend", "debug", "diseno", "lectura", "mecanico"] as const;
export type Tipo = (typeof TIPOS)[number];

/** Los niveles de esfuerzo de Claude Code; en Gemini va dentro del nombre y un local no tiene. */
export const EFFORTS_CONFIG = ["low", "medium", "high", "xhigh", "max"] as const;

/** Los Gemini que `pa` sabe lanzar (agy). */
export const GEMINI = [
  "gemini-4-argon-low",
  "gemini-4-argon-medium",
  "gemini-4-argon-high",
  "gemini-3.8-flash-low",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-high",
] as const;

/** Los modelos no-Gemini que `agy` sirve con el cupo de Google (`agy:<modelo>-<effort>`). */
export const AGY = [
  "agy:claude-opus-5-5-low",
  "agy:claude-opus-5-5-medium",
  "agy:claude-opus-5-5-high",
  "agy:claude-opus-4-6-thinking",
  "agy:claude-sonnet-5-5-low",
  "agy:claude-sonnet-5-5-medium",
  "agy:claude-sonnet-5-5-high",
  "agy:claude-sonnet-4-6",
  "agy:gpt-oss-120b-low",
  "agy:gpt-oss-120b-medium",
  "agy:gpt-oss-120b-high",
] as const;

export const REPARTO = ["auto", "fijo"] as const;
export type ModoReparto = (typeof REPARTO)[number];

export const SIN_CLAUDE = ["claude", "esperar", "fallar"] as const;
export type SinClaude = (typeof SIN_CLAUDE)[number];
/** Qué hace `pa` si el modelo que eligió el reparto no tiene cupo (`sin_cupo`, de cualquier proveedor): lanzar otro, esperar o fallar. */
export const SIN_CUPO = ["otro", "esperar", "fallar"] as const;
export type SinCupo = (typeof SIN_CUPO)[number];
/** El `gemini.sin_claude` de antes dice lo mismo con otro nombre para el primero (`claude` = `otro`). */
export const sinCupoDe = (v: SinClaude): SinCupo => (v === "claude" ? "otro" : v);
/** Cuánto del cupo de Claude no tocan los workers cuando el archivo no dice nada (`RESERVA` de `reparto`: 15 % libre = tope de 85 %). */
export const TOPE_CLAUDE_DEFECTO = 85;
/** Familias de modelo que `reparto` conoce por nombre (`excluir` las acepta además de ids y patrones con `*`). */
export const FAMILIAS = ["fable", "opus", "sonnet", "haiku", "argon", "flash", "gpt-oss"] as const;
/** Más entradas en `excluir` que esto no es una lista que alguien arme a mano. */
export const EXCLUIR_MAX = 50;
/** Una entrada de `excluir`: una familia, un id o un prefijo con `*` al final; sin espacios ni comillas. */
const FORMA_EXCLUIR = /^[A-Za-z0-9][\w.:*/[\]-]{0,79}$/;
export const CUPO_MIN = 1;
export const CUPO_MAX = 100;
export const URL_OLLAMA = "http://localhost:11434";
/** Más locales que esto no es una lista que alguien arme a mano. */
export const LOCALES_MAX = 50;

/** Un modelo y, si es de Claude, su esfuerzo. */
export type Eleccion = { modelo: string; effort?: string };
/** Un modelo servido por Ollama: `id` es `ollama:<modelo>` y es lo que se elige en los selectores. */
export type Local = { id: string; nombre: string; url: string; modelo: string };
export type ConfigModelos = {
  lider?: Eleccion;
  reparto?: ModoReparto;
  workers: Partial<Record<Tipo, Eleccion>>;
  locales: Local[];
  /** Modelos (familias, ids o prefijos con `*`) que `reparto` nunca elige y que un `-m` no puede usar sin permiso del dueño. */
  excluir: string[];
  /** Deja correr opus/sonnet con esfuerzo `max` sin pedir permiso (Fable lo sigue pidiendo). Sin la clave vale `false`. */
  permitir_max: boolean;
  gemini: { cupo_max?: number };
  /** `sin_cupo` del archivo; un `gemini.sin_claude` viejo se lee como éste y se reescribe así al guardar. */
  sin_cupo?: SinCupo;
  /**
   * Hasta qué % de cada ventana del plan de Claude (5 h, semanal) usan los workers; el resto queda para las sesiones propias.
   * En el archivo es `reserva` (lo que se guarda libre, 0–1; número o `{"5h", "7d"}`), la clave que ya lee `reparto`.
   */
  claude: { tope_5h?: number; tope_7d?: number };
  /**
   * «Destrabar solo cuando se repite», por modelo (la clave es el id sin esfuerzo: `gemini-3.8-flash`): sólo lo que se tocó. Sin
   * la clave vale la fábrica (`destrabarPorDefecto`, electron/modelos-tipos.ts: prendido para Gemini 3.8 Flash, apagado el resto).
   */
  destrabar: Record<string, boolean>;
};

export const vacia = (): ConfigModelos => ({ workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude: {}, destrabar: {} });

/** `reserva` (fracción libre que se guarda) ↔ tope (% usable), enteros. */
export const topeDeReserva = (r: number) => Math.round((1 - r) * 100);
export const reservaDeTope = (t: number) => Math.round((100 - t) * 100) / 10000;
const topeValido = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= CUPO_MIN && n <= CUPO_MAX;
const reservaValida = (r: unknown): r is number => typeof r === "number" && Number.isFinite(r) && r >= 0 && r < 1;

/** Los topes que dice un `reserva` ya parseado (un número vale para las dos ventanas; lo que no tiene forma se ignora). */
export function topesDe(reserva: unknown): ConfigModelos["claude"] {
  const c: ConfigModelos["claude"] = {};
  if (reservaValida(reserva)) return { tope_5h: topeDeReserva(reserva), tope_7d: topeDeReserva(reserva) };
  if (esObj(reserva)) {
    if (reservaValida(reserva["5h"])) c.tope_5h = topeDeReserva(reserva["5h"]);
    if (reservaValida(reserva["7d"])) c.tope_7d = topeDeReserva(reserva["7d"]);
  }
  return c;
}

export const esClaude = (m: string) => m.startsWith("claude-");
export const esGemini = (m: string) => m.startsWith("gemini-");
export const esAgy = (m: string) => m.startsWith("agy:");

// --- «Destrabar solo cuando se repite»: el detector está en destrabar.ts; acá, qué modelos lo traen y cómo se decide.
/** El modelo para el que viene prendido; el resto, apagado hasta que se prende en Ajustes. */
export const DESTRABAR_DE_FABRICA = ["gemini-3.8-flash"] as const;
/** `gemini-3.8-flash-low` → `gemini-3.8-flash`; `agy:claude-opus-5-5-high` → `agy:claude-opus-5-5`. La clave del ajuste por modelo. */
export const claveDestrabo = (modelo: string): string => modelo.replace(/-(low|medium|high)$/, "");
/** Prendido de fábrica sólo para Gemini 3.8 Flash. */
export const destrabarPorDefecto = (modelo: string): boolean => (DESTRABAR_DE_FABRICA as readonly string[]).includes(claveDestrabo(modelo));
/** Lo que dice el ajuste (`destrabar` de modelos.json: sólo las claves que se tocaron) o, sin decir, la fábrica. */
export const destrabarActivo = (modelo: string, ajuste: Record<string, boolean> | undefined): boolean => {
  const v = ajuste?.[claveDestrabo(modelo)];
  return typeof v === "boolean" ? v : destrabarPorDefecto(modelo);
};
/** Los modelos de agy que se ofrecen en Ajustes (uno por modelo, sin esfuerzo). */
export const DESTRABAR_MODELOS: readonly string[] = [...new Set([...GEMINI, ...AGY].map(claveDestrabo))];
export const esOllama = (m: string) => m.startsWith("ollama:");
/** Un id con forma de id (va a un archivo y a una línea de comandos): sin espacios ni comillas. */
const FORMA_ID = /^[A-Za-z0-9][\w.:/[\]-]{0,120}$/;

const esObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** La URL de un servidor Ollama sin la barra final; `null` si no es http(s) con host. */
export function urlOllama(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  try {
    const u = new URL(texto.trim());
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password || u.search || u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Lo que se lee de una elección del archivo; lo que no tiene forma se ignora (el archivo no se toca hasta guardar). */
function eleccionDe(x: unknown): Eleccion | undefined {
  if (!esObj(x) || typeof x.modelo !== "string" || !x.modelo) return undefined;
  return typeof x.effort === "string" && x.effort ? { modelo: x.modelo, effort: x.effort } : { modelo: x.modelo };
}

function localDe(x: unknown): Local | undefined {
  if (!esObj(x) || typeof x.id !== "string" || typeof x.modelo !== "string" || typeof x.url !== "string") return undefined;
  const url = urlOllama(x.url);
  if (!url || !x.modelo) return undefined;
  return { id: x.id, nombre: typeof x.nombre === "string" && x.nombre ? x.nombre : x.modelo, url, modelo: x.modelo };
}

/** Lo que dice un archivo ya parseado, sin exigir que esté perfecto: con lo que se entiende se arma el borrador. */
export function leerConfig(j: Record<string, unknown>): ConfigModelos {
  const c = vacia();
  c.lider = eleccionDe(j.lider);
  if (!c.lider) delete c.lider;
  if (j.reparto === "auto" || j.reparto === "fijo") c.reparto = j.reparto;
  if (esObj(j.workers)) for (const t of TIPOS) { const e = eleccionDe(j.workers[t]); if (e?.modelo === "auto") c.reparto = "auto"; else if (e) c.workers[t] = e; }
  if (Array.isArray(j.locales)) for (const l of j.locales) { const x = localDe(l); if (x) c.locales.push(x); }
  if (Array.isArray(j.excluir)) for (const x of j.excluir) if (typeof x === "string" && FORMA_EXCLUIR.test(x.trim()) && !c.excluir.includes(x.trim()) && c.excluir.length < EXCLUIR_MAX) c.excluir.push(x.trim());
  c.permitir_max = j.permitir_max === true;
  if (esObj(j.gemini)) {
    const g = j.gemini;
    if (typeof g.cupo_max === "number" && Number.isInteger(g.cupo_max) && g.cupo_max >= CUPO_MIN && g.cupo_max <= CUPO_MAX) c.gemini.cupo_max = g.cupo_max;
    if (typeof g.sin_claude === "string" && (SIN_CLAUDE as readonly string[]).includes(g.sin_claude)) c.sin_cupo = sinCupoDe(g.sin_claude as SinClaude);
  }
  if (typeof j.sin_cupo === "string" && (SIN_CUPO as readonly string[]).includes(j.sin_cupo)) c.sin_cupo = j.sin_cupo as SinCupo;
  c.claude = topesDe(j.reserva);
  if (esObj(j.destrabar)) for (const [k, v] of Object.entries(j.destrabar)) if (typeof v === "boolean" && FORMA_ID.test(k) && (esGemini(k) || esAgy(k))) c.destrabar[k] = v;
  return c;
}

function validarEleccion(x: unknown, donde: string, locales: Local[]): Eleccion {
  if (!esObj(x)) throw errorT("main.modelosForma");
  const m = x.modelo;
  if (typeof m !== "string" || !FORMA_ID.test(m) || !(esClaude(m) || esGemini(m) || esAgy(m) || esOllama(m))) throw errorT("main.modelosModelo", { donde, v: String(m).slice(0, 60) });
  if (esOllama(m) && !locales.some((l) => l.id === m)) throw errorT("main.modelosLocalFalta", { donde, v: m.slice(0, 60) });
  const e: Eleccion = { modelo: m };
  if (x.effort !== undefined && x.effort !== null && x.effort !== "") {
    if (!esClaude(m)) throw errorT("main.modelosEffortAjeno", { donde });
    if (typeof x.effort !== "string" || !(EFFORTS_CONFIG as readonly string[]).includes(x.effort)) throw errorT("main.modelosEffort", { donde, v: String(x.effort).slice(0, 20) });
    e.effort = x.effort;
  }
  return e;
}

/** Lo que llega a guardar, revisado: tira con el motivo si algo no vale (y entonces no se escribe nada). */
export function validarConfig(x: unknown): ConfigModelos {
  if (!esObj(x)) throw errorT("main.modelosForma");
  const raro = Object.keys(x).find((k) => !["lider", "reparto", "workers", "locales", "excluir", "permitir_max", "gemini", "claude", "sin_cupo", "destrabar"].includes(k));
  if (raro !== undefined) throw errorT("main.modelosCampo", { campo: raro.slice(0, 40) });
  const c = vacia();

  if (x.locales !== undefined) {
    if (!Array.isArray(x.locales)) throw errorT("main.modelosForma");
    if (x.locales.length > LOCALES_MAX) throw errorT("main.modelosDemasiados", { max: LOCALES_MAX });
    for (const l of x.locales) {
      if (!esObj(l) || typeof l.modelo !== "string" || !l.modelo.trim() || !FORMA_ID.test(l.modelo.trim())) throw errorT("main.modelosLocalForma");
      const url = urlOllama(l.url);
      if (!url) throw errorT("main.modelosUrl", { v: String(l.url).slice(0, 60) });
      const modelo = l.modelo.trim();
      if (l.id !== `ollama:${modelo}`) throw errorT("main.modelosLocalId", { id: String(l.id).slice(0, 60), modelo });
      if (c.locales.some((o) => o.id === l.id)) throw errorT("main.modelosLocalRepetido", { id: l.id });
      const nombre = typeof l.nombre === "string" && l.nombre.trim() ? l.nombre.trim().slice(0, 80) : modelo;
      c.locales.push({ id: l.id, nombre, url, modelo });
    }
  }
  if (x.excluir !== undefined && x.excluir !== null) {
    if (!Array.isArray(x.excluir)) throw errorT("main.modelosForma");
    if (x.excluir.length > EXCLUIR_MAX) throw errorT("main.modelosDemasiados", { max: EXCLUIR_MAX });
    for (const v of x.excluir) {
      const e = typeof v === "string" ? v.trim() : "";
      if (!FORMA_EXCLUIR.test(e)) throw errorT("main.modelosExcluir", { v: String(v).slice(0, 60) });
      if (!c.excluir.includes(e)) c.excluir.push(e);
    }
  }
  if (x.permitir_max !== undefined && x.permitir_max !== null) {
    if (typeof x.permitir_max !== "boolean") throw errorT("main.modelosForma");
    c.permitir_max = x.permitir_max;
  }
  if (x.reparto !== undefined && x.reparto !== null) {
    if (typeof x.reparto !== "string" || !(REPARTO as readonly string[]).includes(x.reparto)) throw errorT("main.modelosForma");
    c.reparto = x.reparto as ModoReparto;
  }
  if (x.lider !== undefined && x.lider !== null) c.lider = validarEleccion(x.lider, "lider", c.locales);
  if (x.workers !== undefined) {
    if (!esObj(x.workers)) throw errorT("main.modelosForma");
    for (const [tipo, e] of Object.entries(x.workers)) {
      if (!(TIPOS as readonly string[]).includes(tipo)) throw errorT("main.modelosTipo", { tipo: tipo.slice(0, 40) });
      if (e === null || e === undefined) continue;
      if (esObj(e) && e.modelo === "auto" && (e.effort === undefined || e.effort === null || e.effort === "")) {
        c.reparto = "auto";
        continue;
      }
      c.workers[tipo as Tipo] = validarEleccion(e, tipo, c.locales);
    }
  }
  if (x.gemini !== undefined) {
    if (!esObj(x.gemini)) throw errorT("main.modelosForma");
    const g = x.gemini;
    const rarog = Object.keys(g).find((k) => k !== "cupo_max" && k !== "sin_claude");
    if (rarog !== undefined) throw errorT("main.modelosCampo", { campo: `gemini.${rarog.slice(0, 30)}` });
    if (g.cupo_max !== undefined && g.cupo_max !== null) {
      if (typeof g.cupo_max !== "number" || !Number.isInteger(g.cupo_max) || g.cupo_max < CUPO_MIN || g.cupo_max > CUPO_MAX)
        throw errorT("main.modelosCupo", { min: CUPO_MIN, max: CUPO_MAX });
      c.gemini.cupo_max = g.cupo_max;
    }
    if (g.sin_claude !== undefined && g.sin_claude !== null) {
      if (typeof g.sin_claude !== "string" || !(SIN_CLAUDE as readonly string[]).includes(g.sin_claude)) throw errorT("main.modelosSinClaude");
      c.sin_cupo = sinCupoDe(g.sin_claude as SinClaude);
    }
  }
  if (x.sin_cupo !== undefined && x.sin_cupo !== null) {
    if (typeof x.sin_cupo !== "string" || !(SIN_CUPO as readonly string[]).includes(x.sin_cupo)) throw errorT("main.modelosSinCupo");
    c.sin_cupo = x.sin_cupo as SinCupo;
  }
  if (x.claude !== undefined) {
    if (!esObj(x.claude)) throw errorT("main.modelosForma");
    const k = x.claude;
    const rarok = Object.keys(k).find((n) => n !== "tope_5h" && n !== "tope_7d");
    if (rarok !== undefined) throw errorT("main.modelosCampo", { campo: `claude.${rarok.slice(0, 30)}` });
    for (const n of ["tope_5h", "tope_7d"] as const) {
      const v = k[n];
      if (v === undefined || v === null) continue;
      if (!topeValido(v)) throw errorT("main.modelosTopeClaude", { min: CUPO_MIN, max: CUPO_MAX });
      c.claude[n] = v;
    }
  }
  if (x.destrabar !== undefined && x.destrabar !== null) {
    if (!esObj(x.destrabar)) throw errorT("main.modelosForma");
    for (const [k, v] of Object.entries(x.destrabar)) {
      if (!FORMA_ID.test(k) || !(esGemini(k) || esAgy(k))) throw errorT("main.modelosModelo", { donde: "destrabar", v: k.slice(0, 60) });
      if (typeof v !== "boolean") throw errorT("main.modelosForma");
      c.destrabar[k] = v;
    }
  }
  return c;
}

/**
 * El objeto que se escribe: el que había con lo editado encima. Lo desconocido (claves de más arriba, de adentro de una
 * elección, de un local o de `gemini`) sigue donde estaba; lo que el borrador ya no tiene (un worker vuelto a "como hoy",
 * un local quitado, un límite vaciado) se saca. `version` siempre 1.
 */
export function unir(antes: Record<string, unknown> | null, c: ConfigModelos): Record<string, unknown> {
  const base: Record<string, unknown> = antes ? { ...antes } : {};
  base.version = 1;
  const sobre = (viejo: unknown, nuevo: Record<string, unknown>, quitar: string[]) => {
    const o: Record<string, unknown> = esObj(viejo) ? { ...viejo } : {};
    for (const k of quitar) delete o[k];
    return Object.assign(o, nuevo);
  };

  if (c.lider) base.lider = sobre(base.lider, { ...c.lider }, ["effort"]);
  else delete base.lider;

  if (c.reparto) base.reparto = c.reparto;
  else delete base.reparto;

  const w: Record<string, unknown> = esObj(base.workers) ? { ...base.workers } : {};
  for (const t of TIPOS) {
    const e = c.workers[t];
    if (e) w[t] = sobre(w[t], { ...e }, ["effort"]);
    else delete w[t];
  }
  if (Object.keys(w).length) base.workers = w;
  else delete base.workers;

  const viejos = Array.isArray(base.locales) ? base.locales : [];
  const ls = c.locales.map((l) => sobre(viejos.find((v) => esObj(v) && v.id === l.id), { ...l }, []));
  if (ls.length || "locales" in base) base.locales = ls;

  // `excluir` y `permitir_max` son de `reparto` y `pa`: sin entradas / en falso la clave sale (el default es el mismo).
  if (c.excluir.length) base.excluir = [...c.excluir];
  else delete base.excluir;
  if (c.permitir_max) base.permitir_max = true;
  else delete base.permitir_max;

  // `gemini.sin_claude` se retira: lo dice `sin_cupo`, que vale para cualquier proveedor.
  const g = sobre(base.gemini, { ...c.gemini }, ["cupo_max", "sin_claude"]);
  if (Object.keys(g).length) base.gemini = g;
  else delete base.gemini;
  if (c.sin_cupo) base.sin_cupo = c.sin_cupo;
  else delete base.sin_cupo;

  // `reserva` es de `reparto`: si lo que había ya dice estos topes se deja tal cual (un 0.155 o un número suelto no se reescriben).
  const t = topesDe(base.reserva);
  const igual = c.claude.tope_5h === t.tope_5h && c.claude.tope_7d === t.tope_7d;
  if (!igual) {
    const r: Record<string, number> = {};
    if (c.claude.tope_5h !== undefined) r["5h"] = reservaDeTope(c.claude.tope_5h);
    if (c.claude.tope_7d !== undefined) r["7d"] = reservaDeTope(c.claude.tope_7d);
    if (Object.keys(r).length) base.reserva = r;
    // Apagada: `null` si había una (así se ve que se apagó a propósito); si no había nada, el archivo no gana una clave.
    else if (base.reserva !== undefined) base.reserva = null;
  }

  // `destrabar` es de trama (el puente de agy lo lee en cada turno): sin entradas la clave sale (vale la fábrica).
  if (Object.keys(c.destrabar).length) base.destrabar = { ...c.destrabar };
  else delete base.destrabar;
  return base;
}

// --- Qué corre hoy, sin archivo ------------------------------------------------------

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

/**
 * Los modelos por defecto de cada tipo de tarea: lo barato y mecánico en Haiku, el código en
 * Sonnet y lo que piensa más (debug, diseño) en Opus. `bases` (Opus medium) no es un tipo de `pa` (`TIPOS_VALIDOS`): no
 * tiene fila acá. Es lo que trama muestra; lo que corre sin archivo lo decide `pa`.
 */
export const DEFAULTS_CLAUDE: Record<Tipo, Eleccion> = {
  default: { modelo: SONNET, effort: "high" },
  lectura: { modelo: HAIKU, effort: "xhigh" },
  mecanico: { modelo: HAIKU, effort: "xhigh" },
  "codigo-acotado": { modelo: SONNET, effort: "high" },
  "codigo-multi": { modelo: SONNET, effort: "high" },
  frontend: { modelo: SONNET, effort: "high" },
  debug: { modelo: OPUS, effort: "xhigh" },
  diseno: { modelo: OPUS, effort: "xhigh" },
};

/** Lo mismo cuando sólo hay Gemini (sin `claude`): Argon para todo lo que pesa y Flash sólo para lo mecánico. */
export const DEFAULTS_GEMINI: Record<Tipo, Eleccion> = Object.fromEntries(
  TIPOS.map((t) => [t, { modelo: t === "mecanico" ? "gemini-3.8-flash-medium" : "gemini-4-argon-high" }]),
) as Record<Tipo, Eleccion>;

/** Los defaults de la máquina: los de Gemini si no hay Claude, los de Claude si no. */
export const defaultsDe = (soloGemini: boolean): Record<Tipo, Eleccion> => (soloGemini ? DEFAULTS_GEMINI : DEFAULTS_CLAUDE);

/** Lo que muestra trama cuando el archivo no dice nada (y `pa` no contesta) y el líder (Opus high). */
export const HOY: { lider: Eleccion; workers: Record<Tipo, Eleccion> } = {
  lider: { modelo: OPUS, effort: "high" },
  workers: DEFAULTS_CLAUDE,
};

/** Con qué lanza `pa` un tipo: el suyo, el `default` del archivo o el que le toca por defecto. */
export function efectivoDe(c: ConfigModelos, tipo: Tipo, soloGemini = false): Eleccion {
  const d = defaultsDe(soloGemini);
  return c.workers[tipo] ?? (tipo === "default" ? undefined : c.workers.default) ?? d[tipo];
}

