// Los pasos de un worker, armados desde su transcript de Claude Code: qué pensó, leyó, buscó, editó, corrió y
// delegó, cuándo y cuánto tardó, con el detalle de cada uno (el diff de un Edit, la salida de un comando, el
// RESULTADO). Es lo que muestra la vista de un worker (referencias/maquetas/worker-vista/c-compacta.html).
//
// Incremental, como conv-cache.ts: del transcript se lee sólo lo que creció (`ColaDeLineas`); si se achicó,
// cambió de inodo o ya no empieza igual se arma de nuevo (`gen` sube). Cada paso lleva `v`, la revisión en
// que se tocó por última vez: quien mira pide "lo que cambió desde v", nunca la lista entera.
//
// Del razonamiento no hay texto (el transcript lo trae vacío: "contenido oculto"): sólo que pensó y cuánto.
// Todo lo largo se corta con su marca (`Cortado`: lo que queda, el tamaño original y si se recortó).
// Sin Electron: lo prueba `tests/pasos.test.ts` con transcripts falsos.
import { open } from "node:fs/promises";
import path from "node:path";
import { silencio } from "./log.ts";
import { sumaVacia, totalDe, type Suma } from "./transcripts.ts";

// --- Tipos ---------------------------------------------------------------------

/** Un texto con tope: `t` es lo que queda, `total` los caracteres que tenía, `recortado` si se cortó. */
export type Cortado = { t: string; total: number; recortado: boolean };

export type TipoPaso = "pensar" | "leer" | "buscar" | "editar" | "escribir" | "correr" | "delegar" | "texto" | "otro";
export type EstadoPaso = "corriendo" | "ok" | "fallo";

export type Cambio = {
  viejo: Cortado;
  nuevo: Cortado;
  /** `replace_all`: se cambiaron todas las apariciones. */
  todo: boolean;
  /** Línea del archivo donde empieza lo cambiado (de lo que contestó la herramienta); `null` si no se sabe. */
  desde: number | null;
};

export type Detalle =
  | { clase: "pensar" }
  | { clase: "leer"; ruta: string; desde: number | null; lineas: number | null; total: number | null; imagen: boolean; texto: Cortado | null }
  | { clase: "buscar"; herramienta: string; patron: string; ruta: string | null; resultados: number | null; texto: Cortado | null }
  | { clase: "editar"; ruta: string; cambios: Cambio[]; /** Cambios que no entraron (tope). */ masCambios: number; mas: number; menos: number }
  | { clase: "escribir"; ruta: string; contenido: Cortado; lineas: number; nuevo: boolean | null; mas: number; menos: number }
  | { clase: "correr"; comando: Cortado; descripcion: string | null; salida: Cortado | null; codigo: number | null; interrumpido: boolean; fondo: boolean }
  | {
      clase: "delegar";
      descripcion: string;
      agente: string | null;
      modelo: string | null;
      prompt: Cortado;
      respuesta: Cortado | null;
      agentId: string | null;
      /** Lanzado en segundo plano: lo que contestó la herramienta es sólo "lanzado". */
      fondo: boolean;
      tokens: number | null;
      usos: number | null;
      /** Los pasos del subagente, si su transcript está. */
      pasos: Paso[];
      /** Pasos viejos del subagente que no entraron (tope). */
      omitidos: number;
    }
  | { clase: "texto"; texto: Cortado; /** El último mensaje del turno: el RESULTADO. */ final: boolean }
  | { clase: "otro"; nombre: string; entrada: string; salida: Cortado | null };

export type Paso = {
  /** Posición desde el primer paso (sube de a uno; no se reusa aunque se descarten los más viejos). */
  n: number;
  /** Revisión en que se tocó por última vez. */
  v: number;
  /** El `tool_use_id` (o el del bloque), único en el transcript. */
  id: string;
  tipo: TipoPaso;
  /** Lo corto que dice qué fue: la ruta, el patrón, la primera línea del comando. El verbo lo pone la vista. */
  titulo: string;
  /** Epoch en ms de cuando empezó (el timestamp de su línea); `null` si no lo traía. */
  t: number | null;
  /** Cuánto tardó; `null` mientras corre o si no se sabe. */
  dur: number | null;
  estado: EstadoPaso;
  /** Por qué falló, en una línea corta (el detalle entero, en `detalle`). */
  error: string | null;
  detalle: Detalle;
};

