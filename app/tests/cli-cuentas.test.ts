// node --test tests/cli-cuentas.test.ts — el CLI `cuentas` (electron/cli/cuentas.ts) contra el contrato de cuentas-varias.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { entornoDe, ejecutar, idDeNombre, rutaCuentas, type Deps, type Perfil } from "../electron/cli/cuentas.ts";
import { parsearCuentas } from "../electron/cuentas-varias.ts";

const TS = path.resolve(import.meta.dirname, "../electron/cli/cuentas.ts");
const BIN = path.resolve(import.meta.dirname, "../../motor/bin/cuentas");
const hayJq = spawnSync("jq", ["--version"]).status === 0;

function entorno() {
  const home = mkdtempSync(path.join(os.tmpdir(), "cuentas-"));
  const env = { PATH: process.env.PATH, APPDATA: path.join(home, "AppData", "Roaming"), ANTHROPIC_API_KEY: "sk-x" };
  const logins: { bin: string; args: string[]; env: Record<string, string | undefined> }[] = [];
  const deps: Deps = {
    plataforma: "win32", env, home,
    verificar: async (c: Perfil) => c.id === "claude",
    login: (bin, args, e) => (logins.push({ bin, args, env: e }), 0),
  };
  const json = path.join(home, "AppData", "Roaming", "Trama", "cuentas.json");
  return { home, env, deps, json, logins };
}

test("sin cuentas.json: están las de siempre (claude, google), con su carpeta, y no se crea ningún archivo", async () => {
  const { deps, home, json } = entorno();
  const r = await ejecutar(["--json"], deps);
  assert.equal(r.rc, 0);
  const l = parsearCuentas(r.out);
  assert.deepEqual(l?.cuentas.map((c) => [c.id, c.proveedor, c.defecto, c.logueado]), [["claude", "claude", true, null], ["google", "google", true, null]]);
  assert.equal(JSON.parse(r.out).cuentas[0].dir, path.join(home, ".claude"));
  assert.equal(existsSync(json), false);
});

test("--verificar le pregunta el login a cada cuenta", async () => {
  const { deps } = entorno();
  const l = parsearCuentas((await ejecutar(["--json", "--verificar"], deps)).out);
  assert.deepEqual(l?.cuentas.map((c) => c.logueado), [true, false]);
});

test("agregar: el id es la última línea, crea la carpeta y la lista la trae; un nombre repetido suma un número", async () => {
  const { deps, json } = entorno();
  const a = await ejecutar(["agregar", "claude", "Trabajo", "Ñandú"], deps);
  assert.equal(a.rc, 0);
  assert.equal(a.out, "trabajo-nandu\n");
  assert.match(a.err, /falta el login/);
  assert.equal((await ejecutar(["agregar", "claude", "Trabajo Ñandú"], deps)).out, "trabajo-nandu-2\n");
  assert.equal((await ejecutar(["agregar", "google", "Claude"], deps)).out, "claude-2\n"); // «claude» es el id de la de siempre
  const guardado = JSON.parse(readFileSync(json, "utf8"));
  assert.equal(guardado.cuentas.length, 3);
  assert.equal(existsSync(guardado.cuentas[0].dir), true);
  const l = parsearCuentas((await ejecutar(["--json"], deps)).out);
  assert.deepEqual(l?.cuentas.map((c) => [c.id, c.defecto]), [["claude", true], ["trabajo-nandu", false], ["trabajo-nandu-2", false], ["google", true], ["claude-2", false]]);
});

test("datos que no valen: salida 2 con el motivo en stderr", async () => {
  const { deps } = entorno();
  for (const args of [["agregar", "otro", "x"], ["agregar", "claude", "   "], ["agregar", "claude", "x".repeat(61)], ["renombrar", "../mal", "x"], ["env", "no-existe", "--json"], ["rarisimo"]]) {
    const r = await ejecutar(args, deps);
    assert.equal(r.rc, 2, args.join(" "));
    assert.match(r.err, /^cuentas: /);
  }
});

test("env --json: lo que pa espera ({proveedor, sacar, poner}); Claude con su CLAUDE_CONFIG_DIR y sin ANTHROPIC_API_KEY", async () => {
  const { deps, json } = entorno();
  await ejecutar(["agregar", "claude", "Trabajo"], deps);
  const e = JSON.parse((await ejecutar(["env", "trabajo", "--json"], deps)).out);
  assert.equal(e.proveedor, "claude");
  assert.ok(e.sacar.includes("ANTHROPIC_API_KEY"));
  assert.equal(e.poner.CLAUDE_CONFIG_DIR, JSON.parse(readFileSync(json, "utf8")).cuentas[0].dir);
  await ejecutar(["agregar", "google", "Personal"], deps);
  const g = JSON.parse((await ejecutar(["env", "personal", "--json"], deps)).out);
  assert.equal(g.proveedor, "google");
  assert.equal(g.poner.HOME, JSON.parse(readFileSync(json, "utf8")).cuentas[1].dir);
  assert.equal(g.poner.CLAUDE_CONFIG_DIR, undefined);
  // la de siempre no toca el entorno
  assert.deepEqual(JSON.parse((await ejecutar(["env", "claude", "--json"], deps)).out), { id: "claude", proveedor: "claude", sacar: [], poner: {} });
});

