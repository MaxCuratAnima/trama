// Hook PreToolUse de Bash/PowerShell (puerto de motor/hooks/destructive-guard.sh): frena los comandos catastróficos aunque la
// sesión corra sin permisos. Mismo protocolo que Claude Code: JSON por stdin, `exit 2` + motivo por stderr = bloquear.
// Los patrones de rm/dd/mkfs/push --force, los destinos de backup, el congelado y los directorios de build en RAM son los del
// .sh, con las mismas expresiones; encima van los equivalentes de Windows (Remove-Item -Recurse, rd /s, del /s, Format-Volume…)
// y `git reset --hard`. Sólo mira el TEXTO del comando: un script que borra adentro pasa igual (tercera capa, no la primera).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { caminos, dirConfigTrama, esWindows, type Env, type Plataforma } from "../plataforma.ts";

export type ConfigGuardia = { etiquetas_usb: string[]; montajes: string[]; congelado: { etiqueta?: string; marcador?: string; patrones: string[] } | null };
export type ContextoGuardia = {
  plataforma: Plataforma;
  env: Env;
  home: string;
  /** El directorio de la sesión (el worktree del worker): dentro de él se puede borrar recursivo. */
  cwd: string;
  existe: (ruta: string) => boolean;
};
export type Veredicto = { bloquear: boolean; mensaje: string };

const PASA: Veredicto = { bloquear: false, mensaje: "" };
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** `guard.json` (`TRAMA_GUARD_CONFIG`; si no, `<config de Trama>/guard.json`, con `XDG_CONFIG_HOME` en Linux como antes). */
export function rutaConfigGuardia(p: Plataforma, env: Env, home: string): string {
  if (env.TRAMA_GUARD_CONFIG) return env.TRAMA_GUARD_CONFIG;
  if (!esWindows(p) && env.XDG_CONFIG_HOME) return caminos(p).join(env.XDG_CONFIG_HOME, "trama", "guard.json");
  return caminos(p).join(dirConfigTrama(p, env, home), "guard.json");
}

/** Lee `guard.json`; ilegible o ausente = sin config (valen sólo los destinos genéricos). */
export function leerConfigGuardia(ruta: string): ConfigGuardia {
  let c: Record<string, unknown> = {};
  try {
    const j = JSON.parse(readFileSync(ruta, "utf8"));
    if (j && typeof j === "object" && !Array.isArray(j)) c = j;
  } catch {
    /* sin archivo o roto */
  }
  const cg = c.congelado && typeof c.congelado === "object" && !Array.isArray(c.congelado) ? (c.congelado as Record<string, unknown>) : null;
  return {
    etiquetas_usb: lista(c.etiquetas_usb),
    montajes: lista(c.montajes),
    congelado: cg
      ? { etiqueta: typeof cg.etiqueta === "string" ? cg.etiqueta : undefined, marcador: typeof cg.marcador === "string" ? cg.marcador : undefined, patrones: lista(cg.patrones) }
      : null,
  };
}

const TMPFS_RAM = String.raw`(?:/tmp|/dev/shm|\$TMPDIR)`;

