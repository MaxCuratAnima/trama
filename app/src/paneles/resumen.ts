// Las cuentas del panel de Estadísticas. Puro, sin React. Todo es de los
// WORKERS (`medicion.tsv` anota corridas de `pa`; los líderes no están ahí),
// salvo la cuota, que es la de toda la cuenta (`statusline/historial.jsonl`).
//
// Hay cuatro bases de tiempo y no se mezclan:
//   - el período elegido (7 o 30 días de calendario, con hoy),
//   - los 60 días del consumo diario,
//   - la semana de calendario (lunes 0:00 a domingo, hora local),
//   - la semana de la cuota (la de Anthropic: termina en `sem_reset`).
import type { Corrida, Muestra } from "../datos/paneles";
import { coma, locale } from "../i18n/index.ts";
import { parsearModelo } from "../datos/modelo-id.ts";

const DIA = 86400;

export type Familia = "Opus" | "Sonnet" | "Fable" | "Google" | "otro";
export const FAMILIAS: Familia[] = ["Opus", "Sonnet", "Fable", "Google", "otro"];

/**
 * "claude-opus-5-5" → "Opus"; lo que no se reconoce va a "otro" (no se pierde). Manda el proveedor
 * (src/datos/modelo-id.ts): lo que sirve Google, aunque sea un Claude ("agy:claude-opus-5-5"), es "Google" y no suma en Opus.
 */
export function familia(id: string): Familia {
  const p = parsearModelo(id);
  if (p.proveedor === "google") return "Google";
  return p.proveedor === "anthropic" && (p.linea === "opus" || p.linea === "sonnet" || p.linea === "fable") ? FAMILIA_DE[p.linea] : "otro";
}
const FAMILIA_DE = { opus: "Opus", sonnet: "Sonnet", fable: "Fable" } as const;

export type Suma = { n: number; tokens: number };
export type Dia = Suma & { ts: number };
export type PorModelo = Suma & { familia: Familia };
export type PorProyecto = Suma & { nombre: string; modelos: Record<Familia, number> };

export type Resumen = {
  /** Dónde arranca el período (medianoche de hace `dias - 1` días). */
  inicio: number;
  /** Desde cuándo hay datos, si es después de `inicio` (el período está incompleto). */
  desde: number | null;
  corridas: number;
  tiempo_s: number;
  tokens: number;
  /** Cuánto de lo leído salió del caché (0–1), sobre las corridas que lo anotaron. `null`: ninguna. */
  cache: number | null;
  /** Compactaciones, y en cuántas corridas hay dato (`pa` empezó a anotarlas después). */
  compactaciones: number;
  conCompactaciones: number;
  /** Por tokens, en el orden de `FAMILIAS`; sólo las que aparecen. */
  porModelo: PorModelo[];
  /** De más a menos tokens, con los tokens de cada familia. */
  porProyecto: PorProyecto[];
  /** Sólo las evaluadas (`bien` vacío no cuenta). */
  bien: { si: number; parcial: number; no: number };
  /** Un día por elemento, del más viejo a hoy. */
  porDia: Dia[];
};

const sumar = (cs: Corrida[]): Suma => ({ n: cs.length, tokens: cs.reduce((s, c) => s + c.tokens, 0) });
const entre = (cs: Corrida[], a: number, b: number) => cs.filter((c) => c.ts >= a && c.ts < b);

/** Medianoche local del día de `ts`. */
export function inicioDia(ts: number) {
  const f = new Date(ts * 1000);
  f.setHours(0, 0, 0, 0);
  return f.getTime() / 1000;
}

/** Medianoche local del lunes de la semana de `ts` (el domingo es el último día). */
export function inicioSemana(ts: number) {
  const f = new Date(ts * 1000);
  f.setHours(0, 0, 0, 0);
  f.setDate(f.getDate() - ((f.getDay() + 6) % 7));
  return f.getTime() / 1000;
}

/** `ts` corrido `n` días de calendario (respeta los cambios de hora). */
function masDias(ts: number, n: number) {
  const f = new Date(ts * 1000);
  f.setDate(f.getDate() + n);
  return f.getTime() / 1000;
}

