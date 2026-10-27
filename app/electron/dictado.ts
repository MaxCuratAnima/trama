// Dictar: el audio que grabó la caja de un líder (WAV 16 kHz mono, convertido en el cliente: src/hilo/dictado.ts)
// llega por el RPC de siempre, se deja un momento en una carpeta temporal de Trama y `handy --transcribe-file`
// devuelve el texto (o, sin Handy, el reconocedor de Windows: dictado-windows.ts). El modelo
// va con `--model`: el que se eligió en Ajustes o, sin elegir, Whisper Large v3 Turbo si Handy lo tiene bajado; si no, sin
// `--model` (el que el usuario tiene elegido en Handy). Ver dictado-modelos.ts. El texto vuelve a la caja, no se manda.
// Una transcripción a la vez (un Handy cargando un modelo ya es bastante) y el archivo se borra pase lo que pase.
// Sin `electron`: lo prueba tests/dictado.test.ts con un `handy` falso (`ejecutar`), nunca el de verdad.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { motoresDictado, type Motor } from "./dictado-windows.ts";
import { modelosDeHandy, opcionesDictado, type ModelosDictado } from "./dictado-modelos.ts";
import { errorT } from "./errores.ts";

/** Lo más que se graba (el tope de la caja): 5 min. */
export const DICTADO_MAX_S = 300;
/** Lo que pide `handy --transcribe-file`. */
export const WAV_HZ = 16000;
/** Cuánto se espera a Handy. */
export const DICTADO_TIMEOUT_MS = 120_000;
/** Cabecera de 44 bytes + 5 min de PCM de 16 bits, y un segundo de margen. */
export const WAV_MAX = 44 + WAV_HZ * 2 * (DICTADO_MAX_S + 1);

/** Cómo se corre un programa: lo que se reemplaza en las pruebas. Devuelve su stdout; si falla, rechaza como `execFile`. */
export type Ejecutar = (bin: string, args: string[], o: { timeout: number }) => Promise<string>;

const ejecutarDeVerdad: Ejecutar = (bin, args, o) =>
  new Promise((ok, mal) => {
    execFile(bin, args, { timeout: o.timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }, (e, stdout, stderr) => {
      if (!e) return ok(String(stdout));
      // Lo que dijo Handy sirve para el mensaje: pegado al error, sin las 20 líneas de log.
      (e as Error & { stderr?: string }).stderr = String(stderr).trim().split("\n").slice(-3).join(" ").slice(0, 300);
      mal(e);
    });
  });

/** Un `handy` (`HILOS_HANDY` o el del PATH; lo resuelve `motoresDictado`). */
export const motorHandy = (bin: string): Motor => ({ nombre: "handy", bin, args: async (a) => ["--transcribe-file", a] });

/** El WAV de un pedido, validado: bytes, PCM de 16 bits, 1 canal, 16 kHz y no más de 5 min. */
export function wavDe(x: unknown): Uint8Array {
  const datos = (x as { datos?: unknown } | null)?.datos;
  if (!(datos instanceof Uint8Array)) throw errorT("main.dictadoRaro");
  if (datos.byteLength > WAV_MAX) throw errorT("main.dictadoLargo", { n: DICTADO_MAX_S / 60 });
  if (datos.byteLength < 44) throw errorT("main.dictadoRaro");
  const v = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const tag = (o: number) => String.fromCharCode(datos[o], datos[o + 1], datos[o + 2], datos[o + 3]);
  const bien =
    tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === WAV_HZ && v.getUint16(34, true) === 16;
  if (!bien) throw errorT("main.dictadoRaro");
  return datos;
}

/** El texto que dejó Handy: con `--json`, su `text`; si no, el stdout sin los renglones vacíos ni la línea de métricas. */
export function textoDe(stdout: string): string {
  const crudo = stdout.trim();
  if (crudo.startsWith("{")) {
    try {
      const j = JSON.parse(crudo) as { text?: unknown; transcription?: unknown };
      const t = typeof j.text === "string" ? j.text : typeof j.transcription === "string" ? j.transcription : null;
      if (t !== null) return t.trim();
    } catch {
      // no era JSON: se toma tal cual
    }
  }
  return crudo
    .split("\n")
    // Sin `--json`, Handy dice `model=… rtf=…x text: <texto>`: sólo el texto.
    .map((l) => l.trim().replace(/^model=\S+(?: \S+=\S+)* text: /, ""))
    .filter(Boolean)
    .join(" ");
}

export type OpcionesDictado = {
  /** Dónde se deja el WAV un momento (carpeta temporal de Trama). */
  dir: string;
  /** Un `handy` en concreto (las pruebas); sin él se elige entre los motores de la máquina (`motoresDictado`). */
  bin?: string;
  motores?: Motor[];
  ejecutar?: Ejecutar;
  timeoutMs?: number;
  /** El modelo que se eligió en Ajustes: va siempre con `--model` (si no está bajado, Handy lo dice). */
  modelo?: string;
  /** Sin elegido: éste, pero sólo si Handy lo tiene bajado; si no, Handy usa el suyo. Sin ninguno de los dos, nunca `--model`. */
  porDefecto?: string;
};

