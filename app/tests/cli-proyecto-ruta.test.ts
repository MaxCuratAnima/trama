// node --test tests/cli-proyecto-ruta.test.ts — electron/cli/proyecto-ruta.ts: nombre de proyecto → ruta real
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolver } from "../electron/cli/proyecto-ruta.ts";

const TS = path.resolve(import.meta.dirname, "../electron/cli/proyecto-ruta.ts");

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "proyecto-ruta-")));
const home = path.join(base, "home");
for (const d of ["omc", "cartera-usd", "modo-a", "modo-b", "real", "solo\\dir"]) mkdirSync(path.join(home, d), { recursive: true });
symlinkSync(path.join(home, "real"), path.join(home, "enlace"), "junction");
writeFileSync(path.join(home, "solo", "dir", "script.ps1"), "");
const registry = path.join(base, "registry.json");
writeFileSync(
  registry,
  JSON.stringify({
    projects: [
      { name: "omc", path: path.join(home, "omc") },
      { name: "Cartera", path: "~/cartera-usd" },
      { name: "modo-a", path: path.join(home, "modo-a") },
      { name: "modo-b", path: path.join(home, "modo-b") },
      { name: "MiApp", path: path.join(home, "omc") },
      { name: "miapp-respaldo", path: path.join(home, "cartera-usd") },
      { name: "alias", path: path.join(home, "real") },
      { name: "alias / largo", path: path.join(home, "enlace") },
      { name: "script", path: path.join(home, "solo", "dir", "script.ps1") },
      { name: "fantasma", path: path.join(home, "no-existe") },
    ],
  }),
);
const env = { PROYECTOS_REGISTRY: registry };
const ruta = (...p: string[]) => path.join(home, ...p) + "\n";
const quedo = (args: string[], e: Record<string, string | undefined> = env) => resolver(args, e, "win32", home);

const casos: [string, string[], number, string | RegExp][] = [
  ["exacto", ["omc"], 0, ruta("omc")],
  ["exacto sin mayúsculas", ["MIAPP"], 0, ruta("omc")],
  ["exacto distingue de substring", ["miapp"], 0, ruta("omc")],
  ["substring único", ["carte"], 0, ruta("cartera-usd")],
  ["~ del registry", ["cartera"], 0, ruta("cartera-usd")],
  ["alias a la misma carpeta", ["alias"], 0, ruta("real")],
  ["la junction se resuelve", ["alias / largo"], 0, ruta("real")],
  ["archivo: va a su carpeta", ["script"], 0, ruta("solo", "dir")],
];

for (const [nombre, args, codigo, out] of casos) {
  test(`proyecto-ruta: ${nombre}`, () => {
    const r = quedo(args);
    assert.equal(r.codigo, codigo, r.err);
    assert.equal(r.out, out);
  });
}

test("proyecto-ruta: ambiguo falla y lista los candidatos", () => {
  const r = quedo(["modo"]);
  assert.equal(r.codigo, 1);
  assert.match(r.err, /'modo' es ambiguo, hay 2 candidatos/);
  assert.match(r.err, /modo-a\t/);
  assert.match(r.err, /modo-b\t/);
});

test("proyecto-ruta: errores", () => {
  assert.match(quedo(["fantasma"]).err, /^la ruta no existe: /);
  assert.equal(quedo(["fantasma"]).codigo, 1);
  const no = quedo(["nombremal"]);
  assert.equal(no.codigo, 1);
  assert.match(no.err, /^no encontré 'nombremal'\. Proyectos:\n/);
  assert.equal(quedo([""]).codigo, 2);
  assert.equal(quedo([]).codigo, 2);
  assert.equal(quedo(["a", "b"]).codigo, 2);
});

test("proyecto-ruta: --listar da los nombres ordenados, uno por línea", () => {
  const r = quedo(["--listar"]);
  assert.equal(r.codigo, 0);
  assert.deepEqual(r.out.trim().split("\n"), ["Cartera", "MiApp", "alias", "alias / largo", "fantasma", "miapp-respaldo", "modo-a", "modo-b", "omc", "script"]);
});

test("proyecto-ruta: sin registry falla", () => {
  const r = quedo(["omc"], { PROYECTOS_REGISTRY: path.join(base, "nada.json") });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /^no existe el registry: /);
});

test("proyecto-ruta: como proceso", () => {
  const r = spawnSync(process.execPath, [TS, "omc"], { env: { ...process.env, PROYECTOS_REGISTRY: registry }, encoding: "utf-8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, ruta("omc"));
});

test("proyecto-ruta: resolver() en Windows lee el registry de %APPDATA%", () => {
  const appdata = path.join(base, "appdata");
  mkdirSync(path.join(appdata, "Trama", "proyectos"), { recursive: true });
  writeFileSync(path.join(appdata, "Trama", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "omc", path: path.join(home, "omc") }] }));
  const r = resolver(["omc"], { APPDATA: appdata }, "win32", home);
  assert.equal(r.codigo, 0, r.err);
  assert.equal(r.out, ruta("omc"));
});
