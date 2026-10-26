// node --test tests/cli-proyecto-ruta.test.ts  — la salida del port en TypeScript es la del script de bash (motor/bin/proyecto-ruta)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolver } from "../electron/cli/proyecto-ruta.ts";

const SCRIPT = path.resolve(import.meta.dirname, "../../motor/bin/proyecto-ruta");
const TS = path.resolve(import.meta.dirname, "../electron/cli/proyecto-ruta.ts");
const hayJq = spawnSync("jq", ["--version"]).status === 0;

const base = mkdtempSync(path.join(os.tmpdir(), "proyecto-ruta-"));
const home = path.join(base, "home");
for (const d of ["omc", "cartera-usd", "modo-a", "modo-b", "real", "solo/dir"]) mkdirSync(path.join(home, d), { recursive: true });
symlinkSync(path.join(home, "real"), path.join(home, "enlace"));
writeFileSync(path.join(home, "solo/dir/script.sh"), "");
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
      { name: "script", path: path.join(home, "solo/dir/script.sh") },
      { name: "fantasma", path: path.join(home, "no-existe") },
    ],
  }),
);
const env = { PATH: process.env.PATH, HOME: home, PROYECTOS_REGISTRY: registry, LC_ALL: "C" };

const correr = (cmd: string, args: string[], e: Record<string, string | undefined> = env) => {
  const r = spawnSync(cmd, args, { env: e, encoding: "utf-8" });
  return { codigo: r.status, out: r.stdout, err: r.stderr };
};
const ambos = (args: string[], e = env) => ({ ts: correr(process.execPath, [TS, ...args], e), sh: correr("bash", [SCRIPT, ...args], e) });

const casos: [string, string[]][] = [
  ["exacto", ["omc"]],
  ["exacto sin mayúsculas", ["MIAPP"]],
  ["exacto distingue de substring", ["miapp"]],
  ["substring único", ["carte"]],
  ["~ del registry", ["cartera"]],
  ["ambiguo", ["modo"]],
  ["alias a la misma carpeta", ["alias"]],
  ["symlink se resuelve", ["enlace"]],
  ["archivo: va a su carpeta", ["script"]],
  ["la ruta no existe", ["fantasma"]],
  ["no existe el nombre", ["nombremal"]],
  ["nombre vacío", [""]],
  ["sin argumentos", []],
  ["demasiados argumentos", ["a", "b"]],
  ["--listar", ["--listar"]],
];

for (const [nombre, args] of casos) {
  test(`proyecto-ruta: ${nombre} sale igual que el script`, { skip: !hayJq && "no hay jq" }, () => {
    const { ts, sh } = ambos(args);
    assert.deepEqual(ts, sh);
  });
}

test("proyecto-ruta: sin registry falla igual", { skip: !hayJq && "no hay jq" }, () => {
  const { ts, sh } = ambos(["omc"], { ...env, PROYECTOS_REGISTRY: path.join(base, "nada.json") });
  assert.equal(ts.codigo, 1);
  assert.deepEqual(ts, sh);
});

test("proyecto-ruta: resolver() en Windows lee el registry de %APPDATA%", () => {
  const appdata = path.join(base, "appdata");
  mkdirSync(path.join(appdata, "Trama", "proyectos"), { recursive: true });
  const carpeta = path.join(home, "omc");
  writeFileSync(path.join(appdata, "Trama", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "omc", path: carpeta }] }));
  // path.win32.join con una ruta de Linux: sólo prueba que busca el registry en %APPDATA%\Trama (no en ~/.config)
  const r = resolver(["--listar"], { APPDATA: appdata }, "win32", "C:\\Users\\Ana");
  assert.equal(r.codigo, 1);
  assert.match(r.err, /no existe el registry: .*Trama.*proyectos.*registry\.json/);
});
