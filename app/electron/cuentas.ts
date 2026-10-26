// Ajustes > Cuentas: ¿están conectados Claude Code y Gemini (agy)? Lo decide Trama mismo, preguntándole a cada CLI, y no
// un archivo: `trama-estado` miraba `~/.gemini/oauth_creds.json` (el login del gemini-cli viejo) y agy guarda su sesión en el
// llavero del sistema (su log dice "keyringAuth: loaded token"), así que quien iniciaba sesión en agy seguía "sin conectar".
// - Claude: `claude auth status` (JSON con `loggedIn` y el correo).
// - agy: `agy models`. Sin sesión no trae nada ("Auth mode is unspecified, skipping fetchAvailableModels"); con sesión,
//   un renglón por modelo. Es una consulta al servicio, no un turno: no gasta cupo. Sin red tampoco trae nada, y eso se dice
//   como error (no como "sin conectar") cuando el CLI sale con código ≠ 0 o no contesta a tiempo.
// Cada vez que se pregunta se mira de nuevo (sin caché); el binario se busca en el PATH, en `~/.local/bin` y donde lo dejan
// sus instaladores (`resolverAgy`): bajo systemd o WSL el PATH viene pelado. Sin `electron`: lo prueba tests/cuentas.test.ts.
import { execFileCmd } from "./procesos.ts";
import os from "node:os";
import { pathConLocal, resolverAgy, resolverBinario } from "./binario.ts";

export type Cuenta = {
  instalado: boolean;
  logueado: boolean;
  /** Con quién está conectada (el correo), si el CLI lo dice. */
  cuenta: string | null;
  /** Por qué no se pudo saber (una clave `main.*` sin variables no hace falta: es el motivo en palabras de máquina, corto). */
  error: string | null;
};
/** `codex` es de la tarjeta ChatGPT de Plan y cupos (sólo se mira si está conectado: no se usa para correr nada); puede faltar de un motor viejo. */
export type EstadoCuentas = { version: 1; claude: Cuenta; agy: Cuenta; codex?: Cuenta };

export type Salida = { code: number | null; stdout: string; stderr: string; tiempo: boolean; noExiste: boolean };
export type Deps = {
  env: Record<string, string | undefined>;
  home: string;
  esEjecutable?: (f: string) => boolean;
  correr: (bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<Salida>;
};

const TOPE_CLAUDE = 10_000;
const TOPE_AGY = 25_000;

const sin = (instalado: boolean, error: string | null = null): Cuenta => ({ instalado, logueado: false, cuenta: null, error });
const ultimaLinea = (t: string) => t.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? "";

/** Un renglón de `agy models`: `gemini-4-argon-high<TAB>Gemini 4 Argon (High)`. */
const esModelo = (l: string) => /^[a-z0-9][a-z0-9._:]*(?:-[a-z0-9._:]+)+\s+\S/i.test(l.trim());

export async function sondearAgy(d: Deps): Promise<Cuenta> {
  const bin = resolverAgy(d.env, d.home, d.esEjecutable);
  const r = await d.correr(bin, ["models"], { ...d.env, PATH: pathConLocal(d.env, d.home) }, TOPE_AGY);
  if (r.noExiste) return sin(false);
  if (r.tiempo) return sin(true, "agy no contestó a tiempo");
  const modelos = r.stdout.split(/\r?\n/).filter(esModelo);
  if (modelos.length > 0) return { instalado: true, logueado: true, cuenta: null, error: null };
  if (r.code !== 0 && r.code !== null) return sin(true, ultimaLinea(r.stderr) || ultimaLinea(r.stdout) || `agy salió con ${r.code}`);
  return sin(true);
}

export async function sondearClaude(d: Deps): Promise<Cuenta> {
  const bin = resolverBinario("claude", "HILOS_CLAUDE", d.env, d.home, d.esEjecutable);
  const r = await d.correr(bin, ["auth", "status"], { ...d.env, PATH: pathConLocal(d.env, d.home) }, TOPE_CLAUDE);
  if (r.noExiste) return sin(false);
  if (r.tiempo) return sin(true, "claude no contestó a tiempo");
  // `claude auth status` sale con 1 y dice el JSON igual cuando no hay sesión.
  try {
    const j = JSON.parse(r.stdout) as { loggedIn?: unknown; email?: unknown };
    if (j.loggedIn === true) return { instalado: true, logueado: true, cuenta: typeof j.email === "string" && j.email ? j.email : null, error: null };
    if (j.loggedIn === false) return sin(true);
  } catch {
    /* un claude viejo sin `auth status` o con otra salida: abajo */
  }
  return sin(true, ultimaLinea(r.stderr) || ultimaLinea(r.stdout) || "claude no dijo si hay sesión");
}

/**
 * Codex (ChatGPT): `codex login status` dice «Logged in using ChatGPT» (o «…an API key») y sale con 0; sin sesión sale con 1 y dice
 * «Not logged in». Puede no estar instalado (`noExiste`): es lo normal en una máquina que no lo usa, no un error.
 */
export async function sondearCodex(d: Deps): Promise<Cuenta> {
  const bin = resolverBinario("codex", "HILOS_CODEX", d.env, d.home, d.esEjecutable);
  const r = await d.correr(bin, ["login", "status"], { ...d.env, PATH: pathConLocal(d.env, d.home) }, TOPE_CLAUDE);
  if (r.noExiste) return sin(false);
  if (r.tiempo) return sin(true, "codex no contestó a tiempo");
  const dicho = `${r.stdout}\n${r.stderr}`;
  if (/not logged in/i.test(dicho)) return sin(true);
  if (r.code === 0 && /logged in/i.test(dicho)) return { instalado: true, logueado: true, cuenta: null, error: null };
  return sin(true, ultimaLinea(r.stderr) || ultimaLinea(r.stdout) || "codex no dijo si hay sesión");
}

export async function estadoCuentas(d: Deps): Promise<EstadoCuentas> {
  const [claude, agy, codex] = await Promise.all([sondearClaude(d), sondearAgy(d), sondearCodex(d)]);
  return { version: 1, claude, agy, codex };
}

export const correrReal: Deps["correr"] = (bin, args, env, timeout) =>
  new Promise((ok) => {
    const hijo = execFileCmd(bin, args, { env, timeout, maxBuffer: 1 << 20 }, (e, stdout, stderr) => {
      const err = e as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      ok({
        code: err ? (typeof err.code === "number" ? err.code : null) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        tiempo: !!err?.killed,
        noExiste: err?.code === "ENOENT",
      });
    });
    hijo.stdin?.end();
  });

export const cuentasDeEstaMaquina = () => estadoCuentas({ env: process.env, home: os.homedir(), correr: correrReal });

/** Lo que llega del main, validado en el renderer: sólo estas formas. */
export const cuentaValida = (x: unknown): Cuenta => {
  const o = (x ?? {}) as Partial<Cuenta>;
  return {
    instalado: o.instalado === true,
    logueado: o.logueado === true,
    cuenta: typeof o.cuenta === "string" && o.cuenta ? o.cuenta : null,
    error: typeof o.error === "string" && o.error ? o.error : null,
  };
};