export type ArchivoTocado = { ruta: string; mas: number; menos: number; ediciones: number; nuevo: boolean };

export type Encabezado = {
  /** El primer mensaje que recibió (la tarea), recortado. */
  tarea: string | null;
  modelo: string | null;
  effort: string | null;
  /** Mensajes distintos del modelo (cada llamada a la API). */
  turnos: number;
  /** Tokens exactos, con los de sus subagentes. */
  tokens: Suma;
  /** Entrada + caché + salida. */
  total: number;
  /** Cuánto de lo que entró vino del caché (0–1); `null` si no entró nada. */
  cache: number | null;
  inicio: number | null;
  fin: number | null;
  /** `fin − inicio` en ms; el que mira suma el reloj si el worker sigue vivo. */
  dur: number | null;
  compactaciones: number;
  /** Cuántos pasos hubo en total (incluidos los descartados por tope). */
  pasos: number;
  archivos: ArchivoTocado[];
  mas: number;
  menos: number;
};

export type VistaPasos = {
  id: string;
  /** Hay transcript. `false`: el worker todavía no empezó (o su `.sid` no está). */
  hay: boolean;
  /** Sube cuando se arma todo de nuevo: quien tenga otra, que pida la vista entera. */
  gen: number;
  v: number;
  /** Pasos viejos que no entraron (tope). */
  omitidos: number;
  encabezado: Encabezado;
  pasos: Paso[];
};

/** Lo que cambió desde `desde` (revisión): pasos nuevos o tocados, más el encabezado. Se aplica si quien mira tiene `v >= desde`. */
export type CambioPasos = {
  id: string;
  gen: number;
  desde: number;
  v: number;
  omitidos: number;
  /** Cuántos pasos hubo en total: lo que sobre de la lista de quien mira, se descarta. */
  total: number;
  encabezado: Encabezado;
  cambios: Paso[];
};

// --- Topes ---------------------------------------------------------------------

/** Caracteres (no bytes) de cada pieza; `pasos` y los demás, cantidades. */
export const TOPES = {
  texto: 16_384,
  salida: 8_192,
  lectura: 6_144,
  lado: 8_192,
  escrito: 12_288,
  prompt: 4_096,
  tarea: 2_048,
  titulo: 120,
  entrada: 1_024,
  error: 300,
  cambios: 20,
  pasos: 1500,
  anidados: 300,
  archivos: 200,
} as const;
/** Una línea del transcript más larga que esto (una captura en base64) se saltea sin leerla. */
const MAX_LINEA = 32 * 1024 * 1024;
const PEDAZO = 4 * 1024 * 1024;
const HUELLA = 64;

/**
 * Corta `s` a `tope` caracteres. `cabeza`: se queda con el principio (código, diffs: los números de línea siguen
 * valiendo). `extremos`: principio y final con un aviso en el medio (la salida de un comando: lo último importa).
 */
export function cortar(s: string, tope: number, modo: "cabeza" | "extremos" = "cabeza"): Cortado {
  if (s.length <= tope) return { t: s, total: s.length, recortado: false };
  if (modo === "cabeza") {
    // Si hay un salto de línea cerca del tope, se corta ahí: no queda una línea a medias.
    const sal = s.lastIndexOf("\n", tope);
    return { t: s.slice(0, sal > tope * 0.8 ? sal : tope), total: s.length, recortado: true };
  }
  const cab = Math.ceil(tope * 0.6);
  const cola = tope - cab;
  return { t: `${s.slice(0, cab)}\n… ${s.length - tope} caracteres omitidos …\n${s.slice(s.length - cola)}`, total: s.length, recortado: true };
}

// --- Ayudas --------------------------------------------------------------------

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const nat = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
const una = (s: string, tope: number): string => {
  const l = s.trim().split("\n", 1)[0] ?? "";
  return l.length > tope ? `${l.slice(0, tope - 1)}…` : l;
};

/** Cuántas líneas tiene un texto (el salto final no cuenta una de más). */
export const lineasDe = (s: string): number => (s === "" ? 0 : s.split("\n").length - (s.endsWith("\n") ? 1 : 0));

