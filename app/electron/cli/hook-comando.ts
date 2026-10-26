// El comando que Claude Code ejecuta para cada hook de un worker (`--settings`), según la plataforma y el shell que lo corre.
// Antes `pa` armaba `bash <latido.sh> <hb> pre`; ahora es el ejecutable de node (o el de Electron en modo node) con el script
// compilado. Claude Code en Windows corre los hooks con Git Bash salvo que se le pida PowerShell: de ahí tres formas de
// citar. Funciones puras; las rutas de Windows se citan bien aunque corra en Linux (las pruebas).
import type { Env, Plataforma } from "../plataforma.ts";
import { esWindows } from "../plataforma.ts";

export type ShellHook = "bash" | "powershell" | "cmd";

export type OpcionesComando = {
  plataforma: Plataforma;
  /** El ejecutable que corre el script: `node`, o el de Electron con `electron: true`. */
  ejecutable: string;
  /** El script del hook (`hook-latido.js` compilado, o el `.ts` en desarrollo). */
  script: string;
  args?: string[];
  /** El ejecutable es Electron: hay que prender `ELECTRON_RUN_AS_NODE=1` para que se comporte como node. */
  electron?: boolean;
  shell?: ShellHook;
};

/** Qué shell corre los hooks: `PA_HOOK_SHELL` (bash|powershell|cmd) si está; si no, Git Bash en Windows y bash en el resto. */
export function shellDeHooks(_plataforma: Plataforma, env: Env): ShellHook {
  const v = (env.PA_HOOK_SHELL ?? "").toLowerCase();
  return v === "powershell" || v === "cmd" || v === "bash" ? v : "bash";
}

const SEGURO = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Git Bash entiende `C:/x/y` y se come las barras invertidas sin comillas: en Windows las rutas van con `/`. */
const haciaBash = (p: Plataforma, s: string) => (esWindows(p) ? s.replace(/\\/g, "/") : s);

function citarBash(s: string): string {
  return s !== "" && SEGURO.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
const citarPowerShell = (s: string) => `'${s.replace(/'/g, "''")}'`;
const citarCmd = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** La línea de comando de un hook, lista para el campo `command` de `--settings`. */
export function comandoHook(o: OpcionesComando): string {
  const shell = o.shell ?? "bash";
  const todo = [o.ejecutable, o.script, ...(o.args ?? [])];
  if (shell === "powershell") {
    const env = o.electron ? "$env:ELECTRON_RUN_AS_NODE='1'; " : "";
    const [exe, ...resto] = todo.map(citarPowerShell);
    return `${env}& ${exe} ${resto.join(" ")}`.trimEnd();
  }
  if (shell === "cmd") {
    const env = o.electron ? "set ELECTRON_RUN_AS_NODE=1&& " : "";
    return env + todo.map(citarCmd).join(" ");
  }
  const env = o.electron ? "ELECTRON_RUN_AS_NODE=1 " : "";
  return env + todo.map((x) => citarBash(haciaBash(o.plataforma, x))).join(" ");
}

export type EntradaHooks = {
  plataforma: Plataforma;
  ejecutable: string;
  electron?: boolean;
  shell?: ShellHook;
  scripts: { latido: string; guardia: string };
  /** El archivo de heartbeat del worker (lo hornea el comando, no el entorno). */
  hb: string;
  /** `pa --leer`: el latido deja pasar sólo git de lectura. */
  leer?: boolean;
};

type Hook = { type: "command"; command: string };
export type HooksDeWorker = {
  PreToolUse: ({ matcher: string; hooks: Hook[] } | { hooks: Hook[] })[];
  PostToolUse: { hooks: Hook[] }[];
};

/** El bloque `hooks` del `--settings` de un worker: la guardia destructiva en Bash/PowerShell y el latido en todas las herramientas. */
export function hooksDeWorker(e: EntradaHooks): HooksDeWorker {
  const base = { plataforma: e.plataforma, ejecutable: e.ejecutable, electron: e.electron, shell: e.shell };
  const cmd = (script: string, args: string[]): Hook => ({ type: "command", command: comandoHook({ ...base, script, args }) });
  return {
    PreToolUse: [
      { matcher: "Bash|PowerShell", hooks: [cmd(e.scripts.guardia, [])] },
      { hooks: [cmd(e.scripts.latido, [e.hb, "pre", ...(e.leer ? ["leer"] : [])])] },
    ],
    PostToolUse: [{ hooks: [cmd(e.scripts.latido, [e.hb, "post"])] }],
  };
}
