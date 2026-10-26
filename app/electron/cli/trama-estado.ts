// trama-estado — qué hay instalado y andando para Trama: claude, agy, Ollama y el motor (port de motor/bin/trama-estado).
//
//   trama-estado --json    una línea de JSON (contrato abajo); sale 0 siempre que pueda imprimir
//   trama-estado           lo mismo en palabras
//
// {"version":1,
//  "claude":{"instalado":bool,"logueado":bool},
//  "agy":{"instalado":bool,"logueado":bool},
//  "ollama":{"url":str,"responde":bool,"modelos":[str]},
//  "motor":{"vivo":bool,"url":str}}   (+ "proceso":bool, extra: el proceso existe aunque no atienda HTTP)
//
// Nunca falla por algo que no encuentra: lo que falta sale en false. La salida --json es byte a byte la del script de Python
// (separadores ", " y ": ", sin escapar acentos). Entorno (para probar): TRAMA_CLAUDE / TRAMA_AGY (otro nombre del binario),
// TRAMA_MODELOS (otro modelos.json), TRAMA_PUERTO (puerto del motor, default 8791), OLLAMA_HOST (si modelos.json no dice).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buscarEjecutable, caminos, carpetasPath, dirBinLocal, dirClaudeConfig, dirEstadoApp, esEjecutable, esWindows, rutaModelos, type Env, type Plataforma } from "../plataforma.ts";
import { comandoEjecutable } from "../procesos.ts";

export type Entorno = { plataforma: Plataforma; env: Env; home: string };
export type Estado = {
  version: number;
  claude: { instalado: boolean; logueado: boolean };
  agy: { instalado: boolean; logueado: boolean };
  ollama: { url: string; responde: boolean; modelos: string[] };
  motor: { vivo: boolean; url: string; proceso: boolean };
};

const aqui = (): Entorno => ({ plataforma: process.platform, env: process.env as Env, home: os.homedir() });

function salida(cmd: string[], plataforma: Plataforma, env: Env, espera = 10000): { rc: number; out: string } {
  try {
    // un .cmd (claude instalado por npm) no se lanza directo: va por cmd.exe
    const c = comandoEjecutable(cmd[0], cmd.slice(1), plataforma, env as NodeJS.ProcessEnv);
    const r = spawnSync(c.file, c.args, { encoding: "utf-8", timeout: espera, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...c.opciones });
    if (r.error || r.status === null) return { rc: 1, out: "" };
    return { rc: r.status, out: r.stdout ?? "" };
  } catch {
    return { rc: 1, out: "" };
  }
}

/** Como `shutil.which`, más `~/.local/bin` (un PATH pelado —systemd, wsl.exe— no lo trae). */
export function enPath(nombre: string, { plataforma, env, home }: Entorno, extra: string[] = []): string | null {
  if (/[\\/]/.test(nombre)) return esEjecutable(nombre, plataforma) ? nombre : null;
  const dirs = [...carpetasPath(plataforma, env), dirBinLocal(plataforma, home), ...extra];
  return buscarEjecutable(plataforma, env, nombre, dirs, (f) => esEjecutable(f, plataforma));
}

export function claude(e: Entorno = aqui()): Estado["claude"] {
  const ruta = enPath(e.env.TRAMA_CLAUDE || "claude", e);
  if (!ruta) return { instalado: false, logueado: false };
  const { rc, out } = salida([ruta, "auth", "status"], e.plataforma, e.env);
  let logueado = false;
  if (rc === 0) {
    try {
      logueado = !!JSON.parse(out).loggedIn;
    } catch {
      // claude viejo sin `auth status`: queda el archivo de credenciales.
      const dir = e.env.CLAUDE_CONFIG_DIR || dirClaudeConfig(e.plataforma, e.home);
      logueado = existsSync(caminos(e.plataforma).join(dir, ".credentials.json"));
    }
  }
  return { instalado: true, logueado };
}

/** `agy models`: una línea por modelo, "id<TAB>nombre". Sin sesión no hay ninguna. */
const MODELO_AGY = /^[a-z0-9][a-z0-9.-]*\t/;

/** Dónde cae agy si no está en el PATH: `/usr/local/bin` (en Windows no hay) y la carpeta bin de `~/.antigravity*` del instalador. */
export function dirsAgy({ plataforma, home }: Entorno): string[] {
  const c = caminos(plataforma);
  let propios: string[] = [];
  try {
    propios = readdirSync(home).filter((n) => n.startsWith(".antigravity")).sort().map((n) => c.join(home, n, "bin"));
  } catch {
    // sin home legible
  }
  return [...(esWindows(plataforma) ? [] : ["/usr/local/bin"]), ...propios];
}

