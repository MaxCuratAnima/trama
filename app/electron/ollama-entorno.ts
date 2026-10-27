// Ajustes > Locales: qué hay en esta máquina para correr Ollama, sin instalar ni arrancar nada. Dice si el programa está, si hay
// servicio de systemd, qué distro es y qué GPU (y cuánta VRAM) tiene, y de ahí arma el comando que la persona copia y pega:
// instalar según distro y GPU, y arrancarlo. Sólo lee (`/etc/os-release`, `/sys/class/drm`, `nvidia-smi` por nombre y memoria,
// `systemctl list-unit-files`): no carga ningún modelo ni usa la GPU. Sin `electron`: lo prueba tests/ollama-entorno.test.ts con
// `Deps` falsos (nunca corre `nvidia-smi` ni `systemctl` de verdad).
import path from "node:path";
import { resolverBinario } from "./binario.ts";
import { depsDeVerdad, type Deps } from "./locales.ts";

export type Familia = "arch" | "debian" | "fedora" | "suse" | "otra";
export type Fabricante = "nvidia" | "amd" | "intel";
export type Gpu = { fabricante: Fabricante; nombre: string | null; vramMiB: number | null };

export type EntornoOllama = {
  version: 1;
  /** El programa `ollama` está en la máquina (no dice si anda: eso lo dice el sondeo a su puerto). */
  instalado: boolean;
  distro: { id: string; nombre: string; familia: Familia };
  /** La GPU que más sirve para modelos (NVIDIA > AMD > Intel); `null` si no se vio ninguna. */
  gpu: Gpu | null;
  /** Cómo se instala: `pacman` con el paquete que toca, o el instalador oficial (`script`). `comando` es lo que se copia. */
  instalar: { via: "pacman" | "script" | "winget"; comando: string };
  /** Cómo se arranca: como servicio de systemd, o a mano con `ollama serve`. */
  arrancar: { via: "systemd" | "serve"; comando: string };
};

// --- Puros ---

