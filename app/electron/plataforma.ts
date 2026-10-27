// Rutas y PATH de Windows, en un solo lugar. Funciones puras que reciben (plataforma, env, home) para probarlas con
// entornos armados (`tests/plataforma.test.ts`); al final, los helpers que miran `process.platform`/`process.env`.
// Usa %APPDATA% y %LOCALAPPDATA%. Sin `electron` ni imports locales.
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Env = Record<string, string | undefined>;
export type Plataforma = NodeJS.Platform;

/** Trama es sólo de Windows: siempre `true` (el parámetro queda por los llamadores). */
export const esWindows = (_p: Plataforma) => true;

/** `path.win32`. */
export const caminos = (_p: Plataforma) => path.win32;

/** La ruta como clave de comparación: normalizada y sin distinguir mayúsculas ni `/` de `\` (git informa `C:/Users/.../trama`; nosotros armamos `C:\Users\...\Trama`). */
export function claveRuta(p: Plataforma, ruta: string): string {
  return caminos(p).normalize(ruta).replace(/[\\/]+$/, "").toLowerCase();
}
export const mismaRuta = (p: Plataforma, a: string, b: string) => claveRuta(p, a) === claveRuta(p, b);
/** Lo que sigue de `base` en `ruta` si `ruta` está adentro de `base` (`""` si es la misma), o `null` si no. Conserva las mayúsculas de `ruta`. */
export function restoDeRuta(p: Plataforma, ruta: string, base: string): string | null {
  const r = claveRuta(p, ruta);
  const b = claveRuta(p, base);
  if (r === b) return "";
  if (!r.startsWith(b + caminos(p).sep)) return null;
  return caminos(p).normalize(ruta).replace(/[\\/]+$/, "").slice(b.length + 1);
}

/** El separador del PATH: `;`. */
export const separadorPath = (_p: Plataforma) => ";";

/** El `PATH` del entorno. En Windows la variable se llama `Path` y las claves no distinguen mayúsculas. */
export function leerPath(p: Plataforma, env: Env): string {
  const k = clavePath(p, env);
  return (k && env[k]) || "";
}

function clavePath(_p: Plataforma, env: Env): string | undefined {
  return Object.keys(env).find((k) => k.toLowerCase() === "path");
}

/** Las carpetas del PATH, sin vacías. */
export const carpetasPath = (p: Plataforma, env: Env): string[] => leerPath(p, env).split(separadorPath(p)).filter(Boolean);

/** `%USERPROFILE%\.local\bin`, donde vive `claude.exe`: ahí se instalan `pa`, `tablero`, `claude`. */
export const dirBinLocal = (p: Plataforma, home: string) => caminos(p).join(home, ".local", "bin");

/** El PATH con `~/.local/bin` adelante (sin repetirlo). */
export function pathConLocal(p: Plataforma, env: Env, home: string): string {
  const local = dirBinLocal(p, home);
  const igual = (d: string) => d.toLowerCase() === local.toLowerCase();
  return [local, ...carpetasPath(p, env).filter((d) => !igual(d))].join(separadorPath(p));
}

/** El entorno con `~/.local/bin` adelante en el PATH (sobre la clave que ya tenía, para no duplicarla). */
export function entornoConLocal(p: Plataforma, env: Env, home: string): Env {
  const clave = clavePath(p, env) ?? "Path";
  return { ...env, [clave]: pathConLocal(p, env, home) };
}

/** El entorno con `dir` adelante en el PATH (sin repetirlo; sobre la clave que ya tenía, para no duplicarla). */
export function entornoConDir(p: Plataforma, env: Env, dir: string): Env {
  const clave = clavePath(p, env) ?? "Path";
  const igual = (d: string) => d.toLowerCase() === dir.toLowerCase();
  return { ...env, [clave]: [dir, ...carpetasPath(p, env).filter((d) => !igual(d))].join(separadorPath(p)) };
}

/** Las extensiones con que se prueba un nombre: las de `PATHEXT` (con el nombre pelado primero). */
export function extensionesEjecutable(_p: Plataforma, env: Env): string[] {
  const k = Object.keys(env).find((x) => x.toLowerCase() === "pathext");
  const ext = ((k && env[k]) || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase());
  return ["", ...ext];
}

/** Los nombres de archivo a probar para `nombre`: tal cual, o con cada extensión de `PATHEXT` si no trae una. */
export function candidatosEjecutable(p: Plataforma, env: Env, nombre: string): string[] {
  const exts = extensionesEjecutable(p, env);
  const trae = exts.some((e) => e && nombre.toLowerCase().endsWith(e));
  return trae ? [nombre] : exts.map((e) => nombre + e);
}