/** Los últimos `dias` días de calendario (con hoy): corridas y tokens de cada uno. */
export function diario(todas: Corrida[], dias: number, ahora: number): Dia[] {
  const hoy = inicioDia(ahora);
  return Array.from({ length: dias }, (_, i) => {
    const ts = masDias(hoy, i - dias + 1);
    return { ts, ...sumar(entre(todas, ts, masDias(ts, 1))) };
  });
}

/** El período elegido: los últimos `dias` días de calendario, con hoy. */
export function resumir(todas: Corrida[], dias: number, ahora: number, desde: number | null): Resumen {
  const porDia = diario(todas, dias, ahora);
  const inicio = porDia[0].ts;
  const corridas = entre(todas, inicio, Infinity);

  const conCache = corridas.filter((c) => c.cache_read !== null && c.tokens > 0);
  const leido = conCache.reduce((s, c) => s + c.tokens, 0);
  const conComp = corridas.filter((c) => c.compactaciones !== null);
  const bien = { si: 0, parcial: 0, no: 0 };
  const modelos = new Map<Familia, PorModelo>();
  const proyectos = new Map<string, PorProyecto>();
  for (const c of corridas) {
    if (c.bien) bien[c.bien]++;
    const f = familia(c.modelo);
    let m = modelos.get(f);
    if (!m) modelos.set(f, (m = { familia: f, n: 0, tokens: 0 }));
    m.n++;
    m.tokens += c.tokens;
    let p = proyectos.get(c.proyecto);
    if (!p)
      proyectos.set(c.proyecto, (p = { nombre: c.proyecto, n: 0, tokens: 0, modelos: { Opus: 0, Sonnet: 0, Fable: 0, Google: 0, otro: 0 } }));
    p.n++;
    p.tokens += c.tokens;
    p.modelos[f] += c.tokens;
  }
  return {
    inicio,
    desde: desde !== null && desde > inicio ? desde : null,
    ...sumarTiempo(corridas),
    cache: leido > 0 ? conCache.reduce((s, c) => s + (c.cache_read ?? 0), 0) / leido : null,
    compactaciones: conComp.reduce((s, c) => s + (c.compactaciones ?? 0), 0),
    conCompactaciones: conComp.length,
    porModelo: FAMILIAS.flatMap((f) => modelos.get(f) ?? []),
    porProyecto: [...proyectos.values()].sort((a, b) => b.tokens - a.tokens || b.n - a.n),
    bien,
    porDia,
  };
}

const sumarTiempo = (cs: Corrida[]) => ({
  corridas: cs.length,
  tiempo_s: cs.reduce((s, c) => s + c.duracion_s, 0),
  tokens: cs.reduce((s, c) => s + c.tokens, 0),
});

/** `(a - b) / b`; `null` si no hay contra qué comparar. */
export const cambio = (a: number, b: number) => (b > 0 ? (a - b) / b : null);

export type Tendencia = {
  /** Promedio diario de los últimos 7 días (corridos, hasta ahora). */
  actual: Suma;
  /** Ídem de los 7 anteriores; `null` si los datos arrancan después de que empezaron. */
  anterior: Suma | null;
  /** Días con datos de los últimos 7 (menos de 7 si `medicion.tsv` es más nuevo). */
  dias: number;
};

/**
 * Promedio diario de los últimos 7 días contra los 7 anteriores, en ventanas
 * corridas que terminan ahora (hoy a medias contra un día entero mentiría).
 */
export function tendencia(todas: Corrida[], ahora: number, desde: number | null): Tendencia {
  const a = ahora - 7 * DIA;
  const b = ahora - 14 * DIA;
  const dias = desde === null ? 7 : Math.max(0, Math.min(7, (ahora - Math.max(desde, a)) / DIA));
  const prom = (s: Suma, d: number): Suma => (d > 0 ? { n: s.n / d, tokens: s.tokens / d } : { n: 0, tokens: 0 });
  return {
    actual: prom(sumar(entre(todas, a, Infinity)), dias),
    anterior: desde === null || desde <= b ? prom(sumar(entre(todas, b, a)), 7) : null,
    dias,
  };
}

