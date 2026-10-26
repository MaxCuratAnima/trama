// Los cupos de cada suscripción conectada (Claude, Google AI Pro, y las que vengan): los dice
// `reparto --cupos --json` (contrato `version: 1`, `suscripciones[]` con `ventanas[]` o `grupos[]`),
// el único lector. Genérico: una suscripción nueva aparece sola en la cabecera, sin tocar esto.
// Lo que no se sabe es `null` ("sin dato"), nunca un número inventado.
import { execFileCmd, spawnCmd } from "./procesos.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { entornoPa, resolverAgy, resolverBinario } from "./binario.js";
import { esteConfigTrama } from "./plataforma.js";
import { argvUso, lineaInicio, lineaUso } from "./lider-arma.ts";
import { oficialDe, type Lectura } from "./uso.ts";
import { log } from "./log.js";

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
  /** Nunca se pudo leer esta cuenta: sus ventanas van en null y ts es el de este intento. */
  sinLectura?: true;
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

function cuposIniciales(): CuposLeidos | null {
  try {
    const cuentasPath = path.join(esteConfigTrama(), "cuentas.json");
    const suscripciones: SuscripcionCupo[] = [];
    const tsS = Math.round(Date.now() / 1000);
    if (existsSync(cuentasPath)) {
      const data = JSON.parse(readFileSync(cuentasPath, "utf8")) as { cuentas?: Array<{ id?: string; nombre?: string; proveedor?: string }> };
      if (Array.isArray(data.cuentas)) {
        for (const c of data.cuentas) {
          if (c?.id && c.id !== "claude") {
            suscripciones.push({
              id: c.id,
              nombre: c.nombre || c.id,
              proveedor: c.proveedor || "claude",
              cuenta: c.id,
              ts: tsS,
              ventanas: [{ id: "5h", pct: null, vuelve: null }, { id: "7d", pct: null, vuelve: null }],
            });
          }
        }
      }
    }
    suscripciones.push({
      id: "google",
      nombre: "Gemini",
      proveedor: "google",
      cuenta: "google",
      ts: tsS,
      ventanas: [{ id: "5h", pct: null, vuelve: null }, { id: "7d", pct: null, vuelve: null }],
    });
    return { ts: Date.now(), claudeNombre: "Claude", suscripciones };
  } catch {
    return null;
  }
}

const TTL_CUPOS_MS = 60_000;
/** agy /quota y el get_usage de cada cuenta extra: cada 5 min, salvo refresco manual (cada uno arranca un proceso). */
const TTL_LENTO_MS = 5 * 60_000;
/** Lo que espera el get_usage de una cuenta extra; si no contesta, esa cuenta queda sin lectura. */
const ESPERA_USO_MS = 25_000;
/** Las credenciales de la cuenta de siempre no deben pasarle a la cuenta extra (como cli/cuentas.ts). */
const CLAVES_CUENTA = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

/** Una cuenta de cuentas.json tal como la necesita el lector (dir: su CLAUDE_CONFIG_DIR). */
type CuentaLeida = { id: string; nombre: string; proveedor: string; dir: string };

/** Las cuentas agregadas (todas menos la de siempre). Si el archivo no se puede leer, ninguna. */
function cuentasExtra(): CuentaLeida[] {
  try {
    const base = esteConfigTrama();
    const cuentasPath = path.join(base, "cuentas.json");
    if (!existsSync(cuentasPath)) return [];
    const data = JSON.parse(readFileSync(cuentasPath, "utf8")) as { cuentas?: Array<{ id?: string; nombre?: string; proveedor?: string; dir?: string }> };
    if (!Array.isArray(data.cuentas)) return [];
    const res: CuentaLeida[] = [];
    for (const c of data.cuentas) {
      if (!c?.id || c.id === "claude") continue;
      res.push({
        id: c.id,
        nombre: c.nombre || c.id,
        proveedor: c.proveedor || "claude",
        dir: c.dir || path.join(base, "cuentas", c.id),
      });
    }
    return res;
  } catch {
    return [];
  }
}

