// "Falta algo del setup": qué de lo que trama usa no está en esta máquina (Handy para dictar, agy, Ollama, el login de
// Claude; en Windows también Git for Windows y claude.exe). Es el aviso chico de la barra (src/barra/AvisoSetup.tsx). Sólo se mira cuando se pide (al abrir la app y con
// "Revisar"), nunca con un reloj. Sólo se avisa en el producto (`TRAMA_LOCAL=1`, la carcasa de Windows) o con
// `HILOS_SETUP=1`: en una instalación propia o en un servidor hay otras cosas y no se molesta con lo que a propósito no tienen.
// Cada falta se descarta aparte y queda en `$HILOS_STATE/setup.json`. Sin `electron`: lo prueba tests/setup.test.ts.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolverBinario } from "./binario.ts";
import { hayAgy, hayClaude } from "./capacidades.ts";
import { hayHandy } from "./dictado-windows.ts";
import { buscarEjecutable, carpetasPath, esEjecutable, esWindows, type Env, type Plataforma } from "./plataforma.ts";
import { modoLocal } from "./modo-local.ts";
import { sondearOllama } from "./modelos-config.ts";
import { URL_OLLAMA } from "./modelos-tipos.ts";
import { ESTADO, escribirAtomico } from "./pa.js";
import { silencio } from "./log.js";

export type FaltaId = "handy" | "agy" | "ollama" | "login" | "claude" | "git";
/** Lo que falta y a dónde se va a conseguirlo (un enlace que se abre afuera). */
export type Falta = { id: FaltaId; url: string };
export type EstadoSetup = { version: 1; faltas: Falta[] };

export const URLS: Record<FaltaId, string> = {
  handy: "https://handy.computer",
  agy: "https://antigravity.google",
  ollama: "https://ollama.com/download",
  login: "https://docs.claude.com/en/docs/claude-code/quickstart",
  claude: "https://docs.claude.com/en/docs/claude-code/quickstart",
  git: "https://git-scm.com/download/win",
};
const IDS = Object.keys(URLS) as FaltaId[];
const ARCHIVO = path.join(ESTADO, "setup.json");

/** Lo que se pregunta a la máquina: las pruebas lo reemplazan. */
export type Sondas = {
  /** ¿Se avisa? (producto o forzado). */
  activo: () => boolean;
  handy: () => Promise<boolean>;
  agy: () => boolean;
  ollama: () => Promise<boolean>;
  /** `false` solo si Claude dice que no hay sesión (o no está); si no se sabe, `true`: nunca se acusa sin saber. */
  login: () => Promise<boolean>;
  /** ¿Está `claude` (Claude Code)? En Windows, `claude.exe` (en `%USERPROFILE%\.local\bin`). */
  claude: () => boolean;
  /** ¿Está Git for Windows (Claude Code y `pa` lo necesitan)? Fuera de Windows no se pide: `true`. */
  git: () => boolean;
  descartados: () => Promise<FaltaId[]>;
};

/** Lo que falta, sin lo descartado. */
export async function estadoSetup(s: Sondas): Promise<EstadoSetup> {
  if (!s.activo()) return { version: 1, faltas: [] };
  const [descartados, handy, ollama, login] = await Promise.all([s.descartados(), s.handy(), s.ollama(), s.login()]);
  const hayClaudeInstalado = s.claude();
  // Sin claude no hay sesión que mirar: se avisa que falta claude y el login queda implícito.
  const faltan: Record<FaltaId, boolean> = { login: !login && hayClaudeInstalado, handy: !handy, agy: !s.agy(), ollama: !ollama, claude: !hayClaudeInstalado, git: !s.git() };
  return { version: 1, faltas: IDS.filter((id) => faltan[id] && !descartados.includes(id)).map((id) => ({ id, url: URLS[id] })) };
}

const esId = (x: unknown): x is FaltaId => typeof x === "string" && (IDS as string[]).includes(x);

export async function leerDescartados(archivo = ARCHIVO): Promise<FaltaId[]> {
  try {
    const j = JSON.parse(await readFile(archivo, "utf8")) as { version?: unknown; descartados?: unknown };
    return j.version === 1 && Array.isArray(j.descartados) ? j.descartados.filter(esId) : [];
  } catch {
    return [];
  }
}

/** Anota que `id` no se avisa más (idempotente). Un id que no existe no escribe nada. */
export async function descartarSetup(id: unknown, archivo = ARCHIVO): Promise<void> {
  if (!esId(id)) return;
  const antes = await leerDescartados(archivo);
  if (antes.includes(id)) return;
  await escribirAtomico(archivo, JSON.stringify({ version: 1, descartados: [...antes, id] })).catch(silencio("setup"));
}

/** `claude auth status` dice `{"loggedIn": false}` sin sesión. Cualquier otra cosa (un claude falso, un error) no acusa. */
export const loginDe = (salida: string): boolean => {
  try {
    return (JSON.parse(salida) as { loggedIn?: unknown }).loggedIn !== false;
  } catch {
    return true;
  }
};

/** Dónde instala Git for Windows: en todo el equipo (`Program Files`) o por usuario (`%LOCALAPPDATA%\Programs\Git`). */
export function carpetasGit(env: Env, home: string): string[] {
  const j = path.win32;
  const pf = [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"];
  return [...pf.map((d) => j.join(d, "Git", "cmd")), ...pf.map((d) => j.join(d, "Git", "bin")), j.join(env.LOCALAPPDATA ?? j.join(home, "AppData", "Local"), "Programs", "Git", "cmd")];
}

/** ¿Hay Git for Windows? `git.exe` en el PATH o en una carpeta de instalación conocida. Fuera de Windows no se pide (`true`). */
export function hayGit(p: Plataforma = process.platform, env: Env = process.env, home = os.homedir(), existe: (f: string) => boolean = (f) => esEjecutable(f, p)): boolean {
  if (!esWindows(p)) return true;
  return buscarEjecutable(p, env, "git", [...carpetasPath(p, env), ...carpetasGit(env, home)], existe) !== null;
}

const sondasReales = (): Sondas => ({
  activo: () => modoLocal() || process.env.HILOS_SETUP === "1",
  handy: () => hayHandy({ correr: (b, a, o) => correrTexto(b, a, o.timeout) }),
  agy: () => hayAgy(),
  ollama: async () => (await sondearOllama(URL_OLLAMA, 1500).catch(() => ({ ok: false }))).ok,
  claude: () => hayClaude(),
  git: () => hayGit(),
  login: async () => {
    const claude = resolverBinario("claude", "HILOS_CLAUDE", process.env, os.homedir());
    try {
      return loginDe(await correrTexto(claude, ["auth", "status"], 8000));
    } catch (e) {
      // `claude auth status` sale con 1 y dice el JSON igual cuando no hay sesión.
      const salida = (e as { stdout?: unknown }).stdout;
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      return typeof salida === "string" ? loginDe(salida) : true;
    }
  },
  descartados: () => leerDescartados(),
});

function correrTexto(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((ok, mal) => execFile(bin, args, { timeout, maxBuffer: 1 << 20 }, (e, stdout) => (e ? mal(Object.assign(e, { stdout: String(stdout) })) : ok(String(stdout)))));
}

export const setupDeEstaMaquina = () => estadoSetup(sondasReales());
