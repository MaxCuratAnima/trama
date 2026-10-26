// Lo de la conversación que no escribió el usuario ni contestó el modelo (B18): lo
// que dice Claude Code (límite, error de la API, "interrumpido", compactó) va
// como una línea de sistema; lo que inyecta como si fuera del usuario (el cuerpo
// de una skill, una tarea de fondo que terminó, un mensaje de otra sesión, un
// slash command, el resumen al compactar) va como una tarjeta plegada. Puro:
// lo prueba `tests/sistema.test.ts`.
//
// Primero los campos del transcript (`isMeta`, `isCompactSummary`, `origin.kind`,
// `isApiErrorMessage`/`error`, el modelo "<synthetic>", `system/compact_boundary`),
// que trae `conversacionDe` (electron/lider-arma.ts) en el de un líder. `pa --hilo`
// (el de un worker) sólo trae el modelo: ahí, y para lo que no tiene campo propio
// ("[Request interrupted by user]" es un mensaje de usuario común), se mira cómo
// empieza el texto, que son constantes de Claude Code. Una etiqueta a mitad de
// un mensaje del usuario no cuenta: sigue siendo suyo.
import type { Mensaje } from "../datos/contrato";
import { vieneDeRelevo } from "./herramientas.ts";

export type Linea =
  /** Límite de uso: `hasta` (epoch s) sale de "resets 4:50pm (zona)"; `semana`: el semanal. */
  | { tipo: "linea"; clase: "limite"; texto: string; hasta: number | null; semana: boolean }
  /** Error de la API (sintético con `isApiErrorMessage`): el texto de `claude` tal cual. */
  | { tipo: "linea"; clase: "error"; texto: string; codigo: string | null }
  /** Un sintético que no es error ("No response requested."). */
  | { tipo: "linea"; clase: "nota"; texto: string }
  | { tipo: "linea"; clase: "interrumpido"; texto: string }
  /** Compactó (B19: una raya); `resumen`: el texto con que siguió, si vino justo después (lo junta `turnos()`). */
  | { tipo: "linea"; clase: "compacto"; auto: boolean | null; antes: number | null; resumen?: string }
  /** Trama destrabó al modelo (repetía `que`); `agotado`: lo intentó 2 veces y paró. */
  | { tipo: "linea"; clase: "destrabo"; que: string; agotado: boolean }
  /** El primer mensaje de un líder que viene de un relevo (B19, `vieneDeRelevo`): el prompt fijo de `bin/relevo`. */
  | { tipo: "linea"; clase: "viene"; texto: string; traspaso: string | null };

export type ClaseTarjeta =
  | "skill"
  | "tarea"
  | "mensaje"
  | "comando"
  | "salida"
  | "caveat"
  | "recordatorio"
  | "resumen"
  | "hook"
  | "continua"
  | "imagen"
  | "meta";

/** `dato`: lo que va en la etiqueta (el nombre de la skill, el comando…); `estado`: el de una tarea de fondo. */
export type Tarjeta = { tipo: "tarjeta"; clase: ClaseTarjeta; dato: string | null; estado: string | null; crudo: string };

export type Sistema = Linea | Tarjeta;

const SINTETICO = "<synthetic>";

/** Lo que es de sistema, o `null` si es del usuario o del modelo. */
export function sistemaDe(m: Mensaje): Sistema | null {
  if (m.destrabo) return { tipo: "linea", clase: "destrabo", que: m.destrabo.que, agotado: m.destrabo.agotado };
  if (m.compacto) return { tipo: "linea", clase: "compacto", auto: m.compacto.auto, antes: m.compacto.antes };
  return m.rol === "user" ? deUsuario(m) : deModelo(m);
}

function deModelo(m: Mensaje): Linea | null {
  if (m.modelo !== SINTETICO && !m.error) return null;
  const texto = m.texto.trim();
  // `error: null`: el transcript dice que es sintético pero no un error.
  if (m.error === null) return { tipo: "linea", clase: "nota", texto };
  // Sin `error` (viene de `pa --hilo`): un límite se reconoce por la hora en que vuelve.
  const r = m.error === "rate_limit" || m.error === undefined ? vuelve(texto, m.ts) : null;
  if (m.error === "rate_limit" || r) return { tipo: "linea", clase: "limite", texto, hasta: r?.hasta ?? null, semana: r?.semana ?? false };
  if (m.error === undefined && texto === "No response requested.") return { tipo: "linea", clase: "nota", texto };
  return { tipo: "linea", clase: "error", texto, codigo: m.error ?? null };
}

const INTERRUMPIDO = /^\[Request interrupted by user( for tool use)?\]$/;
const SKILL = "Base directory for this skill:";

const tarjeta = (clase: ClaseTarjeta, crudo: string, dato: string | null = null, estado: string | null = null): Tarjeta => ({
  tipo: "tarjeta",
  clase,
  dato,
  estado,
  crudo,
});