export type Semanas = {
  /** Lunes 0:00 de esta semana. */
  lunes: number;
  actual: Suma;
  /** La semana pasada entera (lunes a domingo); `null` si faltan datos. */
  pasada: Suma | null;
  /** La semana pasada hasta el mismo día y hora que ahora: contra esto se compara. */
  aLaAltura: Suma | null;
};

/** Esta semana de calendario (arranca el lunes) contra la anterior. */
export function semanas(todas: Corrida[], ahora: number, desde: number | null): Semanas {
  const lunes = inicioSemana(ahora);
  const antes = masDias(lunes, -7);
  const hay = desde === null || desde <= antes;
  return {
    lunes,
    actual: sumar(entre(todas, lunes, Infinity)),
    pasada: hay ? sumar(entre(todas, antes, lunes)) : null,
    aLaAltura: hay ? sumar(entre(todas, antes, antes + (ahora - lunes))) : null,
  };
}

export type Cuota = {
  /** La última muestra. */
  ultima: Muestra;
  /** Ya pasó `sem_reset` de la última muestra: el % que dice es de la semana vieja. */
  semVencida: boolean;
  h5Vencida: boolean;
  /** Cómo terminó cada semana de cuota anterior (su último %), de la más nueva a la más vieja. */
  anteriores: { reset: number; sem: number }[];
  /** La primera muestra del historial. */
  desde: number;
  /** Corridas y tokens de workers en esta semana de cuota (desde `sem_reset - 7 días`). */
  workers: Suma;
};

/**
 * La cuota de `historial.jsonl`. Una semana de cuota = las muestras con el mismo
 * `sem_reset` (redondeado a la hora: que no salte por segundos). El % sólo sube
 * dentro de una semana, así que su máximo es como terminó.
 */
export function cuota(muestras: Muestra[] | null, todas: Corrida[], ahora: number): Cuota | null {
  if (!muestras?.length) return null;
  const ultima = muestras[muestras.length - 1];
  const hora = (t: number) => Math.round(t / 3600);
  const grupos = new Map<number, { reset: number; sem: number }>();
  for (const m of muestras) {
    const g = grupos.get(hora(m.sem_reset));
    if (!g) grupos.set(hora(m.sem_reset), { reset: m.sem_reset, sem: m.sem });
    else g.sem = Math.max(g.sem, m.sem);
  }
  const semVencida = ahora >= ultima.sem_reset;
  return {
    ultima,
    semVencida,
    h5Vencida: ahora >= ultima.h5_reset,
    anteriores: [...grupos.values()]
      .filter((g) => semVencida || hora(g.reset) !== hora(ultima.sem_reset))
      .sort((a, b) => b.reset - a.reset),
    desde: muestras[0].ts,
    workers: semVencida ? { n: 0, tokens: 0 } : sumar(entre(todas, ultima.sem_reset - 7 * DIA, Infinity)),
  };
}

export type Etiquetas = {
  /** Qué va debajo de cada barra: "mié 30" (pocos días), "30" (un mes) o sólo los lunes. */
  dia: "largo" | "corto" | "lunes";
  /** El número arriba: en todas, o sólo en el máximo y en hoy. */
  numero: "todas" | "extremos";
};

/** Cuánto texto entra en un gráfico de `n` barras a lo ancho del panel (~670 px). */
export function etiquetas(n: number): Etiquetas {
  if (n <= 14) return { dia: "largo", numero: "todas" };
  if (n <= 31) return { dia: "corto", numero: "todas" };
  return { dia: "lunes", numero: "extremos" };
}

/** "182 M", "1,4 M" ("1.4 M" en inglés), "956 k". */
export function tokens(n: number) {
  if (n >= 1e8) return `${Math.round(n / 1e6).toLocaleString(locale())} M`;
  if (n >= 1e6) return `${coma((n / 1e6).toFixed(1))} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(Math.round(n));
}

/** "claude-opus-5-5" → "Opus 5.5"; lo que sirve Google lo dice ("Claude Opus 5.5 · por Google"). Lo que no se reconoce queda como vino. */
export function nombreModelo(id: string) {
  return parsearModelo(id).etiqueta || id;
}