let cacheCupos: CuposLeidos | null = cuposIniciales();
let ultimoIntentoMs = 0;
let ultimoLentoMs = 0;
/** Lo último BUENO de cada fuente lenta (google, o el id de una cuenta extra): se reusa entre lecturas lentas. */
const lentos = new Map<string, SuscripcionCupo>();
let enVuelo: Promise<CuposLeidos | null> | null = null;
const oyentes = new Set<() => void>();
/** Los avisos ya dichos: un fallo que se repite en cada refresco se loguea una sola vez (se limpia al volver a andar). */
const avisados = new Set<string>();

function avisarUna(clave: string, detalle: string): void {
  if (avisados.has(clave)) return;
  avisados.add(clave);
  log.escribir("aviso", "cupos", detalle);
}

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

/**
 * El get_usage de una cuenta agregada de Claude, con su propio claude (CLAUDE_CONFIG_DIR de la
 * cuenta): el mismo pedido que usa la de siempre (lider.ts, usoDeUnRato), sin turno ni transcript.
 * null: no se pudo leer (no arranca, no contesta a tiempo o no dice nada del plan).
 */
function usoDeCuenta(dir: string): Promise<Lectura | null> {
  return new Promise((listo) => {
    const ID = "trama-uso";
    const marcaId = "\"" + ID + "\"";
    const marcaControl = "\"control_response\"";
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: dir };
    for (const k of CLAVES_CUENTA) delete env[k];
    let hecho = false;
    let resto = "";
    let p: ReturnType<typeof spawnCmd>;
    let t: NodeJS.Timeout;
    const fin = (l: Lectura | null) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(t);
      try {
        p.stdin?.end();
      } catch {
        /* ya cerrado */
      }
      if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
      listo(l);
    };
    try {
      p = spawnCmd(resolverBinario("claude", "HILOS_CLAUDE", process.env, homedir()), argvUso(), {
        env,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch (e) {
      avisarUna("uso:" + dir, "get_usage de " + dir + ": " + (e as Error).message);
      return listo(null);
    }
    t = setTimeout(() => {
      avisarUna("uso:" + dir, "get_usage de " + dir + ": sin respuesta en " + ESPERA_USO_MS / 1000 + " s");
      fin(null);
    }, ESPERA_USO_MS);
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (trozo: string) => {
      const partes = (resto + trozo).split("\n");
      resto = partes.pop() ?? "";
      for (const l of partes) {
        // La respuesta a nuestro get_usage (no la del initialize, que tiene otro id).
        if (!l.includes(marcaControl) || !l.includes(marcaId)) continue;
        const lu = oficialDe(l, Math.floor(Date.now() / 1000));
        if (!lu) avisarUna("uso:" + dir, "get_usage de " + dir + ": contestó sin datos del plan");
        fin(lu);
        return;
      }
    });
    p.stdin!.on("error", () => {});
    p.on("error", (e) => {
      avisarUna("uso:" + dir, "get_usage de " + dir + ": " + e.message);
      fin(null);
    });
    p.on("exit", () => fin(null));
    // Como el Agent SDK: primero el initialize.
    p.stdin!.write(lineaInicio(ID + "-inicio"));
    p.stdin!.write(lineaUso(ID));
  });
}

/** Una cuenta extra de Claude como fila: sus ventanas de la lectura (null si no hubo), con sinLectura cuando no hay. */
function filaDeCuenta(c: CuentaLeida, l: Lectura | null, tsS: number): SuscripcionCupo {
  const ventana = (id: "5h" | "7d", v: Lectura["five_hour"]): VentanaCupo => ({
    id,
    pct: v ? Math.max(0, Math.min(100, Math.round(v.pct))) : null,
    vuelve: v?.resets_at ?? null,
  });
  return {
    id: c.id,
    nombre: c.nombre,
    proveedor: c.proveedor,
    cuenta: c.id,
    ts: tsS,
    ventanas: [ventana("5h", l?.five_hour ?? null), ventana("7d", l?.seven_day ?? null)],
    ...(l ? {} : { sinLectura: true as const }),
  };
}

