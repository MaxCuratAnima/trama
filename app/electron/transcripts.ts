// Los números de un transcript de Claude Code (`~/.claude/projects/<carpeta>/<sid>.jsonl`), leídos de a
// pedazos: cada vez se lee sólo lo que el archivo creció, nunca entero de nuevo. De acá salen **sólo
// nombres de modelo y números** (el `usage` de cada mensaje, las compactaciones): el texto de los
// mensajes no se guarda ni sale de este módulo. Sin Electron: lo prueba `tests/transcripts.test.ts`,
// y es lo que después indexa el registro histórico.
import { lstat, open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { silencio } from "./log.ts";

/** Los tokens de un modelo, por clase. Todo exacto: es la suma del `usage` de cada mensaje. */
export type Suma = { entrada: number; cacheCreado: number; cacheLeido: number; salida: number };
/** El `usage` del último mensaje: lo que pesa hoy la conversación. */
export type Uso = { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number };

export type Lectura = {
  /** Todo lo que consumió, por modelo. */
  total: Record<string, Suma>;
  /** Lo mismo, contando sólo los mensajes de `desde` en adelante. */
  reciente: Record<string, Suma>;
  /** El último modelo que contestó (nunca `<synthetic>`). */
  modelo: string | null;
  effort: string | null;
  /** El `usage` del último mensaje de la conversación principal (no de un subagente). */
  uso: Uso | null;
  compactaciones: number;
  /** Compactó después del último mensaje: lo que pesa ahora no se sabe hasta que conteste. */
  compactada: boolean;
};

export const sumaVacia = (): Suma => ({ entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 });
export const totalDe = (s: Suma): number => s.entrada + s.cacheCreado + s.cacheLeido + s.salida;

export function sumar(a: Record<string, Suma>, b: Record<string, Suma>): void {
  for (const [modelo, s] of Object.entries(b)) {
    const x = (a[modelo] ??= sumaVacia());
    x.entrada += s.entrada;
    x.cacheCreado += s.cacheCreado;
    x.cacheLeido += s.cacheLeido;
    x.salida += s.salida;
  }
}

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);

function usoDe(x: unknown): Uso | null {
  if (!x || typeof x !== "object") return null;
  const u = x as Record<string, unknown>;
  return {
    input_tokens: num(u.input_tokens),
    cache_creation_input_tokens: num(u.cache_creation_input_tokens),
    cache_read_input_tokens: num(u.cache_read_input_tokens),
    output_tokens: num(u.output_tokens),
  };
}

function anotar(en: Record<string, Suma>, modelo: string, u: Uso, signo: 1 | -1): void {
  const s = (en[modelo] ??= sumaVacia());
  s.entrada += signo * u.input_tokens;
  s.cacheCreado += signo * u.cache_creation_input_tokens;
  s.cacheLeido += signo * u.cache_read_input_tokens;
  s.salida += signo * u.output_tokens;
}

/** Cuántos ids de mensaje se recuerdan para no contar dos veces el mismo (vienen seguidos). */
const IDS = 64;
/** Lo más que se lee de una vez: un transcript de 12 MB entra en un par de vueltas. */
const TROZO = 8 * 1024 * 1024;

type Visto = { modelo: string; uso: Uso; reciente: boolean };

/**
 * Un transcript, leído de a pedazos. Un mensaje del modelo ocupa varias líneas (una por bloque) con
 * el mismo `message.id` y el mismo `usage`: se cuenta una vez, y si una línea posterior trae un
 * `usage` distinto para ese id, vale el último.
 */
export class Lector {
  ruta: string;
  /** Epoch en ms: lo de antes no entra en `reciente`. */
  desde: number;
  /** Un subagente: suma tokens, pero no dice cuánto pesa la conversación ni si compactó. */
  subagente: boolean;
  lectura: Lectura = { total: {}, reciente: {}, modelo: null, effort: null, uso: null, compactaciones: 0, compactada: false };
  private leido = 0;
  private vistos = new Map<string, Visto>();

  constructor(ruta: string, desde: number, subagente = false) {
    this.ruta = ruta;
    this.desde = desde;
    this.subagente = subagente;
  }

