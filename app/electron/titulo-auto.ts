// El título de un líder que no tiene uno propio: un resumen del tema en pocas palabras, en vez del primer mensaje entero.
// Lo genera Haiku una sola vez por líder (`claude -p`, sin sesión guardada, unos 100 tokens) y queda en `titulos-auto.json`;
// mientras llega (o si falla) la barra muestra el primer mensaje recortado.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverBinario } from "./binario.js";
import { silencio } from "./log.js";
import { ESTADO, escribirAtomico } from "./pa.js";
import { spawnCmd } from "./procesos.js";
import { limpiarTitulo } from "./tema.js";

const ARCHIVO = path.join(ESTADO, "titulos-auto.json");
const VERSION = 1;
const MODELO = "claude-haiku-5-5";
const ESPERA_MS = 60_000;
const MAX_A_LA_VEZ = 2;
/** Un mensaje más corto que esto ya es un buen título tal cual. */
const LARGO_MIN = 48;

const PEDIDO =
  "Resumí el tema de este mensaje en 2 a 5 palabras (máximo 40 caracteres) para usarlo de título de chat: un tema, no una frase ni una orden. Ejemplos: \"Bugs de la app Trama\", \"Retexturizar el buzo de Max\", \"Cupos de Gemini\". Sin comillas, sin punto final, en el mismo idioma del mensaje. Respondé solo el título.\n\nMensaje:\n";

let cache: Map<string, string> | null = null;
const intentados = new Set<string>();
let corriendo = 0;

function cargar(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();
  try {
    const j = JSON.parse(readFileSync(ARCHIVO, "utf8"));
    if (j?.version === VERSION && j.titulos && typeof j.titulos === "object") {
      for (const [k, v] of Object.entries(j.titulos)) if (typeof v === "string" && v) cache.set(k, v);
    }
  } catch {
    // sin archivo todavía
  }
  return cache;
}

function generar(sid: string, primero: string): void {
  corriendo++;
  let salida = "";
  let hecho = false;
  const fin = (titulo: string) => {
    if (hecho) return;
    hecho = true;
    clearTimeout(t);
    corriendo--;
    if (!titulo) return;
    const c = cargar();
    c.set(sid, titulo);
    escribirAtomico(ARCHIVO, JSON.stringify({ version: VERSION, titulos: Object.fromEntries(c) })).catch(silencio("titulo-auto"));
  };
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE;
  let p: ReturnType<typeof spawnCmd>;
  const t = setTimeout(() => {
    try {
      p.kill("SIGTERM");
    } catch {
      /* ya terminó */
    }
    fin("");
  }, ESPERA_MS);
  try {
    // El mensaje va por stdin: en Windows un argumento con saltos de línea o comillas se rompe al pasar por cmd.exe.
    p = spawnCmd(
      resolverBinario("claude", "HILOS_CLAUDE", process.env, os.homedir()),
      ["-p", "--model", MODELO, "--effort", "low", "--no-session-persistence", "--tools", "", "--strict-mcp-config"],
      { env, cwd: os.tmpdir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
  } catch {
    return fin("");
  }
  p.stdout?.on("data", (d) => (salida += String(d)));
  p.on("error", () => fin(""));
  p.on("close", (codigo) => fin(codigo === 0 ? limpiarTitulo(salida) : ""));
  p.stdin?.on("error", () => {});
  p.stdin?.end(PEDIDO + primero.slice(0, 600));
}

/**
 * El resumen de este líder si ya está; si no, lo pide (una vez por líder, de a pocos) y devuelve `null` por ahora: la
 * barra se relee sola y lo toma cuando llegue. Un mensaje corto no se resume.
 */
export function tituloAuto(sid: string, primero: string): string | null {
  if (primero.length <= LARGO_MIN) return null;
  const hecho = cargar().get(sid);
  if (hecho) return hecho;
  if (!intentados.has(sid) && corriendo < MAX_A_LA_VEZ) {
    intentados.add(sid);
    generar(sid, primero);
  }
  return null;
}
