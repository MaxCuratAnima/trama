// Dictar (docs/estado/dictado.md): el WAV del cliente (src/hilo/dictado.ts) y la transcripción del motor
// (electron/dictado.ts) con un `handy` falso (`ejecutar`): nunca el de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codificarWav, agregarDictado, reloj, soporte, TOPE_S } from "../src/hilo/dictado.ts";
import { DICTADO_MAX_S, WAV_MAX,modelosDictado, motorHandy, textoDe, transcribir, wavDe, type Ejecutar } from "../electron/dictado.ts";
import { MODELO_LARGE_V3, MODELO_TURBO, esModeloDictado, modelosDeHandy, opcionesDictado } from "../electron/dictado-modelos.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-dictado-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const dir = path.join(tmp, "trama");
const wav = (n = 1600) => codificarWav(new Float32Array(n).fill(0.25));
const sinSobras = () => assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);

test("codificarWav: cabecera PCM de 16 bits, mono, 16 kHz, con sus muestras", () => {
  const w = codificarWav(Float32Array.from([0, 1, -1, 2, -2]));
  const v = new DataView(w.buffer);
  assert.equal(w.length, 44 + 10);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), "RIFF");
  assert.equal(v.getUint32(4, true), 36 + 10);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 10);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768]);
});

test("el tope del cliente y el del motor son los mismos", () => {
  assert.equal(TOPE_S, DICTADO_MAX_S);
});

test("wavDe: acepta el WAV del cliente y rechaza lo raro", () => {
  const w = wav();
  assert.equal(wavDe({ datos: w }), w);
  for (const malo of [null, {}, { datos: "x" }, { datos: new Uint8Array(10) }, { datos: new Uint8Array(100) }]) assert.throws(() => wavDe(malo), /dictadoRaro/);
  const otroHz = wav();
  new DataView(otroHz.buffer).setUint32(24, 44100, true);
  assert.throws(() => wavDe({ datos: otroHz }), /dictadoRaro/);
  assert.throws(() => wavDe({ datos: new Uint8Array(WAV_MAX + 1) }), /dictadoLargo/);
});

test("textoDe: texto plano, renglones sueltos y JSON", () => {
  assert.equal(textoDe("  hola mundo \n"), "hola mundo");
  assert.equal(textoDe("hola\n\n  qué tal \n"), "hola qué tal");
  assert.equal(textoDe('{"text": " hola "}'), "hola");
  assert.equal(textoDe("{no es json\nsigue"), "{no es json sigue");
  assert.equal(textoDe("\n \n"), "");
});

test("agregarDictado: se agrega al final con un espacio", () => {
  assert.equal(agregarDictado("", "hola"), "hola");
  assert.equal(agregarDictado("hola", " mundo "), "hola mundo");
  assert.equal(agregarDictado("hola ", "mundo"), "hola mundo");
  assert.equal(agregarDictado("hola\n", "mundo"), "hola\nmundo");
  assert.equal(agregarDictado("hola", "  "), "hola");
});

test("reloj y soporte", () => {
  assert.deepEqual([0, 7, 65, 299].map(reloj), ["0:00", "0:07", "1:05", "4:59"]);
  assert.equal(soporte({ isSecureContext: false, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {} } as never), "inseguro");
  assert.equal(soporte({ isSecureContext: true, navigator: {}, MediaRecorder() {} } as never), "sin");
  assert.equal(soporte({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } } as never), "sin");
  assert.equal(soporte({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {} } as never), "si");
});

test("transcribir: pasa el WAV por --transcribe-file, devuelve el texto y borra el archivo", async () => {
  let visto: { bin: string; args: string[]; timeout: number; bytes: number } | null = null;
  const ejecutar: Ejecutar = async (bin, args, o) => {
    visto = { bin, args, timeout: o.timeout, bytes: (await readFile(args[1])).length };
    assert.ok(args[1].startsWith(dir + path.sep));
    return " hola mundo\n";
  };
  const w = wav(3200);
  assert.equal(await transcribir({ datos: w }, { dir, bin: "handy-falso", ejecutar }), "hola mundo");
  assert.ok(visto);
  const v = visto as { bin: string; args: string[]; timeout: number; bytes: number };
  assert.equal(v.bin, "handy-falso");
  assert.equal(v.args[0], "--transcribe-file");
  assert.ok(!v.args.includes("--model"));
  assert.ok(v.args.includes("--json"), "sin --json Handy antepone sus métricas al texto");
  assert.equal(v.bytes, w.length);
  assert.equal(v.timeout, 120_000);
  sinSobras();
});

