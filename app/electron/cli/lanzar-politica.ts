// Qué modelo y qué effort lleva un worker de `pa`, igual que `motor/bin/pa`: `-m`/`--effort` ganan; si no, `modelos.json`
// (`workers.<tipo>`, `workers.default`); si no los defaults (sonnet high, haiku xhigh para `--tipo mecanico`, opus según el plan).
// Y los candados: `max` y fable sólo con `--ok-dueno`. Puro: el archivo y el settings de Claude llegan ya leídos.
import { readFileSync } from "node:fs";

export const TIPOS_VALIDOS = ["mecanico", "lectura", "codigo-acotado", "codigo-multi", "frontend", "diseno", "debug", "final"];

export type ModelosJson = {
  workers: Record<string, { modelo: string; effort: string }>;
  /** `excluir`: ids o familias que `-m` no acepta sin `--ok-dueno`. */
  excluir: string[];
  /** `permitir_max`: `--effort max` sin `--ok-dueno`. */
  permitirMax: boolean;
};

/** Las familias que `excluir` reconoce dentro de un id (la misma lista que `reparto --excluido`). */
const FAMILIAS = ["fable", "opus", "sonnet", "haiku", "argon", "flash", "gpt-oss", "astra", "sol", "luna"];

/**
 * `excluido_por`: la entrada de `excluir` que atrapa a este modelo, o `null`. Una familia cuenta si está dentro del id; un id, si es el
 * mismo o su prefijo seguido de "-"; un patrón que termina en `*` (agy:*, ollama:*), si el id empieza igual.
 */
export function excluidoPor(modelo: string, excluir: readonly string[]): string | null {
  const m = modelo.toLowerCase();
  for (const p of excluir) {
    const q = p.toLowerCase().replace(/^\s+|\s+$/g, "");
    if (!q) continue;
    const atrapa = q.endsWith("*") ? m.startsWith(q.slice(0, -1)) : FAMILIAS.includes(q) ? m.includes(q) : m === q || m.startsWith(q + "-");
    if (atrapa) return p;
  }
  return null;
}

/**
 * Lee `modelos.json`. Sin archivo: `null`. Si no se puede usar (no es JSON, no es un objeto, versión que no entiende, un worker
 * sin modelo o con effort inexistente) devuelve `{ error }` y `pa` sigue con los defaults avisando en una línea.
 */
