// Lo que piden los tres paneles del pie de la barra: Ajustes (sólo lectura),
// Ramas (integrar, descartar, deshacer) y Estadísticas (`medicion.tsv`). Node
// puro, como pa.ts, para probarlo desde la terminal con el `pa` falso:
//   HILOS_PA=scripts/pa-falso.sh node -e 'import("./dist-electron/paneles.js").then(m => m.accionRama(…))'
import { execFile } from "node:child_process";
import { execFileCmd } from "./procesos.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decisionDeConversacion, resultadoDeConversacion, type DatosPasar, type RamaBrief } from "./asistente.js";
import { leerUmbral } from "./contexto.js";
import { errorT, textoT } from "./errores.ts";
import { argvIntegrarPa, ENV, ID, nombrePa, PA, PA_STATE, PROYECTO, proyectoPa } from "./pa.js";
import { registro } from "./registro.js";
import { leerRouting, type Routing } from "./routing.js";
import { mientrasIntegra, estadoSalud, type Chequeo, type FilaIntegrada } from "./salud.js";
import { sesionesVivas } from "./sesiones.js";
import { silencio } from "./log.js";

/**
 * Corre `pa` (execFile, sin shell) y cuenta cómo terminó en vez de rechazar: el
 * código de salida importa (93 son tests rojos) y un `Error` no lo cruzaría por IPC.
 */
export function ejecutar(args: string[], env: NodeJS.ProcessEnv = ENV): Promise<{ rc: number; out: string; dijo: string }> {
  return new Promise((ok) => {
    execFileCmd(PA, args, { env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const dijo = String(stderr).trim().split("\n").filter(Boolean).slice(-2).join(" · ");
      if (!err) return ok({ rc: 0, out: stdout, dijo });
      ok({
        rc: typeof err.code === "number" ? err.code : -1,
        out: stdout,
        dijo: dijo || `${path.basename(PA)} ${args[0]}: ${err.message}`,
      });
    });
  });
}

// --- Ajustes ---------------------------------------------------------------------

export type Ajustes = {
  version: 1;
  /** `pa --plan`: "pro" o "max". `null` si `pa` no lo dijo (el porqué va en `plan_error`). */
  plan: string | null;
  plan_error: string | null;
  /** `autoCompactWindow` de `~/.claude/settings.json`; `null` si no está. */
  red_seguridad: number | null;
  /** Las filas de worker de la tabla de routing de `~/CLAUDE.md` (electron/routing.ts). */
  routing: Routing;
};

export async function leerAjustes(): Promise<Ajustes> {
  const [p, red, routing] = await Promise.all([ejecutar(["--plan"]), leerUmbral(), leerRouting()]);
  const plan = p.rc === 0 ? (/^plan:\s*(\w+)/m.exec(p.out)?.[1] ?? null) : null;
  return {
    version: 1,
    plan,
    plan_error: plan ? null : p.dijo || textoT("main.planNoDijo"),
    red_seguridad: red,
    routing,
  };
}

// --- Estadísticas ----------------------------------------------------------------

/**
 * Cuánto para atrás se manda al frontend: el panel muestra 7 o 30 días, el
 * consumo diario de 60 y compara contra la semana y los 7 días anteriores.
 */
const DIAS = 60;
/** El historial de la cuota llega más lejos: las semanas anteriores son lo que importa. */
const DIAS_CUOTA = 120;

/** Una corrida de `medicion.tsv`. `costo_usd` no cruza: El usuario paga suscripción. */
export type Corrida = {
  /** Cuándo terminó (epoch, segundos). */
  ts: number;
  proyecto: string;
  modelo: string;
  duracion_s: number;
  /** input + cache_read + output (así lo anota `pa`). */
  tokens: number;
  /** La columna `bien`, que es texto libre: se clasifica por cómo empieza. */
  bien: "si" | "parcial" | "no" | null;
  /** `null` en las corridas de antes de que existiera la columna. */
  compactaciones: number | null;
  cache_read: number | null;
};

/**
 * Una línea de `statusline/historial.jsonl` (la escribe el espejo del statusline
 * cada vez que cambia algo): % real de la cuota de 5 h y de la semanal, y cuándo
 * se renueva cada una (epoch, segundos).
 */
