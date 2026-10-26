// Archivos de estado de `pa` (`<estado>/<slug>/<id>.{hilo,corrida,sid,pid,puesto,jefe,json}` y `<estado>/<slug>.running`):
// el MISMO formato que escribe y lee `motor/bin/pa` (bash), para que la app y los scripts viejos se entiendan.
// `clave=valor` por línea (el valor es el resto de la línea; sin comillas ni escapes), en un orden fijo.
// `.sid`, `.pid`, `.puesto` y `.cola` son el valor pelado, sin salto de línea final.
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { conCandado, type OpcionesCandado } from "./candado.ts";

/** `${v//$'\n'/ }`: un valor es una sola línea. */
export const aplanar = (v: string | number | undefined | null): string => String(v ?? "").replace(/\n/g, " ");

/** `leer_campo`: lo que sigue a `campo=` en la primera línea que empieza así ("" si no está). */
export function campoDe(texto: string, campo: string): string {
  const pre = `${campo}=`;
  for (const l of texto.split("\n")) if (l.startsWith(pre)) return l.slice(pre.length);
  return "";
}

/** Todos los `clave=valor` (`[a-z_]+`); si una clave se repite gana la última, como el `add` de jq en `--hilos`. */
export function camposDe(texto: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of texto.split("\n")) {
    const m = /^([a-z_]+)=(.*)$/.exec(l);
    if (m) r[m[1]] = m[2];
  }
  return r;
}

/** El archivo entero, o `null` si no está (o no se puede leer). */
export async function leerTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8");
  } catch {
    return null;
  }
}

export async function leerCampo(ruta: string, campo: string): Promise<string> {
  const t = await leerTexto(ruta);
  return t === null ? "" : campoDe(t, campo);
}

/** La primera línea (`head -n1`), o `null` si no hay archivo. */
export async function primeraLinea(ruta: string): Promise<string | null> {
  const t = await leerTexto(ruta);
  return t === null ? null : (t.split("\n")[0] ?? "");
}

/** `clave=valor\n` por cada par, en orden. */
export const armarClaveValor = (pares: ReadonlyArray<readonly [string, string | number | undefined | null]>): string =>
  pares.map(([k, v]) => `${k}=${aplanar(v)}\n`).join("");

/** Escribe sin que un lector vea el archivo a medias (temporal + rename; en Windows el rename pisa el destino). */
export async function escribirAtomico(ruta: string, texto: string): Promise<void> {
  await mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, texto);
    await rename(tmp, ruta);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

// --- rutas ---

export type Rutas = { estado: string };
export const dirProyecto = (estado: string, slug: string) => path.join(estado, slug);
/** `<slug>.running` (puesto 1), `<slug>@2.running`, `<slug>@aca.running`: `puesto` "1" o vacío no lleva sufijo. */
export const sufijoPuesto = (puesto: string | number | undefined) => (puesto === undefined || puesto === "" || String(puesto) === "1" ? "" : `@${puesto}`);
export const rutaRunning = (estado: string, slug: string, puesto?: string | number) => path.join(estado, `${slug}${sufijoPuesto(puesto)}.running`);
export const rutaRunningLeer = (estado: string, slug: string, id: string) => path.join(estado, `${slug}.leer-${id}.running`);
export const rutaDe = (dir: string, id: string, ext: string) => path.join(dir, `${id}.${ext}`);

/** Un slug de proyecto: el nombre de la carpeta, minúscula, `[A-Za-z0-9._-]` (el resto va a `-`). */
export const slugDe = (rutaProyecto: string): string => {
  const base = rutaProyecto.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return base.replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
};

// --- `.running`: la corrida viva ---

