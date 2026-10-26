// Los cupos de cada suscripción conectada (Claude, Google AI Pro, y las que vengan): los dice
// `reparto --cupos --json` (contrato `version: 1`, `suscripciones[]` con `ventanas[]` o `grupos[]`),
// el único lector. Genérico: una suscripción nueva aparece sola en la cabecera, sin tocar esto.
// Lo que no se sabe es `null` ("sin dato"), nunca un número inventado.
import { execFileCmd } from "./procesos.js";
import { homedir } from "node:os";
import { entornoPa, resolverBinario } from "./binario.js";

const execFileP = (bin: string, args: string[], o: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) =>
  new Promise<{ stdout: string }>((ok, mal) => execFileCmd(bin, args, o, (e, stdout) => (e ? mal(e) : ok({ stdout }))));

/** Una ventana de cupo: `pct` 0..100 (`null`: sin dato) y cuándo vuelve (epoch s, `null`: no se sabe). */
export interface VentanaCupo {
  id: string;
  pct: number | null;
  vuelve: number | null;
}

export interface GrupoCupo {
  id: string;
  nombre: string;
  ventanas: VentanaCupo[];
  /** Fecha ISO corta (YYYY-MM-DD) hasta la que vale el grupo. */
  hasta?: string;
}

/** Una suscripción con ventanas propias (`ventanas`) o repartidas en grupos (`grupos`). `ts`: cuándo se leyó (epoch s). */
export interface SuscripcionCupo {
  id: string;
  nombre: string;
  /** El proveedor (`claude`, `google`, `chatgpt`) y la cuenta (su id) cuando `reparto` los dice; la cuenta de siempre tiene el id del proveedor. */
  proveedor?: string;
  cuenta?: string;
  ts: number;
  ventanas?: VentanaCupo[];
  grupos?: GrupoCupo[];
}

export interface CuposLeidos {
  /** Epoch ms de la lectura. */
  ts: number;
  /** Las dos ventanas de Claude, si el reparto las sabe (una fuente más para la barra de Claude; epoch ms). */
  claude?: {
    cincoH: number;
    sieteD: number;
    reseteaCincoH?: number;
    reseteaSieteD?: number;
  };
  /** Cómo se llama la cuenta de siempre de Claude (se puede renombrar); la barra lo usa cuando hay más de una cuenta de Claude. */
  claudeNombre?: string;
  /** Las demás suscripciones (y las cuentas agregadas de Claude), en el orden del reparto. */
  suscripciones: SuscripcionCupo[];
}

const pctDe = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100))) : null);

function isoMs(s: unknown): number | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const ms = Date.parse(s.trim());
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function ventanasDe(raw: unknown): VentanaCupo[] {
  if (!Array.isArray(raw)) return [];
  const res: VentanaCupo[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const id = texto(o.id);
    if (!id) continue;
    const vuelve = isoMs(o.vuelve);
    res.push({ id, pct: pctDe(o.usado), vuelve: vuelve === null ? null : Math.round(vuelve / 1000) });
  }
  return res;
}

/** Un grupo con `hasta` vencido ya no cuenta (el día de `hasta` todavía vale). */
const vencido = (hasta: string | undefined, ahoraMs: number): boolean => !!hasta && /^\d{4}-\d{2}-\d{2}/.test(hasta) && hasta.slice(0, 10) < new Date(ahoraMs).toISOString().slice(0, 10);

function gruposDe(raw: unknown, ahoraMs: number): GrupoCupo[] {
  if (!Array.isArray(raw)) return [];
  const res: GrupoCupo[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const id = texto(o.id);
    const ventanas = ventanasDe(o.ventanas);
    const hasta = texto(o.hasta) || undefined;
    if (!id || ventanas.length === 0 || vencido(hasta, ahoraMs)) continue;
    res.push({ id, nombre: texto(o.nombre) || id, ventanas, ...(hasta ? { hasta } : {}) });
  }
  return res;
}