  private reiniciar(): void {
    this.leido = 0;
    this.vistos.clear();
    this.lectura = { total: {}, reciente: {}, modelo: null, effort: null, uso: null, compactaciones: 0, compactada: false };
  }

  /** Lee lo que creció. `true` si cambió algún número. */
  async leer(): Promise<boolean> {
    let tam: number;
    try {
      tam = (await stat(this.ruta)).size;
    } catch {
      return false;
    }
    // Más corto que lo leído: lo reescribieron. Se empieza de nuevo.
    if (tam < this.leido) this.reiniciar();
    if (tam === this.leido) return false;
    let cambio = false;
    let fd;
    try {
      fd = await open(this.ruta, "r");
    } catch {
      return false;
    }
    try {
      while (this.leido < tam) {
        const buf = Buffer.allocUnsafe(Math.min(TROZO, tam - this.leido));
        const { bytesRead } = await fd.read(buf, 0, buf.length, this.leido);
        if (bytesRead <= 0) break;
        // Sólo líneas enteras: la última puede estar a medio escribir.
        const fin = buf.lastIndexOf(10, bytesRead - 1);
        if (fin < 0) {
          // Una línea más larga que el trozo: se saltea sin leerla (no hay `usage` que valga tanto).
          if (bytesRead < buf.length || this.leido + bytesRead >= tam) break;
          this.leido += bytesRead;
          continue;
        }
        for (const linea of buf.toString("utf8", 0, fin).split("\n")) if (this.linea(linea)) cambio = true;
        this.leido += fin + 1;
      }
    } catch {
      // Se sigue desde donde quedó en la próxima vuelta.
    } finally {
      await fd.close().catch(silencio("transcripts"));
    }
    return cambio;
  }

  /** Una línea del transcript. Lo que no se entiende se saltea: nunca un número inventado. */
  private linea(linea: string): boolean {
    // Sin parsear lo que no trae números (los mensajes del usuario, los resultados de herramientas).
    const compacta = linea.includes('"compact_boundary"');
    if (!compacta && !linea.includes('"usage"')) return false;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(linea) as Record<string, unknown>;
    } catch {
      return false;
    }
    if (!d || typeof d !== "object") return false;
    if (d.type === "system" && d.subtype === "compact_boundary") {
      if (this.subagente) return false;
      this.lectura.compactaciones++;
      this.lectura.compactada = true;
      return true;
    }
    if (d.type !== "assistant") return false;
    const m = d.message as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") return false;
    const modelo = typeof m.model === "string" ? m.model : "";
    const uso = usoDe(m.usage);
    // Los mensajes sintéticos (un error, un corte) no los contestó ningún modelo.
    if (!modelo || modelo === "<synthetic>" || !uso) return false;
    const hora = typeof d.timestamp === "string" ? Date.parse(d.timestamp) : NaN;
    const reciente = Number.isFinite(hora) && hora >= this.desde;
    const id = typeof m.id === "string" && m.id ? m.id : null;
    const antes = id ? this.vistos.get(id) : undefined;
    if (antes) {
      anotar(this.lectura.total, antes.modelo, antes.uso, -1);
      if (antes.reciente) anotar(this.lectura.reciente, antes.modelo, antes.uso, -1);
    }
    anotar(this.lectura.total, modelo, uso, 1);
    if (reciente) anotar(this.lectura.reciente, modelo, uso, 1);
    if (id) {
      this.vistos.delete(id);
      this.vistos.set(id, { modelo, uso, reciente });
      if (this.vistos.size > IDS) this.vistos.delete(this.vistos.keys().next().value as string);
    }
    if (!this.subagente && d.isSidechain !== true) {
      this.lectura.modelo = modelo;
      this.lectura.uso = uso;
      this.lectura.compactada = false;
      if (typeof d.effort === "string" && d.effort) this.lectura.effort = d.effort;
    }
    return true;
  }
}

/**
 * Una sesión entera: su transcript y los de sus subagentes (`<sid>/subagents/agent-*.jsonl`), que
 * consumen tokens de la misma sesión pero no pesan en su contexto.
 */