export type Running = {
  pid?: number | string; pa_pid?: number | string; inicio?: number | string; proyecto: string; id: string; ruta?: string;
  ruta_trabajo?: string; rama?: string; modelo?: string; leer?: number | string; jefe?: string; jefe_id?: string;
  puesto?: string | number; salida?: string; sid?: string; transcript?: string; tarea?: string;
};
export const textoRunning = (r: Running) =>
  armarClaveValor([
    ["pid", r.pid], ["pa_pid", r.pa_pid], ["inicio", r.inicio], ["proyecto", r.proyecto], ["id", r.id], ["ruta", r.ruta],
    ["ruta_trabajo", r.ruta_trabajo], ["rama", r.rama], ["modelo", r.modelo], ["leer", r.leer], ["jefe", r.jefe],
    ["jefe_id", r.jefe_id], ["puesto", r.puesto], ["salida", r.salida], ["sid", r.sid], ["transcript", r.transcript], ["tarea", r.tarea],
  ]);
export const escribirRunning = (ruta: string, r: Running) => escribirAtomico(ruta, textoRunning(r));

// --- `.corrida`: dónde corrió y en qué rama (la borra integrar/descartar) ---

export type Corrida = { ruta_trabajo?: string; rama?: string; base?: string; proyecto: string; origen?: string; leer?: number | string; puesto?: string | number; jefe?: string; jefe_id?: string };
export const textoCorrida = (c: Corrida) =>
  armarClaveValor([
    ["ruta_trabajo", c.ruta_trabajo], ["rama", c.rama], ["base", c.base], ["proyecto", c.proyecto], ["origen", c.origen],
    ["leer", c.leer], ["puesto", c.puesto], ["jefe", c.jefe], ["jefe_id", c.jefe_id],
  ]);
/** Sólo si no existe: un `--seguir` ya tiene la suya. */
export async function escribirCorrida(ruta: string, c: Corrida): Promise<boolean> {
  if ((await leerTexto(ruta)) !== null) return false;
  await escribirAtomico(ruta, textoCorrida(c));
  return true;
}

// --- `.hilo`: el registro durable de la corrida ---

export type Hilo = {
  tarea?: string; modelo?: string; effort?: string; inicio?: number | string; proyecto: string; ruta_trabajo?: string; rama?: string;
  origen?: string; leer?: number | string; puesto?: string | number; lanzo?: string; jefe?: string; jefe_id?: string; tipo?: string;
};
export const textoHilo = (h: Hilo) =>
  armarClaveValor([
    ["tarea", h.tarea], ["modelo", h.modelo], ["effort", h.effort], ["inicio", h.inicio], ["proyecto", h.proyecto],
    ["ruta_trabajo", h.ruta_trabajo], ["rama", h.rama], ["origen", h.origen], ["leer", h.leer], ["puesto", h.puesto],
    ["lanzo", h.lanzo], ["jefe", h.jefe], ["jefe_id", h.jefe_id], ["tipo", h.tipo],
  ]);
export async function escribirHilo(ruta: string, h: Hilo): Promise<boolean> {
  if ((await leerTexto(ruta)) !== null) return false;
  await escribirAtomico(ruta, textoHilo(h));
  return true;
}

/**
 * `hilo_poner`: pone UN campo del `.hilo` (borra el que había y lo agrega al final), bajo candado.
 * Mismo resultado que el `grep -v "^campo="` + `printf` del bash.
 */
export async function hiloPoner(ruta: string, campo: string, valor: string | number, op?: OpcionesCandado): Promise<void> {
  await conCandado(
    `${ruta}.lock`,
    async () => {
      const actual = (await leerTexto(ruta)) ?? "";
      const pre = `${campo}=`;
      const resto = actual.split("\n").filter((l, i, a) => !l.startsWith(pre) && !(l === "" && i === a.length - 1));
      await writeFile(ruta, [...resto, `${campo}=${aplanar(valor)}`].join("\n") + "\n");
    },
    { espera: 5000, ...op },
  );
}

