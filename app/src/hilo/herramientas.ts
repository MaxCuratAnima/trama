// Lo que hizo el modelo, herramienta por herramienta (B19), como lo muestra la
// terminal de Claude Code: una línea por llamada ("Bash · Corre los tests",
// "Edit · src/x.ts +3 −1") y, al abrirla, el comando entero o el diff. Puro: lo
// prueba `tests/herramientas.test.ts`.
import type { Herramienta } from "../datos/contrato";
import { esShell } from "./shell.ts";

/** Lo que `pa --hilo` (y el transcript de un líder) deja de cada texto de la entrada. */
export const CORTE = 2000;

/** Una llamada como se ve en la lista: el nombre y lo que hizo en un renglón. */
export type Uso = { nombre: string; resumen: string; det: Herramienta | null };

/** Varias llamadas seguidas con el mismo resumen van en una línea ("×3"). */
export type Grupo = { uso: Uso; todos: Uso[] };

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const renglon = (s: string, n = 160) => {
  const r = s.split("\n").find((x) => x.trim()) ?? "";
  const t = r.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const ARCHIVO = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "NotebookRead"]);
const PATRON = new Set(["Grep", "Glob"]);
const DESCRIPCION = new Set(["Agent", "Task"]);
/** Para el resto: el campo que más dice, en este orden. */
const OTROS = ["description", "command", "file_path", "path", "pattern", "url", "query", "skill", "prompt", "to", "subject", "name"];

/**
 * La ruta relativa al proyecto. El directorio del transcript es el cwd de la
 * sesión con todo lo que no es letra o número cambiado por "-"
 * (`~/.claude/projects/-home-x-proy/<sid>.jsonl`): el ancestro de la ruta que da
 * ese nombre es la raíz. Si no hay, el home se abrevia "~".
 */
export function relativa(ruta: string, transcript: string | null): string {
  const dir = transcript?.split("/").slice(-2, -1)[0];
  if (dir && ruta.startsWith("/")) {
    const partes = ruta.split("/");
    for (let k = partes.length - 1; k > 1; k--) {
      const raiz = partes.slice(0, k).join("/");
      if (raiz.replace(/[^A-Za-z0-9]/g, "-") === dir) return partes.slice(k).join("/") || ruta;
    }
  }
  return ruta.replace(/^\/home\/[^/]+(?=\/|$)/, "~");
}

/** Lo que hizo una llamada en un renglón: Bash → su descripción; los de archivo → la ruta; etc. */
export function resumen(nombre: string, entrada: Record<string, unknown>, transcript: string | null = null): string {
  const e = entrada ?? {};
  if (esShell(nombre)) return renglon(str(e.description) ?? str(e.command) ?? "");
  if (ARCHIVO.has(nombre)) {
    const r = str(e.file_path) ?? str(e.notebook_path) ?? str(e.path);
    return r ? relativa(r.trim(), transcript) : "";
  }
  if (PATRON.has(nombre)) return renglon(str(e.pattern) ?? "");
  if (DESCRIPCION.has(nombre)) return renglon(str(e.description) ?? str(e.prompt) ?? "");
  if (nombre === "SendMessage") return renglon(str(e.to) ?? str(e.recipient) ?? "");
  if (nombre === "ToolSearch") return renglon(str(e.query) ?? "");
  const k = OTROS.find((c) => str(e[c]));
  return k ? renglon(String(e[k])) : "";
}

/** "Bash: git status" (lo que había antes de B19, y lo que trae un evento sin `det`) → nombre y resumen. */
export function deTexto(h: string): Uso {
  const i = h.indexOf(": ");
  return i > 0 ? { nombre: h.slice(0, i), resumen: h.slice(i + 2), det: null } : { nombre: h, resumen: "", det: null };
}

/** Las llamadas de un mensaje: con `det` si lo trae (el mismo orden que `herramientas`), si no por nombre. */
export function usosDe(herramientas: string[], det: Herramienta[] | undefined, transcript: string | null): Uso[] {
  if (det && det.length) return det.map((d) => ({ nombre: d.nombre, resumen: resumen(d.nombre, d.entrada, transcript), det: d }));
  return herramientas.map(deTexto);
}

/** Sólo las seguidas e iguales (mismo nombre y resumen) van juntas. */
export function agrupar(usos: Uso[]): Grupo[] {
  const out: Grupo[] = [];
  for (const u of usos) {
    const p = out[out.length - 1];
    if (p && p.uso.nombre === u.nombre && p.uso.resumen === u.resumen) p.todos.push(u);
    else out.push({ uso: u, todos: [u] });
  }
  return out;
}

// --- Diff ---------------------------------------------------------------------

export type LineaDiff = { tipo: " " | "-" | "+"; texto: string };

const lineas = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/**
 * Diff por líneas de `a` → `b`: lo común de los bordes afuera y una LCS en el
 * medio (los textos vienen recortados a 2000 caracteres: alcanza y sobra).
 */