export class Sesion {
  sid: string;
  ruta: string;
  principal: Lector;
  private desde: number;
  private subagentes = new Map<string, Lector>();

  constructor(ruta: string, desde: number) {
    this.ruta = ruta;
    this.sid = path.basename(ruta, ".jsonl");
    this.desde = desde;
    this.principal = new Lector(ruta, desde);
  }

  /** Donde escriben sus subagentes (puede no existir). */
  get carpetaSubagentes(): string {
    return path.join(path.dirname(this.ruta), this.sid, "subagents");
  }

  async leer(): Promise<boolean> {
    let cambio = await this.principal.leer();
    let nombres: string[] = [];
    try {
      nombres = await readdir(this.carpetaSubagentes);
    } catch {}
    for (const n of nombres) {
      if (!n.endsWith(".jsonl")) continue;
      let l = this.subagentes.get(n);
      if (!l) this.subagentes.set(n, (l = new Lector(path.join(this.carpetaSubagentes, n), this.desde, true)));
      if (await l.leer()) cambio = true;
    }
    return cambio;
  }

  /** Todo lo que consumió la sesión, con sus subagentes, por modelo. */
  total(): Record<string, Suma> {
    const r: Record<string, Suma> = {};
    sumar(r, this.principal.lectura.total);
    for (const l of this.subagentes.values()) sumar(r, l.lectura.total);
    return r;
  }

  /** Lo mismo, desde `desde`. */
  reciente(): Record<string, Suma> {
    const r: Record<string, Suma> = {};
    sumar(r, this.principal.lectura.reciente);
    for (const l of this.subagentes.values()) sumar(r, l.lectura.reciente);
    return r;
  }

  /** Lo de `reciente`, partido: la conversación principal y lo que gastaron sus subagentes (que trabajan como workers). */
  recientePartido(): { propio: Record<string, Suma>; subagentes: Record<string, Suma> } {
    const propio: Record<string, Suma> = {};
    const subagentes: Record<string, Suma> = {};
    sumar(propio, this.principal.lectura.reciente);
    for (const l of this.subagentes.values()) sumar(subagentes, l.lectura.reciente);
    return { propio, subagentes };
  }
}

/** Los transcripts de primer nivel de `projects/` que se tocaron de `desde` en adelante. */
export async function transcriptsDesde(proyectos: string, desde: number): Promise<string[]> {
  let carpetas: string[] = [];
  try {
    carpetas = await readdir(proyectos);
  } catch {
    return [];
  }
  const rutas: string[] = [];
  await Promise.all(
    carpetas.map(async (c) => {
      let nombres: string[] = [];
      try {
        nombres = await readdir(path.join(proyectos, c));
      } catch {
        return;
      }
      for (const n of nombres) {
        if (!n.endsWith(".jsonl")) continue;
        const ruta = path.join(proyectos, c, n);
        try {
          // Un enlace simbólico es el transcript de otra carpeta otra vez: no se cuenta dos veces.
          const st = await lstat(ruta);
          if (st.isFile() && st.mtimeMs >= desde) rutas.push(ruta);
        } catch {}
      }
    }),
  );
  return rutas.sort();
}

/** La medianoche local de hoy, en ms. */
export function medianoche(ahora = Date.now()): number {
  const d = new Date(ahora);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Lo mismo para una carpeta con `<sid>.jsonl` sueltos (los líderes de Gemini: `$HILOS_STATE/gemini`). */
export async function transcriptsPlanasDesde(carpeta: string, desde: number): Promise<string[]> {
  let nombres: string[] = [];
  try {
    nombres = await readdir(carpeta);
  } catch {
    return [];
  }
  const rutas: string[] = [];
  for (const n of nombres) {
    if (!n.endsWith(".jsonl")) continue;
    const ruta = path.join(carpeta, n);
    try {
      const st = await lstat(ruta);
      if (st.isFile() && st.mtimeMs >= desde) rutas.push(ruta);
    } catch {}
  }
  return rutas.sort();
}
