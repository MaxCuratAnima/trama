// Procesos, igual en Linux y en Windows: cuándo arrancó un pid (para descartar un pid reusado), matar un proceso con todo
// lo que lanzó, y el shell para un comando suelto. En Linux es lo de siempre (`/proc`, grupos de procesos, `bash -c`);
// en Windows, PowerShell para el arranque, `taskkill /T` para el árbol y `cmd /d /s /c`. Todo recibe la plataforma y
// los efectos por `Deps`, así se prueba cada rama sin salir de Linux.
import { execFile, execFileSync, spawn, spawnSync, type ChildProcess, type ExecFileException, type ExecFileOptions, type ExecFileSyncOptions, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export type Deps = {
  plataforma: NodeJS.Platform;
  /** `process.kill`. */
  kill: (pid: number, senal: NodeJS.Signals) => unknown;
  /** Lanza si el pid no existe (`process.kill(pid, 0)`; EPERM es que existe y no es nuestro: no cuenta como falta). */
  existe: (pid: number) => void;
  /** Lee un archivo de texto (`/proc/<pid>/stat`). */
  leer: (ruta: string) => Promise<string>;
  leerSync: (ruta: string) => string;
  /** Corre un programa y devuelve su salida; rechaza si falla o pasa el tiempo. */
  correr: (bin: string, args: string[], opciones: { timeout: number; windowsHide: true }) => Promise<string>;
  correrSync: (bin: string, args: string[], opciones: { timeout: number; windowsHide: true }) => string;
};

const REALES: Deps = {
  plataforma: process.platform,
  kill: (pid, senal) => process.kill(pid, senal),
  existe: (pid) => {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    }
  },
  leer: (ruta) => readFile(ruta, "utf8"),
  leerSync: (ruta) => readFileSync(ruta, "utf8"),
  correr: (bin, args, o) => new Promise((ok, mal) => execFile(bin, args, { ...o, encoding: "utf8" }, (e, out) => (e ? mal(e) : ok(String(out))))),
  correrSync: (bin, args, o) => execFileSync(bin, args, { ...o, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
};

const con = (d?: Partial<Deps>): Deps => ({ ...REALES, ...d });

/** ¿Es Windows? (`plataforma` inyectable para probar). */
export const esWindows = (plataforma: NodeJS.Platform = process.platform) => plataforma === "win32";

/** Opciones de `spawn` para que lo que se lance se pueda cortar entero: su propio grupo en Linux (`setsid`); en Windows, `taskkill /T` alcanza y sin ventana de consola. */
export const grupoPropio = (plataforma: NodeJS.Platform = process.platform) => ({ detached: !esWindows(plataforma), windowsHide: true as const });

export type EstadoProceso = { estado: string; arranque: string | null; ppid: number | null };

/** De `/proc/<pid>/stat`: estado (campo 3), ppid (4) y arranque (22). */
export function deStat(texto: string): EstadoProceso {
  const c = texto.slice(texto.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(c[1]);
  return { estado: c[0] ?? "", arranque: c[19] ?? null, ppid: Number.isInteger(ppid) ? ppid : null };
}

const TOPE_PS_MS = 8000;
const PS_ARGS = (pid: number) => ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-Process -Id ${pid} -ErrorAction Stop; $q = (Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction SilentlyContinue).ParentProcessId; "$($p.StartTime.ToUniversalTime().Ticks) $q"`];

/** La salida de PowerShell es `<ticks UTC de StartTime> <pid del padre>`: el primero es el arranque (un número, igual para el mismo proceso). */
function ticks(salida: string): string | null {
  const t = salida.trim().split(/\s+/)[0] ?? "";
  return /^\d+$/.test(t) ? t : null;
}

function ppidDe(salida: string): number | null {
  const t = salida.trim().split(/\s+/)[1] ?? "";
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

const pidValido = (pid: number) => Number.isInteger(pid) && pid > 0;

/**
 * Cuándo arrancó el proceso, como texto opaco: con el pid dice que es éste y no otro que reusó el número.
 * `null`: no existe o no se pudo leer. Linux: campo 22 de `/proc/<pid>/stat`. Windows: `StartTime` de PowerShell.
 */
export async function inicioDeProceso(pid: number, d?: Partial<Deps>): Promise<string | null> {
  return (await estadoDeProceso(pid, d))?.arranque ?? null;
}

/** Como `inicioDeProceso`, pero bloquea (en Windows tarda lo que tarde PowerShell): para quien no puede ser async. */
export function inicioDeProcesoSync(pid: number, d?: Partial<Deps>): string | null {
  const x = con(d);
  if (!pidValido(pid)) return null;
  try {
    if (!esWindows(x.plataforma)) return deStat(x.leerSync(`/proc/${pid}/stat`)).arranque;
    x.existe(pid);
    return ticks(x.correrSync("powershell", PS_ARGS(pid), { timeout: TOPE_PS_MS, windowsHide: true }));
  } catch {
    return null;
  }
}

/** Estado y arranque del proceso; `null` si no existe o no se pudo leer. En Windows no hay zombis: `estado` es `""`. */
export async function estadoDeProceso(pid: number, d?: Partial<Deps>): Promise<EstadoProceso | null> {
  const x = con(d);
  if (!pidValido(pid)) return null;
  try {
    if (!esWindows(x.plataforma)) return deStat(await x.leer(`/proc/${pid}/stat`));
    x.existe(pid);
    const salida = await x.correr("powershell", PS_ARGS(pid), { timeout: TOPE_PS_MS, windowsHide: true });
    return { estado: "", arranque: ticks(salida), ppid: ppidDe(salida) };
  } catch {
    return null;
  }
}

/**
 * Corta un proceso y todo lo que lanzó. Linux: señal al grupo (`kill(-pid)`, el proceso tiene que ser líder de
 * grupo: `detached`). Windows: `taskkill /PID n /T` (`/F` con `forzar`). No rechaza ni lanza: un proceso que ya no
 * está no es un error. Devuelve si se pudo mandar.
 */
export function matarArbol(pid: number | undefined, forzar: boolean, d?: Partial<Deps>): boolean {
  if (!pid || !pidValido(pid) || pid <= 1) return false;
  const x = con(d);
  if (!esWindows(x.plataforma)) {
    try {
      x.kill(-pid, forzar ? "SIGKILL" : "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
  try {
    void x.correr("taskkill", ["/PID", String(pid), "/T", ...(forzar ? ["/F"] : [])], { timeout: TOPE_PS_MS, windowsHide: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export type ComandoShell = { bin: string; args: string[]; opciones: { windowsVerbatimArguments?: true } };

/**
 * Cómo correr un comando suelto: `bash -c` en Linux; `cmd /d /s /c "…"` en Windows (con `/s` cmd saca el par de
 * comillas de afuera, y los argumentos van tal cual para que Node no re-escape las de adentro).
 */
export function shellDe(cmd: string, plataforma: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): ComandoShell {
  if (!esWindows(plataforma)) return { bin: "bash", args: ["-c", cmd], opciones: {} };
  return { bin: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${cmd}"`], opciones: { windowsVerbatimArguments: true } };
}