export function diffLineas(a: string, b: string): LineaDiff[] {
  const x = lineas(a);
  const y = lineas(b);
  let ini = 0;
  while (ini < x.length && ini < y.length && x[ini] === y[ini]) ini++;
  let fin = 0;
  while (fin < x.length - ini && fin < y.length - ini && x[x.length - 1 - fin] === y[y.length - 1 - fin]) fin++;
  const xm = x.slice(ini, x.length - fin);
  const ym = y.slice(ini, y.length - fin);
  const n = xm.length;
  const m = ym.length;
  // lcs[i][j]: la más larga de xm[i..] e ym[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = xm[i] === ym[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const medio: LineaDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xm[i] === ym[j]) {
      medio.push({ tipo: " ", texto: xm[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) medio.push({ tipo: "+", texto: ym[j++] });
    else medio.push({ tipo: "-", texto: xm[i++] });
  }
  // Los "-" de un tramo antes que sus "+", como en un diff unificado.
  for (let k = 0; k < medio.length; ) {
    if (medio[k].tipo === " ") {
      k++;
      continue;
    }
    let f = k;
    while (f < medio.length && medio[f].tipo !== " ") f++;
    const tramo = medio.slice(k, f);
    medio.splice(k, f - k, ...tramo.filter((l) => l.tipo === "-"), ...tramo.filter((l) => l.tipo === "+"));
    k = f;
  }
  return [...x.slice(0, ini).map(comun), ...medio, ...x.slice(x.length - fin).map(comun)];
}

const comun = (texto: string): LineaDiff => ({ tipo: " ", texto });

/** Cuántas líneas agrega y saca. */
export function contar(d: LineaDiff[]): { mas: number; menos: number } {
  let mas = 0;
  let menos = 0;
  for (const l of d) if (l.tipo === "+") mas++;
    else if (l.tipo === "-") menos++;
  return { mas, menos };
}

/** Lo que muestra una llamada al abrirse. */
export type Cuerpo =
  | { tipo: "comando"; comando: string; cortado: boolean }
  /** Edit/MultiEdit/Write: los tramos del diff (MultiEdit, uno por edición), y si alguno vino recortado. */
  | { tipo: "diff"; tramos: LineaDiff[][]; cortado: boolean }
  | { tipo: "nada" };

const cortado = (s: unknown) => typeof s === "string" && s.length >= CORTE;

/** El comando, el diff o nada (los demás muestran sólo su línea). */
export function cuerpo(d: Herramienta | null): Cuerpo {
  if (!d) return { tipo: "nada" };
  const e = d.entrada ?? {};
  if (esShell(d.nombre) && typeof e.command === "string") return { tipo: "comando", comando: e.command, cortado: !!d.cortado || cortado(e.command) };
  if (d.nombre === "Edit" && typeof e.old_string === "string" && typeof e.new_string === "string")
    return { tipo: "diff", tramos: [diffLineas(e.old_string, e.new_string)], cortado: !!d.cortado || cortado(e.old_string) || cortado(e.new_string) };
  if (d.nombre === "MultiEdit" && Array.isArray(e.edits)) {
    const eds = (e.edits as any[]).filter((x): x is { old_string: string; new_string: string } => typeof x?.old_string === "string" && typeof x?.new_string === "string");
    return {
      tipo: "diff",
      tramos: eds.map((x) => diffLineas(x.old_string, x.new_string)),
      cortado: !!d.cortado || eds.some((x) => cortado(x.old_string) || cortado(x.new_string)),
    };
  }
  if (d.nombre === "Write" && typeof e.content === "string")
    return { tipo: "diff", tramos: [diffLineas("", e.content)], cortado: !!d.cortado || cortado(e.content) };
  return { tipo: "nada" };
}

/** "+3 −1" de un Edit/MultiEdit/Write (sin abrirlo), o `null`. */
export function cambios(d: Herramienta | null): { mas: number; menos: number } | null {
  const c = cuerpo(d);
  if (c.tipo !== "diff") return null;
  return c.tramos.map(contar).reduce((a, b) => ({ mas: a.mas + b.mas, menos: a.menos + b.menos }), { mas: 0, menos: 0 });
}

// --- Relevo -------------------------------------------------------------------
// El relevo del líder (`bin/relevo` del orquestador): el líder viejo corre `relevo` por Bash
// (suele ir detrás de `pa --nota '…' &&`); si arrancó la sesión nueva dice "sesión nueva
// corriendo (pid N)", y la nueva empieza con un prompt fijo que nombra el traspaso.

const RELEVO = /(?:^|&&|;|\|\||\n)\s*(?:\S*\/)?relevo(?=\s|$)/;
const RELEVO_OK = /sesión nueva corriendo/;
const RELEVO_VIENE = /Esto es un RELEVO automático/;

/** La llamada es `relevo`. */
export const esRelevo = (d: Herramienta | null) => !!d && d.nombre === "Bash" && typeof d.entrada?.command === "string" && RELEVO.test(d.entrada.command);

/** El relevo salió (la sesión nueva arrancó). */
export const relevoHecho = (d: Herramienta | null) => !!d?.resultado && !d.resultado.error && RELEVO_OK.test(d.resultado.texto);

/** El primer mensaje de un líder que viene de un relevo; `traspaso`: el archivo que le dejó el viejo. */
export function vieneDeRelevo(texto: string): { traspaso: string | null } | null {
  if (!RELEVO_VIENE.test(texto)) return null;
  return { traspaso: texto.match(/(\S*relevo-[\d-]+\.md)/)?.[1] ?? null };
}