/** Los patrones del .sh (mismas expresiones), más los de la config. Cada uno bloquea si matchea el comando. */
export function patronesBase(cfg: ConfigGuardia, ctx: Pick<ContextoGuardia, "env" | "home" | "existe">, cmd: string): string[] {
  const patrones = [
    String.raw`(?<![\w-])rm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\b.*\s(/|~|\$HOME|\.config|\.claude)`,
    String.raw`(?<![\w-])rm\s+-[a-zA-Z]*r[a-zA-Z]*f|(?<![\w-])rm\s+-[a-zA-Z]*f[a-zA-Z]*r`,
    String.raw`(?<![\w-])rm\s+-[rf]{1,2}\s+/`,
    String.raw`\bdd\b.*\bof=/dev/`,
    String.raw`\bof=/dev/(sd|nvme|disk|mmcblk)`,
    String.raw`>\s*/dev/(sd|nvme|disk|mmcblk)`,
    String.raw`\bmkfs(\.\w+)?\b`,
    String.raw`\bwipefs\b`,
    String.raw`\b(parted|fdisk|sgdisk)\b.*\b/dev/`,
    String.raw`\bshred\b`,
    String.raw`\btruncate\s+-s\s*0\b`,
    String.raw`\bpacman\s+-R`,
    String.raw`\byay\s+-R`,
    String.raw`\bparu\s+-R`,
    String.raw`\bgit\s+push\b.*(--force\b|-f\b)`,
    String.raw`\bchmod\s+-R\s+0*777\s+/`,
    String.raw`\bchown\s+-R\b.*\s/(\s|$)`,
    String.raw`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`,
    // git reset --hard tira lo que haya sin commitear (también de otra sesión) y no se recupera
    String.raw`\bgit\b[^|;&]*\sreset\s+(?:[^|;&]*\s)?--hard\b`,
  ];

  // BACKUPS: cualquier verbo destructivo cuyo objetivo caiga en un destino de backup. Leer pasa siempre.
  const usb = cfg.etiquetas_usb;
  const destinos =
    String.raw`(?:/run/media/[^\s]*` +
    cfg.montajes.map((m) => "|" + escapar(m)).join("") +
    String.raw`|/media/[^\s]*` +
    String.raw`|~/backups|\$HOME/backups|/home/[^/\s]+/backups` +
    String.raw`|\.papelera` +
    (usb.length ? "|by-label/(?:" + usb.map(escapar).join("|") + ")" : "") +
    ")";
  patrones.push(
    String.raw`(?<![\w-])rm\b[^|;&]*` + destinos,
    String.raw`\bmv\b[^|;&]*` + destinos,
    String.raw`\bshred\b[^|;&]*` + destinos,
    String.raw`\btruncate\b[^|;&]*` + destinos,
    String.raw`\bfind\b[^|;&]*` + destinos + String.raw`[^|;&]*(-delete|-exec\s+rm)`,
    String.raw`\bfind\b[^|;&]*(-delete|-exec\s+rm)[^|;&]*` + destinos,
    String.raw`\brsync\b[^|;&]*--delete[^|;&]*` + destinos,
    String.raw`>\s*"?'?` + destinos,
    String.raw`\bdd\b[^|;&]*\bof=[^\s]*` + destinos,
  );
  if (usb.length) patrones.push(String.raw`\budisksctl\s+(unmount|power-off)\b[^|;&]*(?:` + usb.map(escapar).join("|") + ")");

  // DIRECTORIOS DE BUILD EN RAM: /tmp y /dev/shm son tmpfs; un target de cargo ahí llenó el zram y earlyoom mató 137 procesos.
  patrones.push(
    String.raw`CARGO_TARGET_DIR\s*=\s*["']?` + TMPFS_RAM,
    String.raw`--target-dir(?:\s+|=)["']?` + TMPFS_RAM,
    String.raw`CARGO_BUILD_TARGET_DIR\s*=\s*["']?` + TMPFS_RAM,
  );

  // CONGELADO de un USB: lo manda el archivo marcador (borrarlo descongela). `bash -n <script>` solo queda exento.
  const cg = cfg.congelado;
  if (cg) {
    const marcador = (cg.marcador ?? "").replace(/^~(?=$|[\\/])/, ctx.home);
    const congelado = (marcador !== "" && ctx.existe(marcador)) || ctx.env.TRAMA_GUARD_FORZAR_CONGELADO === "1";
    const soloSintaxis = /^\s*bash\s+-n\s+\S+\s*$/.test(cmd);
    if (congelado && !soloSintaxis) {
      if (cg.etiqueta) patrones.push(String.raw`\budisksctl\s+mount\b[^|;&]*` + escapar(cg.etiqueta), String.raw`\bmount\b[^|;&]*` + escapar(cg.etiqueta));
      patrones.push(...cg.patrones);
    }
  }
  return patrones;
}

