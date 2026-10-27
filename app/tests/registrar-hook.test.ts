import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REGISTRAR = path.join(import.meta.dirname, "..", "scripts", "registrar-hook.mjs");
const WIN = process.platform === "win32";
const BIN_WIN = path.resolve(import.meta.dirname, "..", "..", "motor", "bin-win");
const entreComillas = (f: string) => `"${path.join(BIN_WIN, f).replace(/\\/g, "/")}"`;
/** El comando que el script registra en esta plataforma. */
const HOOK = WIN ? entreComillas("hook-compactando.cmd") : path.join(import.meta.dirname, "..", "scripts", "hook-compactando.sh");

const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-registrar-hook-"));
const registrar = (ruta: string) => execFileSync(process.execPath, [REGISTRAR, ruta], { encoding: "utf8" });
const leer = (ruta: string) => JSON.parse(readFileSync(ruta, "utf8"));
/** Cuántas veces aparece el hook de compactando en un evento (cualquier grupo). */
const cuantos = (ajustes: any, evento: string) =>
  (ajustes.hooks?.[evento] ?? []).flatMap((g: any) => g.hooks ?? []).filter((h: any) => /hook-compactando\.cmd/.test(h.command)).length;

test("registrar-hook: dos corridas dejan el hook una sola vez y los otros hooks intactos", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const otrosHooks = {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "C:\\bin\\otro-hook.cmd" }] }],
    PreCompact: [{ matcher: "manual", hooks: [{ type: "command", command: "C:\\bin\\mi-otro-precompact.cmd" }] }],
    PostCompact: [],
  };
  writeFileSync(settings, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls:*)"] }, hooks: otrosHooks }, null, 2));

  const primera = registrar(settings);
  assert.match(primera, /registrado/);
  const tras1 = leer(settings);
  const bytes1 = readFileSync(settings, "utf8");
  assert.equal(cuantos(tras1, "PreCompact"), 1);
  assert.equal(cuantos(tras1, "PostCompact"), 1);
  assert.deepEqual(tras1.hooks.PreToolUse, otrosHooks.PreToolUse, "PreToolUse intacto");
  assert.deepEqual(tras1.hooks.PreCompact[0], otrosHooks.PreCompact[0], "el PreCompact ajeno sigue en su grupo");
  assert.equal(tras1.model, "opus");
  assert.deepEqual(tras1.permissions, { allow: ["Bash(ls:*)"] });
  assert.equal(tras1.hooks.PreCompact[1].hooks[0].command, HOOK, "el comando es la ruta de este checkout");

  const segunda = registrar(settings);
  assert.match(segunda, /ya registrado/);
  assert.equal(readFileSync(settings, "utf8"), bytes1, "la segunda corrida no reescribe el archivo");
  assert.equal(cuantos(leer(settings), "PreCompact"), 1);
  assert.equal(cuantos(leer(settings), "PostCompact"), 1);
  rmSync(dir, { recursive: true });
});

test("registrar-hook: crea el settings si no existe, con los dos eventos", () => {
  const dir = temporal();
  const settings = path.join(dir, "sub", "settings.json");
  registrar(settings);
  const ajustes = leer(settings);
  assert.equal(cuantos(ajustes, "PreCompact"), 1);
  assert.equal(cuantos(ajustes, "PostCompact"), 1);
  if (!WIN) assert.equal(statSync(settings).mode & 0o777, 0o600, "un settings nuevo no sale legible por todos");
  rmSync(dir, { recursive: true });
});

test("registrar-hook: un hook de este script con otra ruta (checkout viejo) o repetido queda uno, con la ruta nueva", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const viejo = { type: "command", command: "C:/viejo/motor/bin-win/hook-compactando.cmd" };
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        PreCompact: [{ hooks: [viejo, { type: "command", command: "C:\\bin\\otro.cmd" }] }, { hooks: [viejo] }],
        PostCompact: [{ hooks: [viejo] }],
      },
    }),
  );
  registrar(settings);
  const ajustes = leer(settings);
  assert.equal(cuantos(ajustes, "PreCompact"), 1);
  assert.equal(cuantos(ajustes, "PostCompact"), 1);
  // La primera aparición se actualiza en su lugar; las repetidas salen, y el grupo que quedó vacío se saca.
  assert.deepEqual(ajustes.hooks.PreCompact, [
    { hooks: [{ type: "command", command: HOOK }, { type: "command", command: "C:\\bin\\otro.cmd" }] },
  ]);
  assert.deepEqual(ajustes.hooks.PostCompact, [{ hooks: [{ type: "command", command: HOOK }] }]);
  rmSync(dir, { recursive: true });
});

test("registrar-hook: JSON roto no se toca y sale con error", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, '{"hooks": {');
  const r = spawnSync(process.execPath, [REGISTRAR, settings], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no es JSON válido/);
  assert.equal(readFileSync(settings, "utf8"), '{"hooks": {');
  rmSync(dir, { recursive: true });
});

test("registrar-hook: statusLine se pone si no hay, queda igual en la segunda corrida y el shim es el de hook-statusline", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ model: "opus" }));
  assert.match(registrar(settings), /statusLine/);
  const ajustes = leer(settings);
  assert.deepEqual(ajustes.statusLine, { type: "command", command: entreComillas("hook-statusline.cmd") });
  const bytes = readFileSync(settings, "utf8");
  assert.match(registrar(settings), /ya registrado/);
  assert.equal(readFileSync(settings, "utf8"), bytes);
  rmSync(dir, { recursive: true });
});

test("registrar-hook: un statusLine ajeno no se pisa (y se avisa); uno nuestro con otra ruta se actualiza", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const ajeno = { type: "command", command: "C:\\Python314\\pythonw.exe -S C:\\x\\linea.py" };
  writeFileSync(settings, JSON.stringify({ statusLine: ajeno }));
  const salida = registrar(settings);
  assert.match(salida, /statusLine: ya hay uno propio/);
  assert.deepEqual(leer(settings).statusLine, ajeno);
  assert.equal(cuantos(leer(settings), "PreCompact"), 1, "el hook de compactando se registra igual");

  writeFileSync(settings, JSON.stringify({ statusLine: { type: "command", command: '"D:/viejo/motor/bin-win/hook-statusline.cmd" otro' } }));
  registrar(settings);
  assert.equal(leer(settings).statusLine.command, entreComillas("hook-statusline.cmd"));
  rmSync(dir, { recursive: true });
});