export type Muestra = { ts: number; h5: number; h5_reset: number; sem: number; sem_reset: number };

export type Medicion =
  | {
      version: 1;
      corridas: Corrida[];
      /** La primera fila de todo el archivo (antes de cortar a 60 días); `null` si no hay ninguna. */
      desde: number | null;
      /** `null` si todavía no existe `historial.jsonl`. */
      cuota: Muestra[] | null;
    }
  | { version: 1; error: string }
  // Sin `medicion.tsv` todavía: ningún worker corrió. No es un error: Estadísticas lo muestra como estado vacío.
  | { version: 1; vacia: true };

const numero = (s: string | undefined) => (s === undefined || s.trim() === "" || isNaN(Number(s)) ? null : Number(s));

function clasificar(bien: string | undefined): Corrida["bien"] {
  const b = (bien ?? "").trim().toLowerCase();
  if (/^s[ií]\b/.test(b)) return "si";
  if (b.startsWith("parcial")) return "parcial";
  if (/^no\b/.test(b)) return "no";
  return null;
}

const esNumero = (x: unknown): x is number => typeof x === "number" && isFinite(x);

/** `historial.jsonl` de los últimos 120 días; las líneas rotas se saltean. */
export async function leerCuota(ahora = Date.now() / 1000): Promise<Muestra[] | null> {
  let texto: string;
  try {
    texto = await readFile(path.join(PA_STATE, "statusline", "historial.jsonl"), "utf8");
  } catch {
    return null;
  }
  const muestras: Muestra[] = [];
  for (const l of texto.split("\n")) {
    if (!l.trim()) continue;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(l);
    } catch {
      continue;
    }
    const { ts, h5, h5_reset, sem, sem_reset } = m ?? {};
    if (![ts, h5, h5_reset, sem, sem_reset].every(esNumero)) continue;
    if ((ts as number) < ahora - DIAS_CUOTA * 86400) continue;
    muestras.push({ ts, h5, h5_reset, sem, sem_reset } as Muestra);
  }
  return muestras.sort((a, b) => a.ts - b.ts);
}

/**
 * `medicion.tsv` de los últimos 60 días, con el historial de la cuota. Las
 * columnas se buscan por el nombre del encabezado: las filas viejas son más
 * cortas (`pa` fue sumando columnas).
 */
