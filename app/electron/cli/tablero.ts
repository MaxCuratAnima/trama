// tablero — el único lugar de pendientes, esperas, ideas y hecho del usuario (port de motor/bin/tablero, que es Python).
//
// Un item JSON por línea en $TABLERO_DIR/items.jsonl. Sin daemon ni SQLite: lo escriben a la vez `pa`, la app y el jefe, así
// que toda escritura va con candado (cli/candado.ts, en vez de flock) + archivo temporal + rename, y los que leen no toman el
// candado (ven el archivo de antes o el de después). Mismo formato de archivos (items.jsonl, seq, vista.json, hecho/*.jsonl)
// y misma salida que el script de Python: la app (tablero.ts) y `pa` lo siguen entendiendo.
//
// Ejecutable con node (sin compilar): node electron/cli/tablero.ts <comando> …
import { execFile } from "node:child_process";
import {
  closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dirTablero, rutaPerfil, rutaRegistry, type Env } from "../plataforma.ts";
import { inicioDeProcesoSync } from "../procesos.ts";
import { conCandado, ErrorCandado } from "./candado.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type It = Record<string, any>;

const COLUMNAS = ["bandeja", "sigue", "en-curso", "espera-dueno", "espera-externo", "ideas", "hecho", "tirado"];
const CERRADAS = ["hecho", "tirado"];
const AREAS = ["sistema", "casa", "personal", "producto"];
// `estado` del registry -> etapa. Sin dato o con un valor que no está acá: "?".
const ETAPAS: Record<string, string> = {
  activo: "activo", "a-suplantar": "activo", pausado: "pausado", pausa: "pausado",
  idea: "idea", "en preparacion": "idea", "en preparación": "idea", infra: "infra", retirado: "retirado",
};
// vista.json: sube cuando un campo cambia de significado o se va; sumar un campo no la toca.
const VISTA_VERSION = 1;
const VISTA_HECHO_MAX = 50; // cerrados recientes que lleva la vista
const TITULO_MAX = 120; // tope del título de una integrada sacado del RESULTADO
const TIPOS = ["pregunta", "prueba"];
const LETRAS = "abcdefghijklmnopqrstuvwxyz"; // ids de las opciones, en orden

// ---- configuración (lo que en el script son globales del entorno) ----

type Cfg = { env: Env; HOME: string; DIR: string; ITEMS: string; SEQ: string; ARCHIVO: string; VISTA: string; PA_STATE: string; REGISTRY: string };
let C: Cfg;
let SALIDA: string[] = [];
let AVISOS: string[] = [];

function configurar(env: Env): Cfg {
  const HOME = os.homedir();
  const DIR = dirTablero(process.platform, env, HOME);
  // Con TABLERO_DIR seteado (tests) y sin TABLERO_VISTA, la vista cae adentro de ese directorio. La app la busca ahí.
  const VISTA = env.TABLERO_VISTA || path.join(DIR, "vista.json");
  const PA_STATE = env.PA_STATE || (process.platform === "win32" ? path.join(env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "Trama", "state", "pa") : path.join(HOME, ".local/state/pa"));
  return {
    env, HOME, DIR, ITEMS: path.join(DIR, "items.jsonl"), SEQ: path.join(DIR, "seq"), ARCHIVO: path.join(DIR, "hecho"), VISTA, PA_STATE,
    REGISTRY: rutaRegistry(process.platform, env, HOME),
  };
}

const print = (s = "") => void SALIDA.push(s + "\n");
const aviso = (msg: string) => void AVISOS.push(`tablero: ${msg}\n`);

class Salida extends Error {
  rc: number;
  constructor(msg: string, rc: number) {
    super(msg);
    this.rc = rc;
  }
}
const morir = (msg: string, rc = 1): never => {
  throw new Salida(msg, rc);
};

// ---- helpers de Python que acá no vienen ----

/** `str(x)` de Python para lo que sale en las líneas (None incluido). */
const pys = (v: unknown) => (v === null || v === undefined ? "None" : String(v));
const palabras = (t: unknown) => String(t ?? "").split(/\s+/).filter(Boolean).join(" ");
const unaLinea = (t: string) => palabras(t);

/** `json.dumps(v, ensure_ascii=False)`: separadores ", " y ": ", como el script (el archivo en disco queda igual). */
function pyJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(", ") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => JSON.stringify(k) + ": " + pyJson(x)).join(", ") + "}";
  }
  return JSON.stringify(v ?? null);
}
const salidaJson = (d: unknown) => print(JSON.stringify(d, null, 1));

// ---- fechas ----

const p2 = (n: number) => String(n).padStart(2, "0");
const fechaLocal = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hoyStr = () => fechaLocal(new Date());

