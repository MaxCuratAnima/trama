// El contexto del usuario para un líder local (llama-server): lo que un líder Claude recibe solo (los CLAUDE.md, el índice de la
// memoria y la salida de los hooks SessionStart) y un modelo local, con `--bare`, no. Se arma al lanzar su proceso y va en el
// `--system-prompt` (`argvLider`). Sin workers: se sacan las secciones de jefe / `pa` / tabla de modelos de lo que se carga
// (por encabezado, no por texto copiado: sigue los cambios de los archivos). Sin GPU ni red: sólo archivos y el hook del usuario.
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { entornoLider } from "./lider-arma.ts";
import { shellDe } from "./procesos.ts";
import { deDueno, dueno } from "./dueno.ts";

/** Los encabezados que no le tocan a un local: él no delega (no hay `pa`) ni elige workers. */
export const ENCABEZADOS_FUERA = /^(jefe|modelos)\b/i;

/** Caracteres por token: conservador para español con un tokenizador de la familia Qwen (medido ≈ 3,3 en prosa; el código rinde menos). */
export const CHARS_POR_TOKEN = 3;
export const tokensDe = (texto: string) => Math.ceil(texto.length / CHARS_POR_TOKEN);

/** Tope de todo el contexto: ~15k tokens, y nunca más de un cuarto de lo que el local tiene cargado (`-c`). */
export const TOPE_TOKENS = 15000;
export const topeParaCtx = (ctx: number) => Math.max(1000, Math.min(TOPE_TOKENS, Math.floor(ctx / 4)));

/** Lo que más importa va primero y se recorta al final: trato + seguridad (CLAUDE.md del usuario), tablero (hook), memoria, proyecto. */
const TOPE_PARTE = { usuario: 1500, hook: 2500, memoria: 2000 };

