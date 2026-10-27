// node --test tests/  (Node corre el TypeScript directo, sin compilar)
import { test } from "node:test";
import assert from "node:assert/strict";
import { entornoAgy, entornoPa, pathConLocal, resolverAgy, resolverBinario, resolverPa } from "../electron/binario.ts";

const HOME = "C:\\Users\\Ana";
const LOCAL = "C:\\Users\\Ana\\.local\\bin";
const hay = (...fs: string[]) => (f: string) => fs.includes(f);

test("HILOS_PA gana siempre", () => {
  assert.equal(resolverPa({ HILOS_PA: "D:\\pa-falso.cmd", Path: "C:\\bin" }, HOME, hay("C:\\bin\\pa.exe"), "win32"), "D:\\pa-falso.cmd");
});

test("pa.exe del PATH (con ; y PATHEXT) si está", () => {
  assert.equal(resolverPa({ Path: "C:\\Windows;C:\\bin" }, HOME, hay("C:\\bin\\pa.exe", `${LOCAL}\\pa.exe`), "win32"), "C:\\bin\\pa.exe");
});

test("sin pa en el PATH (menú de inicio): %USERPROFILE%\\.local\\bin\\pa", () => {
  assert.equal(resolverPa({ Path: "C:\\Windows" }, HOME, hay(`${LOCAL}\\pa.cmd`), "win32"), `${LOCAL}\\pa.cmd`);
  assert.equal(resolverPa({}, HOME, hay(`${LOCAL}\\pa.cmd`), "win32"), `${LOCAL}\\pa.cmd`);
});

test("en ningún lado: pa pelado (el error de spawn lo dice)", () => {
  assert.equal(resolverPa({ Path: "C:\\Windows" }, HOME, hay(), "win32"), "pa");
});

test("claude.exe en %USERPROFILE%\\.local\\bin", () => {
  assert.equal(resolverBinario("claude", "HILOS_CLAUDE", { Path: "C:\\Windows" }, HOME, hay(`${LOCAL}\\claude.exe`), "win32"), `${LOCAL}\\claude.exe`);
});

test("el PATH de pa lleva .local\\bin adelante, una sola vez, y respeta la clave Path", () => {
  assert.equal(pathConLocal({ Path: "C:\\Windows;C:\\bin" }, HOME, "win32"), `${LOCAL};C:\\Windows;C:\\bin`);
  assert.equal(pathConLocal({ Path: `C:\\Windows;${LOCAL.toLowerCase()}` }, HOME, "win32"), `${LOCAL};C:\\Windows`);
  assert.equal(pathConLocal({}, HOME, "win32"), LOCAL);
  const env = entornoPa({ Path: "C:\\Windows", OTRA: "1" }, HOME, "win32");
  assert.equal(env.OTRA, "1");
  assert.equal(env.Path, `${LOCAL};C:\\Windows`);
  assert.equal(env.PATH, undefined);
});

test("el entorno de agy trae la carpeta del pa encontrado, tras .local\\bin y sin repetirla", () => {
  // pa en una carpeta que el PATH de la app no tiene (HILOS_PA): se agrega para que el líder de Gemini lo llame.
  assert.equal(entornoAgy({ HILOS_PA: "D:\\trama\\pa.exe", Path: "C:\\Windows" }, HOME, hay(), "win32").Path, `${LOCAL};D:\\trama;C:\\Windows`);
  // pa en .local\bin: nada de más.
  assert.equal(entornoAgy({ Path: "C:\\Windows" }, HOME, hay(`${LOCAL}\\pa.exe`), "win32").Path, `${LOCAL};C:\\Windows`);
  // pa en una carpeta que ya estaba en el PATH: pasa adelante, una sola vez.
  const e = entornoAgy({ Path: "C:\\Windows;D:\\bin" }, HOME, hay("D:\\bin\\pa.exe"), "win32");
  assert.equal(e.Path, `${LOCAL};D:\\bin;C:\\Windows`);
  assert.equal(e.PATH, undefined);
  // sin pa en ningún lado: como pathConLocal, y el resto del entorno intacto.
  const s = entornoAgy({ Path: "C:\\Windows", OTRA: "1" }, HOME, hay(), "win32");
  assert.equal(s.Path, `${LOCAL};C:\\Windows`);
  assert.equal(s.OTRA, "1");
});

test("resolverAgy: agy.exe del PATH, de las carpetas de sus instaladores o pelado", () => {
  assert.equal(resolverAgy({ Path: "C:\\bin" }, HOME, hay("C:\\bin\\agy.exe"), "win32"), "C:\\bin\\agy.exe");
  assert.equal(resolverAgy({ Path: "C:\\bin" }, HOME, hay("C:\\Users\\Ana\\.antigravity\\bin\\agy.exe"), "win32"), "C:\\Users\\Ana\\.antigravity\\bin\\agy.exe");
  assert.equal(resolverAgy({ Path: "C:\\bin" }, HOME, hay(), "win32"), "agy");
  assert.equal(resolverAgy({ HILOS_AGY: "D:\\agy.exe" }, HOME, hay(), "win32"), "D:\\agy.exe");
});