export function leerModelos(ruta: string): ModelosJson | { error: string } | null {
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch {
    return null;
  }
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return { error: "no es JSON válido" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { error: "no es un objeto JSON" };
  const o = j as { version?: unknown; workers?: unknown };
  if (o.version !== 1) return { error: `version ${JSON.stringify(o.version)} (pa entiende 1)` };
  if (o.workers !== undefined && (typeof o.workers !== "object" || o.workers === null || Array.isArray(o.workers))) return { error: "workers no es un objeto" };
  const x = j as Record<string, unknown>;
  const workers: ModelosJson["workers"] = {};
  for (const [k, v] of Object.entries((o.workers ?? {}) as Record<string, unknown>)) {
    if (k !== "default" && !TIPOS_VALIDOS.includes(k)) return { error: `tipo de worker desconocido: ${k}` };
    const w = v as { modelo?: unknown; effort?: unknown } | null;
    if (!w || typeof w !== "object" || typeof w.modelo !== "string" || w.modelo === "") return { error: `workers.${k}: modelo desconocido ${JSON.stringify(w?.modelo)}` };
    if (w.effort !== undefined && w.effort !== null && !(typeof w.effort === "string" && /^(low|medium|high|xhigh|max)$/.test(w.effort))) {
      return { error: `workers.${k}: effort ${JSON.stringify(w.effort)} no existe` };
    }
    workers[k] = { modelo: w.modelo, effort: typeof w.effort === "string" ? w.effort : "" };
  }
  const frac = (v: unknown) => typeof v === "number" && v >= 0 && v < 1;
  const r = x.reserva;
  if (r !== undefined && r !== null && !(frac(r) || (typeof r === "object" && !Array.isArray(r) && Object.keys(r as object).length > 0 &&
      Object.keys(r as object).every((k) => k === "5h" || k === "7d") && Object.values(r as object).every(frac)))) {
    return { error: `reserva ${JSON.stringify(r)} (un número de 0 a 1, {"5h":…,"7d":…} o null)` };
  }
  const ex = x.excluir;
  if (ex !== undefined && ex !== null && !(Array.isArray(ex) && ex.every((e) => typeof e === "string" && e.replace(/\s/g, "") !== ""))) {
    return { error: `excluir ${JSON.stringify(ex)} (una lista de ids o familias)` };
  }
  if ("permitir_max" in x && typeof x.permitir_max !== "boolean") return { error: `permitir_max ${JSON.stringify(x.permitir_max)} (true o false)` };
  if (x.sin_cupo !== undefined && x.sin_cupo !== null && !/^(otro|esperar|fallar)$/.test(String(x.sin_cupo))) {
    return { error: `sin_cupo ${JSON.stringify(x.sin_cupo)} (otro, esperar o fallar)` };
  }
  return { workers, excluir: Array.isArray(ex) ? (ex as string[]) : [], permitirMax: x.permitir_max === true };
}

export type EntradaPolitica = {
  /** `-m` ("" = que decida la política). */
  modelo: string;
  /** `--effort` o `PA_EFFORT` ("" = sin pedir). */
  esfuerzo: string;
  /** El effort vino de `--effort` (y no del entorno): sólo cambia el texto del error de `max`. */
  esfuerzoFlag: boolean;
  tipo: string;
  leer: boolean;
  seguir: boolean;
  okDueno: boolean;
  plan: "pro" | "max";
  modelos: ModelosJson | null;
  /** `effortLevel` del settings de Claude ("" si no hay). */
  effortSettings: string;
  /** El nombre del dueño, para "Si X aprobó esta corrida…". */
  dueno: string;
  /** Es el hijo de `--async`: su `-m` lo puso el padre, que ya pasó por `excluir`. */
  hijoAsync?: boolean;
};

export type DecisionPolitica = { modelo: string; esfuerzo: string; deModelosJson: boolean } | { error: string };

export function resolverPolitica(e: EntradaPolitica): DecisionPolitica {
  let modelo = e.modelo;
  let esfuerzo = e.esfuerzo;
  let deModelosJson = false;
  if (!modelo && e.modelos) {
    const w = e.modelos.workers[e.tipo || "default"] ?? e.modelos.workers.default;
    if (w) {
      modelo = w.modelo;
      deModelosJson = true;
      if (w.effort && !esfuerzo) esfuerzo = w.effort;
    }
  }
  if (!modelo) modelo = e.tipo === "mecanico" && !e.leer && !e.seguir ? "claude-haiku-5-5" : "claude-sonnet-5-5";

  const m = modelo.toLowerCase();
  if (m.startsWith("gemini") || m.startsWith("agy:") || m.startsWith("codex:") || m.startsWith("ollama:")) {
    return { error: `pa: el modelo '${modelo}' (Gemini/agy/codex/local) todavía no lo lanza la versión en TypeScript. Usá un modelo Claude con -m.` };
  }
  const ef = esfuerzo.toLowerCase();
  if (!e.okDueno) {
    const conOk = `Si ${e.dueno} aprobó esta corrida, repetila con --ok-dueno`;
    // excluir de modelos.json: un -m que el archivo excluye no corre sin --ok-dueno (el que eligió la política no pasa por acá)
    const excl = e.modelo && !e.hijoAsync && e.modelos ? excluidoPor(modelo, e.modelos.excluir) : null;
    if (excl !== null) {
      return { error: `pa: modelo '${modelo}' está excluido en modelos.json (excluir: ${excl}). ${conOk}; si no, elegí otro con -m o sacalo de excluir.` };
    }
    const ojoEnv = !e.esfuerzoFlag && esfuerzo ? " (ojo: puede venir de PA_EFFORT)" : "";
    if (m.includes("fable")) {
      return { error: `pa: modelo '${modelo}' no va sin --ok-dueno: Fable en \`-p\` cobra créditos sin preguntar y usa hasta la mitad del límite semanal. ${conOk}; si no, para frontend/diseño o algo difícil: -m claude-opus-5-5 --effort xhigh.` };
    }
    if (ef === "max" && !m.includes("haiku") && !e.modelos?.permitirMax) {
      return m.includes("opus")
        ? { error: `pa: effort 'max' con opus no va sin --ok-dueno: rinde 1,5 puntos más por 65 % más de costo. ${conOk}; si no, usá low, medium, high o xhigh${ojoEnv}.` }
        : { error: `pa: effort 'max' con '${modelo}' no va sin --ok-dueno (sin flag, max sólo con claude-haiku-5-5). ${conOk}; si no, usá low, medium, high o xhigh${ojoEnv}.` };
    }
  }
  if (!esfuerzo) {
    if (m.includes("haiku")) esfuerzo = "xhigh";
    else if (m.includes("sonnet")) esfuerzo = "high";
    else if (e.plan === "pro") esfuerzo = "medium";
    else if (e.leer) esfuerzo = "high";
    else if (m.includes("opus") && !["", "medium", "high", "xhigh"].includes(e.effortSettings.toLowerCase())) esfuerzo = "high";
  }
  return { modelo, esfuerzo, deModelosJson };
}