/**
 * Líneas que suma y que quita un cambio de `viejo` a `nuevo`: lo común del principio y del final no cuenta y
 * del resto se saca la subsecuencia común más larga. Si es enorme, se cuenta todo como cambiado.
 */
export function contarDiff(viejo: string, nuevo: string): { mas: number; menos: number } {
  let a = viejo === "" ? [] : viejo.split("\n");
  let b = nuevo === "" ? [] : nuevo.split("\n");
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  a = a.slice(ini);
  b = b.slice(ini);
  let fin = 0;
  while (fin < a.length && fin < b.length && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++;
  a = a.slice(0, a.length - fin);
  b = b.slice(0, b.length - fin);
  if (!a.length || !b.length || a.length * b.length > 400_000) return { mas: b.length, menos: a.length };
  let prev = new Uint32Array(b.length + 1);
  let act = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) act[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], act[j - 1]);
    [prev, act] = [act, prev];
  }
  const comun = prev[b.length];
  return { mas: b.length - comun, menos: a.length - comun };
}

/** Lo de un `structuredPatch` de Claude Code: cuántas líneas suma y quita, y dónde empieza el primer cambio. */
function parche(x: unknown): { mas: number; menos: number; desde: number | null } | null {
  if (!Array.isArray(x) || !x.length) return null;
  let mas = 0;
  let menos = 0;
  let desde: number | null = null;
  for (const h of x) {
    const o = obj(h);
    if (!o || !Array.isArray(o.lines)) continue;
    let ctx = 0;
    let visto = false;
    for (const l of o.lines) {
      const s = str(l);
      if (s.startsWith("+")) mas++;
      else if (s.startsWith("-")) menos++;
      if (!visto) {
        if (s.startsWith(" ")) ctx++;
        else visto = true;
      }
    }
    if (desde === null && nat(o.oldStart) !== null) desde = (o.oldStart as number) + (visto ? ctx : 0);
  }
  return { mas, menos, desde };
}

/** El texto de un `content` de tool_result (cadena, o lista de bloques) y cuántas imágenes traía. */
function textoDe(c: unknown): { texto: string; imagenes: number } {
  if (typeof c === "string") return { texto: c, imagenes: 0 };
  if (!Array.isArray(c)) return { texto: "", imagenes: 0 };
  const partes: string[] = [];
  let imagenes = 0;
  for (const b of c) {
    const o = obj(b);
    if (!o) continue;
    if (o.type === "text" && typeof o.text === "string") partes.push(o.text);
    else if (o.type === "image") imagenes++;
  }
  return { texto: partes.join("\n"), imagenes };
}

// --- Lectura incremental --------------------------------------------------------

/**
 * Un archivo de líneas que crece, leído de a trozos: cada vez sólo lo nuevo y sólo líneas enteras (la última puede
 * estar a medio escribir). Si el archivo se achicó, es otro (inodo) o ya no termina en lo que se leyó, avisa
 * (`reiniciar`) y empieza de cero.
 */
export class ColaDeLineas {
  bytes = 0;
  private ino = 0;
  private huella: Buffer = Buffer.alloc(0);

