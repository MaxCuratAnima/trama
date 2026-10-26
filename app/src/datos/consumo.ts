// El panel de consumo (src/paneles/Consumo.tsx): lo que manda el main (electron/consumo.ts), validado,
// y las cuentas del panel. Puro: lo prueba `tests/consumo-panel.test.ts`. Todo número viene del
// `usage` de un transcript; lo que no llegó es `null` ("sin dato"), nunca un cero puesto a mano.
import type { Consumo, FilaConsumo, Pedido } from "../../electron/consumo";
import type { Suma } from "../../electron/transcripts";
import { nivel, usados, ventanaDe, type Nivel } from "../hilo/contexto-datos";
import { total } from "./tokens";

export type { Consumo, FilaConsumo, Pedido, Suma };

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
const texto = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

function porModelo(x: unknown): Record<string, Suma> {
  const r: Record<string, Suma> = {};
  if (!x || typeof x !== "object") return r;
  for (const [modelo, v] of Object.entries(x as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const s = v as Record<string, unknown>;
    r[modelo] = { entrada: num(s.entrada), cacheCreado: num(s.cacheCreado), cacheLeido: num(s.cacheLeido), salida: num(s.salida) };
  }
  return r;
}

function filaDe(x: unknown): FilaConsumo | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Record<string, unknown>;
  const u = f.uso && typeof f.uso === "object" ? (f.uso as Record<string, unknown>) : null;
  return {
    modelo: texto(f.modelo),
    effort: texto(f.effort),
    uso: u
      ? {
          input_tokens: num(u.input_tokens),
          cache_creation_input_tokens: num(u.cache_creation_input_tokens),
          cache_read_input_tokens: num(u.cache_read_input_tokens),
          output_tokens: num(u.output_tokens),
        }
      : null,
    compactada: f.compactada === true,
    compactaciones: num(f.compactaciones),
    total: porModelo(f.total),
  };
}

/** Lo que contestó el main, con forma. Lo que no la tiene queda vacío: el panel dice "sin dato". */
export function consumoDe(x: unknown): Consumo {
  const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const filas: Record<string, FilaConsumo | null> = {};
  if (c.filas && typeof c.filas === "object") for (const [id, f] of Object.entries(c.filas as Record<string, unknown>)) filas[id] = filaDe(f);
  return { n: num(c.n), desde: num(c.desde), lideres: porModelo(c.lideres), workers: porModelo(c.workers), filas };
}

/** Todo lo de una sesión, sumados sus modelos (la cuenta de Estadísticas: sin el caché escrito). */
export const totalSesion = (t: Record<string, Suma>): number => Object.values(t).reduce((n, s) => n + total(s), 0);

export type RenglonModelo = { modelo: string; lideres: number; workers: number; /** Líderes + workers. */ total: number; deLideres?: Suma; deWorkers?: Suma };

/**
 * El resumen: un renglón por modelo (el que más consumió, arriba) y el total de cada columna.
 * `clave` junta los ids que son el mismo modelo ("claude-opus-5-5[1m]" y "claude-opus-5-5").
 */
export function resumen(c: Consumo, clave: (modelo: string) => string = (m) => m): { renglones: RenglonModelo[]; lideres: number; workers: number; total: number } {
  const junta = (de: Record<string, Suma>) => {
    const r: Record<string, Suma> = {};
    for (const [modelo, s] of Object.entries(de)) {
      const x = (r[clave(modelo)] ??= { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 });
      x.entrada += s.entrada;
      x.cacheCreado += s.cacheCreado;
      x.cacheLeido += s.cacheLeido;
      x.salida += s.salida;
    }
    return r;
  };
  const [l, w] = [junta(c.lideres), junta(c.workers)];
  const renglones = [...new Set([...Object.keys(l), ...Object.keys(w)])]
    .map((modelo) => {
      const [lideres, workers] = [l[modelo] ? total(l[modelo]) : 0, w[modelo] ? total(w[modelo]) : 0];
      return { modelo, lideres, workers, total: lideres + workers, deLideres: l[modelo], deWorkers: w[modelo] };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.modelo.localeCompare(b.modelo));
  const [lideres, workers] = [renglones.reduce((n, r) => n + r.lideres, 0), renglones.reduce((n, r) => n + r.workers, 0)];
  // `total` es el número del pie: líderes + workers en uno solo; el desglose queda para el tooltip.
  return { renglones, lideres, workers, total: lideres + workers };
}

export type ContextoFila = { usados: number; ventana: number; pct: number; nivel: Nivel };

/**
 * Cuánto de la ventana de su modelo ocupa la conversación: lo que entró en el último mensaje. `null`
 * (sin dato) si todavía no contestó o si compactó y no volvió a contestar.
 */
export function contextoFila(f: FilaConsumo | null | undefined, modelo: string | null): ContextoFila | null {
  if (!f?.uso || f.compactada) return null;
  const ventana = ventanaDe(f.modelo ?? modelo);
  const n = usados(f.uso);
  const pct = Math.max(0, Math.min(100, Math.round((n / ventana) * 100)));
  return { usados: n, ventana, pct, nivel: nivel(pct) };
}

// --- Fixtures ----------------------------------------------------------------------

const MODELOS_FIJOS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Números inventados pero fijos (salen del id): las capturas no cambian de una corrida a otra. */
function semilla(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function filaFija(id: string, i: number): FilaConsumo | null {
  const s = semilla(id);
  // Uno de cada tanto, sin transcript: se ve el "sin dato".
  if (i % 5 === 4) return null;
  const modelo = MODELOS_FIJOS[s % (i % 3 === 2 ? 3 : 2)];
  const ventana = ventanaDe(modelo);
  const leido = Math.round(ventana * (0.04 + (s % 83) / 100));
  const uso = { input_tokens: 12 + (s % 900), cache_creation_input_tokens: 400 + (s % 9000), cache_read_input_tokens: leido, output_tokens: 300 + (s % 4000) };
  const vueltas = 6 + (s % 40);
  return {
    modelo,
    effort: ["medium", "high", "xhigh"][s % 3],
    uso,
    compactada: false,
    compactaciones: s % 7 === 0 ? 1 + (s % 2) : 0,
    total: { [modelo]: { entrada: uso.input_tokens * vueltas, cacheCreado: uso.cache_creation_input_tokens * 9, cacheLeido: Math.round(leido * vueltas * 0.6), salida: uso.output_tokens * vueltas } },
  };
}

let ordenFijo = 0;

export function consumoFijo(pedido: Pedido): Consumo {
  const c: Consumo = { n: ++ordenFijo, desde: 0, lideres: {}, workers: {}, filas: {} };
  const anotar = (en: Record<string, Suma>, f: FilaConsumo | null) => {
    for (const [modelo, s] of Object.entries(f?.total ?? {})) {
      const x = (en[modelo] ??= { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 });
      x.entrada += s.entrada;
      x.cacheCreado += s.cacheCreado;
      x.cacheLeido += s.cacheLeido;
      x.salida += s.salida;
    }
  };
  pedido.lideres.forEach((id, i) => anotar(c.lideres, (c.filas[id] = filaFija(id, i))));
  pedido.workers.forEach((id, i) => anotar(c.workers, (c.filas[id] = filaFija(id, i + 1))));
  return c;
}
