// Candado entre procesos, sin `flock`: un archivo que se crea con creación exclusiva
// (`wx`) y guarda el pid y el arranque de quien lo tiene. Si el dueño ya no existe (o su pid lo reusó otro proceso, que
// arrancó en otro momento) el candado es viejo y se saca. `procesos.ts` dice si un pid vive y cuándo arrancó.
import { link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { inicioDeProceso } from "../procesos.ts";

export type DepsCandado = {
  pid: number;
  /** Cuándo arrancó el proceso (texto opaco), o `null` si no existe. */
  inicioDe: (pid: number) => Promise<string | null>;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
};

export type OpcionesCandado = {
  /** Cuánto esperar (ms) si lo tiene otro vivo. 0 = no esperar (default). */
  espera?: number;
  /** Cada cuánto reintentar (ms). */
  cada?: number;
  deps?: Partial<DepsCandado>;
};

export type Candado = { ruta: string; soltar: () => Promise<void> };

export class ErrorCandado extends Error {
  ruta: string;
  dueno: number | null;
  constructor(ruta: string, dueno: number | null) {
    super(`candado ocupado: ${ruta}${dueno ? ` (pid ${dueno})` : ""}`);
    this.ruta = ruta;
    this.dueno = dueno;
  }
}

let miInicio: Promise<string | null> | null = null;
const REALES: DepsCandado = {
  pid: process.pid,
  // el arranque propio se calcula una vez (en Windows es un PowerShell)
  inicioDe: (pid) => (pid === process.pid ? (miInicio ??= inicioDeProceso(pid)) : inicioDeProceso(pid)),
  ahora: () => Date.now(),
  dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)),
};

/** Un candado a medio escribir (vacío) es de alguien que lo está creando: sólo es viejo pasados estos ms. */
const GRACIA_VACIO_MS = 5000;

const contenido = (pid: number, inicio: string | null) => `pid=${pid}\narranque=${inicio ?? ""}\n`;

type Dueno = { pid: number; arranque: string } | null;
function parsear(t: string): Dueno {
  const pid = Number(/^pid=(\d+)$/m.exec(t)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid, arranque: /^arranque=(.*)$/m.exec(t)?.[1] ?? "" };
}

async function esViejo(ruta: string, texto: string, d: DepsCandado): Promise<boolean> {
  const dueno = parsear(texto);
  if (!dueno) {
    try {
      return d.ahora() - (await stat(ruta)).mtimeMs > GRACIA_VACIO_MS;
    } catch {
      return false;
    }
  }
  const inicio = await d.inicioDe(dueno.pid);
  if (inicio === null) return true;
  return dueno.arranque !== "" && dueno.arranque !== inicio;
}

/** Saca un candado viejo sin pisar uno nuevo: se aparta con `rename` (sólo uno gana la carrera) y se mira qué era. */
async function sacarViejo(ruta: string, visto: string): Promise<void> {
  const aparte = `${ruta}.viejo.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await rename(ruta, aparte);
  } catch {
    return; // otro ya lo sacó
  }
  try {
    if ((await readFile(aparte, "utf8").catch(() => visto)) !== visto) await link(aparte, ruta).catch(() => {}); // era uno recién tomado: se devuelve
  } finally {
    await rm(aparte, { force: true });
  }
}

/** Toma el candado, o `null` si lo tiene otro vivo (después de esperar `espera` ms). */
export async function tomarCandado(ruta: string, op: OpcionesCandado = {}): Promise<Candado | null> {
  const d: DepsCandado = { ...REALES, ...op.deps };
  const limite = d.ahora() + (op.espera ?? 0);
  await mkdir(path.dirname(ruta), { recursive: true });
  for (;;) {
    try {
      const fh = await open(ruta, "wx");
      try {
        await fh.writeFile(contenido(d.pid, await d.inicioDe(d.pid)));
      } finally {
        await fh.close();
      }
      return { ruta, soltar: () => soltar(ruta, d.pid) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const texto = await readFile(ruta, "utf8").catch(() => null);
    if (texto === null) continue; // se soltó justo ahora
    if (await esViejo(ruta, texto, d)) {
      await sacarViejo(ruta, texto);
      continue;
    }
    if (d.ahora() >= limite) return null;
    await d.dormir(op.cada ?? 50);
  }
}

/** Suelta el candado sólo si sigue siendo nuestro (si lo sacaron por viejo y lo tomó otro, no se toca). */
async function soltar(ruta: string, pid: number): Promise<void> {
  const t = await readFile(ruta, "utf8").catch(() => null);
  if (t !== null && parsear(t)?.pid === pid) await rm(ruta, { force: true });
}

/** Corre `fn` con el candado tomado; lanza `ErrorCandado` si no se pudo tomar. */
export async function conCandado<T>(ruta: string, fn: () => Promise<T>, op?: OpcionesCandado): Promise<T> {
  const c = await tomarCandado(ruta, op);
  if (!c) {
    const dueno = parsear((await readFile(ruta, "utf8").catch(() => "")) || "");
    throw new ErrorCandado(ruta, dueno?.pid ?? null);
  }
  try {
    return await fn();
  } finally {
    await c.soltar();
  }
}
