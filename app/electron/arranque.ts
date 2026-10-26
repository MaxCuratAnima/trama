// "Medir exacto": cuánto pesa de verdad arrancar una sesión de Claude Code, a pedido. El registro
// histórico (historial.ts) reparte el arranque exacto entre sus piezas con el tamaño de su texto (estimado);
// acá se mide: `claude -p` con un mensaje mínimo, una vez completo y otras tres apagando de a una cosa
// (todas las skills, todos los servidores MCP, todo lo personalizable), y de cada `usage` se saca la entrada
// del primer pedido (entrada + caché escrito + caché leído). El peso de cada parte es la resta:
//   skills = completo − sin skills        mcp = completo − sin MCP       sistema = todo apagado
//   resto (CLAUDE.md, plugins, hooks, agentes, estilo) = completo − todo apagado − skills − mcp
// Cuatro pedidos cortos a Claude, que cuentan para el plan: sólo cuando el usuario aprieta el botón, nunca de
// fondo ni de corrido. Sin sesión (`--no-session-persistence`): no deja transcript ni ensucia el registro.
// Lo medido se guarda en `$HILOS_STATE/arranque-medido.json` y se sigue mostrando, con su fecha, hasta
// que se mide de nuevo. Sin Electron: `tests/arranque.test.ts`.
import { execFileCmd } from "./procesos.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { escribirAtomico } from "./pa.ts";
import { textoT } from "./errores.ts";
import { silencio } from "./log.ts";

const VERSION = 1;
const MENSAJE = "Contestá solo: ok";
/** Un pedido corto tarda segundos; más que esto es que claude se colgó. */
const TOPE_MS = 120_000;

/** Qué se apaga en cada pedido (el primero, nada). */
const PEDIDOS = {
  completo: [],
  sinSkills: ["--disable-slash-commands"],
  sinMcp: ["--strict-mcp-config"],
  vacio: ["--safe-mode"],
} as const;
type Pedido = keyof typeof PEDIDOS;

/** El peso exacto de arrancar con la configuración de cuando se midió, en tokens. */
export type Medido = {
  version: 1;
  /** Epoch en ms. */
  medido_en: number;
  total: number;
  partes: { sistema: number; skills: number; mcp: number; resto: number };
};
export type Arranque = Medido | { version: 1; error: string };

type Env = NodeJS.ProcessEnv;
export type OpcionesArranque = {
  /** El `claude` (el de los líderes: `HILOS_CLAUDE`). */
  claude: string;
  cwd: string;
  env: Env;
  /** Dónde se guarda lo medido (`$HILOS_STATE`). */
  estado: string;
  ahora?: () => number;
};

const num = (x: unknown) => (typeof x === "number" && isFinite(x) && x >= 0 ? x : 0);

/** El `usage` del resultado que imprime `claude -p --output-format json` (un objeto, o la lista de mensajes). */
export function usoDe(salida: string): number | null {
  let j: unknown;
  try {
    j = JSON.parse(salida);
  } catch {
    return null;
  }
  const r = (Array.isArray(j) ? j.findLast((m) => m?.type === "result") : j) as { usage?: Record<string, unknown>; is_error?: boolean } | undefined;
  if (!r || r.is_error || !r.usage) return null;
  const n = num(r.usage.input_tokens) + num(r.usage.cache_creation_input_tokens) + num(r.usage.cache_read_input_tokens);
  return n > 0 ? n : null;
}

/** De los cuatro pedidos al peso de cada parte. Nunca negativo: lo apagado no puede pesar más que el total. */
export function partesDe(m: Record<Pedido, number>): Medido["partes"] {
  const skills = Math.max(0, m.completo - m.sinSkills);
  const mcp = Math.max(0, m.completo - m.sinMcp);
  const sistema = Math.min(m.vacio, m.completo);
  return { sistema, skills, mcp, resto: Math.max(0, m.completo - sistema - skills - mcp) };
}

function leerMedido(x: unknown): Medido | null {
  const m = x as Partial<Medido> | null;
  if (!m || m.version !== VERSION || !m.partes) return null;
  const p = m.partes;
  if (![m.medido_en, m.total, p.sistema, p.skills, p.mcp, p.resto].every((n) => typeof n === "number" && isFinite(n))) return null;
  return m as Medido;
}

export function crearArranque(o: OpcionesArranque) {
  const archivo = path.join(o.estado, "arranque-medido.json");
  const ahora = o.ahora ?? Date.now;
  let enCurso: Promise<Arranque> | null = null;

  const correr = (extra: readonly string[]) =>
    new Promise<string>((listo, falla) => {
      execFileCmd(
        o.claude,
        ["-p", MENSAJE, "--output-format", "json", "--no-session-persistence", ...extra],
        { cwd: o.cwd, env: o.env, timeout: TOPE_MS, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => (err ? falla(new Error(String(stderr || err.message).trim().split("\n").pop())) : listo(String(stdout))),
      );
    });

  /** Lo último que se midió, o `null` si nunca. */
  async function leer(): Promise<Medido | null> {
    try {
      return leerMedido(JSON.parse(await readFile(archivo, "utf8")));
    } catch {
      return null;
    }
  }

  async function medirDeVerdad(): Promise<Arranque> {
    const m = {} as Record<Pedido, number>;
    // De a uno: dos pedidos a la vez se pisarían el caché de Claude y la cuenta no sería la de uno solo.
    for (const p of Object.keys(PEDIDOS) as Pedido[]) {
      let salida: string;
      try {
        salida = await correr(PEDIDOS[p]);
      } catch (e) {
        return { version: VERSION, error: textoT("main.medirFalla", { por: (e as Error).message }) };
      }
      const n = usoDe(salida);
      if (n === null) return { version: VERSION, error: textoT("main.medirSinUso") };
      m[p] = n;
    }
    const r: Medido = { version: VERSION, medido_en: ahora(), total: m.completo, partes: partesDe(m) };
    await escribirAtomico(archivo, JSON.stringify(r)).catch(silencio("arranque"));
    return r;
  }

  return {
    leer,
    /** Mide ahora. Uno solo a la vez: apretar de nuevo mientras corre espera el mismo resultado. Nunca rechaza. */
    medir(): Promise<Arranque> {
      enCurso ??= medirDeVerdad()
        .catch((e): Arranque => ({ version: VERSION, error: textoT("main.medirFalla", { por: (e as Error).message }) }))
        .finally(() => {
          enCurso = null;
        });
      return enCurso;
    },
  };
}