export function agy(e: Entorno = aqui()): Estado["agy"] {
  const ruta = enPath(e.env.TRAMA_AGY || "agy", e, dirsAgy(e));
  if (!ruta) return { instalado: false, logueado: false };
  // agy guarda el login de Google en el llavero del sistema (no hay archivo que mirar): con sesión lista modelos.
  // Colgado: salida() corta a los 15 s y devuelve "" (queda en false).
  const { out } = salida([ruta, "models"], e.plataforma, e.env, 15000);
  return { instalado: true, logueado: out.split("\n").some((l) => MODELO_AGY.test(l)) };
}

function modelosJson(e: Entorno): Record<string, unknown> {
  try {
    const j = JSON.parse(readFileSync(rutaModelos(e.plataforma, { ...e.env, HILOS_MODELOS: undefined }, e.home), "utf-8"));
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** GET; devuelve el código HTTP o `null` si no hay nadie. Un 4xx/5xx también es "responde". */
async function pedir(url: string, espera = 3000): Promise<{ codigo: number | null; cuerpo: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(espera) });
    const cuerpo = r.status === 200 ? (await r.text()).slice(0, 1 << 20) : "";
    return { codigo: r.status, cuerpo };
  } catch {
    return { codigo: null, cuerpo: "" };
  }
}

export async function ollama(e: Entorno = aqui()): Promise<Estado["ollama"]> {
  let url = "";
  const locales = modelosJson(e).locales;
  for (const l of Array.isArray(locales) ? locales : []) {
    if (l && typeof l === "object" && typeof (l as { url?: unknown }).url === "string" && (l as { url: string }).url) {
      url = (l as { url: string }).url;
      break;
    }
  }
  if (!url) {
    url = e.env.OLLAMA_HOST || "http://localhost:11434";
    if (!url.includes("://")) url = "http://" + url;
  }
  url = url.replace(/\/+$/, "");
  const { codigo, cuerpo } = await pedir(url + "/api/tags");
  let modelos: string[] = [];
  if (codigo === 200) {
    try {
      const ms = JSON.parse(cuerpo).models;
      modelos = (Array.isArray(ms) ? ms : []).filter((m) => m && typeof m === "object" && m.name).map((m) => m.name);
    } catch {
      // sin lista: queda vacía
    }
  }
  return { url, responde: codigo === 200, modelos };
}

export async function motor(e: Entorno = aqui()): Promise<Estado["motor"]> {
  const url = `http://127.0.0.1:${e.env.TRAMA_PUERTO || "8791"}`;
  const { codigo } = await pedir(url + "/");
  // `proceso`: el motor (su `dueno` en el estado de la app) está vivo aunque no atienda HTTP todavía.
  let proceso = false;
  try {
    const dueno = caminos(e.plataforma).join(dirEstadoApp(e.plataforma, e.env, e.home), "dueno");
    process.kill(Number(JSON.parse(readFileSync(dueno, "utf-8")).pid), 0);
    proceso = true;
  } catch {
    // sin dueño, o muerto
  }
  return { vivo: codigo !== null, url, proceso };
}

export async function estado(e: Entorno = aqui()): Promise<Estado> {
  return { version: 1, claude: claude(e), agy: agy(e), ollama: await ollama(e), motor: await motor(e) };
}

/** `json.dumps(x, ensure_ascii=False)` de Python: `{"a": 1, "b": [1, 2]}`. */
export function jsonPython(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(jsonPython).join(", ") + "]";
  if (v && typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${jsonPython(x)}`).join(", ") + "}";
  return JSON.stringify(v);
}

export function enPalabras(est: Estado): string {
  const si = (b: boolean) => (b ? "sí" : "no");
  const o = est.ollama;
  return [
    `claude   instalado: ${si(est.claude.instalado)} · sesión: ${si(est.claude.logueado)}`,
    `agy      instalado: ${si(est.agy.instalado)} · sesión: ${si(est.agy.logueado)}`,
    `ollama   ${o.url} · responde: ${si(o.responde)} · modelos: ${o.modelos.join(", ") || "ninguno"}`,
    `motor    ${est.motor.url} · vivo: ${si(est.motor.vivo)}`,
  ].join("\n") + "\n";
}

async function main() {
  try {
    const est = await estado();
    process.stdout.write(process.argv.slice(2).includes("--json") ? jsonPython(est) + "\n" : enPalabras(est));
  } catch (e) {
    // el contrato: sale 0 siempre que pueda imprimir
    const vacio = { version: 1, claude: { instalado: false, logueado: false }, agy: { instalado: false, logueado: false }, ollama: { url: "", responde: false, modelos: [] }, motor: { vivo: false, url: "" }, error: String(e) };
    process.stdout.write(jsonPython(vacio) + "\n");
  }
  process.exitCode = 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
