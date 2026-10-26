// node --test tests/plataforma.test.ts  (Windows se prueba desde Linux: las funciones reciben plataforma, env y home)
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

const LH = "/home/ana";
const WH = "C:\\Users\\Ana";
const WENV = { APPDATA: "C:\\Users\\Ana\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" };

test("linux: los valores de siempre", () => {
  assert.equal(dirConfigTrama("linux", {}, LH), "/home/ana/.config/trama");
  assert.equal(rutaPerfil("linux", {}, LH), "/home/ana/.config/trama/perfil.json");
  assert.equal(rutaModelos("linux", {}, LH), "/home/ana/.config/trama/modelos.json");
  assert.equal(rutaModelos("linux", { XDG_CONFIG_HOME: "/x" }, LH), "/x/trama/modelos.json");
  assert.equal(rutaRegistry("linux", {}, LH), "/home/ana/.config/proyectos/registry.json");
  assert.equal(dirEstadoApp("linux", {}, LH), "/home/ana/.local/state/hilos");
  assert.equal(dirEstadoPa("linux", {}, LH), "/home/ana/.local/state/pa");
  assert.equal(dirTablero("linux", {}, LH), "/home/ana/.local/state/tablero");
  assert.equal(dirClaudeConfig("linux", LH), "/home/ana/.claude");
  assert.equal(separadorPath("linux"), ":");
});

test("linux: las variables de override ganan", () => {
  assert.equal(dirEstadoApp("linux", { HILOS_STATE: "/t/h" }, LH), "/t/h");
  assert.equal(dirEstadoPa("linux", { PA_STATE: "/t/p" }, LH), "/t/p");
  assert.equal(dirTablero("linux", { TABLERO_DIR: "/t/tab" }, LH), "/t/tab");
  assert.equal(rutaRegistry("linux", { PROYECTOS_REGISTRY: "/t/r.json" }, LH), "/t/r.json");
  assert.equal(rutaPerfil("linux", { TRAMA_PERFIL: "/t/perfil.json" }, LH), "/t/perfil.json");
  assert.equal(rutaModelos("linux", { TRAMA_MODELOS: "/t/m.json", HILOS_MODELOS: "/t/otro.json" }, LH), "/t/m.json");
  assert.equal(rutaModelos("linux", { HILOS_MODELOS: "/t/otro.json" }, LH), "/t/otro.json");
});

test("win32: AppData y LocalAppData", () => {
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

test("win32: sin APPDATA/LOCALAPPDATA cae al perfil", () => {
  assert.equal(dirConfigTrama("win32", {}, WH), "C:\\Users\\Ana\\AppData\\Roaming\\Trama");
  assert.equal(dirEstadoPa("win32", {}, WH), "C:\\Users\\Ana\\AppData\\Local\\Trama\\state\\pa");
});

test("win32: las variables de override también valen", () => {
  assert.equal(dirEstadoApp("win32", { ...WENV, HILOS_STATE: "D:\\t\\h" }, WH), "D:\\t\\h");
  assert.equal(dirEstadoPa("win32", { ...WENV, PA_STATE: "D:\\t\\p" }, WH), "D:\\t\\p");
  assert.equal(dirTablero("win32", { ...WENV, TABLERO_DIR: "D:\\t\\tab" }, WH), "D:\\t\\tab");
  assert.equal(rutaRegistry("win32", { ...WENV, PROYECTOS_REGISTRY: "D:\\r.json" }, WH), "D:\\r.json");
});

test("PATH: separador, ~/.local/bin adelante y sin repetir", () => {
  assert.equal(pathConLocal("linux", { PATH: "/usr/bin:/bin" }, LH), "/home/ana/.local/bin:/usr/bin:/bin");
  assert.equal(pathConLocal("win32", { Path: "C:\\Windows;C:\\Users\\Ana\\.local\\bin;C:\\bin" }, WH), "C:\\Users\\Ana\\.local\\bin;C:\\Windows;C:\\bin");
  assert.equal(pathConLocal("win32", { Path: "C:\\Windows;c:\\users\\ana\\.local\\bin" }, WH), "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
  assert.equal(pathConLocal("win32", {}, WH), "C:\\Users\\Ana\\.local\\bin");
});

test("PATH en Windows: se escribe sobre la clave que ya estaba, sin duplicarla", () => {
  const env = entornoConLocal("win32", { Path: "C:\\Windows", OTRA: "1" }, WH);
  assert.equal(env.Path, "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
  assert.equal(env.PATH, undefined);
  assert.equal(env.OTRA, "1");
  assert.equal(entornoConLocal("linux", { PATH: "/usr/bin" }, LH).PATH, "/home/ana/.local/bin:/usr/bin");
});

test("ejecutables: PATHEXT en Windows, el nombre solo en Linux", () => {
  assert.deepEqual(candidatosEjecutable("linux", {}, "pa"), ["pa"]);
  assert.deepEqual(candidatosEjecutable("win32", { PATHEXT: ".EXE;.CMD" }, "pa"), ["pa", "pa.exe", "pa.cmd"]);
  assert.deepEqual(candidatosEjecutable("win32", {}, "claude"), ["claude", "claude.com", "claude.exe", "claude.bat", "claude.cmd"]);
  assert.deepEqual(candidatosEjecutable("win32", {}, "claude.exe"), ["claude.exe"]);
});

test("buscarEjecutable: claude.exe en %USERPROFILE%\\.local\\bin", () => {
  const existe = (f: string) => f === "C:\\Users\\Ana\\.local\\bin\\claude.exe";
  assert.equal(buscarEjecutable("win32", {}, "claude", ["C:\\Windows", "C:\\Users\\Ana\\.local\\bin"], existe), "C:\\Users\\Ana\\.local\\bin\\claude.exe");
  assert.equal(buscarEjecutable("win32", {}, "claude", ["C:\\Windows"], existe), null);
  assert.equal(buscarEjecutable("linux", {}, "claude", ["/usr/bin"], (f) => f === "/usr/bin/claude"), "/usr/bin/claude");
});