/** ¿Es un archivo ejecutable? Windows no tiene bit X: alcanza con que sea un archivo. */
export function esEjecutable(f: string, _p: Plataforma = process.platform): boolean {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
}

/** Busca `nombre` en `dirs` (con `PATHEXT`); la ruta del primero que `existe`, o `null`. */
export function buscarEjecutable(p: Plataforma, env: Env, nombre: string, dirs: string[], existe: (f: string) => boolean): string | null {
  const j = caminos(p);
  for (const d of dirs) for (const n of candidatosEjecutable(p, env, nombre)) if (existe(j.join(d, n))) return j.join(d, n);
  return null;
}

/** Donde Windows guarda lo de la app: `%APPDATA%` (roaming) y `%LOCALAPPDATA%`; sin variable, las carpetas de siempre del perfil. */
const appData = (env: Env, home: string) => env.APPDATA || path.win32.join(home, "AppData", "Roaming");
const localAppData = (env: Env, home: string) => env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");

/** La config de Trama: `%APPDATA%\Trama`. */
export function dirConfigTrama(_p: Plataforma, env: Env, home: string): string {
  return path.win32.join(appData(env, home), "Trama");
}

/** `perfil.json` (`TRAMA_PERFIL`). */
export const rutaPerfil = (p: Plataforma, env: Env, home: string) => env.TRAMA_PERFIL ?? caminos(p).join(dirConfigTrama(p, env, home), "perfil.json");

/** `modelos.json` (`TRAMA_MODELOS`, `HILOS_MODELOS`). */
export function rutaModelos(p: Plataforma, env: Env, home: string): string {
  return env.TRAMA_MODELOS ?? env.HILOS_MODELOS ?? path.win32.join(dirConfigTrama(p, env, home), "modelos.json");
}

/** El registry de proyectos (`PROYECTOS_REGISTRY`): `%APPDATA%\Trama\proyectos\registry.json`. */
export function rutaRegistry(p: Plataforma, env: Env, home: string): string {
  return env.PROYECTOS_REGISTRY ?? path.win32.join(dirConfigTrama(p, env, home), "proyectos", "registry.json");
}

/** Raíz del estado: `%LOCALAPPDATA%\Trama\state`. */
const estadoWin = (env: Env, home: string) => path.win32.join(localAppData(env, home), "Trama", "state");

/** El estado propio de la app (`HILOS_STATE`): `%LOCALAPPDATA%\Trama\state\hilos`. */
export function dirEstadoApp(_p: Plataforma, env: Env, home: string): string {
  return env.HILOS_STATE ?? path.win32.join(estadoWin(env, home), "hilos");
}

/** El estado de `pa` (`PA_STATE`): `%LOCALAPPDATA%\Trama\state\pa`. */
export function dirEstadoPa(_p: Plataforma, env: Env, home: string): string {
  return env.PA_STATE ?? path.win32.join(estadoWin(env, home), "pa");
}

/** El tablero (`TABLERO_DIR`): `%LOCALAPPDATA%\Trama\tablero`. */
export function dirTablero(_p: Plataforma, env: Env, home: string): string {
  if (env.TABLERO_DIR) return env.TABLERO_DIR;
  return path.win32.join(localAppData(env, home), "Trama", "tablero");
}

/** La config de Claude Code: `%USERPROFILE%\.claude`. */
export const dirClaudeConfig = (p: Plataforma, home: string) => caminos(p).join(home, ".claude");

// --- Con la plataforma y el entorno de este proceso ---

const aqui = () => process.platform;
const entorno = () => process.env as Env;

export const hayWindows = () => true;
export const separador = () => separadorPath(aqui());
export const esteConfigTrama = () => dirConfigTrama(aqui(), entorno(), os.homedir());
export const estePerfil = () => rutaPerfil(aqui(), entorno(), os.homedir());
export const esteModelos = () => rutaModelos(aqui(), entorno(), os.homedir());
export const esteRegistry = () => rutaRegistry(aqui(), entorno(), os.homedir());
export const esteEstadoApp = () => dirEstadoApp(aqui(), entorno(), os.homedir());
export const esteEstadoPa = () => dirEstadoPa(aqui(), entorno(), os.homedir());
export const esteTablero = () => dirTablero(aqui(), entorno(), os.homedir());
