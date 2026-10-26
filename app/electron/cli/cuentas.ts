// cuentas — varias cuentas por proveedor (Claude, Google/agy, ChatGPT/codex). Lo llaman `pa` (`cuentas env <id> --json`) y la app
// (electron/cuentas-varias.ts: `--json [--verificar]`, `agregar`, `renombrar`, `quitar`, `login`). Único dueño de cuentas.json.
//
//   cuentas [lista] [--json] [--verificar]       las cuentas (`--verificar`: le pregunta el login a cada CLI)
//   cuentas agregar <proveedor> <nombre>         crea la cuenta y su carpeta; la última línea de stdout es el id
//   cuentas renombrar <id> <nombre>
//   cuentas quitar <id> [--borrar-credenciales]  la de siempre no se quita
//   cuentas login <id>                           corre el login del CLI de esa cuenta en esta terminal (la app ya lo abre en una)
//   cuentas env <id> [--json]                    {id, proveedor, sacar: [...], poner: {...}}: el entorno con el que pa corre esa cuenta
//
// La cuenta de siempre de cada proveedor tiene el id del proveedor (claude, google, chatgpt), vive donde la dejó el CLI (~/.claude,
// ~) y NO se guarda ni se toca: sin cuentas.json todo anda como antes. Las agregadas viven en <config de Trama>/cuentas/<id>:
// Claude con CLAUDE_CONFIG_DIR, agy con HOME, codex con CODEX_HOME. Salida 0 bien, 1 error de ejecución, 2 uso o cuenta que no va.
// Ejecutable con node (sin compilar): node electron/cli/cuentas.ts <comando> …
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { resolverAgy, resolverBinario } from "../binario.ts";
import { correrReal, sondearAgy, sondearClaude, sondearCodex, type Cuenta } from "../cuentas.ts";
import { comandoEjecutable } from "../procesos.ts";
import { caminos, dirConfigTrama, esWindows, pathConLocal, type Env, type Plataforma } from "../plataforma.ts";
import { conCandado } from "./candado.ts";

export type Proveedor = "claude" | "google" | "chatgpt";
export const PROVEEDORES: readonly Proveedor[] = ["claude", "google", "chatgpt"];
const MOTOR: Record<Proveedor, string> = { claude: "claude", google: "agy", chatgpt: "codex" };
const NOMBRE: Record<Proveedor, string> = { claude: "Claude", google: "Gemini", chatgpt: "ChatGPT" };
// Lo que pisaría las credenciales de la carpeta de la cuenta: pa lo saca del entorno del worker (nunca ANTHROPIC_API_KEY).
const SACAR: Record<Proveedor, string[]> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  chatgpt: ["OPENAI_API_KEY"],
};
const ID_VALIDO = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LARGO_NOMBRE = 60;

/** Una cuenta agregada, tal como queda en cuentas.json. */
export type Guardada = { id: string; proveedor: Proveedor; nombre: string; dir: string };
/** Una cuenta tal como la lista `--json`. `logueado`: `null` = no se preguntó. */
export type Perfil = { id: string; proveedor: Proveedor; motor: string; nombre: string; dir: string; defecto: boolean; logueado: boolean | null };

export type Deps = {
  plataforma: Plataforma;
  env: Env;
  home: string;
  /** ¿Hay sesión en esa cuenta? Pregunta al CLI con el entorno de la cuenta; `null` si no se pudo saber. */
  verificar: (p: Perfil) => Promise<boolean | null>;
  /** Corre el login interactivo (hereda la terminal) y devuelve su código de salida. */
  login: (bin: string, args: string[], env: Env) => number;
};

class ErrorUso extends Error {
  rc: number;
  constructor(msg: string, rc = 2) {
    super(msg);
    this.rc = rc;
  }
}

// ---- dónde vive todo ----

/** cuentas.json: `TRAMA_CUENTAS`; si no, `TRAMA_CUENTAS_HOME/.config/trama` (como `pa`) o la config de Trama (`~/.config/trama` · `%APPDATA%\Trama`). */
export function rutaCuentas(p: Plataforma, env: Env, home: string): string {
  if (env.TRAMA_CUENTAS) return env.TRAMA_CUENTAS;
  const j = caminos(p);
  if (env.TRAMA_CUENTAS_HOME) return j.join(env.TRAMA_CUENTAS_HOME, ".config", "trama", "cuentas.json");
  return j.join(dirConfigTrama(p, env, home), "cuentas.json");
}

const dirCuentas = (p: Plataforma, ruta: string) => caminos(p).join(caminos(p).dirname(ruta), "cuentas");