function deUsuario(m: Mensaje): Sistema | null {
  // El prompt con que `relevo` abre al líder nuevo va como si lo hubiera tecleado el usuario (`origin.kind: human`).
  const r = m.i === 0 ? vieneDeRelevo(m.texto) : null;
  if (r) return { tipo: "linea", clase: "viene", texto: m.texto, traspaso: r.traspaso };
  // Lo que tecleó una persona es suyo aunque empiece con una etiqueta.
  if (m.origen === "human") return null;
  const t = m.texto;
  const s = t.trimStart();
  if (m.resumen || s.startsWith("This session is being continued from a previous conversation")) return tarjeta("resumen", t);
  if (m.origen === "task-notification" || s.startsWith("<task-notification>")) {
    // 'Agent "Wait for the worker" finished' → lo de entre comillas.
    const r = etiqueta(t, "summary");
    return tarjeta("tarea", t, r?.match(/^\w+ "(.+)" \w+\.?$/)?.[1] ?? r, etiqueta(t, "status"));
  }
  if (m.origen === "peer" || s.startsWith("Another Claude session sent a message:") || s.startsWith("<cross-session-message"))
    return tarjeta("mensaje", t, t.match(/<cross-session-message\b[^>]*\bfrom-name="([^"]+)"/)?.[1] ?? null);
  if (m.origen === "auto-continuation") return tarjeta("continua", t);
  if (INTERRUMPIDO.test(s.trim())) return { tipo: "linea", clase: "interrumpido", texto: s.trim() };
  if (s.startsWith(SKILL)) {
    const dir = s.slice(SKILL.length).split("\n")[0].trim().replace(/\/+$/, "");
    return tarjeta("skill", t, dir.split("/").pop() || null);
  }
  if (s.startsWith("<command-name>") || s.startsWith("<command-message>")) {
    const msj = etiqueta(t, "command-message");
    const n = etiqueta(t, "command-name") ?? (msj ? `/${msj}` : null);
    const a = etiqueta(t, "command-args");
    return tarjeta("comando", t, n && a ? `${n} ${a}` : n);
  }
  if (s.startsWith("<local-command-stdout>") || s.startsWith("<local-command-stderr>")) {
    const r = (etiqueta(t, "local-command-stdout", false) ?? etiqueta(t, "local-command-stderr", false) ?? "")
      .split("\n")
      .map((x) => x.replace(/^#+\s*/, "").trim())
      .find(Boolean);
    return tarjeta("salida", t, r ? recortar(r, 80) : null);
  }
  if (s.startsWith("<local-command-caveat>")) return tarjeta("caveat", t);
  if (s.startsWith("<system-reminder>")) return tarjeta("recordatorio", t);
  if (/^<[a-z-]*hook[a-z-]*>/i.test(s) || /^\w+ hook (feedback|output|error)/i.test(s)) return tarjeta("hook", t);
  if (m.meta) return tarjeta(s.startsWith("[Image") ? "imagen" : "meta", t);
  return null;
}

/** El contenido de `<nombre>…</nombre>` (un renglón, recortado, si `corto`); `null` si no está o está vacío. */
function etiqueta(t: string, nombre: string, corto = true): string | null {
  const v = t.match(new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`))?.[1].trim();
  if (!v) return null;
  return corto ? recortar(v.split("\n")[0], 120) : v;
}

const recortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// --- La hora en que vuelve un límite -------------------------------------------

const MESES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RESET = /resets\s+(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)(?:\s*\(([^)]+)\))?/i;

/** Cuánto le suma la zona `tz` a UTC en el instante `t` (ms). */
function desfase(t: number, tz: string | undefined) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(t));
  const v = (k: string) => Number(p.find((x) => x.type === k)?.value);
  const pared = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"));
  return { y: v("year"), mo: v("month") - 1, d: v("day"), ms: pared - Math.floor(t / 60_000) * 60_000 };
}

/** El instante (ms) de una hora de pared en la zona `tz` (dos pasadas: por si cae justo en un cambio de horario). */
function enZona(y: number, mo: number, d: number, h: number, mi: number, tz: string | undefined) {
  const g = Date.UTC(y, mo, d, h, mi);
  const t = g - desfase(g, tz).ms;
  return g - desfase(t, tz).ms;
}

/**
 * "You've hit your session limit · resets 4:50pm (America/Argentina/Buenos_Aires)"
 * → cuándo vuelve (epoch s). La fecha es la del mensaje (no la de hoy): si la hora
 * ya había pasado cuando se escribió, es la del día siguiente. El semanal trae
 * el día ("resets Oct 4, 12pm"). `null` si no se entiende.
 */
export function vuelve(texto: string, ts: string | null): { hasta: number; semana: boolean } | null {
  const r = texto.match(RESET);
  const desde = ts ? Date.parse(ts) : NaN;
  if (!r || !Number.isFinite(desde)) return null;
  let tz: string | undefined = r[6]?.trim();
  try {
    if (tz) new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = undefined;
  }
  const h = (Number(r[3]) % 12) + (r[5].toLowerCase() === "pm" ? 12 : 0);
  const mi = r[4] ? Number(r[4]) : 0;
  if (Number(r[3]) > 12 || mi > 59) return null;
  const hoy = desfase(desde, tz);
  let t: number;
  if (r[1]) {
    const mo = MESES.indexOf(r[1].toLowerCase());
    if (mo < 0) return null;
    t = enZona(hoy.y, mo, Number(r[2]), h, mi, tz);
    if (t < desde - 86_400_000) t = enZona(hoy.y + 1, mo, Number(r[2]), h, mi, tz);
  } else {
    t = enZona(hoy.y, hoy.mo, hoy.d, h, mi, tz);
    if (t < desde) t = enZona(hoy.y, hoy.mo, hoy.d + 1, h, mi, tz);
  }
  return Number.isFinite(t) ? { hasta: Math.floor(t / 1000), semana: /weekly/i.test(texto) } : null;
}