/** Google / Gemini desde agy /quota. null: no se pudo leer (agy falla o no trae grupos). */
async function googleDeAgy(tsS: number): Promise<SuscripcionCupo | null> {
  try {
    const binAgy = resolverAgy(process.env, homedir());
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const { stdout } = await execFileP(binAgy, ["-p", "/quota", "--output-format", "json"], { env, timeout: 12000, maxBuffer: 512 * 1024 });
    const raw = JSON.parse(stdout) as { command?: { data?: { groups?: Array<{ name?: string; buckets?: Array<{ id?: string; window?: string; remaining_fraction?: number; reset_time?: string }> }> } } };
    const groups = raw?.command?.data?.groups;
    if (!Array.isArray(groups) || groups.length === 0) return null;
    const gruposCupo: GrupoCupo[] = [];
    let geminiVentanas: VentanaCupo[] = [];

    for (const g of groups) {
      const gName = g?.name || "";
      const buckets = Array.isArray(g?.buckets) ? g.buckets : [];
      const ventanas: VentanaCupo[] = [];

      for (const b of buckets) {
        const rem = typeof b.remaining_fraction === "number" ? b.remaining_fraction : 1;
        const pct = Math.max(0, Math.min(100, Math.round((1 - rem) * 100)));
        const vuelve = b.reset_time ? Math.round(Date.parse(b.reset_time) / 1000) : null;
        const id = (b.window === "weekly" || String(b.id).includes("weekly")) ? "7d" : "5h";
        ventanas.push({ id, pct, vuelve: Number.isFinite(vuelve) ? vuelve : null });
      }

      if (ventanas.length > 0) {
        gruposCupo.push({
          id: gName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          nombre: gName,
          ventanas,
        });
        if (gName.toLowerCase().includes("gemini") || geminiVentanas.length === 0) {
          geminiVentanas = ventanas;
        }
      }
    }
    if (gruposCupo.length === 0) return null;
    avisados.delete("agy");
    return {
      id: "google",
      nombre: "Gemini",
      proveedor: "google",
      cuenta: "google",
      ts: tsS,
      ventanas: geminiVentanas,
      grupos: gruposCupo,
    };
  } catch (e) {
    avisarUna("agy", "agy /quota no se pudo leer: " + (e as Error).message);
    return null;
  }
}

