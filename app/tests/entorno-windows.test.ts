// node --test tests/entorno-windows.test.ts — el entorno de la app instalada en Windows (electron/entorno-windows.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirBinWindows, entornoWindows } from "../electron/entorno-windows.ts";

const RES = "C:\\Users\\Ana\\AppData\\Local\\Programs\\Trama\\resources";
const EXE = "C:\\Users\\Ana\\AppData\\Local\\Programs\\Trama\\Trama.exe";

test("instalada: <resources>\\bin; en desarrollo: motor\\bin-win del repo", () => {
  const solo = (...ok: string[]) => (f: string) => ok.includes(f);
  assert.equal(dirBinWindows("win32", RES, "C:\\x\\app\\dist-electron", solo(`${RES}\\bin\\pa.cmd`)), `${RES}\\bin`);
  const dev = "C:\\trama-win\\app\\dist-electron";
  const bin = "C:\\trama-win\\motor\\bin-win";
  assert.equal(dirBinWindows("win32", "C:\\trama-win\\app\\node_modules\\electron\\dist\\resources", dev, solo(`${bin}\\pa.cmd`)), bin);
  assert.equal(dirBinWindows("win32", RES, dev, () => false), null);
});

test("windows: TRAMA_LOCAL=1, bin adelante en Path (sin duplicar) y TRAMA_ELECTRON; lo que ya estaba manda", () => {
  const bin = `${RES}\\bin`;
  const r = entornoWindows("win32", { Path: `C:\\Windows;${bin.toUpperCase()};C:\\Git\\cmd` }, bin, EXE);
  assert.equal(r.Path, `${bin};C:\\Windows;C:\\Git\\cmd`);
  assert.equal(r.PATH, undefined);
  assert.equal(r.TRAMA_LOCAL, "1");
  assert.equal(r.TRAMA_ELECTRON, EXE);
  const fijo = entornoWindows("win32", { TRAMA_LOCAL: "0", TRAMA_ELECTRON: "C:\\otro.exe" }, bin, EXE);
  assert.equal(fijo.TRAMA_LOCAL, "0");
  assert.equal(fijo.TRAMA_ELECTRON, "C:\\otro.exe");
  assert.equal(fijo.Path, bin);
});

test("sin carpeta de .cmd sólo cambia el modo", () => {
  assert.equal(entornoWindows("win32", { Path: "C:\\Windows" }, null, EXE).Path, "C:\\Windows");
});
