// node --test tests/plataforma.test.ts  (las funciones reciben plataforma, env y home)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buscarEjecutable,
  candidatosEjecutable,
  dirClaudeConfig,
  dirConfigTrama,
  dirEstadoApp,
  dirEstadoPa,
  dirTablero,
  entornoConLocal,
  pathConLocal,
  rutaModelos,
  rutaPerfil,
  rutaRegistry,
  separadorPath,
} from "../electron/plataforma.ts";

const WH = "C:\\Users\\Ana";
const WENV = { APPDATA: "C:\\Users\\Ana\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" };

test("AppData y LocalAppData", () => {
  assert.equal(dirConfigTrama("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Roaming\\Trama");
  assert.equal(rutaPerfil("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Roaming\\Trama\\perfil.json");
  assert.equal(rutaModelos("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Roaming\\Trama\\modelos.json");
  assert.equal(rutaRegistry("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Roaming\\Trama\\proyectos\\registry.json");
  assert.equal(dirEstadoApp("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Local\\Trama\\state\\hilos");
  assert.equal(dirEstadoPa("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Local\\Trama\\state\\pa");
  assert.equal(dirTablero("win32", WENV, WH), "C:\\Users\\Ana\\AppData\\Local\\Trama\\tablero");
  assert.equal(dirClaudeConfig("win32", WH), "C:\\Users\\Ana\\.claude");
  assert.equal(separadorPath("win32"), ";");
});

test("sin APPDATA/LOCALAPPDATA cae al perfil", () => {
  assert.equal(dirConfigTrama("win32", {}, WH), "C:\\Users\\Ana\\AppData\\Roaming\\Trama");
  assert.equal(dirEstadoPa("win32", {}, WH), "C:\\Users\\Ana\\AppData\\Local\\Trama\\state\\pa");
});

test("las variables de override también valen", () => {
  assert.equal(dirEstadoApp("win32", { ...WENV, HILOS_STATE: "D:\\t\\h" }, WH), "D:\\t\\h");
  assert.equal(dirEstadoPa("win32", { ...WENV, PA_STATE: "D:\\t\\p" }, WH), "D:\\t\\p");
  assert.equal(dirTablero("win32", { ...WENV, TABLERO_DIR: "D:\\t\\tab" }, WH), "D:\\t\\tab");
  assert.equal(rutaRegistry("win32", { ...WENV, PROYECTOS_REGISTRY: "D:\\r.json" }, WH), "D:\\r.json");
});

test("PATH: separador, ~/.local/bin adelante y sin repetir", () => {
  assert.equal(pathConLocal("win32", { Path: "C:\\Windows;C:\\Users\\Ana\\.local\\bin;C:\\bin" }, WH), "C:\\Users\\Ana\\.local\\bin;C:\\Windows;C:\\bin");
  assert.equal(pathConLocal("win32", { Path: "C:\\Windows;c:\\users\\ana\\.local\\bin" }, WH), "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
  assert.equal(pathConLocal("win32", {}, WH), "C:\\Users\\Ana\\.local\\bin");
});

test("PATH en Windows: se escribe sobre la clave que ya estaba, sin duplicarla", () => {
  const env = entornoConLocal("win32", { Path: "C:\\Windows", OTRA: "1" }, WH);
  assert.equal(env.Path, "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
  assert.equal(env.PATH, undefined);
  assert.equal(env.OTRA, "1");
});

test("ejecutables: PATHEXT", () => {
  assert.deepEqual(candidatosEjecutable("win32", { PATHEXT: ".EXE;.CMD" }, "pa"), ["pa", "pa.exe", "pa.cmd"]);
  assert.deepEqual(candidatosEjecutable("win32", {}, "claude"), ["claude", "claude.com", "claude.exe", "claude.bat", "claude.cmd"]);
  assert.deepEqual(candidatosEjecutable("win32", {}, "claude.exe"), ["claude.exe"]);
});

test("buscarEjecutable: claude.exe en %USERPROFILE%\\.local\\bin", () => {
  const existe = (f: string) => f === "C:\\Users\\Ana\\.local\\bin\\claude.exe";
  assert.equal(buscarEjecutable("win32", {}, "claude", ["C:\\Windows", "C:\\Users\\Ana\\.local\\bin"], existe), "C:\\Users\\Ana\\.local\\bin\\claude.exe");
  assert.equal(buscarEjecutable("win32", {}, "claude", ["C:\\Windows"], existe), null);
});