/** Dónde dejó el CLI la sesión de la cuenta de siempre (no se toca). */
function dirDeSiempre(p: Plataforma, home: string, prov: Proveedor): string {
  return prov === "claude" ? caminos(p).join(home, ".claude") : prov === "chatgpt" ? caminos(p).join(home, ".codex") : home;
}

export const idValido = (x: unknown): x is string => typeof x === "string" && ID_VALIDO.test(x);
const esProveedor = (x: unknown): x is Proveedor => typeof x === "string" && (PROVEEDORES as readonly string[]).includes(x);

/** El nombre que se escribe: sin espacios de más, 1 a 60 caracteres, sin controles. `null`: no vale. */
export function nombreValido(x: unknown): string | null {
  if (typeof x !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const n = x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return n && n.length <= LARGO_NOMBRE ? n : null;
}

/** «Trabajo 2» -> `trabajo-2`; sin letras ni números queda vacío. */
export function idDeNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|[-._]+$/g, "").slice(0, 60);
}

// ---- cuentas.json ----

type Archivo = { version: 1; cuentas: Guardada[] };

function leer(ruta: string): Archivo {
  let txt: string;
  try {
    txt = readFileSync(ruta, "utf8");
  } catch {
    return { version: 1, cuentas: [] };
  }
  let raw: { cuentas?: unknown };
  try {
    raw = JSON.parse(txt);
  } catch {
    throw new ErrorUso(`${ruta} no es JSON; lo arreglo a mano o lo borro (no lo piso)`, 1);
  }
  const cuentas: Guardada[] = [];
  for (const c of Array.isArray(raw?.cuentas) ? raw.cuentas : []) {
    const x = (c ?? {}) as Record<string, unknown>;
    if (!idValido(x.id) || !esProveedor(x.proveedor) || x.id === x.proveedor) continue;
    cuentas.push({ id: x.id, proveedor: x.proveedor, nombre: nombreValido(x.nombre) ?? x.id, dir: typeof x.dir === "string" ? x.dir : "" });
  }
  return { version: 1, cuentas };
}