/** El texto sin las secciones cuyo encabezado (cualquier nivel) es de `fuera`, hasta el próximo encabezado del mismo nivel o mayor. */
export function sinSecciones(md: string, fuera: RegExp = ENCABEZADOS_FUERA): string {
  const out: string[] = [];
  let nivel = 0; // > 0: dentro de una sección que se descarta
  let cerca = false;
  for (const l of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) cerca = !cerca;
    const h = cerca ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      if (nivel && h[1].length <= nivel) nivel = 0;
      if (!nivel && fuera.test(h[2].replace(/[`*_]/g, ""))) nivel = h[1].length;
    }
    if (!nivel) out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Recorta en un límite de línea a `tokens`; dice dónde está lo entero. */
export function recortar(texto: string, tokens: number, donde: string): string {
  if (tokensDe(texto) <= tokens) return texto;
  const aviso = `\n[recortado por el tamaño; el archivo entero: ${donde}]`;
  const corte = texto.slice(0, Math.max(0, tokens - tokensDe(aviso)) * CHARS_POR_TOKEN);
  const fin = corte.lastIndexOf("\n");
  return (fin > 0 ? corte.slice(0, fin) : corte).trimEnd() + aviso;
}

/** La carpeta de memoria de Claude Code para un cwd: todo lo que no es letra o número, un guión. */
export const memoriaDe = (home: string, cwd: string) => path.join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory", "MEMORY.md");

/** Los CLAUDE.md que Claude Code cargaría: de `~` hacia el cwd (si el cwd está bajo `~`; si no, sólo el del cwd). */
export function carpetasDe(home: string, cwd: string): string[] {
  const rel = path.relative(home, cwd);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return [cwd];
  const out = [home];
  let d = home;
  for (const p of rel.split(path.sep).filter(Boolean)) out.push((d = path.join(d, p)));
  return out;
}

const MAX_HOOK_BYTES = 200_000;

/** Corre un comando de hook como Claude Code (por `sh -c` o `cmd /c` en Windows, el JSON del evento por stdin); nunca falla ni pasa de `timeout`. */
function correrHook(comando: string, cwd: string, home: string, env: Record<string, string | undefined>, timeoutMs: number): Promise<string> {
  return new Promise((ok) => {
    const entrada = JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd });
    const sh = shellDe(comando);
    const p = execFile(sh.bin, sh.args, { ...sh.opciones, cwd, env: { ...env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: cwd }, timeout: timeoutMs, maxBuffer: MAX_HOOK_BYTES, windowsHide: true }, (err, stdout) => {
      if (err) console.error(`[contexto-local] el hook SessionStart falló (${comando.slice(0, 120)}): ${err.message}`);
      ok(err ? "" : String(stdout));
    });
    p.stdin?.on("error", () => {});
    p.stdin?.end(entrada);
  });
}

/** Lo que un hook dijo: su stdout, o el `additionalContext` si contestó JSON. */
export function textoDeHook(salida: string): string {
  const s = salida.trim();
  if (!s.startsWith("{")) return s;
  try {
    const j = JSON.parse(s);
    const c = j?.hookSpecificOutput?.additionalContext ?? j?.additionalContext;
    return typeof c === "string" ? c.trim() : "";
  } catch {
    return s;
  }
}

/** Los comandos de SessionStart de `~/.claude/settings.json` (los que aplican a un arranque: sin matcher, o `startup`). */
export async function hooksDeArranque(home: string, leer: (ruta: string) => Promise<string | null>): Promise<string[]> {
  const t = await leer(path.join(home, ".claude", "settings.json"));
  if (!t) return [];
  try {
    const grupos = JSON.parse(t)?.hooks?.SessionStart;
    if (!Array.isArray(grupos)) return [];
    const out: string[] = [];
    for (const g of grupos) {
      if (g?.matcher && !new RegExp(`^(${g.matcher})$`).test("startup")) continue;
      for (const h of g?.hooks ?? []) if (h?.type === "command" && typeof h.command === "string") out.push(h.command);
    }
    return out;
  } catch {
    return [];
  }
}

export type DepsContexto = {
  leer: (ruta: string) => Promise<string | null>;
  hook: (comando: string, cwd: string) => Promise<string>;
};

const leerODejar = (ruta: string) => readFile(ruta, "utf8").catch(() => null);

export type Contexto = { texto: string; partes: { titulo: string; tokens: number; recortado: boolean }[]; tokens: number };

/**
 * El contexto del usuario para un líder local en `cwd` (por defecto `home`), con `ctx` tokens de contexto cargado. Cada parte
 * va bajo su título y recortada a su tope; en total, `topeParaCtx(ctx)`. Una parte que no existe no aparece.
 */
export async function armarContexto(x: {
  home: string;
  cwd?: string;
  ctx: number;
  env?: Record<string, string | undefined>;
  deps?: Partial<DepsContexto>;
  /** `gemini`: un líder de agy, que sí delega con `pa` y no lee CLAUDE.md: sus secciones de jefe se quedan, y ni hooks ni memoria (el tablero y lo recordado del usuario no salen de su máquina hacia Google). */
  perfil?: "gemini";
}): Promise<Contexto> {
  const home = x.home;
  const cwd = x.cwd || home;
  const leer = x.deps?.leer ?? leerODejar;
  const hook = x.deps?.hook ?? ((c: string, d: string) => correrHook(c, d, home, entornoLider(x.env ?? process.env, home), 5000));
  const gemini = x.perfil === "gemini";
  const fuera = gemini ? /(?!)/ : ENCABEZADOS_FUERA;
  let libre = topeParaCtx(x.ctx);
  const partes: Contexto["partes"] = [];
  const bloques: string[] = [];
  const poner = (titulo: string, cuerpo: string, tope: number, donde: string) => {
    if (!cuerpo.trim() || libre <= 0) return;
    const t = recortar(cuerpo.trim(), Math.min(tope, libre), donde);
    const tokens = tokensDe(t);
    libre -= tokens;
    partes.push({ titulo, tokens, recortado: t !== cuerpo.trim() });
    bloques.push(`## ${titulo}\n${t}`);
  };

  const global = path.join(home, ".claude", "CLAUDE.md");
  poner(`Reglas globales ${deDueno()}`, sinSecciones((await leer(global)) ?? "", fuera), TOPE_PARTE.usuario, global);

  // `~/CLAUDE.md` y los de las carpetas hasta el cwd: los de arriba primero, como Claude Code.
  const archivos = carpetasDe(home, cwd).map((d) => path.join(d, "CLAUDE.md"));
  const textos = await Promise.all(archivos.map(async (f) => [f, await leer(f)] as const));
  // Primero lo de `~` (trato, seguridad, tablero), después tablero y memoria, y al final los de proyecto, con lo que quede.
  const [primero, ...proyecto] = textos;
  if (primero) poner(`CLAUDE.md de ${path.dirname(primero[0]) === home ? "~" : path.dirname(primero[0])}`, sinSecciones(primero[1] ?? "", fuera), 4000, primero[0]);

  const salidas = gemini ? [] : await Promise.all((await hooksDeArranque(home, leer)).map((c) => hook(c, cwd).then(textoDeHook, () => "")));
  poner("Tablero y estado al arrancar (salida de los hooks de arranque)", salidas.filter(Boolean).join("\n"), TOPE_PARTE.hook, "`tablero resumen`");

  const mem = memoriaDe(home, cwd);
  const memoria = gemini ? "" : ((await leer(mem)) ?? "");
  poner(`Memoria sobre ${dueno()} (índice; cada archivo está en ${path.dirname(mem)}/, léelo con Read si hace falta)`, memoria.split("\n").slice(0, 200).join("\n"), TOPE_PARTE.memoria, mem);

  for (const [f, t] of proyecto) poner(`CLAUDE.md de ${path.dirname(f)}`, sinSecciones(t ?? "", fuera), libre, f);

  return { texto: bloques.length ? `# Contexto ${deDueno()} (cargado al arrancar este líder)\n\n${bloques.join("\n\n")}` : "", partes, tokens: topeParaCtx(x.ctx) - libre };
}

/**
 * Lo que se le dice a un líder de Gemini antes de su primer mensaje (agy no lee CLAUDE.md ni sabe de `pa`): quién es, que
 * delega con `pa` y los CLAUDE.md de la persona tal cual (con la sección del jefe). El skill de orquestación lo ve solo
 * (el plugin `pa-worker` enlaza `~/.claude/skills`), y se le avisa.
 */
export const PROMPT_GEMINI = [
  "Sos un líder de Trama (una app para manejar workers de `pa` y chatear con sus líderes) y corrés como Gemini dentro de `agy`, no como Claude.",
  "Estás en el home de la persona: sos el jefe que delega el trabajo de cada proyecto a workers con `pa`, que tenés en el PATH de tu herramienta de comandos (`pa --help` explica cómo se usa).",
  "Cómo delegar, en corto (esto vale aunque no tengas ningún skill):",
  "- `pa <proyecto> --tipo <tipo> \"<tarea>\"` lanza un worker adentro del proyecto y espera su resultado (RESULTADO / ARCHIVOS / DECISION). Tipos: mecanico, lectura, codigo-acotado, codigo-multi, frontend, diseno, debug. Sin `-m`, `pa` elige el modelo según el tipo.",
  "- Varias tareas a la vez, o una larga: `pa <proyecto> --async --tipo <tipo> \"<tarea>\"` imprime el id; después `pa --esperar <proyecto> --id <id>` (o `pa --esperar-todos`) trae el resultado.",
  "- `<proyecto>` es un nombre de `~/.config/proyectos/registry.json` (`proyecto-ruta --listar` los muestra). Si el proyecto no está, decíselo a la persona; no lo inventes.",
  "- Lo que hace un worker queda en una rama: no está en main hasta `pa <proyecto> --integrar <id>`. No toques vos el código de un proyecto: delegá.",
  "Si tenés el skill `trama-orquestar` (`~/.claude/skills/trama-orquestar/SKILL.md`), leelo con view_file antes de delegar algo más que lo básico: dice qué modelo y `--tipo` conviene, cómo integrar y cómo seguir a un worker.",
  "Tus herramientas son las de agy (comandos, archivos, búsqueda). Contestá en el idioma en que te escriben, claro y al grano, y contá qué hiciste.",
  "Antes de algo que no se deshace (borrar, sobrescribir, publicar), preguntá. Las reglas de abajo son los CLAUDE.md de esta persona: valen tal cual.",
].join("\n");

/** La skill genérica del producto: la del prompt de arriba y la que se usa si no hay otra. */
export const SKILL_GENERICA = "trama-orquestar";

/**
 * Qué skill de orquestación existe en `home`: la propia de la persona (otra `<algo>-orquestar` en `~/.claude/skills`, con
 * su SKILL.md; la primera por orden alfabético) manda; si no hay, la genérica del producto (`trama-orquestar`).
 */
export async function skillOrquestar(home: string): Promise<string> {
  const dir = path.join(home, ".claude", "skills");
  const nombres = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith("-orquestar") && n !== SKILL_GENERICA).sort();
  for (const n of nombres) if (await access(path.join(dir, n, "SKILL.md")).then(() => true, () => false)) return n;
  return SKILL_GENERICA;
}

/**
 * El prefacio completo de un líder de Gemini en `cwd`: lo de arriba más sus CLAUDE.md. Un archivo ilegible no lo tira.
 * `pa`: dónde está el binario si se encontró con ruta absoluta; se lo dice por si el PATH de la herramienta de comandos de
 * agy no lo trae (la unidad de systemd y el menú de apps arrancan sin `~/.local/bin`), así nunca queda en "pa: command not found".
 */
export async function prefacioGemini(x: { home: string; cwd?: string; pa?: string; deps?: Partial<DepsContexto> }): Promise<string> {
  const c = await armarContexto({ home: x.home, cwd: x.cwd, ctx: 40000, perfil: "gemini", deps: x.deps }).catch(() => null);
  const skill = await skillOrquestar(x.home);
  const base = skill === SKILL_GENERICA ? PROMPT_GEMINI : PROMPT_GEMINI.replaceAll(SKILL_GENERICA, skill);
  const prompt = x.pa && path.isAbsolute(x.pa) ? `${base}\nSi un comando dice "pa: command not found", \`pa\` está en \`${x.pa}\`: llamalo con esa ruta.` : base;
  return c?.texto ? `${prompt}\n\n${c.texto}` : prompt;
}