  /** `true` si leyó algo. Nunca lanza: lo que falla se anota y se sigue en la próxima vuelta. */
  async avanzar(ruta: string, linea: (l: string) => void, reiniciar: () => void): Promise<boolean> {
    let f;
    try {
      f = await open(ruta, "r");
    } catch {
      return false;
    }
    try {
      const { size, ino } = await f.stat();
      if (this.bytes > 0 && (ino !== this.ino || size < this.bytes || !(await this.igual(f)))) {
        this.bytes = 0;
        this.huella = Buffer.alloc(0);
        reiniciar();
      }
      this.ino = ino;
      if (size <= this.bytes) return false;
      const antes = this.bytes;
      let pos = this.bytes;
      let resto: Buffer = Buffer.alloc(0);
      let saltando = false;
      while (pos < size) {
        const n = Math.min(PEDAZO, size - pos);
        const trozo = Buffer.allocUnsafe(n);
        const { bytesRead } = await f.read(trozo, 0, n, pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        let buf: Buffer = trozo.subarray(0, bytesRead);
        if (saltando) {
          // Se está salteando una línea enorme: se sigue hasta su salto.
          const i = buf.indexOf(10);
          if (i < 0) {
            this.bytes = pos;
            continue;
          }
          buf = buf.subarray(i + 1);
          saltando = false;
        } else if (resto.length) buf = Buffer.concat([resto, buf]);
        const fin = buf.lastIndexOf(10);
        if (fin < 0) {
          if (buf.length > MAX_LINEA) {
            resto = Buffer.alloc(0);
            saltando = true;
            this.bytes = pos;
          } else resto = Buffer.from(buf);
          continue;
        }
        for (const l of buf.toString("utf8", 0, fin).split("\n")) if (l) linea(l);
        resto = Buffer.from(buf.subarray(fin + 1));
        this.bytes = pos - resto.length;
      }
      // Una última línea sin salto que ya es un JSON entero cuenta (un objeto no es prefijo de otro).
      if (resto.length && pos === size) {
        const txt = resto.toString("utf8");
        let entera = false;
        try {
          entera = JSON.parse(txt) !== undefined;
        } catch {}
        if (entera) {
          linea(txt);
          this.bytes = size;
        }
      }
      const h = Math.min(HUELLA, this.bytes);
      const buf = Buffer.alloc(h);
      if (h) await f.read(buf, 0, h, this.bytes - h);
      this.huella = buf;
      return this.bytes > antes;
    } catch (e) {
      silencio("pasos")(e);
      return false;
    } finally {
      await f.close().catch(silencio("pasos"));
    }
  }

  private async igual(f: Awaited<ReturnType<typeof open>>): Promise<boolean> {
    if (!this.huella.length) return true;
    const b = Buffer.alloc(this.huella.length);
    const { bytesRead } = await f.read(b, 0, b.length, this.bytes - this.huella.length);
    return bytesRead === b.length && b.equals(this.huella);
  }
}

// --- El armador -----------------------------------------------------------------

export type OpcionesArmador = {
  /** Donde escriben los subagentes de esta sesión (`<sid>/subagents`); sin esto no se anidan. */
  carpetaSub?: string | null;
  /** El transcript de un subagente: sus líneas son todas `isSidechain`, y no hay tarea ni subagentes adentro. */
  subagente?: boolean;
};

const vacio = (): Encabezado => ({
  tarea: null,
  modelo: null,
  effort: null,
  turnos: 0,
  tokens: sumaVacia(),
  total: 0,
  cache: null,
  inicio: null,
  fin: null,
  dur: null,
  compactaciones: 0,
  pasos: 0,
  archivos: [],
  mas: 0,
  menos: 0,
});
export const encabezadoVacio = vacio;

export class ArmadorPasos {
  ruta: string;
  gen = 0;
  v = 0;
  pasos: Paso[] = [];
  omitidos = 0;
  private carpetaSub: string | null;
  private subagente: boolean;
  private cola = new ColaDeLineas();
  private contador = 0;
  private porUso = new Map<string, Paso>();
  private usos = new Map<string, Suma>();
  private suma = sumaVacia();
  private tarea: string | null = null;
  private modelo: string | null = null;
  private effort: string | null = null;
  private inicio: number | null = null;
  private fin: number | null = null;
  private ultimoT: number | null = null;
  private compactaciones = 0;
  private archivos = new Map<string, ArchivoTocado>();
  private nietos = new Map<string, ArmadorPasos>();

  constructor(ruta: string, o: OpcionesArmador = {}) {
    this.ruta = ruta;
    this.carpetaSub = o.subagente ? null : (o.carpetaSub ?? null);
    this.subagente = o.subagente === true;
  }

  private reiniciar(): void {
    this.gen++;
    this.v++;
    this.pasos = [];
    this.omitidos = 0;
    this.contador = 0;
    this.porUso.clear();
    this.usos.clear();
    this.suma = sumaVacia();
    this.tarea = this.modelo = this.effort = this.inicio = this.fin = this.ultimoT = null;
    this.compactaciones = 0;
    this.archivos.clear();
    this.nietos.clear();
  }

  /** Lee lo que creció (y los subagentes). `true` si algo cambió. */
  async leer(): Promise<boolean> {
    const antes = this.v;
    await this.cola.avanzar(
      this.ruta,
      (l) => this.linea(l),
      () => this.reiniciar(),
    );
    if (this.carpetaSub) await this.anidar();
    return this.v !== antes;
  }

