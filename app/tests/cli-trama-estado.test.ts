// node --test tests/cli-trama-estado.test.ts — electron/cli/trama-estado.ts contra binarios falsos (.cmd) y servidores locales
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { enPalabras, jsonPython } from "../electron/cli/trama-estado.ts";

const run = promisify(execFile);
const TS = path.resolve(import.meta.dirname, "../electron/cli/trama-estado.ts");
const SYS32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");

const base = mkdtempSync(path.join(os.tmpdir(), "trama-estado-"));
const bin = path.join(base, "bin");
mkdirSync(bin);
const falso = (nombre: string, cuerpo: string, dir = bin) => writeFileSync(path.join(dir, nombre + ".cmd"), `@echo off\r\n${cuerpo}\r\n`);
falso("claude-ok", `echo {"loggedIn": true}`);
falso("claude-fuera", `echo {"loggedIn": false}`);
falso("claude-viejo", `echo comando desconocido`); // rc 0 pero sin JSON: cae al archivo de credenciales
falso("claude-error", `exit /b 3`);
falso("agy-falso", `exit /b 0`); // sin sesión: `agy models` no lista nada
falso("agy-con-sesion", `echo gemini-4-argon\tGemini 4 Argon\r\necho claude-sonnet-5-5\tClaude Sonnet`);
falso("agy-sin-modelos", `echo Sin sesion`);

let ollama: http.Server, motor: http.Server;
let puertoOllama = 0;
let puertoMotor = 0;
before(async () => {
  ollama = http.createServer((q, r) => {
    if (q.url === "/api/tags") r.end(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3" }, { nombre: "x" }] }));
    else r.writeHead(404).end();
  });
  motor = http.createServer((_q, r) => r.writeHead(500).end("x")); // un 5xx también es "responde"
  await Promise.all([ollama, motor].map((s) => new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok))));
  puertoOllama = (ollama.address() as AddressInfo).port;
  puertoMotor = (motor.address() as AddressInfo).port;
});
after(() => {
  ollama.close();
  motor.close();
});

/** Un home aparte por caso, con sus archivos (credenciales, modelos.json, dueno). */
function casa(nombre: string, f: (h: string) => Record<string, string> = () => ({})) {
  const h = path.join(base, nombre);
  mkdirSync(h, { recursive: true });
  return {
    USERPROFILE: h,
    APPDATA: path.join(h, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(h, "AppData", "Local"),
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    ComSpec: process.env.ComSpec ?? path.join(SYS32, "cmd.exe"),
    PATH: `${bin};${SYS32}`,
    ...f(h),
  };
}
const escribir = (f: string, t: string) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, t);
};
const modelosDe = (h: string) => path.join(h, "AppData", "Roaming", "Trama", "modelos.json");
const duenoDe = (h: string) => path.join(h, "AppData", "Local", "Trama", "state", "hilos", "dueno");

async function correr(env: Record<string, string>, args: string[] = ["--json"]) {
  const e = { OLLAMA_HOST: "127.0.0.1:1", TRAMA_PUERTO: "1", ...env }; // sin esto, localhost:11434 tarda 3 s en rendirse
  return (await run(process.execPath, [TS, ...args], { env: e })).stdout;
}