function escribir(ruta: string, a: Archivo): void {
  mkdirSync(caminos(process.platform).dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n");
  renameSync(tmp, ruta);
}

/** Lee, deja que `cambiar` toque la lista y guarda, todo con el candado de cuentas.json. */
const modificar = <T>(ruta: string, cambiar: (a: Archivo) => T): Promise<T> => {
  mkdirSync(caminos(process.platform).dirname(ruta), { recursive: true });
  return conCandado(`${ruta}.lock`, async () => {
    const a = leer(ruta);
    const r = cambiar(a);
    escribir(ruta, a);
    return r;
  });
};

// ---- las cuentas ----

function perfiles(d: Deps, a: Archivo): Perfil[] {
  const lista: Perfil[] = [];
  for (const prov of PROVEEDORES) {
    // ChatGPT (codex) es opcional: sólo aparece si está instalado su carpeta o hay cuentas agregadas de él.
    const dir = dirDeSiempre(d.plataforma, d.home, prov);
    if (prov === "chatgpt" && !existsSync(dir) && !a.cuentas.some((c) => c.proveedor === prov)) continue;
    lista.push({ id: prov, proveedor: prov, motor: MOTOR[prov], nombre: NOMBRE[prov], dir, defecto: true, logueado: null });
    for (const c of a.cuentas.filter((x) => x.proveedor === prov)) {
      lista.push({ id: c.id, proveedor: prov, motor: MOTOR[prov], nombre: c.nombre, dir: c.dir || caminos(d.plataforma).join(dirCuentas(d.plataforma, rutaCuentas(d.plataforma, d.env, d.home)), c.id), defecto: false, logueado: null });
    }
  }
  return lista;
}

function buscar(d: Deps, a: Archivo, id: string): Perfil {
  const p = perfiles(d, a).find((x) => x.id === id);
  if (!p) throw new ErrorUso(`no existe la cuenta '${id}'`);
  return p;
}

/** El entorno con el que corre el CLI de esa cuenta: lo que se saca y lo que se pone (la de siempre no toca nada). */
export function entornoDe(p: Plataforma, c: Perfil): { sacar: string[]; poner: Record<string, string> } {
  if (c.defecto) return { sacar: [], poner: {} };
  const sacar = [...SACAR[c.proveedor]];
  if (c.proveedor === "claude") return { sacar, poner: { CLAUDE_CONFIG_DIR: c.dir } };
  if (c.proveedor === "chatgpt") return { sacar, poner: { CODEX_HOME: c.dir } };
  return { sacar, poner: esWindows(p) ? { HOME: c.dir, USERPROFILE: c.dir } : { HOME: c.dir } };
}

/** El entorno completo de esa cuenta, para correr su CLI (verificar, login). */
function entornoCompleto(p: Plataforma, env: Env, c: Perfil): Env {
  const e = entornoDe(p, c);
  const r: Env = { ...env, ...e.poner };
  for (const k of e.sacar) delete r[k];
  return r;
}

const CLI_DE: Record<Proveedor, (d: { env: Env; home: string; correr: typeof correrReal }) => Promise<Cuenta>> = {
  claude: sondearClaude,
  google: sondearAgy,
  chatgpt: sondearCodex,
};

/** ¿Hay sesión en esa cuenta? Le pregunta al CLI con el entorno de la cuenta; `null` si no se pudo saber. */
export const verificarReal = (plataforma: Plataforma, env: Env, home: string) => async (c: Perfil): Promise<boolean | null> => {
  const r = await CLI_DE[c.proveedor]({ env: entornoCompleto(plataforma, env, c), home, correr: correrReal });
  return r.error || !r.instalado ? null : r.logueado;
};

// ---- comandos ----

type Opciones = { json: boolean; verificar: boolean; borrar: boolean; resto: string[] };

function opciones(args: string[]): Opciones {
  const o: Opciones = { json: false, verificar: false, borrar: false, resto: [] };
  for (const a of args) {
    if (a === "--json") o.json = true;
    else if (a === "--verificar") o.verificar = true;
    else if (a === "--borrar-credenciales") o.borrar = true;
    else if (a.startsWith("--")) throw new ErrorUso(`opción desconocida: ${a}`);
    else o.resto.push(a);
  }
  return o;
}

async function cmdLista(d: Deps, o: Opciones): Promise<string> {
  const lista = perfiles(d, leer(rutaCuentas(d.plataforma, d.env, d.home)));
  if (o.verificar) await Promise.all(lista.map(async (c) => void (c.logueado = await d.verificar(c).catch(() => null))));
  if (o.json) return JSON.stringify({ version: 1, cuentas: lista }) + "\n";
  return lista.map((c) => `${c.id}\t${c.proveedor}\t${c.nombre}${c.defecto ? " (de siempre)" : ""}\t${c.logueado === null ? "?" : c.logueado ? "con sesión" : "sin sesión"}\t${c.dir}`).join("\n") + "\n";
}

async function cmdAgregar(d: Deps, o: Opciones): Promise<{ out: string; err: string }> {
  const [prov, ...nom] = o.resto;
  const nombre = nombreValido(nom.join(" "));
  if (!esProveedor(prov) || !nombre) throw new ErrorUso("uso: cuentas agregar <claude|google|chatgpt> <nombre> (nombre de 1 a 60 caracteres)");
  const ruta = rutaCuentas(d.plataforma, d.env, d.home);
  const id = await modificar(ruta, (a) => {
    const base = idDeNombre(nombre) || prov;
    const ocupado = (x: string) => (PROVEEDORES as readonly string[]).includes(x) || a.cuentas.some((c) => c.id === x);
    let id = base;
    for (let n = 2; ocupado(id); n++) id = `${base.slice(0, 60)}-${n}`;
    const dir = caminos(d.plataforma).join(dirCuentas(d.plataforma, ruta), id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    a.cuentas.push({ id, proveedor: prov, nombre, dir });
    return id;
  });
  return { out: `${id}\n`, err: `cuentas: creé '${id}'; falta el login (cuentas login ${id})\n` };
}

async function cmdRenombrar(d: Deps, o: Opciones): Promise<string> {
  const [id, ...nom] = o.resto;
  const nombre = nombreValido(nom.join(" "));
  if (!idValido(id) || !nombre) throw new ErrorUso("uso: cuentas renombrar <id> <nombre>");
  await modificar(rutaCuentas(d.plataforma, d.env, d.home), (a) => {
    const c = buscar(d, a, id);
    if (c.defecto) throw new ErrorUso(`'${id}' es la cuenta de siempre: no se renombra`);
    a.cuentas.find((x) => x.id === id)!.nombre = nombre;
  });
  return "";
}

async function cmdQuitar(d: Deps, o: Opciones): Promise<string> {
  const [id] = o.resto;
  if (!idValido(id) || o.resto.length !== 1) throw new ErrorUso("uso: cuentas quitar <id> [--borrar-credenciales]");
  const ruta = rutaCuentas(d.plataforma, d.env, d.home);
  const dir = await modificar(ruta, (a) => {
    const c = buscar(d, a, id);
    if (c.defecto) throw new ErrorUso(`'${id}' es la cuenta de siempre: no se quita`);
    a.cuentas = a.cuentas.filter((x) => x.id !== id);
    return c.dir;
  });
  // Sólo se borra lo que está adentro de la carpeta de cuentas (nunca una ruta a mano del json, ni ~/.claude).
  const j = caminos(d.plataforma);
  const raiz = dirCuentas(d.plataforma, ruta);
  if (o.borrar && j.relative(raiz, dir) && !j.relative(raiz, dir).startsWith("..") && !j.isAbsolute(j.relative(raiz, dir))) rmSync(dir, { recursive: true, force: true });
  return "";
}

function cmdLogin(d: Deps, o: Opciones): number {
  const [id] = o.resto;
  if (!idValido(id) || o.resto.length !== 1) throw new ErrorUso("uso: cuentas login <id>");
  const c = buscar(d, leer(rutaCuentas(d.plataforma, d.env, d.home)), id);
  const env = entornoCompleto(d.plataforma, d.env, c);
  if (!c.defecto) mkdirSync(c.dir, { recursive: true, mode: 0o700 });
  const bin = c.proveedor === "claude" ? resolverBinario("claude", "HILOS_CLAUDE", d.env, d.home, undefined, d.plataforma)
    : c.proveedor === "google" ? resolverAgy(d.env, d.home, undefined, d.plataforma)
    : resolverBinario("codex", "HILOS_CODEX", d.env, d.home, undefined, d.plataforma);
  // claude: `claude auth login`; codex: `codex login`; agy no tiene subcomando: sin sesión, al abrirlo pide el login.
  const args = c.proveedor === "claude" ? ["auth", "login"] : c.proveedor === "chatgpt" ? ["login"] : [];
  env[Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"] = pathConLocal(d.plataforma, d.env, d.home);
  return d.login(bin, args, env);
}

function cmdEnv(d: Deps, o: Opciones): string {
  const [id] = o.resto;
  if (!idValido(id) || o.resto.length !== 1) throw new ErrorUso("uso: cuentas env <id> [--json]");
  const c = buscar(d, leer(rutaCuentas(d.plataforma, d.env, d.home)), id);
  const e = entornoDe(d.plataforma, c);
  if (o.json) return JSON.stringify({ id: c.id, proveedor: c.proveedor, sacar: e.sacar, poner: e.poner }) + "\n";
  return [...e.sacar.map((k) => `unset ${k}`), ...Object.entries(e.poner).map(([k, v]) => `${k}=${v}`)].map((l) => l + "\n").join("");
}

/** Corre un comando y devuelve lo que sale por stdout/stderr y el código; no escribe ni sale. */
export async function ejecutar(argv: string[], d: Deps): Promise<{ rc: number; out: string; err: string }> {
  try {
    let [cmd, ...resto] = argv;
    if (!cmd || cmd.startsWith("--")) {
      resto = cmd ? [cmd, ...resto] : resto;
      cmd = "lista";
    }
    const o = opciones(resto);
    switch (cmd) {
      case "lista":
      case "listar":
        return { rc: 0, out: await cmdLista(d, o), err: "" };
      case "agregar": {
        const r = await cmdAgregar(d, o);
        return { rc: 0, ...r };
      }
      case "renombrar":
        return { rc: 0, out: await cmdRenombrar(d, o), err: "" };
      case "quitar":
        return { rc: 0, out: await cmdQuitar(d, o), err: "" };
      case "login":
        return { rc: cmdLogin(d, o), out: "", err: "" };
      case "env":
        return { rc: 0, out: cmdEnv(d, o), err: "" };
      default:
        throw new ErrorUso(`comando desconocido: ${cmd} (lista, agregar, renombrar, quitar, login, env)`);
    }
  } catch (e) {
    if (e instanceof ErrorUso) return { rc: e.rc, out: "", err: `cuentas: ${e.message}\n` };
    return { rc: 1, out: "", err: `cuentas: ${(e as Error).message}\n` };
  }
}

/** Login interactivo: hereda la terminal; un `.cmd` de Windows (claude.cmd) va por cmd.exe (`comandoEjecutable`). */
const loginReal: Deps["login"] = (bin, args, env) => {
  const c = comandoEjecutable(bin, args);
  const r = spawnSync(c.file, c.args, { env: env as NodeJS.ProcessEnv, stdio: "inherit", ...c.opciones });
  if (r.error) {
    process.stderr.write(`cuentas: no pude correr ${bin}: ${r.error.message}\n`);
    return 1;
  }
  return r.status ?? 1;
};

export const depsReales = (env: Env = process.env, home = os.homedir(), plataforma: Plataforma = process.platform): Deps => ({
  plataforma, env, home, verificar: verificarReal(plataforma, env, home), login: loginReal,
});

export async function main(argv: string[]): Promise<number> {
  const r = await ejecutar(argv, depsReales());
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  return r.rc;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (rc) => void (process.exitCode = rc),
    (e: Error) => {
      process.stderr.write(`cuentas: ${e.message}\n`);
      process.exitCode = 1;
    },
  );
}