test("renombrar y quitar (con y sin --borrar-credenciales); la de siempre no se renombra ni se quita", async () => {
  const { deps, json } = entorno();
  await ejecutar(["agregar", "claude", "Trabajo"], deps);
  await ejecutar(["agregar", "claude", "Casa"], deps);
  const dirs = JSON.parse(readFileSync(json, "utf8")).cuentas.map((c: { dir: string }) => c.dir);
  assert.equal((await ejecutar(["renombrar", "trabajo", "Mi", "  oficina"], deps)).rc, 0);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).cuentas[0].nombre, "Mi oficina");
  assert.equal((await ejecutar(["quitar", "trabajo"], deps)).rc, 0);
  assert.equal(existsSync(dirs[0]), true); // sin --borrar-credenciales la carpeta queda
  assert.equal((await ejecutar(["quitar", "casa", "--borrar-credenciales"], deps)).rc, 0);
  assert.equal(existsSync(dirs[1]), false);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).cuentas.length, 0);
  for (const args of [["quitar", "claude", "--borrar-credenciales"], ["renombrar", "google", "x"], ["quitar", "trabajo"]]) assert.equal((await ejecutar(args, deps)).rc, 2, args.join(" "));
});

test("quitar --borrar-credenciales no borra una carpeta fuera de la de cuentas (un dir a mano en el json)", async () => {
  const { deps, json, home } = entorno();
  const afuera = path.join(home, "mis-cosas");
  mkdirSync(afuera);
  mkdirSync(path.dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify({ version: 1, cuentas: [{ id: "raro", proveedor: "claude", nombre: "Raro", dir: afuera }] }));
  assert.equal((await ejecutar(["quitar", "raro", "--borrar-credenciales"], deps)).rc, 0);
  assert.equal(existsSync(afuera), true);
});

test("login corre el CLI de esa cuenta con su entorno (claude auth login con su CLAUDE_CONFIG_DIR); la de siempre, con el entorno tal cual", async () => {
  const { deps, logins } = entorno();
  await ejecutar(["agregar", "claude", "Trabajo"], deps);
  assert.equal((await ejecutar(["login", "trabajo"], deps)).rc, 0);
  assert.deepEqual(logins[0].args, ["auth", "login"]);
  assert.match(logins[0].env.CLAUDE_CONFIG_DIR!, /trabajo$/);
  assert.equal(logins[0].env.ANTHROPIC_API_KEY, undefined);
  await ejecutar(["login", "claude"], deps);
  assert.equal(logins[1].env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal((await ejecutar(["login", "nadie"], deps)).rc, 2);
});

test("un cuentas.json roto no se pisa", async () => {
  const { deps, json } = entorno();
  mkdirSync(path.dirname(json), { recursive: true });
  writeFileSync(json, "{ roto");
  assert.equal((await ejecutar(["agregar", "claude", "X"], deps)).rc, 1);
  assert.equal(readFileSync(json, "utf8"), "{ roto");
});

test("rutas y entorno", () => {
  assert.equal(rutaCuentas("win32", { APPDATA: "C:\\U\\A\\Roaming" }, "C:\\U\\A"), "C:\\U\\A\\Roaming\\Trama\\cuentas.json");
  assert.equal(rutaCuentas("win32", { TRAMA_CUENTAS: "C:\\x\\c.json" }, "C:\\U\\A"), "C:\\x\\c.json");
  assert.equal(rutaCuentas("win32", { TRAMA_CUENTAS_HOME: "C:\\otra", APPDATA: "C:\\otra\\AppData\\Roaming" }, "C:\\U\\A"), "C:\\otra\\AppData\\Roaming\\Trama\\cuentas.json");
  const c = (proveedor: Perfil["proveedor"]): Perfil => ({ id: "x", proveedor, motor: "", nombre: "X", dir: "D", defecto: false, logueado: null });
  assert.deepEqual(entornoDe("win32", c("google")).poner, { HOME: "D", USERPROFILE: "D" });
  assert.deepEqual(entornoDe("win32", c("chatgpt")).poner, { CODEX_HOME: "D" });
  assert.equal(idDeNombre("  ¡Hola, Mundo!  "), "hola-mundo");
});

test("el .ts anda por línea de comandos con un cuentas.json temporal", () => {
  const { home } = entorno();
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: home, TRAMA_CUENTAS: path.join(home, "c.json") };
  const r = spawnSync(process.execPath, [TS, "agregar", "claude", "Viaje"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "viaje\n");
  const w = spawnSync(process.execPath, [TS, "env", "viaje", "--json"], { env, encoding: "utf8" });
  assert.equal(w.status, 0, w.stderr);
  assert.equal(JSON.parse(w.stdout).poner.CLAUDE_CONFIG_DIR, path.join(home, "cuentas", "viaje"));
  assert.equal(spawnSync(process.execPath, [TS, "env", "no", "--json"], { env, encoding: "utf8" }).status, 2);
});
