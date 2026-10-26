// Sin `reparto` en motor/bin (la instalación de Trama no lo trae), `pa` no tiene que avisar "reparto falló"
// en cada lanzamiento: sigue con modelos.json o el default. Sólo avisa si PA_REPARTO apunta a uno que no está.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PA = path.resolve(import.meta.dirname, "../../motor/bin/pa");

function lanzar(extra: Record<string, string> = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-reparto-"));
  const proy = path.join(tmp, "proy");
  const bin = path.join(tmp, "bin");
  mkdirSync(proy, { recursive: true });
  mkdirSync(bin);
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.email=a@b", "-c", "user.name=n", ...a], { cwd: proy });
  git("init", "-q", ".");
  git("commit", "-q", "--allow-empty", "-m", "i");
  writeFileSync(path.join(bin, "claude"), "#!/bin/bash\necho '{}'\n");
  chmodSync(path.join(bin, "claude"), 0o755);
  writeFileSync(path.join(tmp, "reg.json"), JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
  const env = { HOME: os.homedir(), PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`, PA_STATE: path.join(tmp, "state"), TABLERO_DIR: path.join(tmp, "tab"), PROYECTOS_REGISTRY: path.join(tmp, "reg.json"), ...extra };
  return spawnSync("bash", [PA, "demo", "--leer", "--tipo", "lectura", "decime hola"], { env, encoding: "utf8", timeout: 80_000 });
}

test("sin reparto instalado no hay aviso de fallo", () => {
  assert.equal(existsSync(path.resolve(path.dirname(PA), "reparto")), false, "este test supone que motor/bin no trae reparto");
  const r = lanzar();
  assert.doesNotMatch(r.stdout + r.stderr, /reparto falló/);
});

test("con PA_REPARTO apuntando a uno que no está sí avisa", () => {
  const r = lanzar({ PA_REPARTO: "/no/existe/reparto" });
  assert.match(r.stderr, /reparto falló \(no existe \/no\/existe\/reparto\)/);
});