  /** Pasos tocados desde la revisión `v`. */
  cambiosDesde(v: number): Paso[] {
    return this.pasos.filter((p) => p.v > v);
  }

  vista(id: string): VistaPasos {
    return { id, hay: true, gen: this.gen, v: this.v, omitidos: this.omitidos, encabezado: this.encabezado(), pasos: this.pasos };
  }

  cambio(id: string, desde: number): CambioPasos {
    return { id, gen: this.gen, desde, v: this.v, omitidos: this.omitidos, total: this.contador, encabezado: this.encabezado(), cambios: this.cambiosDesde(desde) };
  }

  /** Tokens propios y de los subagentes anidados. */
  private sumaTotal(): Suma {
    const s = { ...this.suma };
    for (const n of this.nietos.values()) {
      const x = n.suma;
      s.entrada += x.entrada;
      s.cacheCreado += x.cacheCreado;
      s.cacheLeido += x.cacheLeido;
      s.salida += x.salida;
    }
    return s;
  }

  encabezado(): Encabezado {
    const tokens = this.sumaTotal();
    const entro = tokens.entrada + tokens.cacheCreado + tokens.cacheLeido;
    const archivos = [...this.archivos.values()];
    return {
      tarea: this.tarea,
      modelo: this.modelo,
      effort: this.effort,
      turnos: this.usos.size,
      tokens,
      total: totalDe(tokens),
      cache: entro > 0 ? tokens.cacheLeido / entro : null,
      inicio: this.inicio,
      fin: this.fin,
      dur: this.inicio !== null && this.fin !== null ? this.fin - this.inicio : null,
      compactaciones: this.compactaciones,
      pasos: this.contador,
      archivos: archivos.slice(0, TOPES.archivos),
      mas: archivos.reduce((n, a) => n + a.mas, 0),
      menos: archivos.reduce((n, a) => n + a.menos, 0),
    };
  }

  // --- Líneas ---

  private linea(linea: string): void {
    // Sin parsear lo que no es un mensaje (adjuntos, títulos, pedidos a la API).
    const compacta = linea.includes('"compact_boundary"');
    if (!compacta && !linea.includes('"type":"assistant"') && !linea.includes('"type":"user"')) return;
    let d: Record<string, unknown> | null;
    try {
      d = obj(JSON.parse(linea));
    } catch {
      return;
    }
    if (!d) return;
    // En el transcript principal lo de un subagente no va (tiene el suyo).
    if (!this.subagente && d.isSidechain === true) return;
    const t = typeof d.timestamp === "string" ? Date.parse(d.timestamp) : NaN;
    const hora = Number.isFinite(t) ? t : null;
    this.v++;
    if (hora !== null) {
      this.inicio = this.inicio === null ? hora : Math.min(this.inicio, hora);
      this.fin = this.fin === null ? hora : Math.max(this.fin, hora);
    }
    if (d.type === "system" && d.subtype === "compact_boundary") this.compactaciones++;
    else if (d.type === "assistant") this.asistente(d, hora);
    else if (d.type === "user") this.usuario(d, hora);
    if (hora !== null) this.ultimoT = hora;
  }