/** Windows (PowerShell y cmd), sin distinguir mayúsculas. */
const PATRONES_WINDOWS = [
  String.raw`(?<![\w-])(?:Format-Volume|Clear-Disk|Remove-Partition|Initialize-Disk)(?![\w-])`,
  String.raw`(?<![\w.-])diskpart(?:\.exe)?(?![\w-])`,
  String.raw`(?<![\w.-])format(?:\.com)?\s+[a-z]:`,
  String.raw`(?<![\w.-])vssadmin(?:\.exe)?\s+delete\b`,
  String.raw`(?<![\w.-])cipher(?:\.exe)?\s+/w\b`,
];

/** Los verbos de borrado de PowerShell y cmd que pueden ser recursivos (`rm` aparte: en bash `-r` ya lo cubre el .sh). */
const VERBO_BORRAR = /(?<![\w.-])(Remove-Item|ri|rm|del|erase|rd|rmdir)(?![\w.:-])/gi;
const FLAG_RECURSE = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i;
const NO_ES_COMANDO = /(?:^|[\s;&|(])(?:git(?:\.exe)?(?:\s+-\S+)*|echo|Write-Host|Write-Output|grep|rg|findstr|Select-String|man|help|which|where)\s+["']*$/i;

function palabras(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** ¿Está `ruta` estrictamente dentro de `cwd`? Con variables, `~` o raíces de unidad no se puede saber: no. */
export function dentroDe(plataforma: Plataforma, cwd: string, ruta: string): boolean {
  const limpia = ruta.replace(/^["'`(]+|["'`);}]+$/g, "");
  if (limpia === "" || /[$%~`]/.test(limpia)) return false;
  const c = caminos(plataforma);
  const rel = c.relative(cwd, c.resolve(cwd, limpia));
  return rel !== "" && !rel.startsWith("..") && !c.isAbsolute(rel);
}

/**
 * Borrados recursivos de PowerShell/cmd (`Remove-Item -Recurse`, `rd /s`, `rmdir /s`, `del /s`) cuyos objetivos no estén todos
 * dentro del directorio de la sesión, o que no se pueda saber cuáles son. Devuelve el trozo ofensor o `null`.
 */
export function borradoRecursivoFuera(plataforma: Plataforma, cwd: string, cmd: string): string | null {
  for (const trozo of cmd.split(/[;|\n]|&&?|\|\|/)) {
    for (const m of trozo.matchAll(VERBO_BORRAR)) {
      const verbo = m[1].toLowerCase();
      if (NO_ES_COMANDO.test(trozo.slice(0, m.index))) continue;
      const args = palabras(trozo.slice(m.index + m[0].length));
      const recursivo = args.some((a) => (verbo === "rm" ? /^-rec/i.test(a) && FLAG_RECURSE.test(a) : FLAG_RECURSE.test(a) || /^\/s$/i.test(a)));
      if (!recursivo) continue;
      const rutas = args.filter((a) => !/^-/.test(a) && !/^\/[a-z]$/i.test(a));
      if (rutas.length === 0 || !rutas.every((r) => dentroDe(plataforma, cwd, r))) return trozo.trim();
    }
  }
  return null;
}

/** Corre `docker-guard.py` (si está en `TRAMA_GUARD_DIR` y hay python) para los comandos que nombran docker/podman. `null` si pasa. */
function guardiaDocker(cmd: string, entrada: unknown, env: Env): string | null {
  if (!/docker|podman/.test(cmd)) return null;
  const dir = env.TRAMA_GUARD_DIR;
  const guard = dir ? caminos(process.platform).join(dir, "docker-guard.py") : "";
  if (!guard || !existsSync(guard)) return null;
  const r = spawnSync(env.TRAMA_PYTHON || (esWindows(process.platform) ? "python" : "python3"), ["-I", guard], { input: JSON.stringify(entrada), encoding: "utf8", timeout: 20000, windowsHide: true });
  return r.status === 2 ? r.stderr || "GUARD: docker-guard bloqueó el comando." : null;
}

const HERRAMIENTAS = new Set(["Bash", "PowerShell"]);

/** La decisión del hook para una entrada de PreToolUse. Entrada rara o de otra herramienta: pasa. */
export function evaluarGuardia(entrada: unknown, ctx: ContextoGuardia, cfg: ConfigGuardia): Veredicto {
  const d = entrada as { tool_name?: unknown; tool_input?: { command?: unknown } | null } | null;
  if (!d || typeof d !== "object" || typeof d.tool_name !== "string" || !HERRAMIENTAS.has(d.tool_name)) return PASA;
  const c = d.tool_input?.command;
  const cmd = typeof c === "string" ? c : "";

  const docker = guardiaDocker(cmd, entrada, ctx.env);
  if (docker !== null) return { bloquear: true, mensaje: docker };

  for (const p of patronesBase(cfg, ctx, cmd)) {
    if (new RegExp(p).test(cmd)) {
      return {
        bloquear: true,
        mensaje:
          "GUARD: comando potencialmente destructivo bloqueado por seguridad (modo asistente sin prompts). Confirma EXPLICITAMENTE con el usuario " +
          "en voz/texto antes de ejecutarlo. Patron: " + p + " | cmd: " + cmd.slice(0, 300),
      };
    }
  }
  for (const p of PATRONES_WINDOWS) {
    if (new RegExp(p, "i").test(cmd)) {
      return {
        bloquear: true,
        mensaje: "GUARD: comando potencialmente destructivo bloqueado por seguridad (Windows). Confirma EXPLICITAMENTE con el usuario antes de ejecutarlo. Patron: " + p + " | cmd: " + cmd.slice(0, 300),
      };
    }
  }
  const fuera = borradoRecursivoFuera(ctx.plataforma, ctx.cwd, cmd);
  if (fuera !== null) {
    return {
      bloquear: true,
      mensaje:
        "GUARD: borrado recursivo (Remove-Item -Recurse, rd /s, del /s) fuera del directorio de la sesión, o con un objetivo que no se puede verificar (variables, ~, raíz de unidad). " +
        "Dentro de " + ctx.cwd + " se puede con una ruta explícita. Confirma EXPLICITAMENTE con el usuario antes de ejecutarlo. | cmd: " + fuera.slice(0, 300),
    };
  }
  return PASA;
}

export function contextoReal(cwd?: string): ContextoGuardia {
  return { plataforma: process.platform, env: process.env as Env, home: os.homedir(), cwd: cwd || process.cwd(), existe: existsSync };
}

/** Lee la entrada, decide y devuelve el código de salida (el motivo va a stderr). Un error propio deja pasar: un guard roto se termina desactivando. */
export function correrGuardia(texto: string): { codigo: 0 | 2; stderr: string } {
  let entrada: unknown;
  try {
    entrada = JSON.parse(texto);
  } catch {
    return { codigo: 0, stderr: "" };
  }
  try {
    const cwd = typeof (entrada as { cwd?: unknown })?.cwd === "string" ? (entrada as { cwd: string }).cwd : undefined;
    const ctx = contextoReal(cwd);
    const v = evaluarGuardia(entrada, ctx, leerConfigGuardia(rutaConfigGuardia(ctx.plataforma, ctx.env, ctx.home)));
    return v.bloquear ? { codigo: 2, stderr: v.mensaje } : { codigo: 0, stderr: "" };
  } catch (e) {
    return { codigo: 0, stderr: "hook-guardia: error propio (deja pasar): " + (e instanceof Error ? e.message : String(e)) };
  }
}

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = correrGuardia(await leerStdin());
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.codigo;
}
