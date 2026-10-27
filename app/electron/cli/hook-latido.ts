// Hook PreToolUse/PostToolUse de los workers de `pa` (puerto de motor/hooks/latido.sh):
//   node hook-latido.js <archivo-heartbeat> <pre|post> [leer]
// Hace tres cosas, en este orden: (1) LATIDO: una línea por evento en el .heartbeat (epoch/tool/envuelo/desc, el mismo
// formato de `key=valor` que lee `workers` con sed); (2) GUARDIA DE --leer: con `leer`, Bash/PowerShell sólo deja pasar git de
// lectura (allowlist); (3) GUARDIA DE GIT Y DE COMANDOS LARGOS: stash, add -A, commit -a, run_in_background, builds de release,
// cargo clean, comandos largos sin `timeout`, instalar dependencias con otro worker vivo. Después del tool, el aviso de turnos
// y el de "se fue a background". Protocolo de Claude Code: JSON por stdin; `exit 2` + stderr = bloquear; JSON por stdout = ajustes.
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { caminos, rutaPerfil, type Env, type Plataforma } from "../plataforma.ts";

export type ContextoLatido = {
  plataforma: Plataforma;
  env: Env;
  home: string;
  /** Segundos desde epoch. */
  ahora: () => number;
  /** ¿Existe el proceso? (`kill -0`) */
  vivo: (pid: number) => boolean;
};
export type ResultadoLatido = { codigo: 0 | 2; stderr: string; stdout: string };

type Entrada = { tool_name?: unknown; tool_input?: Record<string, unknown> | null; tool_response?: unknown };

/** Una de las herramientas de shell: `PowerShell` (o `Bash`, si la sesión lo trae). */
const esShell = (h: string) => h === "Bash" || h === "PowerShell";

/** Como `jq -r '.x // empty'`: null/false/ausente = ""; texto tal cual; el resto, su JSON. */
function texto(v: unknown): string {
  if (v === undefined || v === null || v === false) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Nombre del dueño: TRAMA_DUENO → `dueno` de perfil.json → usuario con mayúscula inicial → "el usuario". Sólo al armar un bloqueo. */
export function nombreDueno(ctx: ContextoLatido): string {
  let n = ctx.env.TRAMA_DUENO ?? "";
  if (!n) {
    try {
      const j = JSON.parse(readFileSync(rutaPerfil(ctx.plataforma, ctx.env, ctx.home), "utf8"));
      if (typeof j?.dueno === "string") n = j.dueno;
    } catch {
      /* sin perfil */
    }
  }
  if (!n) {
    const u = ctx.env.USER || ctx.env.USERNAME || "";
    if (u) n = u[0].toUpperCase() + u.slice(1);
  }
  return n || "el usuario";
}

const PRE = String.raw`(?:^|[;&|\s])`;
const GIT = String.raw`git(?:\.exe)?\s+(?:(?:-C\s+\S+|-\S+)\s+)*`;

/** Subcomandos de git que sólo leen, para `--leer`. */
const SUB_LECTURA = new Set(["log", "diff", "show", "status", "rev-list", "rev-parse", "merge-base", "ls-files", "ls-tree", "blame", "shortlog", "describe", "cat-file", "grep"]);

function ramaDeLectura(resto: string[]): boolean {
  // Sin argumentos lista. Con argumentos, sólo en modo lista (git crea una rama con un nombre suelto) y sin ningún flag
  // que borre, mueva, copie o toque el upstream.
  let lista = resto.length === 0;
  for (const a of resto) {
    if (/^--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track|no-track|create-reflog)/.test(a)) return false;
    if (/^--(list|all|remotes|verbose|show-current|merged|no-merged|contains|no-contains|points-at)/.test(a)) lista = true;
    else if (a.startsWith("--")) continue;
    else if (a.startsWith("-")) {
      if (/[dDmMcCfut]/.test(a)) return false;
      if (/[lavr]/.test(a)) lista = true;
    }
  }
  return lista;
}

/**
 * ALLOWLIST de `pa --leer`: ¿es el comando git de lectura, con pipes opcionales a filtros que no escriben? Lo que no se reconoce
 * se bloquea; una denylist reabría la puerta trasera de escritura que --leer existe para cerrar.
 */