  private asistente(d: Record<string, unknown>, hora: number | null): void {
    const m = obj(d.message);
    if (!m) return;
    const modelo = str(m.model);
    const id = str(m.id);
    const sintetico = modelo === "<synthetic>";
    if (modelo && !sintetico) {
      this.modelo = modelo;
      if (typeof d.effort === "string" && d.effort) this.effort = d.effort;
      const u = obj(m.usage);
      if (u) {
        const uso: Suma = { entrada: nat(u.input_tokens) ?? 0, cacheCreado: nat(u.cache_creation_input_tokens) ?? 0, cacheLeido: nat(u.cache_read_input_tokens) ?? 0, salida: nat(u.output_tokens) ?? 0 };
        // Un mensaje ocupa varias líneas (una por bloque) con el mismo id y usage: cuenta una vez, vale el último.
        const clave = id || str(d.uuid) || `s${this.usos.size}`;
        const antes = this.usos.get(clave);
        if (antes) {
          this.suma.entrada -= antes.entrada;
          this.suma.cacheCreado -= antes.cacheCreado;
          this.suma.cacheLeido -= antes.cacheLeido;
          this.suma.salida -= antes.salida;
        }
        this.suma.entrada += uso.entrada;
        this.suma.cacheCreado += uso.cacheCreado;
        this.suma.cacheLeido += uso.cacheLeido;
        this.suma.salida += uso.salida;
        this.usos.set(clave, uso);
      }
    }
    const final = m.stop_reason === "end_turn";
    const bloques = Array.isArray(m.content) ? m.content : [];
    const base = id || str(d.uuid) || String(this.contador);
    bloques.forEach((x, i) => {
      const b = obj(x);
      if (!b) return;
      const dur = hora !== null && this.ultimoT !== null ? Math.max(0, hora - this.ultimoT) : null;
      if (b.type === "thinking") {
        this.agregar({ id: `${base}:${i}`, tipo: "pensar", titulo: "", t: hora, dur, estado: "ok", error: null, detalle: { clase: "pensar" } });
      } else if (b.type === "text") {
        const texto = str(b.text);
        if (!texto.trim()) return;
        this.agregar({
          id: `${base}:${i}`,
          tipo: "texto",
          titulo: una(texto, TOPES.titulo),
          t: hora,
          dur,
          estado: sintetico ? "fallo" : "ok",
          error: sintetico ? una(texto, TOPES.error) : null,
          detalle: { clase: "texto", texto: cortar(texto, TOPES.texto), final: final && !sintetico },
        });
      } else if (b.type === "tool_use") {
        this.herramienta(b, hora);
      }
    });
  }

  private agregar(p: Omit<Paso, "n" | "v">): Paso {
    const paso: Paso = { ...p, n: this.contador++, v: this.v };
    this.pasos.push(paso);
    if (this.pasos.length > TOPES.pasos + 100) {
      for (const viejo of this.pasos.splice(0, 100)) this.porUso.delete(viejo.id);
      this.omitidos += 100;
    }
    return paso;
  }

  private herramienta(b: Record<string, unknown>, hora: number | null): void {
    const id = str(b.id);
    const nombre = str(b.name);
    const e = obj(b.input) ?? {};
    const base = { id: id || `${nombre}:${this.contador}`, t: hora, dur: null, estado: "corriendo" as const, error: null };
    let paso: Paso;
    switch (nombre) {
      case "Read": {
        const ruta = str(e.file_path);
        paso = this.agregar({ ...base, tipo: "leer", titulo: ruta, detalle: { clase: "leer", ruta, desde: nat(e.offset), lineas: null, total: null, imagen: false, texto: null } });
        break;
      }
      case "Grep":
      case "Glob":
      case "WebFetch":
      case "WebSearch": {
        const patron = str(e.pattern) || str(e.url) || str(e.query);
        const ruta = str(e.path) || str(e.glob) || null;
        paso = this.agregar({ ...base, tipo: "buscar", titulo: una(patron, TOPES.titulo), detalle: { clase: "buscar", herramienta: nombre, patron, ruta, resultados: null, texto: null } });
        break;
      }
      case "Edit":
      case "MultiEdit": {
        const ruta = str(e.file_path);
        const lista = nombre === "Edit" ? [e] : Array.isArray(e.edits) ? e.edits.map((x) => obj(x) ?? {}) : [];
        const cambios: Cambio[] = lista.slice(0, TOPES.cambios).map((c) => ({ viejo: cortar(str(c.old_string), TOPES.lado), nuevo: cortar(str(c.new_string), TOPES.lado), todo: c.replace_all === true, desde: null }));
        paso = this.agregar({ ...base, tipo: "editar", titulo: ruta, detalle: { clase: "editar", ruta, cambios, masCambios: Math.max(0, lista.length - cambios.length), mas: 0, menos: 0 } });
        // Lo que suma y quita se cuenta al resultado (si falló, no entró); guardado acá para no releer el input.
        this.pendiente.set(paso.id, lista);
        break;
      }
      case "Write": {
        const ruta = str(e.file_path);
        const contenido = str(e.content);
        paso = this.agregar({ ...base, tipo: "escribir", titulo: ruta, detalle: { clase: "escribir", ruta, contenido: cortar(contenido, TOPES.escrito), lineas: lineasDe(contenido), nuevo: null, mas: 0, menos: 0 } });
        this.pendiente.set(paso.id, [{ new_string: contenido }]);
        break;
      }
      case "Bash":
      case "PowerShell": {
        const comando = str(e.command);
        paso = this.agregar({
          ...base,
          tipo: "correr",
          titulo: una(comando, TOPES.titulo),
          detalle: { clase: "correr", comando: cortar(comando, TOPES.entrada * 4), descripcion: str(e.description) || null, salida: null, codigo: null, interrumpido: false, fondo: e.run_in_background === true },
        });
        break;
      }
      case "Task":
      case "Agent": {
        const descripcion = str(e.description) || una(str(e.prompt), TOPES.titulo);
        paso = this.agregar({
          ...base,
          tipo: "delegar",
          titulo: una(descripcion, TOPES.titulo),
          detalle: { clase: "delegar", descripcion, agente: str(e.subagent_type) || null, modelo: str(e.model) || null, prompt: cortar(str(e.prompt), TOPES.prompt), respuesta: null, agentId: null, fondo: e.run_in_background === true, tokens: null, usos: null, pasos: [], omitidos: 0 },
        });
        break;
      }
      default: {
        let entrada = "";
        try {
          entrada = JSON.stringify(e);
        } catch {}
        paso = this.agregar({ ...base, tipo: "otro", titulo: nombre || "?", detalle: { clase: "otro", nombre, entrada: cortar(entrada, TOPES.entrada).t, salida: null } });
      }
    }
    if (id) this.porUso.set(id, paso);
  }