function ahora(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const abs = Math.abs(off);
  return `${fechaLocal(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${off < 0 ? "-" : "+"}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

function edadSeg(s: number): string {
  s = Math.max(0, Math.trunc(s));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function edad(iso: unknown): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "?" : edadSeg((Date.now() - t) / 1000);
}

/** AAAA-MM-DD, hoy, mañana, +3d, +2s (semanas). `ya` la borra (devuelve null). */
function fechaArg(txt: string): string | null {
  const t = txt.trim().toLowerCase();
  if (["", "ya", "nunca", "-"].includes(t)) return null;
  if (t === "hoy") return hoyStr();
  const mas = (dias: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return fechaLocal(d);
  };
  if (t === "mañana" || t === "manana") return mas(1);
  if (t.length > 2 && t[0] === "+" && "ds".includes(t[t.length - 1]) && /^\d+$/.test(t.slice(1, -1))) return mas(Number(t.slice(1, -1)) * (t.endsWith("s") ? 7 : 1));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])) return t;
  }
  return morir(`fecha inválida: '${txt}' (AAAA-MM-DD, hoy, mañana, +3d, +2s)`, 2);
}

// ---- textos ----

function recorte(txt: unknown, n: number): string {
  const t = Array.from(palabras(txt));
  return t.length <= n ? t.join("") : t.slice(0, n - 1).join("").trimEnd() + "…";
}

/** Como recorte, pero corta en un espacio: nunca deja una palabra por la mitad. */
function recortePalabra(txt: unknown, n: number): string {
  const t = Array.from(palabras(txt));
  if (t.length <= n) return t.join("");
  let c = t.slice(0, n);
  if (t[n] !== " " && c.includes(" ")) c = c.slice(0, c.lastIndexOf(" "));
  return c.join("").replace(/[ ,;:]+$/, "") + "…";
}

function leerTexto(ruta: string, que: string): string {
  try {
    return (ruta === "-" ? readFileSync(0, "utf8") : readFileSync(ruta, "utf8")).replace(/^\n+|\n+$/g, "");
  } catch (e) {
    return morir(`${que}: no pude leer ${ruta}: ${(e as Error).message}`, 2);
  }
}

/** --<campo> o --<campo>-archivo (uno solo de los dos); undefined si no vino ninguno. */
function textoOArchivo(a: It, campo: string): string | undefined {
  const directo = a[campo];
  const archivo = a[campo + "_archivo"];
  if (directo !== undefined && archivo !== undefined) morir(`${a.cmd}: --${campo} y --${campo}-archivo no van juntos`, 2);
  return archivo !== undefined ? leerTexto(archivo, `--${campo}-archivo`) : directo;
}

// ---- nombre del dueño y columnas legadas ----

let dueno: string | null = null;
function nombreDueno(): string {
  if (dueno !== null) return dueno;
  let n = (C.env.TRAMA_DUENO || "").trim();
  if (!n) {
    try {
      n = String(JSON.parse(readFileSync(rutaPerfil(process.platform, C.env, C.HOME), "utf8"))?.dueno || "").trim();
    } catch {
      n = "";
    }
  }
  if (!n) {
    const u = (C.env.USER || C.env.USERNAME || "").trim();
    n = u.slice(0, 1).toUpperCase() + u.slice(1);
  }
  return (dueno = n || "el usuario");
}

const D = (texto: string) => texto.replaceAll("{D}", nombreDueno()).replaceAll(" a el usuario", " al usuario").replaceAll(" de el usuario", " del usuario");

function columnasLegadas(): Set<string> {
  const s = new Set<string>();
  for (const n of [nombreDueno(), C.env.USER || ""]) if (n) s.add("espera-" + n.toLowerCase());
  s.delete("espera-el usuario");
  return s;
}
const colCanon = (c: string) => (columnasLegadas().has(c) ? "espera-dueno" : c);

// ---- registry (misma resolución que proyecto-ruta, más el slug de pa) ----

type Proy = { name: string; path?: string; estado?: string; desc?: string };
type Resolucion = [string, Proy | null, string | null];

class Registro {
  private _proy: Proy[] | null = null;
  private _rutas = new Map<Proy, string>();

  get proyectos(): Proy[] {
    if (this._proy === null) {
      try {
        const d = JSON.parse(readFileSync(C.REGISTRY, "utf8"));
        this._proy = (Array.isArray(d?.projects) ? d.projects : []).filter((p: unknown) => p && typeof p === "object" && (p as Proy).name).map((p: Proy) => ({ ...p, name: String(p.name) }));
      } catch {
        this._proy = [];
      }
    }
    return this._proy!;
  }

  /** Ruta real canónica, como proyecto-ruta: ~ expandido, archivo -> su carpeta, realpath. */
  ruta(p: Proy): string {
    let r = this._rutas.get(p);
    if (r === undefined) {
      r = String(p.path || "");
      if (r === "~" || r.startsWith("~/") || r.startsWith("~\\")) r = C.HOME + r.slice(1);
      try {
        if (r && statSync(r).isFile()) r = path.dirname(r);
      } catch {
        /* no existe */
      }
      if (r) {
        try {
          r = realpathSync(r);
        } catch {
          r = path.resolve(r);
        }
      }
      this._rutas.set(p, r);
    }
    return r;
  }

  /** El slug de pa: basename de la ruta real en minúscula (carpeta de $PA_STATE y de pa/<slug>/*). */
  slug(p: Proy): string {
    return path.basename(this.ruta(p)).toLowerCase();
  }

  // Varios nombres con la MISMA carpeta son alias: el canónico es el primero.
  private canonico(p: Proy): Proy {
    const r = this.ruta(p);
    return this.proyectos.find((q) => this.ruta(q) === r) ?? p;
  }

  /** Exacto, exacto sin mayúsculas, slug de pa, área libre, y recién ahí substring único. */
  resolver(nombre: string | null | undefined): Resolucion {
    const q = (nombre || "").trim();
    if (!q) return ["", null, null];
    const ps = this.proyectos;
    const ql = q.toLowerCase();
    for (const cond of [(p: Proy) => p.name === q, (p: Proy) => p.name.toLowerCase() === ql, (p: Proy) => this.slug(p) === ql]) {
      const p = ps.find(cond);
      if (p) {
        const c = this.canonico(p);
        return [c.name, c, null];
      }
    }
    if (AREAS.includes(ql)) return [ql, null, null];
    const cands = ps.filter((p) => p.name.toLowerCase().includes(ql));
    const rutas = new Set(cands.map((p) => this.ruta(p)));
    if (rutas.size === 1) {
      const c = this.canonico(cands[0]);
      return [c.name, c, null];
    }
    if (rutas.size > 1) return [q, null, `proyecto '${q}' es ambiguo (${cands.map((p) => p.name).join(", ")}); lo anoto tal cual`];
    return [q, null, `proyecto '${q}' no está en el registry ni es un área (${AREAS.join(", ")}); lo anoto igual`];
  }

  canon(nombre: string): string {
    const [c, , av] = this.resolver(nombre);
    if (av) aviso(av);
    return c;
  }
}

const etapa = (ent: Proy) => ETAPAS[String(ent.estado || "").trim().toLowerCase()] ?? "?";

// ---- items: leer, escribir ----

function leerJsonl(ruta: string, estricto = false): It[] {
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const items: It[] = [];
  texto.split(/\r?\n|\r/).forEach((cruda, i) => {
    const l = cruda.trim();
    if (!l) return;
    try {
      const it = JSON.parse(l);
      if (!it || typeof it !== "object" || Array.isArray(it)) throw new Error("no es un dict");
      if (typeof it.columna === "string") it.columna = colCanon(it.columna);
      items.push(it);
    } catch {
      // Reescribir sin esa línea la perdería para siempre: el que escribe se niega.
      if (estricto) morir(`${ruta}:${i + 1}: línea que no es un item JSON; no escribo para no perderla`);
      aviso(`${ruta}:${i + 1}: línea que no es un item JSON, la salteo`);
    }
  });
  return items;
}

const leerItems = (estricto = false) => leerJsonl(C.ITEMS, estricto);

function escribirAtomico(ruta: string, texto: string, fsync = true): void {
  const tmp = `${ruta}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, texto);
      if (fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, ruta);
        break;
      } catch (e) {
        // en Windows un lector con el archivo abierto hace fallar el rename un instante
        const code = (e as NodeJS.ErrnoException).code;
        if (i >= 20 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Primera escritura: el directorio del tablero es un repo git propio. Se llama con el candado tomado. */
async function prepararRepo(): Promise<void> {
  if (esDir(path.join(C.DIR, ".git"))) return;
  const gi = path.join(C.DIR, ".gitignore");
  try {
    statSync(gi);
  } catch {
    escribirAtomico(gi, ".lock\n*.tmp\nvista.json\n", false);
  }
  await new Promise<void>((ok) => {
    try {
      execFile("git", ["init", "-q", C.DIR], { timeout: 20000, windowsHide: true }, () => ok());
    } catch {
      ok();
    }
  });
}

function esDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

type Tx = { items: It[]; cambio: boolean };

/** Candado exclusivo, items leídos adentro y, si hubo cambio, items + vista reescritos. */
async function escritura<T>(fn: (tx: Tx) => T): Promise<T> {
  mkdirSync(C.ARCHIVO, { recursive: true });
  return conCandado(
    path.join(C.DIR, ".lock"),
    async () => {
      await prepararRepo();
      const tx: Tx = { items: leerItems(true), cambio: false };
      const r = fn(tx);
      if (tx.cambio) {
        escribirAtomico(C.ITEMS, tx.items.map((it) => pyJson(it) + "\n").join(""));
        await escribirVista(tx.items);
      }
      return r;
    },
    { espera: 120000, cada: 20 },
  );
}

/** Número incremental que no se reusa: `seq` sobrevive a que `archivar` saque los ids altos. */
function nuevoId(items: It[]): number {
  let n = 0;
  try {
    n = parseInt(readFileSync(C.SEQ, "utf8").trim() || "0", 10) || 0;
  } catch (e) {
    // sin seq (borrado a mano): que tampoco se reuse un id que ya está archivado
    if ((e as NodeJS.ErrnoException).code === "ENOENT") for (const it of leerArchivo()) if (Number.isInteger(it.id)) n = Math.max(n, it.id);
  }
  n = Math.max(n, ...items.filter((it) => Number.isInteger(it.id)).map((it) => it.id as number)) + 1;
  escribirAtomico(C.SEQ, `${n}\n`);
  return n;
}

function leerArchivo(mes?: string): It[] {
  let nombres: string[];
  try {
    nombres = readdirSync(C.ARCHIVO).filter((x) => x.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  return nombres.filter((x) => mes === undefined || x === `${mes}.jsonl`).flatMap((x) => leerJsonl(path.join(C.ARCHIVO, x)));
}

const abierto = (it: It) => !CERRADAS.includes(it.columna);
const pospuesto = (it: It, hoy?: string) => !!it.hasta && String(it.hasta) > (hoy || hoyStr());
const visible = (it: It, hoy?: string) => abierto(it) && !pospuesto(it, hoy);

function ponerColumna(it: It, col: string, ts: string): void {
  it.columna = col;
  it.cerrado = CERRADAS.includes(col) ? it.cerrado || ts : null;
}

function buscar(items: It[], i: number): It {
  return items.find((it) => it.id === i) ?? morir(`no hay item ${i}`);
}

/** El item de esa clave: el abierto si hay; si no, el último cerrado (para reabrirlo). */
function porClave(items: It[], clave: string): It | null {
  let hallado: It | null = null;
  for (const it of items) {
    if (it.clave === clave) {
      if (abierto(it)) return it;
      hallado = it;
    }
  }
  return hallado;
}

const linea = (it: It) => [pys(it.id), pys(it.columna), it.proyecto || "-", it.titulo || "", `(${edad(it.creado)})`].join("  ");

const ordenColumna = (it: It): [number, number] => {
  const i = COLUMNAS.indexOf(it.columna);
  return [i >= 0 ? i : COLUMNAS.length, it.id || 0];
};
const porOrdenColumna = (a: It, b: It) => {
  const [x, y] = [ordenColumna(a), ordenColumna(b)];
  return x[0] - y[0] || x[1] - y[1];
};

/** proyecto -> su item `sigue` (el de clave sigue:<proyecto>, uno solo por proyecto). */
function sigueDe(items: It[]): Map<string, It> {
  const m = new Map<string, It>();
  for (const it of items) if (abierto(it) && String(it.clave || "").startsWith("sigue:")) m.set(it.proyecto, it);
  return m;
}

// ---- pregunta o prueba: tipo, opciones, respuesta ----

/** `tipo` del item; si no lo trae (item viejo): `prueba` cuando tiene `prueba`, si no `pregunta`. */
const tipoDe = (it: It) => (TIPOS.includes(it.tipo) ? (it.tipo as string) : it.prueba ? "prueba" : "pregunta");
const publico = (it: It): It => ({ ...it, tipo: tipoDe(it) });

function armarOpciones(textos: string[], cmd: string): It[] {
  if (textos.length > LETRAS.length) morir(`${cmd}: demasiadas opciones (${textos.length}; hasta ${LETRAS.length})`, 2);
  const ops = textos.map((t, i) => ({ id: LETRAS[i], texto: palabras(t) }));
  if (ops.some((o) => !o.texto)) morir(`${cmd}: una --opcion está vacía`, 2);
  return ops;
}

/** El id de una opción a partir de su id (`b`) o de su número de orden (`2`); null si no existe. */
function idOpcion(opciones: It[] | undefined, txt: unknown): string | null {
  const t = String(txt).trim().toLowerCase();
  const ids = (opciones || []).filter((o) => o && typeof o === "object").map((o) => o.id);
  if (/^\d+$/.test(t)) return Number(t) >= 1 && Number(t) <= ids.length ? ids[Number(t) - 1] : null;
  return ids.includes(t) ? t : null;
}

/** --tipo, --simple, --contexto, --opcion y --defecto sobre un item. Sólo toca lo que vino; valida antes de cambiar nada. */
function ponerPregunta(it: It, a: It): void {
  let opciones: It[] | null = a.opcion ? armarOpciones(a.opcion, a.cmd) : null;
  if (a.sin_opciones) {
    if (opciones || a.defecto !== undefined) morir(`${a.cmd}: --sin-opciones no va con --opcion ni con --defecto`, 2);
    opciones = [];
  }
  let defecto: string | null = null;
  if (a.defecto !== undefined) {
    const finales: It[] | undefined = opciones === null ? it.opciones : opciones;
    defecto = idOpcion(finales, a.defecto);
    if (defecto === null) {
      const hay = (finales || []).map((o) => o.id).join(", ") || "ninguna";
      morir(`${a.cmd}: --defecto '${a.defecto}' no es una de las opciones (${hay})`, 2);
    }
  }
  if (a.tipo !== undefined) it.tipo = a.tipo;
  for (const [k, x] of [["titulo_simple", a.simple], ["contexto", a.contexto]] as const) {
    if (x === undefined) continue;
    const v = k === "titulo_simple" ? unaLinea(x) : x.trim();
    if (v) it[k] = v;
    else delete it[k];
  }
  if (opciones !== null) {
    // Reemplazo entero: los ids se reparten de nuevo, así que el por_defecto de antes ya no apunta a lo mismo.
    delete it.por_defecto;
    if (opciones.length) it.opciones = opciones;
    else delete it.opciones;
  }
  if (defecto !== null) it.por_defecto = defecto;
}

function textoRespuesta(r: unknown): string {
  if (!r || typeof r !== "object") return pys(r);
  const x = r as It;
  const p: string[] = [];
  if ("anda" in x) p.push(x.anda ? "anda" : "no anda");
  if (x.opcion) p.push(`${x.opcion}) ${x.opcion_texto || ""}`.trimEnd());
  if (x.texto) p.push(x.texto);
  return p.join(" · ") + (x.fecha ? `  (${x.fecha})` : "");
}

// ---- git y estado de pa (sólo lectura) ----

type Pedido = [string, string, string[]]; // clave, ruta, args

function git(ruta: string, args: string[]): Promise<string | null> {
  return new Promise((ok) => {
    try {
      // GIT_OPTIONAL_LOCKS=0: `git status` no refresca el índice ni deja index.lock en un repo donde puede haber un worker commiteando.
      execFile("git", ["-C", ruta, ...args], { encoding: "utf8", timeout: 15000, maxBuffer: 64 << 20, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }, (err, out) => ok(err ? null : out));
    } catch {
      ok(null);
    }
  });
}

/** Lanza todos juntos; -> clave -> stdout o null si falló. */
async function gitVarios(pedidos: Pedido[]): Promise<Map<string, string | null>> {
  const salida = await Promise.all(pedidos.map(([, ruta, args]) => git(ruta, args)));
  return new Map(pedidos.map(([k], i) => [k, salida[i]]));
}

/** Como gitVarios pero de a tandas: para recorrer los 64 repos sin lanzar 64 git juntos. */
async function gitMuchos(pedidos: Pedido[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < pedidos.length; i += 16) for (const [k, v] of await gitVarios(pedidos.slice(i, i + 16))) out.set(k, v);
  return out;
}

function leerHilo(ruta: string): Record<string, string> {
  const d: Record<string, string> = {};
  try {
    for (const l of readFileSync(ruta, "utf8").split("\n")) {
      const i = l.indexOf("=");
      if (i >= 0) d[l.slice(0, i)] = l.slice(i + 1);
    }
  } catch {
    /* sin hilo */
  }
  return d;
}

/** id -> última fila de integradas.tsv (la última fila de un id manda). */
function leerIntegradas(): Map<string, string[]> {
  const ult = new Map<string, string[]>();
  try {
    for (const l of readFileSync(path.join(C.PA_STATE, "integradas.tsv"), "utf8").split("\n")) {
      const c = l.split("\t");
      if (c.length >= 10 && c[0] !== "fecha") ult.set(c[1], c);
    }
  } catch {
    /* sin registro */
  }
  return ult;
}

function pidVivo(rutaPid: string): boolean {
  try {
    const pid = parseInt(readFileSync(rutaPid, "utf8").trim(), 10);
    return Number.isInteger(pid) && inicioDeProcesoSync(pid) !== null;
  } catch {
    return false;
  }
}

const ENCABEZADO = /^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI[OÓ]N|SIGUE)[*]*:[*]*[ \t]*/m;
const OTRO_CAMPO = /\b(ARCHIVOS|DECISI[OÓ]N|SIGUE)[*]*:/;
// fin de oración: punto, ! o ? seguido de un espacio y de algo que arranca otra oración
const FIN_ORACION = /[.!?…](?=\s+[A-ZÁÉÍÓÚÑ¿¡`"«(\d]|\s*$)/;

/** Primera oración del RESULTADO de una corrida (`.result` de su JSON), o "" si no hay. */
function primeraOracionResultado(rutaJson: string): string {
  let res: unknown;
  try {
    if (statSync(rutaJson).size > 8 << 20) return "";
    res = JSON.parse(readFileSync(rutaJson, "utf8"))?.result;
  } catch {
    return "";
  }
  if (typeof res !== "string") return "";
  let ini: number | null = null;
  for (const m of res.matchAll(new RegExp(ENCABEZADO.source, "gm"))) if (m[1] === "RESULTADO") ini = m.index! + m[0].length; // el último manda
  if (ini === null) return "";
  let t = res.slice(ini);
  let m = ENCABEZADO.exec(t);
  if (m) t = t.slice(0, m.index);
  m = OTRO_CAMPO.exec(t); // todo en una línea: "RESULTADO: listo. ARCHIVOS: ninguno."
  if (m) t = t.slice(0, m.index);
  t = palabras(t.replaceAll("**", ""));
  m = FIN_ORACION.exec(t);
  if (m) t = t.slice(0, m.index + m[0].length);
  return recortePalabra(t, TITULO_MAX);
}

/** Qué se integró, en una oración: el RESULTADO de la última corrida de esa rama anterior a la integración. "" si ninguna lo tiene. */
function tituloIntegrada(slug: string, cid: string, fechaIso: string): string {
  const d = path.join(C.PA_STATE, slug);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(fechaIso);
  const tope = m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}` : "9";
  const ids = [cid];
  try {
    // los ids ordenan por fecha: sólo hace falta abrir los .hilo de después de la dueña
    for (const x of readdirSync(d).sort()) {
      if (x.endsWith(".hilo") && cid < x.slice(0, -5) && x.slice(0, 15) <= tope && leerHilo(path.join(d, x)).origen === cid) ids.push(x.slice(0, -5));
    }
  } catch {
    /* sin carpeta */
  }
  for (const i of ids.reverse()) {
    const t = primeraOracionResultado(path.join(d, i + ".json"));
    if (t) return t;
  }
  return "";
}

type Corrida = { id: string; fecha: string; tarea: string; resultado: string };

/** Últimas n corridas de pa del proyecto: fecha, tarea y en qué terminó. */
function corridas(slug: string, n = 3): Corrida[] {
  const d = path.join(C.PA_STATE, slug);
  let nombres: string[];
  try {
    nombres = readdirSync(d).filter((x) => x.endsWith(".hilo")).sort().reverse().slice(0, n);
  } catch {
    return [];
  }
  const integ = nombres.length ? leerIntegradas() : new Map<string, string[]>();
  return nombres.map((x) => {
    const cid = x.slice(0, -5);
    const h = leerHilo(path.join(d, x));
    const fila = integ.get(cid);
    let res: string;
    if (fila) res = fila[9];
    else if (!("decision_nada" in h)) res = pidVivo(path.join(d, cid + ".pid")) ? "en curso" : "sin resultado";
    else if (h.decision_nada === "0") res = "espera decisión" + (h.decision ? `: ${recorte(h.decision, 80)}` : "");
    else if (h.leer === "1") res = "consulta";
    else res = h.rama ? "sin integrar" : "ok";
    const f = /^\d{8}/.test(cid) ? `${cid.slice(0, 4)}-${cid.slice(4, 6)}-${cid.slice(6, 8)}` : "?";
    return { id: cid, fecha: f, tarea: recorte(h.tarea || "", 70), resultado: res };
  });
}

/** Ramas pa/* de un repo leyendo sus refs del disco, sin lanzar git (resumen corre en cada arranque de sesión). */
function ramasPaEnDisco(ruta: string): string[] {
  let g = path.join(ruta, ".git");
  let esArchivo = false;
  try {
    esArchivo = statSync(g).isFile();
  } catch {
    return [];
  }
  if (esArchivo) {
    // worktree o submódulo: `gitdir: <ruta>` y, adentro, `commondir`
    try {
      g = path.resolve(ruta, readFileSync(g, "utf8").split("gitdir:")[1].trim());
      try {
        g = path.resolve(g, readFileSync(path.join(g, "commondir"), "utf8").trim());
      } catch {
        /* sin commondir */
      }
    } catch {
      return [];
    }
  }
  const heads = path.join(g, "refs", "heads");
  const nombres = new Set<string>();
  const recorrer = (dir: string) => {
    let es: import("node:fs").Dirent[];
    try {
      es = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      if (e.isDirectory()) recorrer(path.join(dir, e.name));
      else if (!e.name.endsWith(".lock")) nombres.add(path.relative(heads, path.join(dir, e.name)).split(path.sep).join("/"));
    }
  };
  recorrer(path.join(heads, "pa"));
  try {
    const pk = path.join(g, "packed-refs");
    if (statSync(pk).size < 4 << 20) for (const l of readFileSync(pk, "utf8").split("\n")) if (l.includes(" refs/heads/pa/")) nombres.add(l.split(" ").slice(1).join(" ").trim().slice("refs/heads/".length));
  } catch {
    /* sin packed-refs */
  }
  return [...nombres].sort();
}

/** pa/<slug>/<id> con su worker vivo: todavía no es una rama que espere integración. */
function ramaEnCurso(rama: string): boolean {
  const p = rama.split("/");
  return p.length === 3 && pidVivo(path.join(C.PA_STATE, p[1], p[2] + ".pid"));
}

/** Ramas pa/* sin mergear de todos los proyectos. Git sólo en los repos que tienen alguna. */
async function ramasSinIntegrar(reg: Registro): Promise<string[]> {
  const pedidos: Pedido[] = [];
  const vistos = new Set<string>();
  for (const p of reg.proyectos) {
    const r = reg.ruta(p);
    if (r && !vistos.has(r) && ramasPaEnDisco(r).length) {
      vistos.add(r);
      pedidos.push([r, r, ["branch", "--no-merged", "HEAD", "--list", "pa/*", "--format=%(refname:short)"]]);
    }
  }
  const ramas: string[] = [];
  for (const o of (await gitVarios(pedidos)).values()) ramas.push(...(o || "").split(/\s+/).filter((x) => x && !ramaEnCurso(x)));
  return ramas.sort();
}

// ---- vista.json ----

const cuentaAbiertos = (items: It[], hoy: string) => {
  const abiertos = new Map<string, number>();
  for (const it of items) if (visible(it, hoy)) abiertos.set(it.proyecto || "", (abiertos.get(it.proyecto || "") || 0) + 1);
  return abiertos;
};

/** Los proyectos retirados del registry, sin git: nombre, descripción, abiertos y su sigue. */
function filasRetirados(reg: Registro, items: It[], sg: Map<string, It>, hoy: string): It[] {
  const abiertos = cuentaAbiertos(items, hoy);
  const filas: It[] = [];
  const rutas = new Set<string>();
  for (const p of reg.proyectos) {
    const r = reg.ruta(p);
    if (etapa(p) !== "retirado" || rutas.has(r)) continue;
    rutas.add(r);
    filas.push({ proyecto: p.name, etapa: "retirado", dias: null, abiertos: abiertos.get(p.name) || 0, sigue: sg.get(p.name)?.titulo ?? null, desc: p.desc || "" });
  }
  return filas;
}

async function datosHoy(reg: Registro | null, items: It[], fecha: string, conCommits = true): Promise<It> {
  const integradas: It[] = [];
  for (const [cid, c] of leerIntegradas()) {
    if (c[9] === "integrada" && c[0].slice(0, 10) === fecha) {
      const h = leerHilo(path.join(C.PA_STATE, c[2], cid + ".hilo"));
      integradas.push({ id: cid, proyecto: c[2], hora: c[0].slice(11, 16), titulo: tituloIntegrada(c[2], cid, c[0]) || recorte(h.tarea || "", 80), commits: /^\d+$/.test(c[7]) ? Number(c[7]) : 0 });
    }
  }
  integradas.sort((x, y) => (x.hora < y.hora ? -1 : x.hora > y.hora ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const vistos = new Set<unknown>();
  const cerrados: It[] = [];
  for (const it of [...items, ...(conCommits ? leerArchivo(fecha.slice(0, 7)) : [])]) {
    if (String(it.cerrado || "").slice(0, 10) === fecha && !vistos.has(it.id)) {
      vistos.add(it.id);
      cerrados.push(it);
    }
  }
  const d: It = { fecha, integradas, cerrados: cerrados.map(publico) };
  if (conCommits && reg) {
    const pedidos: Pedido[] = [];
    const rutas = new Set<string>();
    for (const p of reg.proyectos) {
      const r = reg.ruta(p);
      if (r && !rutas.has(r) && esDir(r)) {
        rutas.add(r);
        // `-- .`: un proyecto que es una subcarpeta de un repo cuenta sólo lo suyo
        pedidos.push([p.name, r, ["rev-list", "--count", `--since=${fecha} 00:00:00`, `--until=${fecha} 23:59:59`, "HEAD", "--", "."]]);
      }
    }
    d.commits = {};
    for (const [k, v] of await gitMuchos(pedidos)) if (v && /^\d+$/.test(v.trim()) && Number(v) > 0) d.commits[k] = Number(v);
  }
  return d;
}

/** Lo que lee la app. Se regenera en cada escritura, con el candado tomado. `hoy` va sin commits por proyecto. */
async function escribirVista(items: It[]): Promise<void> {
  const hoy = hoyStr();
  const columnas: Record<string, It[]> = {};
  for (const c of COLUMNAS) if (!CERRADAS.includes(c)) columnas[c] = [];
  const pospuestos: It[] = [];
  for (const it of [...items].sort(porOrdenColumna)) {
    if (!abierto(it)) continue;
    if (pospuesto(it, hoy)) pospuestos.push(publico(it));
    else if (it.columna in columnas) columnas[it.columna].push(publico(it));
  }
  const h = await datosHoy(null, items, hoy, false);
  const cont: It = Object.fromEntries(Object.entries(columnas).map(([c, v]) => [c, v.length]));
  cont.abiertos = Object.values(columnas).reduce((n, v) => n + v.length, 0);
  cont.pospuestos = pospuestos.length;
  cont.cerrados_hoy = h.cerrados.length;
  cont.integradas_hoy = h.integradas.length;
  const clave = (it: It) => String(it.cerrado || "");
  const hecho = items.filter((it) => it.columna === "hecho").sort((a, b) => (clave(a) < clave(b) ? 1 : clave(a) > clave(b) ? -1 : (b.id || 0) - (a.id || 0)));
  const sg = sigueDe(items);
  const retirados = filasRetirados(new Registro(), items, sg, hoy).map((f) => ({ proyecto: f.proyecto, desc: f.desc, abiertos: f.abiertos, sigue: f.sigue }));
  const v = {
    version: VISTA_VERSION,
    generado: ahora(),
    contadores: cont,
    columnas,
    sigue: Object.fromEntries([...sg].map(([p, it]) => [p, { id: it.id, titulo: it.titulo, head: it.head, tocado: it.tocado }])),
    hoy: h,
    // lo de acá abajo se sumó después (version 1): no está en `columnas` ni en `contadores`
    pospuestos: pospuestos.sort((a, b) => (String(a.hasta) < String(b.hasta) ? -1 : String(a.hasta) > String(b.hasta) ? 1 : (a.id || 0) - (b.id || 0))),
    hecho: hecho.slice(0, VISTA_HECHO_MAX).map(publico),
    retirados,
  };
  try {
    mkdirSync(path.dirname(C.VISTA), { recursive: true });
    escribirAtomico(C.VISTA, pyJson(v), false);
  } catch (e) {
    aviso(`no pude escribir la vista ${C.VISTA}: ${(e as Error).message}`);
  }
}

// ---- comandos que escriben ----

async function cmdInit(): Promise<void> {
  await escritura((tx) => void (tx.cambio = true));
  print(C.DIR);
}

async function cmdAgregar(a: It): Promise<void> {
  const titulo = a.titulo.trim();
  if (!titulo) morir("agregar: el título está vacío", 2);
  const proy = a.proyecto !== undefined ? new Registro().canon(a.proyecto) : null;
  const hasta = a.hasta !== undefined ? fechaArg(a.hasta) : null;
  a.detalle = textoOArchivo(a, "detalle");
  a.prueba = textoOArchivo(a, "prueba");
  const it = await escritura((tx) => {
    const ts = ahora();
    let it = a.clave ? porClave(tx.items, a.clave) : null;
    if (it === null) {
      ponerPregunta({}, a); // valida antes de gastar un id
      it = {
        id: nuevoId(tx.items), columna: null, proyecto: proy || "", titulo, detalle: a.detalle || "", prueba: a.prueba || "", origen: a.origen || "",
        clave: a.clave || "", head: null, creado: ts, tocado: ts, cerrado: null, hasta,
      };
      ponerColumna(it, a.columna || "bandeja", ts);
      ponerPregunta(it, a);
      tx.items.push(it);
    } else {
      ponerPregunta(it, a);
      // Clave que ya está: se actualiza, no se duplica. Si estaba cerrada vuelve a abrirse y la edad arranca de nuevo.
      if (!abierto(it)) {
        it.cerrado = null;
        it.creado = ts;
        ponerColumna(it, a.columna || "bandeja", ts);
      } else if (a.columna) ponerColumna(it, a.columna, ts);
      it.titulo = titulo;
      for (const k of ["detalle", "prueba", "origen"]) if (a[k] !== undefined) it[k] = a[k];
      if (proy !== null) it.proyecto = proy;
      if (a.hasta !== undefined) it.hasta = hasta;
      it.tocado = ts;
    }
    tx.cambio = true;
    return it;
  });
  print(String(it.id));
}

async function cmdMover(a: It): Promise<void> {
  if (a.columna === undefined && a.proyecto === undefined && a.hasta === undefined) morir("mover: pasá --columna, --proyecto o --hasta", 2);
  const proy = a.proyecto !== undefined ? new Registro().canon(a.proyecto) : null;
  const hasta = a.hasta !== undefined ? fechaArg(a.hasta) : null;
  const it = await escritura((tx) => {
    const it = buscar(tx.items, a.id);
    const ts = ahora();
    if (a.columna) ponerColumna(it, a.columna, ts);
    if (proy !== null) it.proyecto = proy;
    if (a.hasta !== undefined) it.hasta = hasta;
    it.tocado = ts;
    tx.cambio = true;
    return it;
  });
  print(linea(it));
}

async function cmdPosponer(a: It): Promise<void> {
  const hasta = fechaArg(a.fecha);
  const objetivos = await escritura((tx) => {
    const objetivos = (a.ids as number[]).map((i) => buscar(tx.items, i));
    const ts = ahora();
    for (const it of objetivos) {
      if (!abierto(it)) morir(`posponer: el item ${pys(it.id)} está cerrado (${pys(it.columna)})`);
      it.hasta = hasta;
      it.tocado = ts;
      tx.cambio = true;
    }
    return objetivos;
  });
  const hoy = hoyStr();
  for (const it of objetivos) print(linea(it) + (pospuesto(it, hoy) ? `  hasta ${it.hasta}` : ""));
}

async function cmdEditar(a: It): Promise<void> {
  a.detalle = textoOArchivo(a, "detalle");
  a.prueba = textoOArchivo(a, "prueba");
  a.sumar = textoOArchivo(a, "sumar");
  if (["titulo", "detalle", "prueba", "sumar", "tipo", "simple", "contexto", "opcion", "defecto"].every((k) => a[k] === undefined) && !a.sin_opciones) {
    morir("editar: pasá --titulo, --detalle, --prueba, --sumar (o su -archivo), --tipo, --simple, --contexto, --opcion, --defecto o --sin-opciones", 2);
  }
  if (a.titulo !== undefined && !a.titulo.trim()) morir("editar: el título está vacío", 2);
  if (a.sumar !== undefined && !a.sumar.trim()) morir("editar: --sumar está vacío", 2);
  const it = await escritura((tx) => {
    const it = buscar(tx.items, a.id);
    ponerPregunta(it, a);
    for (const k of ["titulo", "detalle", "prueba"]) if (a[k] !== undefined) it[k] = k === "titulo" ? a[k].trim() : a[k];
    // al final de lo que haya (también de un --detalle de esta misma llamada)
    if (a.sumar !== undefined) it.detalle = (it.detalle ? it.detalle.replace(/\n+$/, "") + "\n" : "") + a.sumar;
    it.tocado = ahora();
    tx.cambio = true;
    return it;
  });
  print(linea(it));
}

/** La respuesta del usuario queda en el item; no lo cierra ni lo mueve (eso lo hace el que la lee). */
async function cmdResponder(a: It): Promise<void> {
  const prueba = a.anda !== undefined;
  if (a.borrar) {
    if (prueba || a.respuesta !== undefined || a.opcion !== undefined || a.nota !== undefined) morir("responder: --borrar va solo", 2);
  } else if (prueba && (a.respuesta !== undefined || a.opcion !== undefined)) morir("responder: --anda/--no-anda van con --nota, no con --respuesta ni --opcion", 2);
  else if (!prueba && a.nota !== undefined) morir("responder: --nota va con --anda o --no-anda", 2);
  else if (!prueba && a.respuesta === undefined && a.opcion === undefined) morir("responder: pasá --respuesta, --opcion, --anda o --no-anda", 2);
  const it = await escritura((tx) => {
    const it = buscar(tx.items, a.id);
    if (!abierto(it)) morir(`responder: el item ${pys(it.id)} está cerrado (${pys(it.columna)})`);
    const ts = ahora();
    if (a.borrar) {
      if (!("respuesta" in it)) return it;
      delete it.respuesta;
    } else if (prueba) {
      if (tipoDe(it) !== "prueba") morir(`responder: el item ${pys(it.id)} es una pregunta, no una prueba (--respuesta / --opcion)`, 2);
      it.respuesta = { anda: a.anda, texto: (a.nota || "").trim(), fecha: ts };
    } else {
      const r: It = { texto: (a.respuesta || "").trim() };
      if (a.opcion !== undefined) {
        const oid = idOpcion(it.opciones, a.opcion);
        if (oid === null) {
          const hay = (it.opciones || []).map((o: It) => o.id).join(", ") || "ninguna";
          morir(`responder: --opcion '${a.opcion}' no es una de las opciones del item (${hay})`, 2);
        }
        // el texto viaja con el id: si después cambian las opciones, la respuesta se sigue entendiendo
        r.opcion = oid;
        r.opcion_texto = it.opciones.find((o: It) => o.id === oid).texto;
      } else if (!r.texto) morir("responder: --respuesta está vacía", 2);
      r.fecha = ts;
      it.respuesta = r;
    }
    it.tocado = ts;
    tx.cambio = true;
    return it;
  });
  print(linea(it) + (it.respuesta ? `  respuesta: ${textoRespuesta(it.respuesta)}` : ""));
}

async function cerrarA(a: It, columna: string): Promise<void> {
  const { clave, nota } = a;
  if (!a.ids.length && !clave) morir(`${a.cmd}: pasá un id` + (columna === "hecho" ? " o --clave" : ""), 2);
  const lineas = await escritura((tx) => {
    const objetivos = (a.ids as number[]).map((i) => buscar(tx.items, i));
    // Sin item abierto con esa clave no es un error: el doctor cierra en cada pasada buena.
    if (clave) objetivos.push(...tx.items.filter((it) => it.clave === clave && abierto(it)));
    const ts = ahora();
    const out: string[] = [];
    for (const it of objetivos) {
      if (it.columna === columna) continue;
      it.columna = columna;
      it.cerrado = ts;
      it.tocado = ts;
      if (nota) it.detalle = (it.detalle ? it.detalle + "\n" : "") + `cierre: ${nota}`;
      tx.cambio = true;
      out.push(linea(it));
    }
    return out;
  });
  for (const l of lineas) print(l);
}

async function cmdSigue(a: It): Promise<void> {
  const texto = a.texto.trim();
  if (!texto) morir("sigue: el texto está vacío", 2);
  const reg = new Registro();
  const [proy, ent, av] = reg.resolver(a.proyecto);
  if (!proy) morir("sigue: el proyecto está vacío", 2);
  if (av) aviso(av);
  let head: string | null = a.head || null;
  if (!head && ent && esDir(reg.ruta(ent))) head = ((await gitVarios([["h", reg.ruta(ent), ["rev-parse", "HEAD"]]])).get("h") || "").trim() || null;
  const clave = `sigue:${proy}`;
  const it = await escritura((tx) => {
    const ts = ahora();
    let it = porClave(tx.items, clave);
    if (it === null) {
      it = { id: nuevoId(tx.items), columna: "sigue", proyecto: proy, titulo: texto, detalle: "", prueba: "", origen: "sigue", clave, head, creado: ts, tocado: ts, cerrado: null, hasta: null };
      tx.items.push(it);
    } else {
      // Uno solo por proyecto: el paso nuevo reemplaza al anterior en el mismo item.
      if (it.titulo !== texto || !abierto(it)) it.creado = ts;
      Object.assign(it, { columna: "sigue", proyecto: proy, titulo: texto, head, tocado: ts, cerrado: null, hasta: null });
    }
    tx.cambio = true;
    return it;
  });
  print(String(it.id));
}

async function cmdArchivar(a: It): Promise<void> {
  const corte = Date.now() - a.dias * 86400000;
  const n = await escritura((tx) => {
    const quedan: It[] = [];
    const porMes = new Map<string, It[]>();
    for (const it of tx.items) {
      let mes: string | null = null;
      if (!abierto(it)) {
        const cuando = Date.parse(it.cerrado || it.tocado || "");
        if (!Number.isNaN(cuando) && cuando < corte) {
          const d = new Date(cuando);
          mes = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
        }
      }
      if (mes) porMes.set(mes, [...(porMes.get(mes) || []), it]);
      else quedan.push(it);
    }
    // Primero al archivo y recién después fuera de items.jsonl: si se corta en el medio queda un item repetido, no uno perdido.
    let n = 0;
    for (const [mes, its] of porMes) {
      const fd = openSync(path.join(C.ARCHIVO, `${mes}.jsonl`), "a");
      try {
        writeSync(fd, its.map((it) => pyJson(it) + "\n").join(""));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      n += its.length;
    }
    if (n) {
      tx.items = quedan;
      tx.cambio = true;
    }
    return n;
  });
  print(`archivados: ${n}`);
}

// ---- comandos que leen ----

function cmdListar(a: It): void {
  const items = leerItems();
  let cols: string[] | null = null;
  if (a.columna) {
    cols = String(a.columna).split(",").map((c) => c.trim()).filter(Boolean).map(colCanon);
    const malas = cols.filter((c) => !COLUMNAS.includes(c));
    if (malas.length) morir(`columna desconocida: ${malas.join(", ")} (hay: ${COLUMNAS.join(", ")})`, 2);
  }
  const proy = a.proyecto ? new Registro().resolver(a.proyecto)[0] : null;
  const hoy = hoyStr();
  const sal: It[] = [];
  for (const it of [...items].sort(porOrdenColumna)) {
    if (proy !== null && it.proyecto !== proy) continue;
    if (a.pospuestos) {
      // sólo los que están escondidos por su `hasta` (abiertos), para traerlos de vuelta
      if (!(abierto(it) && pospuesto(it, hoy)) || (cols !== null && !cols.includes(it.columna))) continue;
    } else if (cols !== null) {
      // una columna pedida por nombre se muestra aunque sea hecho/tirado; los pospuestos no
      if (!cols.includes(it.columna) || (pospuesto(it, hoy) && !a.todo)) continue;
    } else if (!a.todo && !visible(it, hoy)) continue;
    sal.push(it);
  }
  if (a.json) return salidaJson(sal.map(publico));
  for (const it of sal) print(linea(it) + (pospuesto(it, hoy) ? `  hasta ${it.hasta}` : ""));
}

function cmdVer(a: It): void {
  const it = leerItems().find((x) => x.id === a.id) ?? leerArchivo().find((x) => x.id === a.id) ?? morir(`no hay item ${a.id}`);
  if (a.json) return salidaJson(publico(it));
  print(linea(it));
  print(`tipo: ${tipoDe(it)}`);
  for (const k of ["titulo_simple", "contexto", "detalle", "prueba"]) if (it[k]) print(`${k}: ${it[k]}`);
  if (it.opciones?.length) {
    print("opciones:");
    for (const o of it.opciones) print(`  ${o.id}) ${o.texto}` + (o.id === it.por_defecto ? "  (por defecto)" : ""));
  }
  if (it.respuesta) print(`respuesta: ${textoRespuesta(it.respuesta)}`);
  for (const k of ["origen", "clave", "head", "creado", "tocado", "cerrado", "hasta"]) if (it[k]) print(`${k}: ${it[k]}`);
}

async function datosFicha(reg: Registro, nombre: string): Promise<It> {
  const [proy, ent, av] = reg.resolver(nombre);
  if (av) aviso(av);
  const items = leerItems();
  const hoy = hoyStr();
  const mios = items.filter((it) => it.proyecto === proy && visible(it, hoy));
  const d: It = {
    proyecto: proy, desc: "", etapa: null, commit: null, sucio: null, ramas: [], sigue: null,
    espera_dueno: mios.filter((it) => it.columna === "espera-dueno").map(publico), en_curso: mios.filter((it) => it.columna === "en-curso").map(publico), corridas: [],
  };
  const sg = sigueDe(items).get(proy);
  if (sg) d.sigue = { id: sg.id, texto: sg.titulo, head: sg.head, viejo: null };
  if (!ent) return d;
  d.desc = ent.desc || "";
  d.etapa = etapa(ent);
  const ruta = reg.ruta(ent);
  const slug = reg.slug(ent);
  d.corridas = corridas(slug);
  if (!esDir(ruta)) return d;
  const pedidos: Pedido[] = [
    ["commit", ruta, ["log", "-1", "--format=%h%x09%cs%x09%ct%x09%s", "--", "."]],
    ["sucio", ruta, ["status", "--porcelain", "--", "."]],
    ["ramas", ruta, ["branch", "--no-merged", "HEAD", "--list", `pa/${slug}/*`, "--format=%(refname:short)"]],
  ];
  if (sg?.head) pedidos.push(["viejo", ruta, ["rev-list", "--count", `${sg.head}..HEAD`]]);
  const g = await gitVarios(pedidos);
  const c = (g.get("commit") || "").replace(/\n$/, "").split("\t");
  if (c.length >= 4) {
    // sin esto no hay repo (o ningún commit toca la carpeta): se omite todo lo de git
    const asunto = c.slice(3).join("\t");
    d.commit = { hash: c[0], fecha: c[1], asunto, edad: /^\d+$/.test(c[2]) ? edadSeg(Date.now() / 1000 - Number(c[2])) : "?" };
    d.sucio = !!(g.get("sucio") || "").trim();
    d.ramas = (g.get("ramas") || "").split(/\s+/).filter(Boolean).map((x) => ({ rama: x, en_curso: ramaEnCurso(x) }));
    if (g.has("viejo")) {
      const v = (g.get("viejo") || "").trim();
      // null de git: ese HEAD ya no existe en el repo (rebase, reset): seguro que está viejo
      d.sigue.viejo = /^\d+$/.test(v) ? Number(v) : -1;
    }
  }
  return d;
}

function marcaViejo(sg: It): string {
  const v = sg.viejo;
  if (!v) return "";
  return v > 0 ? `puede estar viejo: ${v} commits después` : "puede estar viejo: el HEAD de entonces ya no está";
}

async function cmdFicha(a: It): Promise<void> {
  const d = await datosFicha(new Registro(), a.proyecto);
  if (a.json) return salidaJson(d);
  const corta = !!a.corta;
  const L: string[] = [];
  let cab = d.proyecto + (d.etapa ? ` [${d.etapa}]` : !AREAS.includes(d.proyecto) ? " (no está en el registry)" : " (área)");
  if (d.desc) cab += " — " + recorte(d.desc, corta ? 100 : 200);
  L.push(cab);
  const c = d.commit;
  if (c) L.push(`commit: ${c.hash} ${c.fecha} ${recorte(c.asunto, 80)} (${c.edad}) · árbol ${d.sucio ? "sucio" : "limpio"}`);
  if (d.ramas.length) {
    const rs = (d.ramas as It[]).map((r) => r.rama + (r.en_curso ? " (en curso)" : ""));
    L.push(`ramas sin integrar (${rs.length}): ` + rs.slice(0, 6).join(", ") + (rs.length > 6 ? ` … +${rs.length - 6}` : ""));
  }
  const sg = d.sigue;
  if (sg) {
    const marca = marcaViejo(sg);
    L.push(`sigue: ${recorte(sg.texto, corta ? 160 : 400)}` + (marca ? ` (${marca})` : ""));
  }
  for (const [clave, titulo] of [["espera_dueno", "espera-dueno"], ["en_curso", "en-curso"]]) {
    const its: It[] = d[clave];
    if (!its.length) continue;
    if (corta) L.push(`${titulo} (${its.length}): ` + recorte(its.map((it) => `#${it.id} ${pys(it.titulo)}`).join("; "), 200));
    else {
      L.push(`${titulo}:`);
      for (const it of its) L.push(`  ${it.id}  ${pys(it.titulo)}` + (it.prueba ? ` · probar: ${it.prueba}` : "") + `  (${edad(it.creado)})`);
    }
  }
  if (d.corridas.length) {
    if (corta) L.push("corridas: " + (d.corridas as Corrida[]).map((r) => `${r.fecha.slice(5)} ${recorte(r.resultado, 30)} «${recorte(r.tarea, 40)}»`).join("; "));
    else {
      L.push("corridas:");
      for (const r of d.corridas as Corrida[]) L.push(`  ${r.fecha}  ${r.resultado}  ${r.tarea}`);
    }
  }
  print((corta ? L.slice(0, 8) : L).join("\n"));
}

async function cmdProyectos(a: It): Promise<void> {
  const reg = new Registro();
  const items = leerItems();
  const hoy = hoyStr();
  const abiertos = cuentaAbiertos(items, hoy);
  const sg = sigueDe(items);
  type Fila = { proyecto: string; etapa: string; dias: number | null; abiertos: number; sigue: string | null };
  const filas: Fila[] = [];
  const rutas = new Set<string>();
  const pedidos: Pedido[] = [];
  for (const p of reg.proyectos) {
    const et = etapa(p);
    const r = reg.ruta(p);
    if ((et === "retirado" && !a.retirados) || rutas.has(r)) continue;
    rutas.add(r);
    const n = p.name;
    filas.push({ proyecto: n, etapa: et, dias: null, abiertos: abiertos.get(n) || 0, sigue: sg.get(n)?.titulo ?? null });
    abiertos.delete(n);
    if (r && esDir(r)) pedidos.push([n, r, ["log", "-1", "--format=%ct", "--", "."]]);
  }
  const t = Date.now() / 1000;
  for (const [n, o] of await gitMuchos(pedidos)) if (o && /^\d+$/.test(o.trim())) filas.find((f) => f.proyecto === n)!.dias = Math.floor((t - Number(o.trim())) / 86400);
  // los retirados (sólo con --retirados) van después de los vivos
  const num = (b: boolean) => (b ? 1 : 0);
  filas.sort((x, y) =>
    num(x.etapa === "retirado") - num(y.etapa === "retirado") || num(x.dias === null) - num(y.dias === null) || (x.dias || 0) - (y.dias || 0) ||
    (x.proyecto.toLowerCase() < y.proyecto.toLowerCase() ? -1 : x.proyecto.toLowerCase() > y.proyecto.toLowerCase() ? 1 : 0));
  // áreas y nombres sueltos con algo abierto: no están en el registry pero también son trabajo
  for (const n of [...abiertos.keys()].filter(Boolean).sort()) filas.push({ proyecto: n, etapa: AREAS.includes(n) ? "área" : "?", dias: null, abiertos: abiertos.get(n)!, sigue: sg.get(n)?.titulo ?? null });
  if (a.json) return salidaJson(filas);
  for (const f of filas) print([f.proyecto, f.etapa, f.dias === null ? "-" : `${f.dias}d`, `abiertos:${f.abiertos}`].join("  ") + (f.sigue ? `  sigue: ${recorte(f.sigue, 100)}` : ""));
}

async function cmdHoy(a: It): Promise<void> {
  const fecha = a.fecha !== undefined ? fechaArg(a.fecha) : hoyStr();
  if (!fecha) morir("hoy: --fecha vacía", 2);
  const d = await datosHoy(new Registro(), leerItems(), fecha!);
  if (a.json) return salidaJson(d);
  const commits: Record<string, number> = d.commits;
  if (!(d.integradas.length || d.cerrados.length || Object.keys(commits).length)) return print(`hoy ${fecha}: nada registrado`);
  print(`hoy ${fecha}`);
  if (d.integradas.length) {
    print(`integradas (${d.integradas.length}):`);
    for (const x of d.integradas) print(`  ${x.hora}  ${x.proyecto}  ${x.titulo || x.id}  (${x.commits} commits)`);
  }
  if (d.cerrados.length) {
    print(`cerrados (${d.cerrados.length}):`);
    for (const it of d.cerrados) print(`  ${pys(it.id)}  ${pys(it.columna)}  ${it.proyecto || "-"}  ${pys(it.titulo)}`);
  }
  if (Object.keys(commits).length) print("commits: " + Object.entries(commits).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", "));
}

/** El informe de la última barrida nocturna (bin/barrendero), si es de hoy o ayer. */
function informeBarrendero(): It | null {
  const ruta = path.join(C.env.BARRENDERO_DIR || path.join(C.HOME, ".local/state/barrendero"), "informe.json");
  try {
    const inf = JSON.parse(readFileSync(ruta, "utf8"));
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inf.fecha);
    if (!m) return null;
    const hoy = new Date();
    const dias = Math.round((Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86400000);
    return dias > 1 || !inf || typeof inf !== "object" ? null : inf;
  } catch {
    return null;
  }
}

function lineaBarrendero(inf: It): string | null {
  const [c, m, f] = ["cerrados", "movidos", "fusionados"].map((k) => (inf[k] || []).length);
  if (!(c || m || f)) return null;
  const ids = ["cerrados", "fusionados", "movidos"].flatMap((k) => (inf[k] || []).map((x: It) => `#${x.id}`));
  return `barrendero (${inf.fecha}): cerró ${c}, movió ${m}, fusionó ${f} — ` + ids.slice(0, 8).join(", ") + (ids.length > 8 ? ` … +${ids.length - 8}` : "") + " (barrendero --deshacer)";
}

async function cmdResumen(a: It): Promise<void> {
  const reg = new Registro();
  const hoy = hoyStr();
  const vis = leerItems().filter((it) => visible(it, hoy));
  const esperan = vis.filter((it) => it.columna === "espera-dueno").sort((x, y) => {
    const [p, q] = [String(x.creado || ""), String(y.creado || "")];
    return p < q ? -1 : p > q ? 1 : (x.id || 0) - (y.id || 0);
  });
  const doctor = vis.filter((it) => String(it.origen || "").startsWith("doctor") || String(it.clave || "").startsWith("doctor:"));
  const bandeja = vis.filter((it) => it.columna === "bandeja").length;
  const ramas = await ramasSinIntegrar(reg);
  if (a.json) return salidaJson({ espera_dueno: esperan.map(publico), ramas, doctor: doctor.map(publico), bandeja, barrendero: informeBarrendero() });
  const cola: string[] = [];
  if (ramas.length) cola.push(`ramas sin integrar (${ramas.length}): ` + ramas.slice(0, 5).join(", ") + (ramas.length > 5 ? ` … +${ramas.length - 5}` : ""));
  if (doctor.length) cola.push(`doctor (${doctor.length}): ` + recorte(doctor.map((it) => `#${it.id} ${it.proyecto || "-"} ${pys(it.titulo)}`).join("; "), 220));
  if (bandeja) cola.push(`bandeja: ${bandeja} sin clasificar`);
  const barr = informeBarrendero();
  const lb = barr && lineaBarrendero(barr);
  if (lb) cola.push(lb);
  const L: string[] = [];
  if (esperan.length) {
    L.push(`te esperan ${esperan.length} (más viejo primero):`);
    const lugar = Math.max(1, a.max - cola.length - 1);
    const mostrar = esperan.length <= lugar ? esperan : esperan.slice(0, Math.max(0, lugar - 1));
    for (const it of mostrar) L.push(`  ${it.id}  ${it.proyecto || "-"}  ${recorte(it.titulo, 120)}` + (it.prueba ? ` · probar: ${recorte(it.prueba, 80)}` : "") + `  (${edad(it.creado)})`);
    if (mostrar.length < esperan.length) L.push(`  … y ${esperan.length - mostrar.length} más: tablero listar --columna espera-dueno`);
  }
  L.push(...cola);
  print(L.length ? L.slice(0, Math.max(1, a.max)).join("\n") : "tablero: nada pendiente");
}

// ---- línea de comandos ----

type Opcion = { dest: string; tipo: "valor" | "bandera" | "multi" | "si" | "no"; choices?: string[]; conv?: (s: string) => unknown };
type Posicional = { dest: string; n: "uno" | "varios" | "unoOMas" };
type Spec = { ayuda: string; fn: (a: It) => unknown; pos: Posicional[]; opts: Record<string, Opcion> };

class ErrorUso extends Error {}

const convId = (s: string) => {
  const t = s.replace(/^#+/, "").trim();
  if (!/^[+-]?\d+$/.test(t)) throw new ErrorUso(`id inválido: ${s}`);
  return Number(t);
};
const convInt = (s: string) => {
  if (!/^\s*[+-]?\d+\s*$/.test(s)) throw new ErrorUso(`valor entero inválido: '${s}'`);
  return Number(s);
};

const v = (dest: string, conv?: Opcion["conv"], choices?: string[]): Opcion => ({ dest, tipo: "valor", conv, choices });
const b = (dest: string): Opcion => ({ dest, tipo: "bandera" });
const FLAGS_PREGUNTA: Record<string, Opcion> = {
  "--tipo": v("tipo", undefined, TIPOS), "--simple": v("simple"), "--contexto": v("contexto"), "--opcion": { dest: "opcion", tipo: "multi" }, "--defecto": v("defecto"),
};
const COL = () => v("columna", (s) => colCanon(s.trim()), COLUMNAS);
const JSON_ = { "--json": b("json") };

function comandos(): Record<string, Spec> {
  const texto = { "--detalle": v("detalle"), "--detalle-archivo": v("detalle_archivo"), "--prueba": v("prueba"), "--prueba-archivo": v("prueba_archivo") };
  return {
    agregar: { ayuda: "agrega un item (a bandeja si no hay --columna) e imprime su id", fn: cmdAgregar, pos: [{ dest: "titulo", n: "uno" }],
      opts: { "--columna": COL(), "--proyecto": v("proyecto"), ...texto, "--origen": v("origen"), "--clave": v("clave"), "--hasta": v("hasta"), ...FLAGS_PREGUNTA } },
    listar: { ayuda: "abiertos (sin hecho, tirado ni pospuestos), una línea por item", fn: cmdListar, pos: [],
      opts: { ...JSON_, "--proyecto": v("proyecto"), "--columna": v("columna"), "--todo": b("todo"), "--pospuestos": b("pospuestos") } },
    ver: { ayuda: "un item con todos sus campos (tipo, opciones y respuesta incluidos)", fn: cmdVer, pos: [{ dest: "id", n: "uno" }], opts: { ...JSON_ } },
    mover: { ayuda: "cambia columna, proyecto o hasta de un item", fn: cmdMover, pos: [{ dest: "id", n: "uno" }], opts: { "--columna": COL(), "--proyecto": v("proyecto"), "--hasta": v("hasta") } },
    editar: { ayuda: "cambia título, detalle, prueba o los campos de pregunta de un item", fn: cmdEditar, pos: [{ dest: "id", n: "uno" }],
      opts: { "--titulo": v("titulo"), "--detalle": v("detalle"), "--detalle-archivo": v("detalle_archivo"), "--prueba": v("prueba"), "--prueba-archivo": v("prueba_archivo"),
        "--sumar": v("sumar"), "--sumar-archivo": v("sumar_archivo"), ...FLAGS_PREGUNTA, "--sin-opciones": b("sin_opciones") } },
    responder: { ayuda: D("guarda la respuesta de {D} en el item, sin cerrarlo ni moverlo"), fn: cmdResponder, pos: [{ dest: "id", n: "uno" }],
      opts: { "--respuesta": v("respuesta"), "--opcion": v("opcion"), "--anda": { dest: "anda", tipo: "si" }, "--no-anda": { dest: "anda", tipo: "no" }, "--nota": v("nota"), "--borrar": b("borrar") } },
    posponer: { ayuda: "cambia o quita el `hasta` de un item: `posponer 12 +3d`, `posponer 12 ya`", fn: cmdPosponer, pos: [{ dest: "ids", n: "unoOMas" }, { dest: "fecha", n: "uno" }], opts: {} },
    cerrar: { ayuda: "pasa a hecho, por id o por --clave (clave sin item abierto: no hace nada)", fn: (a) => cerrarA(a, "hecho"), pos: [{ dest: "ids", n: "varios" }],
      opts: { "--clave": v("clave"), "--nota": v("nota") } },
    tirar: { ayuda: "pasa a tirado (no se va a hacer)", fn: (a) => cerrarA(a, "tirado"), pos: [{ dest: "ids", n: "unoOMas" }], opts: {} },
    sigue: { ayuda: "el próximo paso de un proyecto: uno solo, reemplaza al anterior; guarda el HEAD", fn: cmdSigue, pos: [{ dest: "proyecto", n: "uno" }, { dest: "texto", n: "uno" }], opts: { "--head": v("head") } },
    ficha: { ayuda: "dónde quedó un proyecto: commit, ramas sin integrar, sigue, esperas, corridas de pa", fn: cmdFicha, pos: [{ dest: "proyecto", n: "uno" }], opts: { ...JSON_, "--corta": b("corta") } },
    proyectos: { ayuda: "los no retirados por días sin tocar, con etapa, abiertos y su sigue", fn: cmdProyectos, pos: [], opts: { ...JSON_, "--retirados": b("retirados") } },
    hoy: { ayuda: "lo hecho en el día: integradas de pa, items cerrados, commits por proyecto", fn: cmdHoy, pos: [], opts: { ...JSON_, "--fecha": v("fecha") } },
    resumen: { ayuda: D("lo que se inyecta al arrancar una sesión: qué espera a {D}, ramas, doctor, bandeja"), fn: cmdResumen, pos: [], opts: { ...JSON_, "--max": { ...v("max", convInt) } } },
    archivar: { ayuda: "mueve hecho y tirado viejos a hecho/AAAA-MM.jsonl", fn: cmdArchivar, pos: [], opts: { "--dias": v("dias", convInt) } },
    init: { ayuda: "crea el directorio del tablero (repo git, hecho/, items.jsonl) si no existe", fn: cmdInit, pos: [], opts: {} },
  };
}

const ids = (spec: Spec) => ({ ...spec });

function ayudaGeneral(cmds: Record<string, Spec>): string {
  return D(`uso: tablero <comando> [opciones]

Pendientes, esperas, ideas y hecho de {D}, en un solo lugar.

comandos:
${Object.entries(cmds).map(([n, s]) => `  ${n.padEnd(10)} ${s.ayuda}`).join("\n")}

columnas: ${COLUMNAS.join(" | ")}
  bandeja -> sigue -> en-curso -> espera-dueno / espera-externo -> hecho | tirado; aparte, ideas.
proyecto: un nombre del registry (como en \`pa\`) o un área libre (${AREAS.join(", ")}).
  Un nombre que no se conoce se anota igual y avisa por stderr.
clave:    idempotencia para fuentes automáticas (pa:<id>, doctor:<proyecto>:<chequeo>):
  \`agregar --clave K\` sobre una clave abierta la actualiza; cerrada, la reabre.
hasta:    AAAA-MM-DD, hoy, mañana, +3d, +2s. El item no aparece hasta ese día. \`ya\` lo trae de vuelta.
texto por archivo: --detalle-archivo F, --prueba-archivo F (y --sumar-archivo F en editar), con \`-\` = stdin.
pregunta o prueba (lo que Trama le muestra a {D} en espera-dueno): --tipo, --simple, --contexto,
  --opcion repetible (ids a, b, c…) y --defecto (id o número). \`responder\` guarda la respuesta y NO cierra el item.
salida:   una línea por item: id  columna  proyecto  título  (edad).

entorno:  TABLERO_DIR  TABLERO_VISTA  PA_STATE  PROYECTOS_REGISTRY
`);
}

/** Como el argparse del script: `--x v`, `--x=v`, prefijos únicos de opciones, `--` y valores con espacios que empiezan con `-`. */
function parsear(nombre: string, spec: Spec, args: string[]): It {
  const a: It = { cmd: nombre, ...(nombre === "resumen" ? { max: 12 } : nombre === "archivar" ? { dias: 30 } : {}) }; // los default de argparse
  const pos: string[] = [];
  const buscarOpcion = (flag: string): [string, Opcion] => {
    if (flag in spec.opts) return [flag, spec.opts[flag]];
    const cands = Object.keys(spec.opts).filter((k) => k.startsWith(flag));
    if (cands.length === 1) return [cands[0], spec.opts[cands[0]]];
    throw new ErrorUso(cands.length > 1 ? `ambiguous option: ${flag} could match ${cands.join(", ")}` : `unrecognized arguments: ${flag}`);
  };
  const esValor = (t: string) => !t.startsWith("-") || t === "-" || t.includes(" ") || /^-\d+$|^-\d*\.\d+$/.test(t);
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === "--") {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (!(t.startsWith("-") && t.length > 1) || /^-\d+$|^-\d*\.\d+$/.test(t) || (t.includes(" ") && !t.startsWith("--"))) {
      pos.push(t);
      continue;
    }
    const eq = t.startsWith("--") ? t.indexOf("=") : -1;
    const [clave, op] = buscarOpcion(eq >= 0 ? t.slice(0, eq) : t);
    if (op.tipo === "bandera") a[op.dest] = true;
    else if (op.tipo === "si" || op.tipo === "no") {
      const nuevo = op.tipo === "si";
      if (a[op.dest] !== undefined && a[op.dest] !== nuevo) throw new ErrorUso(`argument ${clave}: not allowed with argument --${nuevo ? "no-anda" : "anda"}`);
      a[op.dest] = nuevo;
    } else {
      let val: string;
      if (eq >= 0) val = t.slice(eq + 1);
      else if (i + 1 < args.length && esValor(args[i + 1])) val = args[++i];
      else throw new ErrorUso(`argument ${clave}: expected one argument`);
      const conv = op.conv ? (op.conv(val) as string) : val;
      if (op.choices && !op.choices.includes(conv)) throw new ErrorUso(`argument ${clave}: invalid choice: '${conv}' (choose from ${op.choices.map((c) => `'${c}'`).join(", ")})`);
      if (op.tipo === "multi") (a[op.dest] ??= []).push(conv);
      else a[op.dest] = conv;
    }
  }
  // posicionales: los de nargs variable se llevan lo que sobra
  let resto = pos.length;
  const fijos = spec.pos.filter((p) => p.n === "uno").length;
  const minimos = spec.pos.reduce((n, p) => n + (p.n === "varios" ? 0 : 1), 0);
  if (resto < minimos) throw new ErrorUso(`the following arguments are required: ${spec.pos.slice(resto).filter((p) => p.n !== "varios").map((p) => p.dest).join(", ")}`);
  let k = 0;
  for (const p of spec.pos) {
    if (p.n === "uno") {
      a[p.dest] = p.dest === "id" ? convId(pos[k++]) : pos[k++];
      resto--;
    } else {
      const sobran = Math.max(0, pos.length - fijos);
      const tomar = p.n === "unoOMas" ? sobran : sobran;
      a[p.dest] = pos.slice(k, k + tomar).map(convId);
      k += tomar;
      resto -= tomar;
    }
  }
  if (k < pos.length) throw new ErrorUso(`unrecognized arguments: ${pos.slice(k).join(" ")}`);
  return a;
}

async function volcar(texto: string, destino: NodeJS.WriteStream): Promise<void> {
  if (!texto) return;
  await new Promise<void>((ok) => {
    destino.once("error", () => ok()); // `tablero listar | head`: el lector cortó; no es un error de tablero
    destino.write(texto, () => ok());
  });
}

/** Corre un comando de tablero; devuelve el código de salida. */
export async function main(argv: string[], env: Env = process.env): Promise<number> {
  C = configurar(env);
  dueno = null;
  SALIDA = [];
  AVISOS = [];
  const cmds = comandos();
  let rc = 0;
  try {
    const [nombre, ...resto] = argv;
    if (!nombre || nombre === "-h" || nombre === "--help") {
      if (nombre) SALIDA.push(ayudaGeneral(cmds));
      else AVISOS.push(ayudaGeneral(cmds));
      rc = nombre ? 0 : 2;
    } else if (!(nombre in cmds)) {
      AVISOS.push(`tablero: error: argument <comando>: invalid choice: '${nombre}' (choose from ${Object.keys(cmds).map((c) => `'${c}'`).join(", ")})\n`);
      rc = 2;
    } else if (resto.includes("-h") || resto.includes("--help")) {
      SALIDA.push(`uso: tablero ${nombre} [opciones]\n\n${cmds[nombre].ayuda}\n`);
    } else {
      const spec = ids(cmds[nombre]);
      await spec.fn(parsear(nombre, spec, resto));
    }
  } catch (e) {
    if (e instanceof Salida) {
      AVISOS.push(`tablero: ${e.message}\n`);
      rc = e.rc;
    } else if (e instanceof ErrorUso) {
      AVISOS.push(`tablero: error: ${e.message}\n`);
      rc = 2;
    } else if (e instanceof ErrorCandado) {
      AVISOS.push(`tablero: ${e.message}\n`);
      rc = 1;
    } else throw e;
  }
  await volcar(SALIDA.join(""), process.stdout);
  await volcar(AVISOS.join(""), process.stderr);
  return rc;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (rc) => void (process.exitCode = rc),
    (e: Error) => {
      process.stderr.write(`tablero: ${e.message}\n`);
      process.exitCode = 1;
    },
  );
}