export function gitDeLectura(c: string): boolean {
  if (!c || c.includes("\n") || c.includes("||") || c.includes("$(")) return false;
  // nada de encadenar, redirigir ni sustituir. Sobre-bloquea un `;` entre comillas: aceptable.
  if (/[;&<>`]/.test(c)) return false;
  const segs = c.split("|");
  for (let k = 0; k < segs.length; k++) {
    const t = segs[k].split(/\s+/).filter(Boolean);
    if (t.length === 0) return false;
    // sort -o y uniq <in> <out> escriben; sed tiene `w`. Quedan los que no pueden escribir.
    if (k > 0) {
      if (["head", "tail", "grep", "wc", "cut"].includes(t[0])) continue;
      return false;
    }
    if (t[0] !== "git" && t[0] !== "git.exe") return false;
    let i = 1;
    while (t[i] === "-C" || t[i] === "--no-pager") i += t[i] === "-C" ? 2 : 1;
    const sub = t[i] ?? "";
    const resto = t.slice(i + 1);
    // --output escribe un archivo; -O abre un pager (ejecuta); --ext-diff corre un programa.
    if (resto.some((a) => a.startsWith("--output") || a.startsWith("-O") || a.startsWith("--open-files-in-pager") || a === "--ext-diff")) return false;
    if (SUB_LECTURA.has(sub)) continue;
    if (sub === "worktree" && resto[0] === "list") continue;
    if (sub === "stash" && (resto[0] === "list" || resto[0] === "show")) continue;
    if (sub === "branch" && ramaDeLectura(resto)) continue;
    return false;
  }
  return true;
}

function valor(archivo: string, clave: string): string {
  try {
    const m = readFileSync(archivo, "utf8").match(new RegExp(`^${clave}=(.*)$`, "m"));
    return m ? m[1].replace(/\r$/, "") : "";
  } catch {
    return "";
  }
}

/** ¿Hay otro worker que ESCRIBE vivo en el mismo proyecto? (cada uno tiene su `<slug>[@n].running`; los --leer no cuentan.) */
function otroWriterVivo(hb: string, ctx: ContextoLatido): boolean {
  if (!hb) return false;
  const c = caminos(ctx.plataforma);
  const propio = hb.replace(/\.heartbeat$/, "") + ".running";
  const st = c.dirname(hb);
  const slug = valor(propio, "proyecto");
  if (!slug) return false;
  let nombres: string[];
  try {
    nombres = readdirSync(st);
  } catch {
    return false;
  }
  for (const n of nombres) {
    if (!(n === `${slug}.running` || (n.startsWith(`${slug}@`) && n.endsWith(".running")))) continue;
    const r = c.join(st, n);
    if (r === propio || valor(r, "leer") === "1") continue;
    const pid = Number(valor(r, "pid") || valor(r, "pa_pid"));
    if (Number.isInteger(pid) && pid > 0 && ctx.vivo(pid)) return true;
  }
  return false;
}

const bloqueo = (stderr: string): ResultadoLatido => ({ codigo: 2, stderr: stderr + "\n", stdout: "" });
const sigue = (stdout = ""): ResultadoLatido => ({ codigo: 0, stderr: "", stdout });

const LARGOS =
  String.raw`(?:cargo\s+(?:test|build|clippy|check|bench)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|typecheck)|npx\s+tsc|(?:go|pytest|make|gradle|mvn|tsc|vitest|jest)(?:[\s;&|)]|$))`;

/** Los bloqueos de git y de comandos largos de un worker (sólo `pre` y sólo shell). `null` si el comando pasa. */
function bloqueoDeWorker(cmd: string, hb: string, timeout: string, ctx: ContextoLatido): string | null {
  // `run_in_background` mató dos corridas: en un worker `-p` nadie re-invoca al modelo cuando el background termina.
  // (lo chequea el llamador, con el campo) — acá van los que miran el texto.
  if (!hb.endsWith("@aca.heartbeat")) {
    const release =
      new RegExp(`${PRE}tauri\\s+(?:--\\s+)?build(?:[\\s;&|)]|$)`).test(cmd) ||
      new RegExp(`${PRE}cargo\\s+(?:[^;&|]*\\s)?(?:--release|-r|--profile[=\\s]+release)(?:[\\s;&|)]|$)`).test(cmd) ||
      new RegExp(`${PRE}cargo\\s+(?:[^\\s;&|]+\\s+)*install(?:[\\s;&|)]|$)`).test(cmd);
    if (release) {
      return `BLOQUEADO: build de release en un worker: pisa el target compartido (y el binario que usa ${nombreDueno(ctx)}). El build lo hace el jefe después de integrar. Probá con cargo test/check o build debug; si de verdad hace falta release, decilo en DECISION.`;
    }
  }
  if (!timeout && new RegExp(`${PRE}${LARGOS}`).test(cmd)) {
    return "BLOQUEADO: a ese comando le falta el parámetro 'timeout' del tool Bash. Sin él el tool corta a los 120s y manda el comando a BACKGROUND solo; ahí te ponés a pollear la salida, cada vuelta es un turno, y te quedás sin turnos con todo sin commitear (pasó tres veces). Relanzá el MISMO comando agregando timeout: 600000 (milisegundos, 10 min, el máximo). El 'timeout 300' del shell que escribiste no cuenta: es otro reloj.";
  }
  // `git stash list` y `git stash show` son de sólo lectura y son justo lo que hay que correr para VERIFICAR.
  if (new RegExp(`${PRE}${GIT}stash(?:[\\s;&|)]|$)`).test(cmd) && !new RegExp(`${GIT}stash\\s+(?:list|show)`).test(cmd)) {
    return "BLOQUEADO: nada de 'git stash' en un worker. Si te matan a mitad, el trabajo sin commitear de otra sesión queda en el stash y desaparece del working tree sin que nada falle. Trabajá encima de lo que haya y commiteá archivo por archivo.";
  }
  // `add -u` y `commit -a` son la misma clase de peligro que `add -A`: barren TODO lo modificado del working tree.
  if (new RegExp(`${PRE}${GIT}add\\s+(?:-A|--all|-u|--update|\\.)(?:[\\s;&|)]|$)`).test(cmd)) {
    return "BLOQUEADO: nada de 'git add -A/-u' ni 'git add .' en un worker: te llevás cambios de otra sesión que no son tuyos. Agregá los archivos que tocaste, uno por uno.";
  }
  if (new RegExp(`${PRE}${GIT}commit\\s+(?:-[A-Za-z]*a[A-Za-z]*|--all)(?:[\\s;&|)]|$)`).test(cmd)) {
    return "BLOQUEADO: nada de 'git commit -a' en un worker: commitea todo lo modificado, incluido lo de otra sesión. Agregá tus archivos con git add <archivo> y commiteá sin -a.";
  }
  // `cargo clean`, SIEMPRE: el target de un worker es el del tree principal del dueño (compartido).
  if (new RegExp(`${PRE}cargo\\s+(?:[^\\s]+\\s+)*clean(?:[\\s;&|)]|$)`).test(cmd)) {
    return "BLOQUEADO: nada de 'cargo clean' en un worker: el target es compartido con el tree principal (y con otros workers). Si sospechás de un artefacto roto, decilo en DECISION.";
  }
  // Instalar/sacar dependencias con OTRO worker vivo: node_modules y .venv son del tree principal (symlink en cada worktree).
  if (
    new RegExp(
      `${PRE}(?:(?:npm|pnpm|yarn|bun)\\s+(?:install|i|add|ci|remove|rm|uninstall|un)|pip[0-9.]*\\s+install|python[0-9.]*\\s+-m\\s+pip\\s+install|uv\\s+(?:sync|add|remove|pip\\s+install))(?:[\\s;&|)]|$)`,
    ).test(cmd) &&
    otroWriterVivo(hb, ctx)
  ) {
    return "BLOQUEADO: hay otro worker corriendo en este mismo proyecto y comparten node_modules/.venv (son los del tree principal). Instalar o sacar dependencias ahora se las cambia a él a mitad de camino. Si de verdad necesitás esa dependencia, decilo en DECISION y seguí con lo demás.";
  }
  return null;
}

/** El heartbeat: escritura atómica (tmp + rename). Los saltos de línea y tabs de `desc` pasan a espacio y se corta a 160. */
function escribirLatido(hb: string, fase: string, herramienta: string, desc: string, ctx: ContextoLatido): void {
  const limpio = Array.from(desc.replace(/[\n\r\t]/g, " ")).slice(0, 160).join("");
  const cuerpo = `epoch=${Math.floor(ctx.ahora())}\ntool=${herramienta || "?"}\nenvuelo=${fase === "pre" ? 1 : 0}\ndesc=${limpio}\n`;
  try {
    writeFileSync(`${hb}.tmp`, cuerpo);
    renameSync(`${hb}.tmp`, hb);
  } catch {
    /* el latido es informativo: si no se puede escribir, el hook sigue */
  }
}

/** La decisión del hook. `argumentos` = [archivo-heartbeat, pre|post, leer?]; `entrada` = el JSON de stdin. */
export function procesarLatido(argumentos: string[], entrada: string, ctx: ContextoLatido): ResultadoLatido {
  const hb = argumentos[0] ?? "";
  const fase = argumentos[1] ?? "pre";
  const modo = argumentos[2] ?? "";
  let d: Entrada = {};
  try {
    const j = JSON.parse(entrada);
    if (j && typeof j === "object") d = j;
  } catch {
    /* sin JSON: campos vacíos, como jq con error */
  }
  const ti = d.tool_input && typeof d.tool_input === "object" ? d.tool_input : {};
  const herramienta = texto(d.tool_name);
  const cmd = texto(ti.command);
  const desc = texto(ti.description) || cmd || texto(ti.file_path) || texto(ti.pattern);
  const bg = texto(ti.run_in_background);

  // Va ANTES de las guardias: si una guardia bloquea, igual queremos que el .heartbeat diga qué intentó el worker.
  if (hb) escribirLatido(hb, fase, herramienta, desc, ctx);

  const shell = esShell(herramienta);
  if (modo === "leer" && fase === "pre" && shell && !gitDeLectura(cmd)) {
    return bloqueo(
      "BLOQUEADO: estás en modo LECTURA (pa --leer). La herramienta de comandos sólo acepta git de lectura: log, diff, show, status, rev-list, rev-parse, merge-base, ls-files, ls-tree, blame, shortlog, describe, cat-file, grep, branch --list, worktree list, stash list/show. Usá 'git -C <ruta>' en vez de cd y acotá la salida con las opciones de git (-n 20, --stat, -- <ruta>). Nada de ;, &&, redirecciones, $(...) ni otros comandos. Para leer archivos usá Read/Grep/Glob.",
    );
  }

  if (fase === "pre" && shell && cmd) {
    if (bg === "true") {
      return bloqueo(
        "BLOQUEADO: nada de run_in_background en un worker headless. Cuando el comando termina no hay nadie que te despierte: te ponés a pollear la salida, cada vuelta es un turno, y te quedás sin turnos con todo sin commitear. Corrélo en FOREGROUND pasándole al tool Bash su parámetro 'timeout' en MILISEGUNDOS (máximo 600000 = 10 min). OJO: 'timeout 540 <cmd>' del SHELL no sirve, el tool corta igual a los 120s por default. Si el comando no cabe en 10 min, acotálo (un test, un paquete) o commiteá lo que tengas y decí en DECISION que no cabe en una corrida.",
      );
    }
    const b = bloqueoDeWorker(cmd, hb, texto(ti.timeout), ctx);
    if (b) return bloqueo(b);
  }

  // --- aviso de turnos y de "se fue a background" (PostToolUse) ---
  let aviso = "";
  // El harness puede mandar a background un comando que el modelo pidió en foreground: la guardia de `pre` ya no llega y el
  // aviso tiene que salir del RESULTADO. Se mira SÓLO el principio de la respuesta de un shell, con la frase entera del harness.
  if (fase === "post" && shell) {
    const r = d.tool_response;
    const cabeza = Buffer.from(typeof r === "string" ? r : JSON.stringify(r ?? null)).subarray(0, 300).toString("utf8");
    if (/did not complete within its [\s\S]*timeout and was moved to the background/.test(cabeza)) {
      aviso =
        "AVISO DEL ORQUESTADOR: el harness mandó ese comando a background porque le faltó el parámetro 'timeout' del tool. NO lo pollees (ni sleep, ni cat de la salida, ni jobs: cada vuelta es un turno y nadie te va a despertar cuando termine). Relanzá el MISMO comando en foreground agregando timeout: 600000.";
    }
  }
  const maxTurnos = ctx.env.PA_MAX_TURNS ?? "";
  if (fase === "post" && hb && /^[0-9]+$/.test(maxTurnos)) {
    // Se cuentan herramientas, no turnos: corre un poco ADELANTE del tope real, que es el lado bueno del error.
    let previo = 0;
    try {
      previo = Number.parseInt(readFileSync(`${hb}.turnos`, "utf8"), 10) || 0;
    } catch {
      /* primera vez */
    }
    const n = previo + 1;
    try {
      writeFileSync(`${hb}.turnos`, String(n));
    } catch {
      /* informativo */
    }
    const quedan = Number(maxTurnos) - n;
    if (quedan <= 5 && quedan >= 0) {
      aviso = `${aviso ? aviso + " " : ""}AVISO DEL ORQUESTADOR: te quedan como mucho ${quedan} turnos. Commiteá lo que hiciste (archivo por archivo) y respondé YA con RESULTADO/ARCHIVOS/DECISION, aunque falte algo: decilo en DECISION.`;
    }
  }
  return sigue(aviso ? JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: aviso } }) : "");
}

export function contextoReal(): ContextoLatido {
  return {
    plataforma: process.platform,
    env: process.env as Env,
    home: os.homedir(),
    ahora: () => Date.now() / 1000,
    vivo: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
      }
    },
  };
}

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = procesarLatido(process.argv.slice(2), await leerStdin(), contextoReal());
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.stdout) process.stdout.write(r.stdout + "\n");
  process.exitCode = r.codigo;
}