async function consultarCuposNativo(manual: boolean): Promise<CuposLeidos | null> {
  const ahora = Date.now();
  const tsS = Math.round(ahora / 1000);
  // Las fuentes lentas (agy y cada cuenta extra) se releen cada TTL_LENTO_MS, o a pedido; si no, queda lo último bueno.
  const toca = manual || ahora - ultimoLentoMs >= TTL_LENTO_MS;
  if (toca) ultimoLentoMs = ahora;
  const suscripciones: SuscripcionCupo[] = [];

  // 1. Cuentas adicionales de Claude: su propio get_usage (con CLAUDE_CONFIG_DIR de la cuenta).
  for (const c of cuentasExtra()) {
    const previa = lentos.get(c.id);
    if (!toca && previa) {
      suscripciones.push(previa);
      continue;
    }
    if (c.proveedor !== "claude") {
      suscripciones.push(filaDeCuenta(c, null, tsS));
      continue;
    }
    const lectura = await usoDeCuenta(c.dir);
    if (lectura) {
      const fila = filaDeCuenta(c, lectura, tsS);
      lentos.set(c.id, fila);
      suscripciones.push(fila);
    } else {
      // Sin lectura nueva: vale lo último bueno (con su ts viejo, la barra lo marca); si nunca hubo, sin lectura.
      suscripciones.push(previa ?? filaDeCuenta(c, null, tsS));
    }
  }

  // 2. Google / Gemini desde agy /quota. En el agy de Windows `-p /quota` no es un comando: corre un turno del modelo
  // (2 a 18 mil tokens por lectura) y no trae grupos. Por eso sólo a pedido ("Actualizar límites"), nunca solo.
  const previaG = lentos.get("google");
  if (!manual && previaG) {
    suscripciones.push(previaG);
  } else if (!manual) {
    suscripciones.push({ id: "google", nombre: "Gemini", proveedor: "google", cuenta: "google", ts: tsS, sinLectura: true, ventanas: [{ id: "5h", pct: null, vuelve: null }, { id: "7d", pct: null, vuelve: null }] });
  } else {
    const g = await googleDeAgy(tsS);
    if (g) {
      lentos.set("google", g);
      suscripciones.push(g);
    } else {
      suscripciones.push(previaG ?? { id: "google", nombre: "Gemini", proveedor: "google", cuenta: "google", ts: tsS, sinLectura: true, ventanas: [{ id: "5h", pct: null, vuelve: null }, { id: "7d", pct: null, vuelve: null }] });
    }
  }

  if (suscripciones.length === 0) return null;
  return {
    ts: ahora,
    claudeNombre: "Claude",
    suscripciones,
  };
}

async function consultarCupos(manual: boolean): Promise<CuposLeidos | null> {
  if (modoAisladoSinCupos()) return null;
  try {
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const bin = resolverBinario("reparto", "HILOS_REPARTO", process.env, homedir());
    const { stdout } = await execFileP(bin, ["--cupos", "--json"], { env, timeout: 6000, maxBuffer: 512 * 1024 });
    const parsed = parsearCuposReparto(stdout, Date.now());
    if (parsed) {
      avisados.delete("reparto");
      return parsed;
    }
    avisarUna("reparto", "reparto --cupos --json no trajo el contrato version 1: se leen las cuentas por la app");
  } catch (e) {
    avisarUna("reparto", "reparto --cupos no anduvo (" + (e as Error).message + "): se leen las cuentas por la app");
  }
  return consultarCuposNativo(manual);
}

/** Las suscripciones sin la hora de la lectura: lo que decide si hay algo nuevo que avisar. */
const huella = (c: CuposLeidos | null): string => JSON.stringify(c ? { claude: c.claude, n: c.claudeNombre, s: c.suscripciones.map((x) => ({ ...x, ts: 0 })) } : null);

/**
 * Relee si venció el TTL (o forzar); avisa a los oyentes si algo cambió. forzar true salta el TTL
 * de 60 s de reparto, pero las fuentes lentas (agy, cuentas extra) sólo se releen a pedido: "manual".
 * Lo que falla deja la última lectura buena (su ts es el de esa lectura).
 */
export function refrescarCupos(forzar: boolean | "manual" = false): Promise<CuposLeidos | null> {
  if (modoAisladoSinCupos()) return Promise.resolve(null);
  const ahora = Date.now();
  if (!forzar && ultimoIntentoMs > 0 && ahora - ultimoIntentoMs < TTL_CUPOS_MS) return Promise.resolve(cacheCupos);
  if (enVuelo) return enVuelo;
  ultimoIntentoMs = ahora;
  enVuelo = consultarCupos(forzar === "manual")
    .then((res) => {
      enVuelo = null;
      if (res) {
        avisados.delete("refresco");
        const cambio = huella(cacheCupos) !== huella(res);
        cacheCupos = res;
        if (cambio) notificarCupos();
      }
      return cacheCupos;
    })
    .catch((e: unknown) => {
      enVuelo = null;
      avisarUna("refresco", "cupos: el refresco falló (" + (e as Error).message + "); queda la última lectura buena del " + new Date(cacheCupos?.ts ?? 0).toISOString());
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
