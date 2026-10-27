// "Falta configurar" (electron/setup.ts): qué falta según las sondas, qué se descarta y qué no se acusa sin saber.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type { Sondas } from "../electron/setup.ts";

// setup.ts importa a sus vecinos con `.js` (lo compila tsc): el hook los lleva al `.ts`; el estado, en un tmp.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-setup-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
const { descartarSetup, estadoSetup, hayGit, leerDescartados, loginDe, URLS } = await import("../electron/setup.ts");
after(() => rmSync(tmp, { recursive: true, force: true }));

const sondas = (o: Partial<Sondas> = {}): Sondas => ({
  activo: () => true,
  handy: async () => true,
  agy: () => true,
  ollama: async () => true,
  login: async () => true,
  claude: () => true,
  git: () => true,
  descartados: async () => [],
  ...o,
});

test("todo en su lugar: nada que avisar", async () => {
  assert.deepEqual(await estadoSetup(sondas()), { version: 1, faltas: [] });
});

test("lo que falta sale en un orden fijo (handy, agy, ollama, login) con su enlace", async () => {
  const r = await estadoSetup(sondas({ handy: async () => false, agy: () => false, ollama: async () => false, login: async () => false }));
  assert.deepEqual(r.faltas.map((f) => f.id), ["handy", "agy", "ollama", "login"]);
  for (const f of r.faltas) assert.equal(f.url, URLS[f.id]);
  assert.ok(Object.values(URLS).every((u) => u.startsWith("https://")));
});

test("lo descartado no vuelve; fuera del producto no se avisa nada (ni se pregunta)", async () => {
  const r = await estadoSetup(sondas({ handy: async () => false, ollama: async () => false, descartados: async () => ["handy"] }));
  assert.deepEqual(r.faltas.map((f) => f.id), ["ollama"]);
  const apagado = await estadoSetup(
    sondas({
      activo: () => false,
      handy: async () => {
        throw new Error("no se pregunta");
      },
    }),
  );
  assert.deepEqual(apagado.faltas, []);
});

test("descartar: queda en el archivo, es idempotente y un id raro no escribe nada", async () => {
  const f = path.join(tmp, "setup.json");
  assert.deepEqual(await leerDescartados(f), []);
  await descartarSetup("ollama", f);
  await descartarSetup("ollama", f);
  await descartarSetup("../etc", f);
  await descartarSetup(7, f);
  await descartarSetup("handy", f);
  assert.deepEqual(await leerDescartados(f), ["ollama", "handy"]);
  writeFileSync(f, "no es json");
  assert.deepEqual(await leerDescartados(f), []);
  writeFileSync(f, JSON.stringify({ version: 2, descartados: ["handy"] }));
  assert.deepEqual(await leerDescartados(f), []);
});

test("loginDe: sólo `loggedIn: false` acusa; un claude falso o una salida rara no", () => {
  assert.equal(loginDe('{"loggedIn": false}'), false);
  assert.equal(loginDe('{"loggedIn": true, "authMethod": "claude.ai"}'), true);
  assert.equal(loginDe("claude falso"), true);
  assert.equal(loginDe(""), true);
});

test("claude y git: faltan en su lugar; sin claude no se acusa también el login", async () => {
  const r = await estadoSetup(sondas({ claude: () => false, git: () => false, login: async () => false }));
  assert.deepEqual(r.faltas.map((f) => f.id), ["claude", "git"]);
  for (const f of r.faltas) assert.equal(f.url, URLS[f.id]);
  const sinLogin = await estadoSetup(sondas({ login: async () => false }));
  assert.deepEqual(sinLogin.faltas.map((f) => f.id), ["login"]);
});

test("hayGit: git.exe en el PATH o en Program Files cuentan", () => {
  const casa = "C:\\Users\\Ana";
  const conGit = (f: string) => f === "C:\\Program Files\\Git\\cmd\\git.exe";
  assert.equal(hayGit("win32", { Path: "C:\\Windows" }, casa, () => false), false);
  assert.equal(hayGit("win32", { Path: "C:\\Windows" }, casa, conGit), true);
  assert.equal(hayGit("win32", { Path: "D:\\Git\\cmd" }, casa, (f) => f === "D:\\Git\\cmd\\git.exe"), true);
  assert.equal(hayGit("win32", { LOCALAPPDATA: "C:\\L" }, casa, (f) => f === "C:\\L\\Programs\\Git\\cmd\\git.exe"), true);
});