test("transcribir: handy que falta, que falla, que tarda o que no dice nada → mensaje con clave, y el archivo se borra", async () => {
  const caso = async (ejecutar: Ejecutar, re: RegExp, timeoutMs?: number) => {
    await assert.rejects(transcribir({ datos: wav() }, { dir, ejecutar, timeoutMs }), re);
    sinSobras();
  };
  await caso(async () => Promise.reject(Object.assign(new Error("spawn handy ENOENT"), { code: "ENOENT" })), /dictadoFalta/);
  await caso(async () => Promise.reject(Object.assign(new Error("Command failed"), { stderr: "modelo roto" })), /dictadoFalla.*modelo roto/);
  await caso(async () => Promise.reject(Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" })), /dictadoTiempo.*"?5"?/, 5000);
  await caso(async () => "  \n", /dictadoVacio/);
});

test("transcribir: de a una, en el orden en que llegan", async () => {
  const orden: string[] = [];
  let libre!: () => void;
  const primera: Ejecutar = () => new Promise((ok) => (libre = () => (orden.push("a-fin"), ok("a"))));
  const segunda: Ejecutar = async () => (orden.push("b"), "b");
  const a = transcribir({ datos: wav() }, { dir, ejecutar: primera });
  const b = transcribir({ datos: wav() }, { dir, ejecutar: segunda });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(orden, []);
  libre();
  assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
  assert.deepEqual(orden, ["a-fin", "b"]);
  sinSobras();
});

// --- El modelo (dictado-modelos.ts): lo que se elige en Ajustes y lo que va con `--model` ---

const LISTA = JSON.stringify([
  { id: MODELO_TURBO, name: "Whisper Large v3 Turbo", is_downloaded: true },
  { id: MODELO_LARGE_V3, name: "Whisper Large v3", is_downloaded: false },
  { id: "small", name: "Whisper Small", is_downloaded: false },
  { id: "parakeet-tdt-0.6b-v3", name: "Parakeet V3", is_downloaded: true },
  { id: "--raro", name: "no", is_downloaded: true },
]);

test("modelosDeHandy y opcionesDictado: Turbo y Large v3 siempre, después lo bajado, y el elegido aunque no esté", () => {
  const l = modelosDeHandy(LISTA);
  assert.equal(l.length, 4, "el id que parece una opción queda afuera");
  assert.deepEqual(modelosDeHandy("no es json"), []);
  assert.deepEqual(
    opcionesDictado(l, MODELO_TURBO).map((m) => [m.id, m.bajado]),
    [[MODELO_TURBO, true], [MODELO_LARGE_V3, false], ["parakeet-tdt-0.6b-v3", true]],
  );
  assert.deepEqual(opcionesDictado(null, "otro").map((m) => [m.id, m.bajado]), [[MODELO_TURBO, false], [MODELO_LARGE_V3, false], ["otro", false]]);
  for (const malo of ["", "-x", "con espacio", 3, null, "a".repeat(201)]) assert.equal(esModeloDictado(malo), false);
  assert.ok(esModeloDictado(MODELO_TURBO));
});

/** Un `handy` falso que contesta la lista y anota con qué argumentos se lo llamó para transcribir. */
const handyCon = (lista: string, vistos: string[][]): Ejecutar => async (_b, args) => {
  if (args[0] === "--list-models") return lista;
  vistos.push(args);
  return "hola";
};

test("transcribir: el elegido va con --model; sin elegir, Turbo sólo si está bajado; el reconocedor de Windows nunca", async () => {
  const vistos: string[][] = [];
  const modelo = () => {
    const a = vistos.at(-1)!;
    return a.includes("--model") ? a[a.indexOf("--model") + 1] : null;
  };
  await transcribir({ datos: wav() }, { dir, bin: "h", ejecutar: handyCon(LISTA, vistos), porDefecto: MODELO_TURBO });
  assert.equal(modelo(), MODELO_TURBO);
  const sinTurbo = LISTA.replace('"is_downloaded":true', '"is_downloaded":false');
  await transcribir({ datos: wav() }, { dir, bin: "h", ejecutar: handyCon(sinTurbo, vistos), porDefecto: MODELO_TURBO });
  assert.equal(modelo(), null, "sin Turbo bajado, Handy usa el suyo");
  await transcribir({ datos: wav() }, { dir, bin: "h", ejecutar: handyCon("roto", vistos), porDefecto: MODELO_TURBO });
  assert.equal(modelo(), null, "si la lista no contesta, igual que antes");
  await transcribir({ datos: wav() }, { dir, bin: "h", ejecutar: handyCon(sinTurbo, vistos), modelo: MODELO_LARGE_V3, porDefecto: MODELO_TURBO });
  assert.equal(modelo(), MODELO_LARGE_V3, "lo elegido va aunque no esté bajado: el error lo dice Handy");
  const windows = { nombre: "windows" as const, bin: "powershell.exe", args: async (a: string) => ["-File", a] };
  await transcribir({ datos: wav() }, { dir, motores: [windows], ejecutar: handyCon(LISTA, vistos), modelo: MODELO_LARGE_V3 });
  assert.equal(modelo(), null);
  sinSobras();
});

test("modelosDictado: lo que ve Ajustes, con o sin Handy", async () => {
  const d = await modelosDictado({ elegido: MODELO_TURBO, motores: [motorHandy("h")], ejecutar: handyCon(LISTA, []) });
  assert.equal(d.version, 1);
  assert.equal(d.motor, "handy");
  assert.equal(d.modelos[0].id, MODELO_TURBO);
  assert.equal(d.modelos[0].bajado, true);
  const nada = await modelosDictado({ elegido: MODELO_TURBO, motores: [], ejecutar: handyCon(LISTA, []) });
  assert.equal(nada.motor, null);
  assert.deepEqual(nada.modelos.map((m) => m.bajado), [false, false]);
});

test("textoDe: la salida de Handy con --json y la de sin --json (con su línea de métricas)", () => {
  assert.equal(textoDe('{"audio_secs":2.1,"model":"x","text":" Hola, che. ","transcribe_ms":[219]}'), "Hola, che.");
  assert.equal(textoDe("model=handy-computer/w/w.gguf device=settings backend=Vulkan0 audio=20.31s load=291ms best=1000ms rtf=20.31x text: Mira, o sea\n"), "Mira, o sea");
  assert.equal(textoDe("hola\n\nmundo"), "hola mundo");
});