  /** Lo que sumó cada Edit/Write, a la espera de saber si entró. */
  private pendiente = new Map<string, Record<string, unknown>[]>();

  private usuario(d: Record<string, unknown>, hora: number | null): void {
    const m = obj(d.message);
    if (!m) return;
    if (typeof m.content === "string") {
      if (this.tarea === null && !this.subagente && m.content.trim()) this.tarea = cortar(m.content, TOPES.tarea).t;
      return;
    }
    const tur = d.toolUseResult;
    for (const x of Array.isArray(m.content) ? m.content : []) {
      const b = obj(x);
      if (!b) continue;
      if (b.type === "text" && this.tarea === null && !this.subagente && str(b.text).trim()) this.tarea = cortar(str(b.text), TOPES.tarea).t;
      if (b.type === "tool_result") this.resultado(b, tur, hora);
    }
  }

  private resultado(b: Record<string, unknown>, tur: unknown, hora: number | null): void {
    const paso = this.porUso.get(str(b.tool_use_id));
    if (!paso) return;
    const mal = b.is_error === true;
    const { texto, imagenes } = textoDe(b.content);
    paso.v = this.v;
    paso.estado = mal ? "fallo" : "ok";
    paso.error = mal ? una(texto.replace(/^Exit code \d+\n?/, "") || texto, TOPES.error) || null : null;
    paso.dur = hora !== null && paso.t !== null ? Math.max(0, hora - paso.t) : null;
    const r = obj(tur);
    const det = paso.detalle;
    switch (det.clase) {
      case "leer": {
        const f = obj(r?.file);
        det.imagen = imagenes > 0 || r?.type === "image";
        if (!mal && !det.imagen) {
          det.texto = cortar(texto, TOPES.lectura);
          det.desde = nat(f?.startLine) ?? det.desde ?? 1;
          det.lineas = nat(f?.numLines) ?? lineasDe(texto);
          det.total = nat(f?.totalLines);
        }
        break;
      }
      case "buscar": {
        if (mal) break;
        det.texto = cortar(texto, TOPES.lectura);
        const n = det.herramienta === "Grep" && r?.mode === "content" ? nat(r.numLines) : nat(r?.numFiles) ?? nat(r?.numLines);
        det.resultados = n ?? (texto.trim() ? lineasDe(texto.trim()) : 0);
        break;
      }
      case "editar":
      case "escribir":
        this.tocado(paso, det, r, mal);
        break;
      case "correr": {
        const codigo = /^Exit code (\d+)/.exec(texto);
        const stdout = str(r?.stdout);
        const stderr = str(r?.stderr);
        const salida = mal ? texto.replace(/^Exit code \d+\n?/, "") : r && (typeof r.stdout === "string" || typeof r.stderr === "string") ? (stderr ? `${stdout}${stdout && !stdout.endsWith("\n") ? "\n" : ""}${stderr}` : stdout) : texto;
        det.salida = salida ? cortar(salida, TOPES.salida, "extremos") : null;
        det.codigo = mal ? (codigo ? Number(codigo[1]) : null) : 0;
        det.interrumpido = r?.interrupted === true;
        det.fondo = det.fondo || typeof r?.backgroundTaskId === "string";
        break;
      }
      case "delegar": {
        const id = str(r?.agentId) || /agentId: (\w+)/.exec(texto)?.[1] || null;
        det.agentId = id;
        det.fondo = det.fondo || r?.isAsync === true || r?.status === "async_launched";
        det.modelo = str(r?.resolvedModel) || det.modelo;
        det.tokens = nat(r?.totalTokens);
        det.usos = nat(r?.totalToolUseCount);
        // Los lanzados en segundo plano contestan "lanzado" al toque: lo que tardaron lo dice su transcript.
        if (!det.fondo) {
          det.respuesta = texto ? cortar(texto, TOPES.texto) : null;
          paso.dur = nat(r?.totalDurationMs) ?? paso.dur;
        } else paso.dur = null;
        break;
      }
      case "otro":
        det.salida = texto ? cortar(texto, TOPES.lectura) : null;
        break;
      default:
        break;
    }
    this.pendiente.delete(paso.id);
  }

