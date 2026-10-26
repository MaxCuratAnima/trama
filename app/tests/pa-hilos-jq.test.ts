// `pa --hilos --json` tiene que andar con el jq de la máquina: la 1.7 no trae `trim` (llegó en la 1.7.1) y
// el programa fallaba entero; `pa` contestaba una lista vacía con rc 0 y la barra se quedaba en "Arrancando…".
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PA = path.resolve(import.meta.dirname, "../../motor/bin/pa");

test("pa --hilos --json lista un hilo con tarea (jq sin trim)", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-hilos-"));
  const id = `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-120000-4242`;
  mkdirSync(path.join(tmp, "atlas"), { recursive: true });
  writeFileSync(path.join(tmp, "atlas", `${id}.hilo`), `tarea=  Arreglar   el login \ninicio=${Math.floor(Date.now() / 1000)}\nproyecto=atlas\nleer=0\n`);
  const env = { ...process.env, PA_STATE: tmp };
  for (const k of Object.keys(env)) if (k.startsWith("PA_") && k !== "PA_STATE") delete env[k];
  const r = spawnSync("bash", [PA, "--hilos", "--json"], { env, encoding: "utf8", timeout: 60_000 });
  assert.doesNotMatch(r.stderr, /jq: error|no pude armar/, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.hilos.length, 1);
  assert.equal(j.hilos[0].id, id);
  assert.match(j.hilos[0].tarea, /Arreglar\s+el login/);
});