const comillasCmd = (a: string) => `"${a.replace(/%/g, "%%").replace(/"/g, '""')}"`;

/**
 * El guion `.cmd` que corre una terminal de Windows para `enTerminal` (el equivalente del envoltorio `sh -c`): corre `argv`, anota su
 * código en `marca` (por un `.tmp` y un `move`, para que nadie lea a medias) y, si falló, deja la ventana esperando una tecla.
 */
export function guionTerminalWindows(argv: string[], marca: string): string {
  return [
    "@echo off",
    `call ${argv.map(comillasCmd).join(" ")}`,
    'set "rc=%errorlevel%"',
    `>${comillasCmd(`${marca}.tmp`)} echo %rc%`,
    `move /y ${comillasCmd(`${marca}.tmp`)} ${comillasCmd(marca)} >nul`,
    'if not "%rc%"=="0" (echo. & echo [rc=%rc%] Pulsa una tecla para cerrar & pause >nul)',
    "",
  ].join("\r\n");
}

const METACARACTERES_CMD = /([()\][%!^"`<>&|;, *?])/g;
const ES_BATCH = /\.(cmd|bat)$/i;

/** ¿Es un `.cmd`/`.bat` de Windows? Desde Node 18.20/20.12 (CVE-2024-27980) `spawn`/`execFile` los rechazan con EINVAL si no pasan por un shell. */
export const esBatch = (bin: string, plataforma: NodeJS.Platform = process.platform) => esWindows(plataforma) && ES_BATCH.test(bin);

/**
 * Un argumento para la línea de `cmd /d /s /c "…"` de un `.cmd`: primero como lo lee el runtime de C (barras antes de las
 * comillas, todo entre comillas) y después cada metacaracter de cmd con `^`. Dos veces: cmd lo lee al armar la línea y los
 * `.cmd` lo vuelven a leer cuando reenvían `%*` (el escape de cross-spawn). Los saltos de línea no pasan por cmd (corta la línea ahí): van como un espacio.
 */
function argumentoCmd(a: string): string {
  let r = `${a}`.replace(/\r\n|\r|\n/g, " ").replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  r = `"${r}"`;
  return r.replace(METACARACTERES_CMD, "^$1").replace(METACARACTERES_CMD, "^$1");
}

export type ComandoEjecutable = { file: string; args: string[]; opciones: { windowsVerbatimArguments?: true } };

/**
 * Cómo lanzar `bin args` sin shell: igual, salvo un `.cmd`/`.bat` en Windows, que va por `cmd /d /s /c "<línea>"` con la línea ya
 * armada (`windowsVerbatimArguments`) y cada argumento escapado, porque llevan texto libre del usuario (las tareas). `plataforma`
 * y `env` son inyectables para probar. Sin `shell: true`: la línea sólo la interpreta cmd con todo lo peligroso escapado.
 */
export function comandoEjecutable(bin: string, args: readonly string[], plataforma: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): ComandoEjecutable {
  if (!esBatch(bin, plataforma)) return { file: bin, args: [...args], opciones: {} };
  const linea = [`"${bin}"`, ...args.map(argumentoCmd)].join(" ");
  return { file: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${linea}"`], opciones: { windowsVerbatimArguments: true } };
}

/** `execFile` que acepta un `.cmd`/`.bat` en Windows (ver `comandoEjecutable`). */
export function execFileCmd(bin: string, args: readonly string[], opciones: ExecFileOptions, cb: (e: ExecFileException | null, stdout: string, stderr: string) => void): ChildProcess {
  const c = comandoEjecutable(bin, args);
  return execFile(c.file, c.args, { ...opciones, ...c.opciones, encoding: "utf8" } as ExecFileOptions & { encoding: "utf8" }, cb as never);
}

/** `execFileSync` que acepta un `.cmd`/`.bat` en Windows. */
export function execFileSyncCmd(bin: string, args: readonly string[], opciones: ExecFileSyncOptions & { encoding: BufferEncoding }): string {
  const c = comandoEjecutable(bin, args);
  return execFileSync(c.file, c.args, { ...opciones, ...c.opciones });
}

/** `spawn` que acepta un `.cmd`/`.bat` en Windows. */
export function spawnCmd(bin: string, args: readonly string[], opciones: SpawnOptions = {}): ChildProcess {
  const c = comandoEjecutable(bin, args);
  return spawn(c.file, c.args, { ...opciones, ...c.opciones });
}

/** `spawnSync` que acepta un `.cmd`/`.bat` en Windows. */
export function spawnSyncCmd(bin: string, args: readonly string[], opciones: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  const c = comandoEjecutable(bin, args);
  return spawnSync(c.file, c.args, { ...opciones, ...c.opciones });
}
