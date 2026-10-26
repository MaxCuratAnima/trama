// Rutas y PATH por plataforma, en un solo lugar. Funciones puras que reciben (plataforma, env, home) para probar
// Windows desde Linux (`tests/plataforma.test.ts`); al final, los helpers que miran `process.platform`/`process.env`.
// Linux devuelve lo de siempre (`~/.config/trama`, `~/.local/state/hilos`…); Windows usa %APPDATA% y %LOCALAPPDATA%.
// Sin `electron` ni imports locales.
import { accessSync, constants, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Env = Record<string, string | undefined>;
export type Plataforma = NodeJS.Platform;

export const esWindows = (p: Plataforma) => p === "win32";

/** `path.win32` o `path.posix`: las rutas de Windows se arman bien aunque corra en Linux (las pruebas). */
export const caminos = (p: Plataforma) => (esWindows(p) ? path.win32 : path.posix);

/** `;` en Windows, `:` en el resto. */
export const separadorPath = (p: Plataforma) => (esWindows(p) ? ";" : ":");

/** El `PATH` del entorno. En Windows la variable se llama `Path` y las claves no distinguen mayúsculas. */
export function leerPath(p: Plataforma, env: Env): string {
  const k = clavePath(p, env);
  return (k && env[k]) || "";
}

function clavePath(p: Plataforma, env: Env): string | undefined {
  if (!esWindows(p)) return "PATH";
  return Object.keys(env).find((k) => k.toLowerCase() === "path");
}

/** Las carpetas del PATH, sin vacías. */
export const carpetasPath = (p: Plataforma, env: Env): string[] => leerPath(p, env).split(separadorPath(p)).filter(Boolean);

/** `~/.local/bin` (en Windows `%USERPROFILE%\.local\bin`, donde vive `claude.exe`): ahí se instalan `pa`, `tablero`, `claude`. */
export const dirBinLocal = (p: Plataforma, home: string) => caminos(p).join(home, ".local", "bin");

/** El PATH con `~/.local/bin` adelante (sin repetirlo). */
export function pathConLocal(p: Plataforma, env: Env, home: string): string {
  const local = dirBinLocal(p, home);
  const igual = (d: string) => (esWindows(p) ? d.toLowerCase() === local.toLowerCase() : d === local);
  return [local, ...carpetasPath(p, env).filter((d) => !igual(d))].join(separadorPath(p));
}

/** El entorno con `~/.local/bin` adelante en el PATH (en Windows, sobre la clave que ya tenía, para no duplicarla). */
export function entornoConLocal(p: Plataforma, env: Env, home: string): Env {
  const clave = clavePath(p, env) ?? (esWindows(p) ? "Path" : "PATH");
  return { ...env, [clave]: pathConLocal(p, env, home) };
}

/** Las extensiones con que se prueba un nombre: ninguna en Linux; en Windows las de `PATHEXT` (con el nombre pelado primero). */
export function extensionesEjecutable(p: Plataforma, env: Env): string[] {
  if (!esWindows(p)) return [""];
  const k = Object.keys(env).find((x) => x.toLowerCase() === "pathext");
  const ext = ((k && env[k]) || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase());
  return ["", ...ext];
}

/** Los nombres de archivo a probar para `nombre`: tal cual, y en Windows con cada extensión de `PATHEXT` si no trae una. */
export function candidatosEjecutable(p: Plataforma, env: Env, nombre: string): string[] {
  const exts = extensionesEjecutable(p, env);
  if (!esWindows(p)) return [nombre];
  const trae = exts.some((e) => e && nombre.toLowerCase().endsWith(e));
  return trae ? [nombre] : exts.map((e) => nombre + e);
}

/** ¿Es un archivo ejecutable? Linux: bit X. Windows no tiene bit X: alcanza con que sea un archivo. */
export function esEjecutable(f: string, p: Plataforma = process.platform): boolean {
  try {
    if (esWindows(p)) return statSync(f).isFile();
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Busca `nombre` en `dirs` (con `PATHEXT` en Windows); la ruta del primero que `existe`, o `null`. */
export function buscarEjecutable(p: Plataforma, env: Env, nombre: string, dirs: string[], existe: (f: string) => boolean): string | null {
  const j = caminos(p);
  for (const d of dirs) for (const n of candidatosEjecutable(p, env, nombre)) if (existe(j.join(d, n))) return j.join(d, n);
  return null;
}

/** Donde Windows guarda lo de la app: `%APPDATA%` (roaming) y `%LOCALAPPDATA%`; sin variable, las carpetas de siempre del perfil. */
const appData = (env: Env, home: string) => env.APPDATA || path.win32.join(home, "AppData", "Roaming");
const localAppData = (env: Env, home: string) => env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");

/** La config de Trama: `~/.config/trama` · `%APPDATA%\Trama`. */
export function dirConfigTrama(p: Plataforma, env: Env, home: string): string {
  return esWindows(p) ? path.win32.join(appData(env, home), "Trama") : path.posix.join(home, ".config", "trama");
}

/** `perfil.json` (`TRAMA_PERFIL`). */
export const rutaPerfil = (p: Plataforma, env: Env, home: string) => env.TRAMA_PERFIL ?? caminos(p).join(dirConfigTrama(p, env, home), "perfil.json");

/** `modelos.json` (`TRAMA_MODELOS`, `HILOS_MODELOS`; en Linux también `XDG_CONFIG_HOME`). */
export function rutaModelos(p: Plataforma, env: Env, home: string): string {
  const fijo = env.TRAMA_MODELOS ?? env.HILOS_MODELOS;
  if (fijo !== undefined) return fijo;
  if (esWindows(p)) return path.win32.join(dirConfigTrama(p, env, home), "modelos.json");
  return path.posix.join(env.XDG_CONFIG_HOME ?? path.posix.join(home, ".config"), "trama", "modelos.json");
}

/** El registry de proyectos (`PROYECTOS_REGISTRY`): `~/.config/proyectos/registry.json` · `%APPDATA%\Trama\proyectos\registry.json`. */
export function rutaRegistry(p: Plataforma, env: Env, home: string): string {
  return (
    env.PROYECTOS_REGISTRY ??
    (esWindows(p) ? path.win32.join(dirConfigTrama(p, env, home), "proyectos", "registry.json") : path.posix.join(home, ".config", "proyectos", "registry.json"))
  );
}

/** Raíz del estado en Windows: `%LOCALAPPDATA%\Trama\state`. En Linux no hay raíz de Trama: cada uno cuelga de `~/.local/state`. */
const estadoWin = (env: Env, home: string) => path.win32.join(localAppData(env, home), "Trama", "state");

/** El estado propio de la app (`HILOS_STATE`): `~/.local/state/hilos` · `%LOCALAPPDATA%\Trama\state\hilos`. */
export function dirEstadoApp(p: Plataforma, env: Env, home: string): string {
  return env.HILOS_STATE ?? (esWindows(p) ? path.win32.join(estadoWin(env, home), "hilos") : path.posix.join(home, ".local", "state", "hilos"));
}

/** El estado de `pa` (`PA_STATE`): `~/.local/state/pa` · `%LOCALAPPDATA%\Trama\state\pa`. */
export function dirEstadoPa(p: Plataforma, env: Env, home: string): string {
  return env.PA_STATE ?? (esWindows(p) ? path.win32.join(estadoWin(env, home), "pa") : path.posix.join(home, ".local", "state", "pa"));
}

/** El tablero (`TABLERO_DIR`): `~/.local/state/tablero` · `%LOCALAPPDATA%\Trama\tablero`. */
export function dirTablero(p: Plataforma, env: Env, home: string): string {
  if (env.TABLERO_DIR) return env.TABLERO_DIR;
  return esWindows(p) ? path.win32.join(localAppData(env, home), "Trama", "tablero") : path.posix.join(home, ".local", "state", "tablero");
}

/** La config de Claude Code: `~/.claude` en las dos (en Windows, `%USERPROFILE%\.claude`). */
export const dirClaudeConfig = (p: Plataforma, home: string) => caminos(p).join(home, ".claude");

// --- Con la plataforma y el entorno de este proceso ---

const aqui = () => process.platform;
const entorno = () => process.env as Env;

export const hayWindows = () => esWindows(aqui());
export const separador = () => separadorPath(aqui());
export const esteConfigTrama = () => dirConfigTrama(aqui(), entorno(), os.homedir());
export const estePerfil = () => rutaPerfil(aqui(), entorno(), os.homedir());
export const esteModelos = () => rutaModelos(aqui(), entorno(), os.homedir());
export const esteRegistry = () => rutaRegistry(aqui(), entorno(), os.homedir());
export const esteEstadoApp = () => dirEstadoApp(aqui(), entorno(), os.homedir());
export const esteEstadoPa = () => dirEstadoPa(aqui(), entorno(), os.homedir());
export const esteTablero = () => dirTablero(aqui(), entorno(), os.homedir());