/** `anotar_fin`: la hora en que se vio terminar la corrida (`fin=<epoch>` en el `.hilo`); no pisa una ya escrita. */
export async function anotarFin(dir: string, id: string, ahora: number): Promise<void> {
  const hilo = rutaDe(dir, id, "hilo");
  const hayHilo = (await leerTexto(hilo)) !== null;
  const hayPid = (await leerTexto(rutaDe(dir, id, "pid"))) !== null;
  if (!hayHilo && !hayPid) return;
  if (await leerCampo(hilo, "fin")) return;
  try {
    await hiloPoner(hilo, "fin", ahora);
  } catch {
    // nunca rompe: la app estima la hora de muerte
  }
}

// --- valores pelados y chicos ---

export const escribirSid = (dir: string, id: string, sid: string) => escribirAtomico(rutaDe(dir, id, "sid"), sid);
export const escribirPuesto = (dir: string, id: string, puesto: string | number) => escribirAtomico(rutaDe(dir, id, "puesto"), String(puesto));
export const escribirPid = (dir: string, id: string, pid: number | string) => escribirAtomico(rutaDe(dir, id, "pid"), String(pid));
/** `.jefe`: de quién es una corrida --async mientras espera en cola (todavía no tiene `.corrida`). */
export const escribirJefe = (dir: string, id: string, jefe: string, jefeId: string) =>
  escribirAtomico(rutaDe(dir, id, "jefe"), armarClaveValor([["jefe", jefe], ["jefe_id", jefeId]]));
/** `.cola`: por qué espera. */
export const escribirCola = (dir: string, id: string, motivo: string) => escribirAtomico(rutaDe(dir, id, "cola"), motivo);

// --- eventos.jsonl ---

/** `evento`: una línea JSON por cosa que le pasa a una corrida, para que la app se entere sin sondear el disco. Nunca rompe. */
export async function evento(estado: string, tipo: string, id: string, proyecto: string, ahora: number, rc?: string | number): Promise<void> {
  try {
    const o: Record<string, unknown> = { version: 1, ts: Math.floor(ahora), tipo, id, proyecto };
    if (rc !== undefined && rc !== "") o.rc = typeof rc === "number" || !/^-?\d+$/.test(rc) ? rc : Number(rc);
    await mkdir(estado, { recursive: true });
    await appendFile(path.join(estado, "eventos.jsonl"), JSON.stringify(o) + "\n");
  } catch {
    // la app lo recupera sondeando
  }
}

// --- plan de la suscripción ---

export type Plan = "pro" | "max";
/** `plan_de`: `PA_PLAN`, si no la primera línea de `<estado>/plan`, si no `pro`. Devuelve también si vino inválido. */
export async function planDe(estado: string, env: Record<string, string | undefined>): Promise<{ plan: Plan; invalido: string | null }> {
  let p = env.PA_PLAN ?? "";
  if (p === "") p = ((await primeraLinea(path.join(estado, "plan"))) ?? "").replace(/\s+/g, "");
  p = p.toLowerCase() || "pro";
  return p === "pro" || p === "max" ? { plan: p, invalido: null } : { plan: "pro", invalido: p };
}


// --- ids ---

/** `proyecto_de_id`: el slug de la carpeta de estado donde está la corrida, o el de la fila de `integradas.tsv`; `""` si no está. */
export async function proyectoDeId(estado: string, id: string): Promise<string> {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) return "";
  let nombres: string[] = [];
  try {
    nombres = (await readdir(estado)).sort();
  } catch {
    // sin estado todavía
  }
  for (const ext of ["corrida", "hilo", "json", "pid"]) {
    for (const s of nombres) {
      if (s === "worktrees" || s === "lock") continue;
      try {
        if ((await stat(path.join(estado, s, `${id}.${ext}`))).isFile()) return s;
      } catch {
        // no está en ésta
      }
    }
  }
  const tsv = (await leerTexto(path.join(estado, "integradas.tsv"))) ?? "";
  let fila = "";
  for (const l of tsv.split("\n").slice(1)) if (l.split("\t")[1] === id) fila = l;
  return fila.split("\t")[2] ?? "";
}
