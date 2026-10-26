// node --test tests/  (Node corre el TypeScript directo, sin compilar)
import { test } from "node:test";
import assert from "node:assert/strict";
import { entornoAgy, entornoPa, pathConLocal, resolverBinario, resolverPa } from "../electron/binario.ts";

const HOME = "/home/ana";
const hay = (...fs: string[]) => (f: string) => fs.includes(f);

test("HILOS_PA gana siempre", () => {
  assert.equal(resolverPa({ HILOS_PA: "/tmp/pa-falso.sh", PATH: "/usr/bin" }, HOME, hay("/usr/bin/pa")), "/tmp/pa-falso.sh");
});

test("pa del PATH si está", () => {
  assert.equal(resolverPa({ PATH: "/usr/bin:/opt/bin" }, HOME, hay("/opt/bin/pa", "/home/ana/.local/bin/pa")), "/opt/bin/pa");
});

test("sin pa en el PATH (sesión gráfica): ~/.local/bin/pa", () => {
  assert.equal(resolverPa({ PATH: "/usr/bin" }, HOME, hay("/home/ana/.local/bin/pa")), "/home/ana/.local/bin/pa");
  assert.equal(resolverPa({}, HOME, hay("/home/ana/.local/bin/pa")), "/home/ana/.local/bin/pa");
});

test("en ningún lado: pa pelado (el error de spawn lo dice)", () => {
  assert.equal(resolverPa({ PATH: "/usr/bin" }, HOME, hay()), "pa");
});

test("el PATH de pa lleva ~/.local/bin adelante, una sola vez", () => {
  assert.equal(pathConLocal({ PATH: "/usr/bin:/bin" }, HOME), "/home/ana/.local/bin:/usr/bin:/bin");
  assert.equal(pathConLocal({ PATH: "/usr/bin:/home/ana/.local/bin" }, HOME), "/home/ana/.local/bin:/usr/bin");
  assert.equal(pathConLocal({}, HOME), "/home/ana/.local/bin");
  const env = entornoPa({ PATH: "/usr/bin", OTRA: "1" }, HOME);
  assert.equal(env.OTRA, "1");
  assert.equal(env.PATH, "/home/ana/.local/bin:/usr/bin");
});

test("el entorno de agy trae la carpeta del pa encontrado, tras ~/.local/bin y sin repetirla", () => {
  // pa en una carpeta que el PATH de la app no tiene (HILOS_PA): se agrega para que el líder de Gemini lo llame.
  assert.equal(entornoAgy({ HILOS_PA: "/opt/trama/pa", PATH: "/usr/bin" }, HOME, hay()).PATH, "/home/ana/.local/bin:/opt/trama:/usr/bin");
  // pa en ~/.local/bin: nada de más.
  assert.equal(entornoAgy({ PATH: "/usr/bin" }, HOME, hay("/home/ana/.local/bin/pa")).PATH, "/home/ana/.local/bin:/usr/bin");
  // pa en una carpeta que ya estaba en el PATH: pasa adelante, una sola vez.
  assert.equal(entornoAgy({ PATH: "/usr/bin:/opt/bin" }, HOME, hay("/opt/bin/pa")).PATH, "/home/ana/.local/bin:/opt/bin:/usr/bin");
  // sin pa en ningún lado: como pathConLocal, y el resto del entorno intacto.
  const e = entornoAgy({ PATH: "/usr/bin", OTRA: "1" }, HOME, hay());
  assert.equal(e.PATH, "/home/ana/.local/bin:/usr/bin");
  assert.equal(e.OTRA, "1");
});

test("Windows: pa.exe del PATH con ; y PATHEXT, o claude.exe en %USERPROFILE%\\.local\\bin", () => {
  const WH = "C:\\Users\\Ana";
  assert.equal(resolverPa({ Path: "C:\\Windows;C:\\bin" }, WH, hay("C:\\bin\\pa.exe"), "win32"), "C:\\bin\\pa.exe");
  assert.equal(resolverPa({ Path: "C:\\Windows" }, WH, hay("C:\\Users\\Ana\\.local\\bin\\pa.cmd"), "win32"), "C:\\Users\\Ana\\.local\\bin\\pa.cmd");
  assert.equal(resolverBinario("claude", "HILOS_CLAUDE", { Path: "C:\\Windows" }, WH, hay("C:\\Users\\Ana\\.local\\bin\\claude.exe"), "win32"), "C:\\Users\\Ana\\.local\\bin\\claude.exe");
  assert.equal(resolverPa({ Path: "C:\\Windows" }, WH, hay(), "win32"), "pa");
  assert.equal(resolverPa({ HILOS_PA: "D:\\pa-falso.cmd" }, WH, hay(), "win32"), "D:\\pa-falso.cmd");
  assert.equal(pathConLocal({ Path: "C:\\Windows" }, WH, "win32"), "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
  assert.equal(entornoPa({ Path: "C:\\Windows" }, WH, "win32").Path, "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
});

test("Windows: entornoAgy deja ~\\.local\\bin y la carpeta de pa.exe adelante, con ; y la clave Path", () => {
  const WH = "C:\\Users\\Ana";
  const e = entornoAgy({ Path: "C:\\Windows;D:\\bin" }, WH, hay("D:\\bin\\pa.exe"), "win32");
  assert.equal(e.Path, "C:\\Users\\Ana\\.local\\bin;D:\\bin;C:\\Windows");
  assert.equal(e.PATH, undefined);
});
