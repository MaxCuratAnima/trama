// Dónde está `pa` y con qué PATH correrlo. Abierta desde el menú de apps, la
// sesión gráfica no trae ~/.local/bin en el PATH: `pa` daba "spawn pa ENOENT"
// (2026-10-03), y aunque se encuentre, `pa` necesita `claude` y `proyecto-ruta`,
// que viven ahí. Puro (sin `electron` ni imports locales): lo prueba
// `tests/binario.test.ts` con `node --test`.
import {
  buscarEjecutable,
  caminos,
  carpetasPath,
  dirBinLocal,
  entornoConLocal,
  esEjecutable,
  esWindows,
  separadorPath,
  pathConLocal as pathConLocalDe,
  type Env,
  type Plataforma,
} from "./plataforma.ts";

/** El PATH con `~/.local/bin` adelante (sin repetirlo). */
export const pathConLocal = (env: Env, home: string, plataforma: Plataforma = process.platform): string => pathConLocalDe(plataforma, env, home);

/** El entorno para correr `pa`: el de la app con `~/.local/bin` adelante en el PATH. */
export const entornoPa = (env: Env, home: string, plataforma: Plataforma = process.platform): Env => entornoConLocal(plataforma, env, home);

/**
 * El entorno para correr `agy` (y las herramientas de comandos que él lanza, donde el líder de Gemini llama a `pa`): `~/.local/bin`
 * adelante y la carpeta del `pa` encontrado (`HILOS_PA`, o el del PATH de la app) justo después, para que `pa` no quede en
 * "command not found" aunque viva fuera del PATH que hereda el proceso (unidad de systemd, menú de apps, WSL).
 */
export function entornoAgy(env: Env, home: string, existe: (f: string) => boolean = (f) => esEjecutable(f), plataforma: Plataforma = process.platform): Env {
  const c = caminos(plataforma);
  const pa = resolverPa(env, home, existe, plataforma);
  const dirPa = c.isAbsolute(pa) ? c.dirname(pa) : "";
  const sep = separadorPath(plataforma);
  const [local, ...resto] = pathConLocal(env, home, plataforma).split(sep);
  const dirs = [local, ...(dirPa && dirPa !== local ? [dirPa] : []), ...resto.filter((d) => d !== dirPa)];
  const clave = Object.keys(entornoConLocal(plataforma, env, home)).find((k) => (plataforma === "win32" ? k.toLowerCase() === "path" : k === "PATH")) ?? "PATH";
  return { ...env, [clave]: dirs.join(sep) };
}

/**
 * La variable de entorno si está; si no, el binario del PATH (el de la app, tal cual vino); si no,
 * `~/.local/bin/<nombre>`. Si no aparece en ningún lado queda el nombre pelado: el error de spawn
 * dice qué falta. En Windows se prueba con las extensiones de `PATHEXT` (`pa.exe`, `pa.cmd`…).
 */
export function resolverBinario(
  nombre: string,
  variable: string,
  env: Env,
  home: string,
  existe: (f: string) => boolean = (f) => esEjecutable(f),
  plataforma: Plataforma = process.platform,
): string {
  if (env[variable]) return env[variable];
  return buscarEjecutable(plataforma, env, nombre, [...carpetasPath(plataforma, env), dirBinLocal(plataforma, home)], existe) ?? nombre;
}

/** `pa`: `HILOS_PA`, el del PATH o `~/.local/bin/pa`. */
export function resolverPa(env: Env, home: string, existe: (f: string) => boolean = (f) => esEjecutable(f), plataforma: Plataforma = process.platform): string {
  return resolverBinario("pa", "HILOS_PA", env, home, existe, plataforma);
}

/**
 * `agy` (Antigravity CLI): lo de `resolverBinario` y, si no aparece, las carpetas donde sus instaladores lo dejan fuera del PATH de una
 * unidad de systemd o de WSL (`/usr/local/bin`, `/usr/bin`, `~/.antigravity/bin`…). Si no está en ningún lado queda `agy` pelado.
 */
export function resolverAgy(env: Env, home: string, existe: (f: string) => boolean = (f) => esEjecutable(f), plataforma: Plataforma = process.platform): string {
  const r = resolverBinario("agy", "HILOS_AGY", env, home, existe, plataforma);
  if (r !== "agy") return r;
  const c = caminos(plataforma);
  const donde = esWindows(plataforma)
    ? [c.join(home, ".antigravity", "bin"), c.join(home, ".antigravity-cli", "bin"), c.join(home, ".gemini", "antigravity-cli", "bin")]
    : ["/usr/local/bin", "/usr/bin", c.join(home, ".antigravity", "bin"), c.join(home, ".antigravity-cli", "bin"), c.join(home, ".gemini", "antigravity-cli", "bin")];
  const nombre = esWindows(plataforma) ? "agy.exe" : "agy";
  for (const d of donde) if (existe(c.join(d, nombre))) return c.join(d, nombre);
  return r;
}