/** `ID` / `ID_LIKE` de `/etc/os-release` → la familia que decide el comando. */
export function familiaDe(osRelease: string): { id: string; nombre: string; familia: Familia } {
  const campos = new Map<string, string>();
  for (const l of osRelease.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
    if (m) campos.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  const id = (campos.get("ID") ?? "").toLowerCase();
  const nombre = campos.get("PRETTY_NAME") || campos.get("NAME") || id || "Linux";
  const parientes = `${id} ${(campos.get("ID_LIKE") ?? "").toLowerCase()}`.split(/\s+/);
  const es = (...xs: string[]) => xs.some((x) => parientes.includes(x));
  const familia: Familia = es("arch") ? "arch" : es("debian", "ubuntu") ? "debian" : es("fedora", "rhel", "centos") ? "fedora" : es("suse", "opensuse") ? "suse" : "otra";
  return { id, nombre, familia };
}

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

const FABRICANTE: Record<string, Fabricante> = { "0x10de": "nvidia", "0x1002": "amd", "0x8086": "intel" };
const PESO: Record<Fabricante, number> = { nvidia: 3, amd: 2, intel: 1 };

/** Cuál de las GPU vistas conviene mostrar: la discreta antes que la integrada, y a igual fabricante la de más memoria. */
export function mejorGpu(gpus: Gpu[]): Gpu | null {
  return [...gpus].sort((a, b) => PESO[b.fabricante] - PESO[a.fabricante] || (b.vramMiB ?? 0) - (a.vramMiB ?? 0))[0] ?? null;
}

export const SCRIPT_OFICIAL = "curl -fsSL https://ollama.com/install.sh | sh";

/** El comando para instalar Ollama: en Arch el paquete que toca según la GPU (`ollama-cuda`, `ollama-rocm`); en el resto, el instalador oficial. */
export function comandoInstalar(familia: Familia, gpu: Gpu | null): EntornoOllama["instalar"] {
  if (familia === "arch") {
    const paquete = gpu?.fabricante === "nvidia" ? "ollama-cuda" : gpu?.fabricante === "amd" ? "ollama-rocm" : "ollama";
    return { via: "pacman", comando: `sudo pacman -S ${paquete}` };
  }
  return { via: "script", comando: SCRIPT_OFICIAL };
}

export function comandoArrancar(servicio: boolean): EntornoOllama["arrancar"] {
  return servicio ? { via: "systemd", comando: "sudo systemctl enable --now ollama" } : { via: "serve", comando: "ollama serve" };
}

// --- Lectura ---

const existe = async (d: Deps, f: string) => (await d.tamano(f)) != null;

/** ¿Está `ollama`? `HILOS_OLLAMA` (las pruebas), el PATH, `~/.local/bin` y donde lo deja el instalador oficial. */
async function hayOllama(d: Deps, plataforma: NodeJS.Platform): Promise<boolean> {
  if (d.env.HILOS_OLLAMA !== undefined) return !!d.env.HILOS_OLLAMA && (await existe(d, d.env.HILOS_OLLAMA));
  const win = plataforma === "win32";
  // En Windows el instalador de Ollama lo deja en %LOCALAPPDATA%ProgramsOllama (y lo suma al PATH).
  const dirs = win
    ? [...(d.env.PATH ?? "").split(path.delimiter), path.join(d.env.LOCALAPPDATA || path.join(d.home, "AppData", "Local"), "Programs", "Ollama")].filter(Boolean)
    : [...(d.env.PATH ?? "").split(path.delimiter), path.join(d.home, ".local", "bin"), "/usr/local/bin", "/usr/bin", "/opt/ollama/bin"].filter(Boolean);
  for (const dir of dirs) if (await existe(d, path.join(dir, win ? "ollama.exe" : "ollama"))) return true;
  return false;
}

async function hayServicio(d: Deps): Promise<boolean> {
  // Sin systemd (WSL viejo, un contenedor) no hay servicio que prender: se arranca a mano.
  if (!(await existe(d, "/run/systemd/system"))) return false;
  try {
    return (await d.ejecutar("systemctl", ["list-unit-files", "ollama.service", "--no-legend"], { timeout: 4000 })).includes("ollama.service");
  } catch {
    return false;
  }
}

/** Las GPU del sistema por `/sys/class/drm` (sin tocarlas); la de NVIDIA, con nombre y memoria de `nvidia-smi`. */
async function leerGpus(d: Deps): Promise<Gpu[]> {
  const vistas: Gpu[] = [];
  let nvidia = false;
  for (let i = 0; i < 8; i++) {
    const base = `/sys/class/drm/card${i}/device`;
    const f = FABRICANTE[((await d.leer(`${base}/vendor`)) ?? "").trim().toLowerCase()];
    if (!f) continue;
    if (f === "nvidia") {
      nvidia = true;
      continue;
    }
    const bytes = Number(((await d.leer(`${base}/mem_info_vram_total`)) ?? "").trim());
    vistas.push({ fabricante: f, nombre: null, vramMiB: f === "amd" && bytes > 0 ? Math.round(bytes / 1048576) : null });
  }
  // WSL no tiene `/sys/class/drm` pero sí `nvidia-smi`: sin tarjeta vista, se le pregunta igual (es sólo leer nombre y memoria).
  if (nvidia || vistas.length === 0) {
    try {
      const n = parsearNvidia(await d.ejecutar(resolverBinario("nvidia-smi", "HILOS_NVIDIA_SMI", d.env, d.home), ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 5000 }));
      if (n) vistas.push({ fabricante: "nvidia", ...n });
      else if (nvidia) vistas.push({ fabricante: "nvidia", nombre: null, vramMiB: null });
    } catch {
      if (nvidia) vistas.push({ fabricante: "nvidia", nombre: null, vramMiB: null });
    }
  }
  return vistas;
}

export async function leerEntornoOllama(d: Deps = depsDeVerdad(), plataforma: NodeJS.Platform = process.platform): Promise<EntornoOllama> {
  // Windows: sin distro, systemd ni /sys; se instala con winget y se arranca a mano (o con la app de Ollama en la bandeja).
  if (plataforma === "win32") {
    const [instalado, gpus] = await Promise.all([hayOllama(d, plataforma), leerGpus(d)]);
    return {
      version: 1,
      instalado,
      distro: { id: "windows", nombre: "Windows", familia: "otra" },
      gpu: mejorGpu(gpus),
      instalar: { via: "winget", comando: "winget install --id Ollama.Ollama -e" },
      arrancar: comandoArrancar(false),
    };
  }
  const [osr, instalado, servicio, gpus] = await Promise.all([d.leer("/etc/os-release"), hayOllama(d, plataforma), hayServicio(d), leerGpus(d)]);
  const distro = familiaDe(osr ?? "");
  const gpu = mejorGpu(gpus);
  // Instalándolo, el paquete o el script dejan el servicio si hay systemd: se anticipa para decir cómo arrancarlo.
  const conSystemd = instalado ? servicio : await existe(d, "/run/systemd/system");
  return { version: 1, instalado, distro, gpu, instalar: comandoInstalar(distro.familia, gpu), arrancar: comandoArrancar(conSystemd) };
}