/** Parsea la salida de `reparto --cupos --json`. `null`: no es el contrato (otra versión, JSON roto) o no trae nada. */
export function parsearCuposReparto(salida: string, ahoraMs = Date.now()): CuposLeidos | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(salida) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !Array.isArray(raw.suscripciones)) return null;
  const ts = isoMs(raw.leido) ?? ahoraMs;
  const tsS = Math.round(ts / 1000);

  let claude: CuposLeidos["claude"];
  let claudeNombre = "";
  const suscripciones: SuscripcionCupo[] = [];
  for (const s of raw.suscripciones) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const id = texto(o.id);
    if (!id) continue;
    const ventanas = ventanasDe(o.ventanas);
    if (id === "claude") {
      claudeNombre = texto(o.nombre);
      const c5 = ventanas.find((v) => v.id === "5h");
      const c7 = ventanas.find((v) => v.id === "7d");
      if (c5?.pct != null && c7?.pct != null) {
        claude = {
          cincoH: c5.pct,
          sieteD: c7.pct,
          ...(c5.vuelve !== null ? { reseteaCincoH: c5.vuelve * 1000 } : {}),
          ...(c7.vuelve !== null ? { reseteaSieteD: c7.vuelve * 1000 } : {}),
        };
      }
      continue;
    }
    const grupos = gruposDe(o.grupos, ahoraMs);
    if (ventanas.length === 0 && grupos.length === 0) continue;
    const proveedor = texto(o.proveedor);
    const cuenta = texto(o.cuenta);
    suscripciones.push({
      id,
      nombre: texto(o.nombre) || id,
      ...(proveedor ? { proveedor } : {}),
      ...(cuenta ? { cuenta } : {}),
      ts: tsS,
      ...(ventanas.length ? { ventanas } : {}),
      ...(grupos.length ? { grupos } : {}),
    });
  }
  if (!claude && suscripciones.length === 0) return null;
  return { ts, ...(claude ? { claude } : {}), ...(claudeNombre ? { claudeNombre } : {}), suscripciones };
}

const TTL_CUPOS_MS = 60_000;
let cacheCupos: CuposLeidos | null = null;
let ultimoIntentoMs = 0;
let enVuelo: Promise<CuposLeidos | null> | null = null;
const oyentes = new Set<() => void>();

export function alCambiarCupos(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function notificarCupos(): void {
  for (const fn of oyentes) fn();
}

function modoAisladoSinCupos(): boolean {
  if (process.env.HILOS_REPARTO) return false;
  return process.env.HILOS_PRUEBA === "1" || process.env.HILOS_CAPTURA === "1" || process.env.HILOS_BENCH === "1";
}

async function consultarCupos(): Promise<CuposLeidos | null> {
  if (modoAisladoSinCupos()) return null;
  try {
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const bin = resolverBinario("reparto", "HILOS_REPARTO", process.env, homedir());
    const { stdout } = await execFileP(bin, ["--cupos", "--json"], { env, timeout: 6000, maxBuffer: 512 * 1024 });
    return parsearCuposReparto(stdout, Date.now());
  } catch {
    return null; // sin `reparto`: la cabecera queda con lo de Claude
  }
}

/** Las suscripciones sin la hora de la lectura: lo que decide si hay algo nuevo que avisar. */
const huella = (c: CuposLeidos | null): string => JSON.stringify(c ? { claude: c.claude, n: c.claudeNombre, s: c.suscripciones.map((x) => ({ ...x, ts: 0 })) } : null);

/** Relee `reparto` si venció el TTL (o `forzar`); avisa a los oyentes si algo cambió. Lo que falla deja la última lectura. */
export function refrescarCupos(forzar = false): Promise<CuposLeidos | null> {
  if (modoAisladoSinCupos()) return Promise.resolve(null);
  const ahora = Date.now();
  if (!forzar && ultimoIntentoMs > 0 && ahora - ultimoIntentoMs < TTL_CUPOS_MS) return Promise.resolve(cacheCupos);
  if (enVuelo) return enVuelo;
  ultimoIntentoMs = ahora;
  enVuelo = consultarCupos()
    .then((res) => {
      enVuelo = null;
      if (res) {
        const cambio = huella(cacheCupos) !== huella(res);
        cacheCupos = res;
        if (cambio) notificarCupos();
      }
      return cacheCupos;
    })
    .catch(() => {
      enVuelo = null;
      return cacheCupos;
    });
  return enVuelo;
}

/** La última lectura en caché; dispara un refresco de fondo si venció el TTL. */
export function cuposActuales(): CuposLeidos | null {
  if (modoAisladoSinCupos()) return null;
  if (ultimoIntentoMs === 0 || Date.now() - ultimoIntentoMs >= TTL_CUPOS_MS) void refrescarCupos(false);
  return cacheCupos;
}