/** Cuánto se espera a `handy --list-models` (no carga nada: lee su catálogo). */
const LISTAR_MS = 10_000;

/** Lo que dice `handy --list-models --json` de un motor Handy, o `null` si no contestó. */
async function listarHandy(m: Motor, ejecutar: Ejecutar): Promise<ReturnType<typeof modelosDeHandy> | null> {
  if (m.nombre === "windows") return null;
  try {
    const l = modelosDeHandy(await ejecutar(m.bin, ["--list-models", "--json"], { timeout: LISTAR_MS }));
    return l.length ? l : null;
  } catch {
    return null;
  }
}

/**
 * Lo que se le suma a `--transcribe-file` en un Handy: `--json` (sin él, Handy antepone una línea de métricas
 * `model=… rtf=… text: …` al texto) y el `--model` (el elegido, o el de por defecto si está bajado). Nada para el
 * reconocedor de Windows.
 */
async function extraHandy(m: Motor, o: OpcionesDictado, ejecutar: Ejecutar): Promise<string[]> {
  if (m.nombre === "windows") return [];
  if (o.modelo) return ["--json", "--model", o.modelo];
  if (!o.porDefecto) return ["--json"];
  const l = await listarHandy(m, ejecutar);
  return l?.some((x) => x.id === o.porDefecto && x.bajado) ? ["--json", "--model", o.porDefecto] : ["--json"];
}

/** Para Ajustes: qué modelos hay para elegir en esta máquina y cuál rige (`elegido`, o el de por defecto). */
export async function modelosDictado(o: { elegido: string; motores?: Motor[]; ejecutar?: Ejecutar }): Promise<ModelosDictado> {
  const ejecutar = o.ejecutar ?? ejecutarDeVerdad;
  const motores = o.motores ?? (await motoresDeEstaMaquina(ejecutar));
  const handy = motores.find((m) => m.nombre !== "windows");
  const lista = handy ? await listarHandy(handy, ejecutar) : null;
  return { version: 1, elegido: o.elegido, modelos: opcionesDictado(lista, o.elegido), motor: handy?.nombre ?? motores[0]?.nombre ?? null };
}

/** Para que haya una sola a la vez. */
let cola: Promise<unknown> = Promise.resolve();

/** Transcribe el WAV de un pedido (`{ datos }`) y devuelve el texto. Los errores van como clave de `main.dictado*`. */
export function transcribir(x: unknown, o: OpcionesDictado): Promise<string> {
  const datos = wavDe(x);
  const una = cola.then(() => correr(datos, o));
  cola = una.catch(() => {});
  return una;
}

/** Un fallo al correr un motor, como clave de `main.dictado*`. */
function comoError(e: unknown, timeout: number): Error {
  const err = e as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
  if (err.message?.startsWith("\u0001")) return err;
  if (err.code === "ENOENT") return errorT("main.dictadoFalta");
  if (err.killed || err.signal === "SIGKILL" || err.code === "ETIMEDOUT") return errorT("main.dictadoTiempo", { n: Math.round(timeout / 1000) });
  return errorT("main.dictadoFalla", { motivo: err.stderr || err.message || String(e) });
}

/** Con qué se puede transcribir en esta máquina (vacío: nada; ver dictado-windows.ts). */
export const motoresDeEstaMaquina = (ejecutar: Ejecutar = ejecutarDeVerdad) => motoresDictado({ correr: (b, a, o) => ejecutar(b, a, o) });

async function correr(datos: Uint8Array, o: OpcionesDictado): Promise<string> {
  const ejecutar = o.ejecutar ?? ejecutarDeVerdad;
  const motores = o.motores ?? (o.bin ? [motorHandy(o.bin)] : await motoresDeEstaMaquina(ejecutar));
  if (!motores.length) throw errorT("main.dictadoFalta");
  await mkdir(o.dir, { recursive: true, mode: 0o700 });
  const archivo = path.join(o.dir, `dictado-${randomUUID()}.wav`);
  await writeFile(archivo, datos, { mode: 0o600 });
  const timeout = o.timeoutMs ?? DICTADO_TIMEOUT_MS;
  try {
    // En orden: si uno falla o no dice nada se prueba el siguiente; si ninguno anda, se cuenta el primer fallo.
    let primero: Error | null = null;
    for (const m of motores) {
      try {
        const args = [...(await m.args(archivo)), ...(await extraHandy(m, o, ejecutar))];
        const texto = textoDe(await ejecutar(m.bin, args, { timeout }));
        if (!texto) throw errorT("main.dictadoVacio");
        return texto;
      } catch (e) {
        primero ??= comoError(e, timeout);
      }
    }
    throw primero;
  } finally {
    await rm(archivo, { force: true });
  }
}
