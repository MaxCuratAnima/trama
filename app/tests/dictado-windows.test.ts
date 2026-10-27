// Dictar en Windows (electron/dictado-windows.ts): el `handy.exe` y el reconocedor que Windows trae, con un
// disco y un `Ejecutar` falsos. Nada de Handy de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { argsSpeech, handyExeEnWindows, hayHandy, motoresDictado, GUION_SPEECH } from "../electron/dictado-windows.ts";
import { transcribir, type Ejecutar } from "../electron/dictado.ts";
import { codificarWav } from "../src/hilo/dictado.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-dictwin-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Un disco inventado: las rutas que existen. */
const discoCon = (rutas: string[]) => ({ hay: (f: string) => rutas.includes(f) });
const nada = async () => {
  throw new Error("no debería correr nada");
};
const HANDY = "C:\\Users\\gonza\\AppData\\Local\\Handy\\handy.exe";
const PS = "C:\\WINDOWS\\powershell.exe";
const BASE = { PATH: "C:\\WINDOWS", LOCALAPPDATA: "C:\\Users\\gonza\\AppData\\Local" };
const esPs = (f: string) => f.toLowerCase() === PS.toLowerCase();

test("handyExeEnWindows: AppData\\Local, Program Files; HILOS_HANDY_EXE manda y si no existe no se busca otro", () => {
  assert.equal(handyExeEnWindows(BASE, "C:\\Users\\gonza", discoCon([HANDY])), HANDY);
  assert.equal(handyExeEnWindows(BASE, "C:\\Users\\gonza", discoCon([])), null);
  const pf = path.join("C:\\Program Files", "Handy", "handy.exe");
  assert.equal(handyExeEnWindows(BASE, "C:\\Users\\gonza", discoCon([pf])), pf);
  assert.equal(handyExeEnWindows({ HILOS_HANDY_EXE: "D:\\x\\handy.exe" }, "C:\\h", discoCon(["D:\\x\\handy.exe", HANDY])), "D:\\x\\handy.exe");
  assert.equal(handyExeEnWindows({ HILOS_HANDY_EXE: "D:\\y\\handy.exe" }, "C:\\h", discoCon([HANDY])), null);
});

test("motoresDictado: el .exe y detrás System.Speech; sin .exe, sólo System.Speech; sin nada, ninguno", async () => {
  const base = { env: BASE, home: "C:\\Users\\gonza", correr: nada, esEjecutable: esPs };
  const con = await motoresDictado({ ...base, disco: discoCon([HANDY]) });
  assert.deepEqual(con.map((m) => m.nombre), ["handy-windows", "windows"]);
  const sin = await motoresDictado({ ...base, disco: discoCon([]) });
  assert.deepEqual(sin.map((m) => m.nombre), ["windows"]);
  assert.equal(await hayHandy({ ...base, disco: discoCon([HANDY]) }), true);
  assert.equal(await hayHandy({ ...base, disco: discoCon([]) }), false);
  // Sin powershell o con HILOS_SPEECH=0: no hay reconocedor.
  assert.deepEqual(await motoresDictado({ ...base, disco: discoCon([]), esEjecutable: () => false }), []);
  assert.deepEqual(await motoresDictado({ ...base, env: { ...BASE, HILOS_SPEECH: "0" }, disco: discoCon([]) }), []);
});

test("argsSpeech: la ruta va entre comillas simples (y una comilla se duplica) y el script habla UTF-8", () => {
  const a = argsSpeech("C:\\Temp\\d'x.wav");
  assert.equal(a[0], "-NoProfile");
  assert.match(a.at(-1)!, /'C:\\Temp\\d''x\.wav'$/);
  assert.match(GUION_SPEECH, /OutputEncoding.*UTF8/);
  assert.match(GUION_SPEECH, /DictationGrammar/);
});

const wav = () => codificarWav(new Float32Array(1600).fill(0.25));

test("transcribir con el .exe: le pasa la ruta del WAV tal cual y lo borra", async () => {
  const dir = path.join(tmp, "a");
  const vistos: string[][] = [];
  const ejecutar: Ejecutar = async (bin, args) => {
    vistos.push([bin, ...args]);
    return "hola desde windows\r\n";
  };
  const motores = await motoresDictado({ env: BASE, home: "C:\\Users\\gonza", correr: nada, esEjecutable: () => false, disco: discoCon([HANDY]) });
  const texto = await transcribir({ datos: wav() }, { dir, motores: motores.slice(0, 1), ejecutar });
  assert.equal(texto, "hola desde windows");
  assert.equal(vistos[0][0], HANDY);
  assert.equal(vistos[0][1], "--transcribe-file");
  assert.match(vistos[0][2], /dictado-.*\.wav$/);
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
});

test("transcribir: si el .exe falla o no dice nada se prueba System.Speech; si nada anda, se cuenta el primer fallo", async () => {
  const dir = path.join(tmp, "b");
  const motores = await motoresDictado({ env: BASE, home: "C:\\Users\\gonza", correr: nada, esEjecutable: esPs, disco: discoCon([HANDY]) });
  assert.deepEqual(motores.map((m) => m.nombre), ["handy-windows", "windows"]);
  const llamadas: string[] = [];
  const hacer = (handy: "falla" | "vacio", speech: "anda" | "falla"): Ejecutar => async (bin) => {
    llamadas.push(bin);
    if (bin === HANDY) {
      if (handy === "falla") throw Object.assign(new Error("boom"), { stderr: "handy.exe: no entiendo --transcribe-file" });
      return "\n";
    }
    if (speech === "falla") throw Object.assign(new Error("x"), { stderr: "no hay reconocedor" });
    return "hola\r\nmundo\r\n";
  };
  assert.equal(await transcribir({ datos: wav() }, { dir, motores, ejecutar: hacer("falla", "anda") }), "hola mundo");
  assert.equal(await transcribir({ datos: wav() }, { dir, motores, ejecutar: hacer("vacio", "anda") }), "hola mundo");
  assert.deepEqual(llamadas, [HANDY, PS, HANDY, PS]);
  await assert.rejects(transcribir({ datos: wav() }, { dir, motores, ejecutar: hacer("falla", "falla") }), /dictadoFalla.*no entiendo/s);
  await assert.rejects(transcribir({ datos: wav() }, { dir, motores: [], ejecutar: hacer("falla", "falla") }), /dictadoFalta/);
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
});