test("trama-estado: sin nada instalado todo sale en false", async () => {
  const out = await correr({ ...casa("vacio"), PATH: SYS32, TRAMA_CLAUDE: "no-existe", TRAMA_AGY: "no-existe", OLLAMA_HOST: "127.0.0.1:1" });
  const j = JSON.parse(out);
  assert.equal(j.claude.instalado, false);
  assert.equal(j.agy.instalado, false);
  assert.equal(j.motor.vivo, false);
  assert.match(out, /^\{"version": 1, "claude": \{"instalado": false, "logueado": false\}/);
});

test("trama-estado: claude con sesión, agy con modelos, ollama y motor andando", async () => {
  const env = casa("todo", (h) => {
    escribir(modelosDe(h), JSON.stringify({ locales: [{ nombre: "sin url" }, { url: `http://127.0.0.1:${puertoOllama}/` }] }));
    escribir(duenoDe(h), JSON.stringify({ pid: process.pid }));
    return { TRAMA_CLAUDE: "claude-ok", TRAMA_AGY: "agy-con-sesion", TRAMA_PUERTO: String(puertoMotor) };
  });
  const j = JSON.parse(await correr(env));
  assert.deepEqual(j.claude, { instalado: true, logueado: true });
  assert.deepEqual(j.agy, { instalado: true, logueado: true });
  assert.deepEqual(j.ollama.modelos, ["qwen3:8b", "llama3"]);
  assert.deepEqual(j.motor, { vivo: true, url: `http://127.0.0.1:${puertoMotor}`, proceso: true });
});

test("trama-estado: OLLAMA_HOST sin esquema, y agy sin sesión (no lista modelos)", async () => {
  const env = casa("host", () => ({ TRAMA_AGY: "agy-sin-modelos", OLLAMA_HOST: `127.0.0.1:${puertoOllama}/` }));
  const j = JSON.parse(await correr(env));
  assert.equal(j.agy.logueado, false);
  assert.equal(j.ollama.responde, true);
});

for (const [nombre, claude] of [["sesión cerrada", "claude-fuera"], ["rc distinto de 0", "claude-error"]] as const) {
  test(`trama-estado: claude ${nombre}`, async () => {
    const j = JSON.parse(await correr({ ...casa("c-" + claude), TRAMA_CLAUDE: claude }));
    assert.deepEqual(j.claude, { instalado: true, logueado: false });
  });
}

test("trama-estado: claude viejo cae a .credentials.json (CLAUDE_CONFIG_DIR)", async () => {
  const sin = JSON.parse(await correr({ ...casa("viejo-sin"), TRAMA_CLAUDE: "claude-viejo" }));
  assert.equal(sin.claude.logueado, false);
  const env = casa("viejo-con", (h) => {
    escribir(path.join(h, "cfg", ".credentials.json"), "{}");
    return { TRAMA_CLAUDE: "claude-viejo", CLAUDE_CONFIG_DIR: path.join(h, "cfg") };
  });
  assert.equal(JSON.parse(await correr(env)).claude.logueado, true);
});

test("trama-estado: el dueño con pid muerto no cuenta como proceso", async () => {
  const env = casa("muerto", (h) => {
    escribir(duenoDe(h), JSON.stringify({ pid: 2 ** 22 + 12345 }));
    return {};
  });
  assert.equal(JSON.parse(await correr(env)).motor.proceso, false);
});

test("trama-estado: HILOS_STATE y TRAMA_MODELOS mandan", async () => {
  const env = casa("override", (h) => {
    escribir(path.join(h, "m.json"), JSON.stringify({ locales: [{ url: `http://127.0.0.1:${puertoOllama}` }] }));
    escribir(path.join(h, "estado", "dueno"), JSON.stringify({ pid: process.pid }));
    return { TRAMA_MODELOS: path.join(h, "m.json"), HILOS_STATE: path.join(h, "estado") };
  });
  const j = JSON.parse(await correr(env));
  assert.equal(j.motor.proceso, true);
  assert.equal(j.ollama.responde, true);
});

test("trama-estado: la salida en palabras", async () => {
  const env = casa("palabras", (h) => {
    escribir(modelosDe(h), JSON.stringify({ locales: [{ url: `http://127.0.0.1:${puertoOllama}` }] }));
    return { TRAMA_CLAUDE: "claude-ok", TRAMA_PUERTO: String(puertoMotor) };
  });
  const out = await correr(env, []);
  assert.match(out, /^claude {3}instalado: sí · sesión: sí\n/);
  assert.match(out, /modelos: qwen3:8b, llama3\n/);
});

test("jsonPython/enPalabras: formato de json.dumps con acentos sin escapar", () => {
  assert.equal(jsonPython({ a: [1, "é"], b: {}, c: [] }), '{"a": [1, "é"], "b": {}, "c": []}');
  const est = { version: 1, claude: { instalado: false, logueado: false }, agy: { instalado: true, logueado: false }, ollama: { url: "http://x", responde: false, modelos: [] }, motor: { vivo: false, url: "http://y", proceso: false } };
  assert.match(enPalabras(est), /modelos: ninguno\n/);
});

test("trama-estado: agy fuera del PATH se encuentra en ~\\.antigravity*\\bin", async () => {
  const env = casa("antigravity", (h) => {
    const d = path.join(h, ".antigravity-ide", "bin");
    mkdirSync(d, { recursive: true });
    falso("agy", `echo gemini-4-argon\tGemini`, d);
    return {};
  });
  assert.deepEqual(JSON.parse(await correr(env)).agy, { instalado: true, logueado: true });
});
