// Ajustes > Locales: qué hay en esta máquina para correr Ollama, sin instalar ni arrancar nada. Dice si el programa está y qué GPU
// NVIDIA (y cuánta VRAM) tiene, y arma los comandos que la persona copia y pega: instalarlo con winget y arrancarlo. Sólo lee
// (`nvidia-smi` por nombre y memoria): no carga ningún modelo ni usa la GPU. Sin `electron`: lo prueba tests/ollama-entorno.test.ts
// con `Deps` falsos (nunca corre `nvidia-smi` de verdad).
import path from "node:path";
import { resolverBinario } from "./binario.ts";
import { depsDeVerdad, type Deps } from "./locales.ts";

export type Gpu = { nombre: string | null; vramMiB: number | null };

export type EntornoOllama = {
  version: 1;
  /** El programa `ollama` está en la máquina (no dice si anda: eso lo dice el sondeo a su puerto). */
  instalado: boolean;
  /** La GPU NVIDIA; `null` si `nvidia-smi` no contesta. */
  gpu: Gpu | null;
  /** Lo que se copia para instalarlo. */
  instalar: { comando: string };
  /** Lo que se copia para arrancarlo a mano (o con la app de Ollama en la bandeja). */
  arrancar: { comando: string };
};

// --- Puros ---

/** La salida de `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` (la primera GPU; memoria en MiB). */
export function parsearNvidia(salida: string): { nombre: string; vramMiB: number | null } | null {
  const l = salida.split("\n").find((x) => x.trim());
  if (!l) return null;
  const partes = l.split(",").map((x) => x.trim());
  const nombre = partes[0];
  if (!nombre) return null;
  const mib = Number(partes[1]);
  return { nombre, vramMiB: Number.isFinite(mib) && mib > 0 ? Math.round(mib) : null };
}

export const COMANDO_INSTALAR = "winget install --id Ollama.Ollama -e";
export const COMANDO_ARRANCAR = "ollama serve";

// --- Lectura ---

const existe = async (d: Deps, f: string) => (await d.tamano(f)) != null;

/** ¿Está `ollama`? `HILOS_OLLAMA` (las pruebas) o el PATH y donde lo deja el instalador de Windows (`%LOCALAPPDATA%\Programs\Ollama`). */
async function hayOllama(d: Deps): Promise<boolean> {
  if (d.env.HILOS_OLLAMA !== undefined) return !!d.env.HILOS_OLLAMA && (await existe(d, d.env.HILOS_OLLAMA));
  const dirs = [...(d.env.PATH ?? "").split(path.win32.delimiter), path.win32.join(d.env.LOCALAPPDATA || path.win32.join(d.home, "AppData", "Local"), "Programs", "Ollama")].filter(Boolean);
  for (const dir of dirs) if (await existe(d, path.win32.join(dir, "ollama.exe"))) return true;
  return false;
}

async function leerGpu(d: Deps): Promise<Gpu | null> {
  try {
    return parsearNvidia(await d.ejecutar(resolverBinario("nvidia-smi", "HILOS_NVIDIA_SMI", d.env, d.home), ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 5000 }));
  } catch {
    return null;
  }
}

export async function leerEntornoOllama(d: Deps = depsDeVerdad()): Promise<EntornoOllama> {
  const [instalado, gpu] = await Promise.all([hayOllama(d), leerGpu(d)]);
  return { version: 1, instalado, gpu, instalar: { comando: COMANDO_INSTALAR }, arrancar: { comando: COMANDO_ARRANCAR } };
}