export async function leerMedicion(ahora = Date.now() / 1000): Promise<Medicion> {
  let texto: string;
  try {
    texto = await readFile(path.join(PA_STATE, "medicion.tsv"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { version: 1, vacia: true };
    return { version: 1, error: textoT("main.medicionNoLee", { que: (e as NodeJS.ErrnoException)?.code ?? "error" }) };
  }
  const [cab, ...lineas] = texto.split("\n");
  const col = new Map(cab.split("\t").map((n, i) => [n.trim(), i]));
  const faltan = ["fecha", "proyecto", "modelo", "duration_s", "tokens"].filter((c) => !col.has(c));
  if (faltan.length) return { version: 1, error: textoT("main.medicionColumnas", { c: faltan.join(", ") }) };

  const corridas: Corrida[] = [];
  let desde: number | null = null;
  for (const l of lineas) {
    if (!l) continue;
    const c = l.split("\t");
    const campo = (n: string) => (col.has(n) ? c[col.get(n)!] : undefined);
    const ts = Date.parse(campo("fecha") ?? "") / 1000;
    if (isNaN(ts)) continue;
    if (desde === null || ts < desde) desde = ts;
    if (ts < ahora - DIAS * 86400) continue;
    corridas.push({
      ts,
      proyecto: campo("proyecto") || "?",
      modelo: campo("modelo") || "?",
      duracion_s: numero(campo("duration_s")) ?? 0,
      tokens: numero(campo("tokens")) ?? 0,
      bien: clasificar(campo("bien")),
      compactaciones: numero(campo("compactaciones")),
      cache_read: numero(campo("cache_read")),
    });
  }
  return { version: 1, corridas, desde, cuota: await leerCuota(ahora) };
}

// --- Ramas -----------------------------------------------------------------------

/** La última acción de rama encolada de cada proyecto: van de a una (dos `--integrar` a la vez, `pa` sale 75). */
const colas = new Map<string, Promise<unknown>>();

/** Corre `fn` cuando terminen las acciones de rama anteriores del mismo proyecto (las del usuario y las solas). */
export function enCola<T>(proyecto: string, fn: () => Promise<T>): Promise<T> {
  const antes = colas.get(proyecto) ?? Promise.resolve();
  const esta = antes.catch(silencio("paneles")).then(fn);
  colas.set(proyecto, esta);
  void esta.finally(() => {
    if (colas.get(proyecto) === esta) colas.delete(proyecto);
  }).catch(silencio("paneles"));
  return esta;
}

export type AccionRama = "integrar" | "descartar" | "revertir";

/**
 * Integrar: `pa <proy> --integrar <id> [--tests]` (93: tests rojos, main sin
 * tocar). Descartar: `pa --descartar <id>`. Deshacer: `pa --revertir <id>`.
 * Id y proyecto se validan: van como argumentos y un "-" adelante sería un flag.
 */
export async function accionRama(accion: AccionRama, h: { id: string; proyecto: string }) {
  if (!ID.test(String(h.id))) throw errorT("main.idRaro", { v: String(h.id) });
  let args: string[];
  if (accion === "integrar") {
    if (!PROYECTO.test(String(h.proyecto))) throw errorT("main.proyectoRaro", { v: String(h.proyecto) });
    // `pa --hilos` dice la carpeta ("atlas"); `pa <proy>` quiere el nombre del registry ("Atlas Web").
    // `--tests` sólo si el registry le da `tests` al proyecto (si no, `pa` sale 2 sin integrar).
    args = await argvIntegrarPa(h.proyecto, h.id);
  } else if (accion === "descartar") args = ["--descartar", h.id];
  else if (accion === "revertir") args = ["--revertir", h.id];
  else throw errorT("main.accionRara", { v: String(accion) });
  const { rc, dijo } = await enCola(String(h.proyecto), () =>
    // Un chequeo de salud (B25) no corre mientras alguien mueve main.
    accion === "descartar" ? ejecutar(args) : mientrasIntegra(String(h.proyecto), () => ejecutar(args)),
  );
  return { rc, dijo };
}

/** Lo que se le puede pedir a un worker desde Ramas: hoy rebasear una rama que chocó con main (`pa --actualizar`). */
export type LanzarRama = {
  accion: "actualizar";
  id: string;
  proyecto: string;
  /** El modelo de `pa -m` (`pa` rechaza el que no va y su mensaje vuelve tal cual). */
  modelo: string;
  effort: string;
  /** Contexto opcional para el worker (`pa` lo agrega como "Contexto del jefe"). */
  texto?: string;
};

/** Clase de tarea de cada acción, para `pa --tipo` (agrupa `pa --rinde`). Rebasear es mecánico. */
export const TIPO_DE: Record<LanzarRama["accion"], string> = { actualizar: "mecanico" };

const MODELO_PA = /^[A-Za-z0-9][\w.\[\]-]*$/;
const EFFORT_PA = /^(low|medium|high|xhigh|max)$/;

/** Los argumentos de `pa` para lanzar un worker de rama: modelo, effort y tipo siempre; validados porque van como argumentos. */
export async function argvLanzarRama(x: LanzarRama): Promise<string[]> {
  if (!ID.test(String(x.id))) throw errorT("main.idRaro", { v: String(x.id) });
  if (!PROYECTO.test(String(x.proyecto))) throw errorT("main.proyectoRaro", { v: String(x.proyecto) });
  if (!(x.accion in TIPO_DE)) throw errorT("main.accionRara", { v: String(x.accion) });
  if (!MODELO_PA.test(String(x.modelo))) throw errorT("main.modeloRaro", { v: String(x.modelo) });
  if (!EFFORT_PA.test(String(x.effort))) throw errorT("main.effortRaro", { v: String(x.effort) });
  const texto = typeof x.texto === "string" ? x.texto.trim() : "";
  const nombre = await nombrePa(x.proyecto);
  return [
    nombre,
    "--actualizar",
    x.id,
    "--async",
    "-m",
    x.modelo,
    "--effort",
    x.effort,
    "--tipo",
    TIPO_DE[x.accion],
    ...(texto ? ["--", texto] : []),
  ];
}

/**
 * "Actualizar" una rama con el modelo y el effort que eligió el usuario: `pa <proy> --actualizar <id> --async -m … --effort … --tipo mecanico`.
 * Va por la cola del proyecto (como el `--actualizar` de integrar solo) y vuelve en cuanto `pa` lo deja corriendo.
 */
export async function lanzarRama(x: LanzarRama) {
  const args = await argvLanzarRama(x);
  const { rc, dijo } = await enCola(String(x.proyecto), () => ejecutar(args));
  return { rc, dijo };
}

// --- Asistente de Ramas ----------------------------------------------------------

/** Cuántos commits de la rama van en el prompt (el asistente ve el resto con git). */
const COMMITS = 20;

/** Los commits de la rama que no están en el HEAD del proyecto (`git log`, sin shell); `null` si git no pudo. */
function commitsDe(ruta: string, rama: string): Promise<string[] | null> {
  return new Promise((ok) => {
    execFile(
      "git",
      ["-C", ruta, "log", "--oneline", "--no-decorate", `-${COMMITS + 1}`, `HEAD..${rama}`, "--"],
      { maxBuffer: 1024 * 1024 },
      (err, out) => ok(err ? null : String(out).split("\n").filter(Boolean)),
    );
  });
}

/** La conversación del final (`pa --hilo <id> --json -n 6`), sin validar; `null` si `pa` no pudo. */
async function finalDe(id: string): Promise<unknown> {
  const r = await ejecutar(["--hilo", id, "--json", "-n", "6"]);
  if (r.rc !== 0) return null;
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

/**
 * "Pasárselo a un líder": lo que lleva el primer mensaje del líder nuevo al que
 * El usuario le pasa un worker sin líder que quedó esperando una decisión (RESULTADO
 * y DECISION enteros por `pa --hilo`; los recortados de `pa --hilos` son el
 * respaldo). El texto lo arma src/datos/asistente.ts.
 */
export async function pasarALider(h: {
  id: string;
  proyecto: string;
  rama: string | null;
  commits: number;
  tarea: string;
  resultado: string | null;
  decision: string | null;
}): Promise<DatosPasar> {
  if (!ID.test(String(h.id))) throw errorT("main.idRaro", { v: String(h.id) });
  const rama = h.rama && /^[\w./-]+$/.test(String(h.rama)) && !String(h.rama).startsWith("-") ? String(h.rama) : null;
  const nombre = await nombrePa(h.proyecto);
  const p = (await registro()).find((x) => x.nombre === nombre);
  const [lista, conv] = await Promise.all([p && rama ? commitsDe(p.ruta, rama) : null, finalDe(h.id)]);
  return {
    id: h.id,
    proyecto: nombre,
    ruta: p?.ruta ?? null,
    rama,
    commits: lista ?? (Number(h.commits) || 0),
    tope: COMMITS,
    tarea: String(h.tarea ?? ""),
    resultado: resultadoDeConversacion(conv) ?? (h.resultado ? String(h.resultado) : null),
    decision: decisionDeConversacion(conv) ?? (h.decision ? String(h.decision) : null),
  };
}

/** "Retomar" (B22): lo de "Pasárselo" más cómo terminó y si el proyecto tiene `tests`. El texto, src/datos/retomar.ts. */
export async function retomarDatos(h: Parameters<typeof pasarALider>[0] & { estado: string }) {
  const [d, p] = await Promise.all([pasarALider(h), proyectoPa(h.proyecto)]);
  return { ...d, estado: String(h.estado ?? ""), tests: p.tests };
}

/** Los archivos que toca la rama (`git diff --name-only HEAD...rama`); `null` si git no pudo. */
function archivosDe(ruta: string, rama: string): Promise<string[] | null> {
  return new Promise((ok) => {
    execFile("git", ["-C", ruta, "diff", "--name-only", `HEAD...${rama}`, "--"], { maxBuffer: 1024 * 1024 }, (err, out) =>
      ok(err ? null : String(out).split("\n").filter(Boolean)),
    );
  });
}

/**
 * El brief del analista de Ramas (B22): por cada rama sin integrar, sus commits y
 * archivos (git, sin shell), cuánto hace que terminó y si su líder sigue vivo.
 * Lo que no tiene forma de id o de rama se descarta. El texto, src/datos/analista.ts.
 */
export async function briefRamas(
  hs: {
    id: string;
    proyecto: string;
    rama: string;
    estado: string;
    commits: number;
    tarea: string;
    resultado: string | null;
    decision: string | null;
    fin: number;
    jefe_id: string | null;
  }[],
): Promise<RamaBrief[]> {
  const lista = (Array.isArray(hs) ? hs : []).filter(
    (h) => ID.test(String(h?.id)) && /^[\w./-]+$/.test(String(h?.rama)) && !String(h.rama).startsWith("-"),
  );
  const [reg, sesiones] = await Promise.all([registro(), sesionesVivas()]);
  const vivas = new Set(sesiones.map((s) => s.id));
  const ahora = Math.floor(Date.now() / 1000);
  return Promise.all(
    lista.map(async (h) => {
      const nombre = await nombrePa(h.proyecto);
      const p = reg.find((x) => x.nombre === nombre);
      const rama = String(h.rama);
      const [commits, archivos] = p ? await Promise.all([commitsDe(p.ruta, rama), archivosDe(p.ruta, rama)]) : [null, null];
      return {
        id: h.id,
        proyecto: nombre,
        ruta: p?.ruta ?? null,
        rama,
        estado: String(h.estado ?? ""),
        tarea: String(h.tarea ?? ""),
        resultado: h.resultado ? String(h.resultado) : null,
        decision: h.decision ? String(h.decision) : null,
        commits: commits ?? (Number(h.commits) || 0),
        archivos,
        edad_s: Math.max(0, ahora - (Number(h.fin) || ahora)),
        lider_vivo: h.jefe_id ? vivas.has(String(h.jefe_id)) : null,
      };
    }),
  );
}

// --- Salud de lo integrado (B25) -------------------------------------------------

/** Cuántos commits de la integración van en el prompt de "Mandar a verificar y arreglar". */
const COMMITS_ARREGLAR = 30;

/** `git log --oneline antes..despues` (sin shell); `null` si git no pudo o los heads no tienen forma. */
function commitsEntre(ruta: string, antes: string, despues: string): Promise<string[] | null> {
  if (!/^[0-9a-f]{7,64}$/.test(antes) || !/^[0-9a-f]{7,64}$/.test(despues)) return Promise.resolve(null);
  return new Promise((ok) => {
    execFile(
      "git",
      ["-C", ruta, "log", "--oneline", "--no-decorate", `-${COMMITS_ARREGLAR + 1}`, `${antes}..${despues}`, "--"],
      { maxBuffer: 1024 * 1024 },
      (err, out) => ok(err ? null : String(out).split("\n").filter(Boolean)),
    );
  });
}

/**
 * "Mandar a verificar y arreglar" (B25): lo que sabe la app de una integración
 * que salió mal (su fila de `integradas.tsv`, el chequeo de los tests, `bien=no`,
 * sus commits). El texto lo arma src/datos/arreglar.ts.
 */
export async function arreglarDatos(h: { id: string; proyecto: string; rama: string | null }): Promise<{
  id: string;
  proyecto: string;
  ruta: string | null;
  rama: string | null;
  fila: FilaIntegrada | null;
  chequeo: Chequeo | null;
  bienNo: boolean;
  commits: string[] | null;
  tope: number;
  tests: string | null;
}> {
  if (!ID.test(String(h.id))) throw errorT("main.idRaro", { v: String(h.id) });
  const [s, nombre] = await Promise.all([estadoSalud(), nombrePa(h.proyecto)]);
  const p = (await registro()).find((x) => x.nombre === nombre);
  const fila = s.integradas[h.id] ?? null;
  const commits = p && fila ? await commitsEntre(p.ruta, fila.head_antes, fila.head_despues) : null;
  return {
    id: h.id,
    proyecto: nombre,
    ruta: p?.ruta ?? null,
    rama: fila?.rama || (h.rama ? String(h.rama) : null),
    fila,
    chequeo: s.chequeos[h.id] ?? null,
    bienNo: s.bienNo.includes(h.id),
    commits,
    tope: COMMITS_ARREGLAR,
    tests: p?.tests ?? null,
  };
}
