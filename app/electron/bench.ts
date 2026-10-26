// Modo bench (slices B0/B0b): con `HILOS_BENCH=<archivo.json>` la UI corre un
// guion fijo (animación → reposo), le pasa los números al main y éste los
// completa con lo que sólo se ve desde afuera del renderer (CPU y RAM de todos
// los procesos de Electron, estado de la GPU, qué dice Hyprland de la ventana)
// y cierra la app.
import { app, ipcMain } from "electron";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** Corte duro: pase lo que pase en el JS, la ventana no vive más que esto. */
const CORTE_MS = 18_000;

/** Ticks por segundo de `/proc/<pid>/stat` (100 en cualquier Linux x86_64 de escritorio). */
const CLK_TCK = 100;

const destino = () => process.env.HILOS_BENCH || null;

/** Epoch (ms) del exec de este proceso: `starttime` de /proc/self/stat + `btime`. Resolución 10 ms. */
function inicioProceso(): number {
  // Sin /proc (Windows): el arranque se saca de cuánto lleva vivo.
  if (process.platform === "win32") return Date.now() - process.uptime() * 1000;
  const btime = Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))![1]);
  const stat = readFileSync("/proc/self/stat", "utf8");
  const campos = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  // Después de "(comm) ": [0]=state … [19]=starttime.
  return btime * 1000 + (Number(campos[19]) * 1000) / CLK_TCK;
}

const INICIO = inicioProceso();
const msDesdeInicio = () => Date.now() - INICIO;

type Proc = { pid: number; ppid: number; comm: string; ticks: number };

function leerStat(pid: number): Proc | null {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const comm = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    const c = s.slice(s.lastIndexOf(")") + 2).split(" ");
    // [1]=ppid [11]=utime [12]=stime.
    return { pid, ppid: Number(c[1]), comm, ticks: Number(c[11]) + Number(c[12]) };
  } catch {
    return null;
  }
}

/** `--type=renderer|gpu-process|zygote|utility…`; el comm de todos es "electron". */
function tipo(pid: number): string {
  try {
    // Chromium reescribe el argv de los hijos separado por espacios, no por \0.
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/);
    const t = cmd.find((a) => a.startsWith("--type="))?.slice(7) ?? "browser";
    const sub = cmd.find((a) => a.startsWith("--utility-sub-type="))?.slice(19);
    return sub ? `${t}:${sub.split(".").pop()}` : t;
  } catch {
    return "?";
  }
}

/** PSS y RSS en kB. PSS puede no ser legible (procesos sandboxeados no-dumpable). */
function memoria(pid: number): { pss_kb: number | null; rss_kb: number | null } {
  let pss: number | null = null;
  let rss: number | null = null;
  try {
    const r = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    pss = Number(/^Pss:\s+(\d+)/m.exec(r)?.[1] ?? NaN);
    rss = Number(/^Rss:\s+(\d+)/m.exec(r)?.[1] ?? NaN);
  } catch {}
  if (rss === null) {
    try {
      rss = (Number(readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1]) * 4096) / 1024;
    } catch {}
  }
  return { pss_kb: pss, rss_kb: rss };
}

/** Este proceso y todos sus descendientes (GPU, zygote, renderers, utility). */
function familia(): Proc[] {
  if (process.platform === "win32") return [];
  const todos = readdirSync("/proc")
    .filter((n) => /^\d+$/.test(n))
    .map((n) => leerStat(Number(n)))
    .filter((p): p is Proc => p !== null);
  const hijos = new Map<number, number[]>();
  for (const p of todos) hijos.set(p.ppid, [...(hijos.get(p.ppid) ?? []), p.pid]);
  const fam = [process.pid];
  for (let i = 0; i < fam.length; i++) fam.push(...(hijos.get(fam[i]) ?? []));
  return todos.filter((p) => fam.includes(p.pid));
}

function cpu() {
  const procesos = familia().map((p) => ({ ...p, tipo: tipo(p.pid), ...memoria(p.pid) }));
  return { ms: msDesdeInicio(), clk_tck: CLK_TCK, procesos };
}

function hyprctl(...args: string[]): any {
  try {
    return JSON.parse(execFileSync("hyprctl", args, { encoding: "utf8", windowsHide: true }));
  } catch {
    return null;
  }
}

/** Lo que dice el compositor de esta ventana: `xwayland: false` prueba Wayland nativo. */
function vistaHyprland() {
  const cliente = (hyprctl("clients", "-j") ?? []).find((c: any) => c.pid === process.pid) ?? {};
  const monitor = (hyprctl("monitors", "-j") ?? []).find((m: any) => m.id === cliente.monitor) ?? {};
  return {
    class: cliente.class,
    xwayland: cliente.xwayland,
    floating: cliente.floating,
    size: cliente.size,
    monitor: monitor.name,
    refresh_hz: monitor.refreshRate,
  };
}

function entorno() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => /^(HILOS_|ELECTRON_|__NV|GDK_|OZONE_)/.test(k)),
  );
}

function escribir(ruta: string, v: unknown) {
  writeFileSync(`${ruta}.tmp`, JSON.stringify(v, null, 2));
  renameSync(`${ruta}.tmp`, ruta);
}

export function armarBench() {
  const ruta = destino();
  ipcMain.handle("bench:modo", () => ruta !== null);
  if (!ruta) return;

  setTimeout(() => {
    escribir(ruta, { error: "corte duro: la UI no terminó el guion" });
    app.exit(3);
  }, CORTE_MS).unref();

  // La UI lo llama en su segundo rAF con la pantalla montada.
  ipcMain.handle("bench:listo", () => msDesdeInicio());
  ipcMain.handle("bench:cpu", () => cpu());
  ipcMain.handle("bench:fin", async (_e, reporte: Record<string, unknown>) => {
    escribir(ruta, {
      ...reporte,
      hyprland: vistaHyprland(),
      entorno: entorno(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      switches: process.argv.slice(1),
      gpu_estado: app.getGPUFeatureStatus(),
      gpu_info: await app.getGPUInfo("basic").catch(() => null),
    });
    app.exit(0);
  });
}