  /** El resultado de un Edit o un Write: dónde cambió, cuánto suma y quita, y el archivo al encabezado. */
  private tocado(paso: Paso, det: Extract<Detalle, { clase: "editar" | "escribir" }>, r: Record<string, unknown> | null, mal: boolean): void {
    const lista = this.pendiente.get(paso.id) ?? [];
    if (mal) return;
    const p = parche(r?.structuredPatch);
    let mas = 0;
    let menos = 0;
    let nuevo = false;
    if (det.clase === "editar") {
      if (p) {
        ({ mas, menos } = p);
      } else {
        for (const c of lista) {
          const x = contarDiff(str(c.old_string), str(c.new_string));
          // Con replace_all cada aparición cuenta; sin su número, una vez.
          mas += x.mas;
          menos += x.menos;
        }
      }
      if (p?.desde != null && det.cambios[0]) det.cambios[0].desde = p.desde;
    } else {
      nuevo = r?.type === "create";
      det.nuevo = r?.type === "create" ? true : r?.type === "update" ? false : null;
      const contenido = str(lista[0]?.new_string);
      const original = r?.originalFile;
      if (p && !nuevo) ({ mas, menos } = p);
      else if (!nuevo && typeof original === "string") ({ mas, menos } = contarDiff(original, contenido));
      else mas = lineasDe(contenido);
    }
    det.mas = mas;
    det.menos = menos;
    const a = this.archivos.get(det.ruta) ?? { ruta: det.ruta, mas: 0, menos: 0, ediciones: 0, nuevo: false };
    a.mas += mas;
    a.menos += menos;
    a.ediciones++;
    a.nuevo = a.nuevo || nuevo;
    this.archivos.set(det.ruta, a);
  }

  /** Los transcripts de los subagentes lanzados, anidados en su paso. */
  private async anidar(): Promise<void> {
    const dir = this.carpetaSub;
    if (!dir) return;
    for (const p of this.pasos) {
      const det = p.detalle;
      if (det.clase !== "delegar" || !det.agentId || !/^[A-Za-z0-9_-]+$/.test(det.agentId)) continue;
      let n = this.nietos.get(det.agentId);
      if (!n) this.nietos.set(det.agentId, (n = new ArmadorPasos(path.join(dir, `agent-${det.agentId}.jsonl`), { subagente: true })));
      // Uno que ya terminó (no está en segundo plano) y ya se armó no vuelve a leerse.
      if (det.pasos.length && p.estado !== "corriendo" && !det.fondo) continue;
      if (!(await n.leer()) && det.pasos.length) continue;
      if (!n.pasos.length) continue;
      det.pasos = n.pasos.slice(-TOPES.anidados);
      det.omitidos = n.omitidos + Math.max(0, n.pasos.length - TOPES.anidados);
      this.v++;
      p.v = this.v;
    }
  }
}
