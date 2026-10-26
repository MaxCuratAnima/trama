// node --test tests/cli-trama-estado.test.ts  — la salida del port en TypeScript es la del script de Python (motor/bin/trama-estado)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { enPalabras, jsonPython } from "../electron/cli/trama-estado.ts";

const run = promisify(execFile);
const SCRIPT = path.resolve(import.meta.dirname, "../../motor/bin/trama-estado");
const TS = path.resolve(import.meta.dirname, "../electron/cli/trama-estado.ts");
const PYTHON = execFileSync("which", ["python3"], { encoding: "utf-8" }).trim(); // el PATH del hijo puede no traerlo

const base = mkdtempSync(path.join(os.tmpdir(), "trama-estado-"));
const bin = path.join(base, "bin");
mkdirSync(bin);
const falso = (nombre: string, cuerpo: string) => {
  writeFileSync(path.join(bin, nombre), `#!/bin/sh\n${cuerpo}\n`);
  chmodSync(path.join(bin, nombre), 0o755);
};
falso("claude-ok", `echo '{"loggedIn": true}'`);
falso("claude-fuera", `echo '{"loggedIn": false}'`);
falso("claude-viejo", `echo 'comando desconocido'`); // rc 0 pero sin JSON: cae al archivo de credenciales
falso("claude-error", `exit 3`);
falso("agy-falso", `exit 0`); // sin sesión: `agy models` no lista nada
falso("agy-con-sesion", `printf 'gemini-4-argon\tGemini 4 Argon\nclaude-sonnet-5-5\tClaude Sonnet\n'`);
falso("agy-sin-modelos", `printf 'Sesión: ninguna\n'`);

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

/** Un HOME aparte por caso, con sus archivos (credenciales, modelos.json, dueno). */
function casa(nombre: string, f: (h: string) => Record<string, string> = () => ({})) {
  const h = path.join(base, nombre);
  mkdirSync(h, { recursive: true });
  return { HOME: h, PATH: `${bin}:/usr/bin:/bin`, ...f(h) };
}
const escribir = (f: string, t: string) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, t);
};

async function ambos(env: Record<string, string>, args: string[] = ["--json"]) {
  const e = { OLLAMA_HOST: "127.0.0.1:1", TRAMA_PUERTO: "1", ...env }; // sin esto, localhost:11434 tarda 3 s en rendirse
  const [ts, py] = await Promise.all([run(process.execPath, [TS, ...args], { env: e }), run(PYTHON, [SCRIPT, ...args], { env: e })]);
  return { ts: ts.stdout, py: py.stdout };
}

test("trama-estado: sin nada instalado sale igual que el script", async () => {
  const { ts, py } = await ambos({ ...casa("vacio"), PATH: "/nada", TRAMA_CLAUDE: "no-existe", TRAMA_AGY: "no-existe", OLLAMA_HOST: "127.0.0.1:1" });
  assert.equal(ts, py);
  const j = JSON.parse(ts);
  assert.equal(j.claude.instalado, false);
  assert.equal(j.motor.vivo, false);
});

test("trama-estado: claude con sesión, agy con modelos, ollama y motor andando", async () => {
  const env = casa("todo", (h) => {
    escribir(path.join(h, ".config", "trama", "modelos.json"), JSON.stringify({ locales: [{ nombre: "sin url" }, { url: `http://127.0.0.1:${puertoOllama}/` }] }));
    escribir(path.join(h, ".local", "state", "hilos", "dueno"), JSON.stringify({ pid: process.pid }));
    return { TRAMA_CLAUDE: "claude-ok", TRAMA_AGY: "agy-con-sesion", TRAMA_PUERTO: String(puertoMotor) };
  });
  const { ts, py } = await ambos(env);
  assert.equal(ts, py);
  const j = JSON.parse(ts);
  assert.deepEqual(j.claude, { instalado: true, logueado: true });
  assert.deepEqual(j.agy, { instalado: true, logueado: true });
  assert.deepEqual(j.ollama.modelos, ["qwen3:8b", "llama3"]);
  assert.deepEqual(j.motor, { vivo: true, url: `http://127.0.0.1:${puertoMotor}`, proceso: true });
});

test("trama-estado: OLLAMA_HOST sin esquema, y agy sin sesión (no lista modelos)", async () => {
  const env = casa("host", () => {
    return { TRAMA_AGY: "agy-sin-modelos", OLLAMA_HOST: `127.0.0.1:${puertoOllama}/` };
  });
  const { ts, py } = await ambos(env);
  assert.equal(ts, py);
  assert.equal(JSON.parse(ts).agy.logueado, false);
  assert.equal(JSON.parse(ts).ollama.responde, true);
});

for (const [nombre, claude] of [["sesión cerrada", "claude-fuera"], ["rc distinto de 0", "claude-error"]] as const) {
  test(`trama-estado: claude ${nombre}`, async () => {
    const { ts, py } = await ambos({ ...casa("c-" + claude), TRAMA_CLAUDE: claude });
    assert.equal(ts, py);
    assert.deepEqual(JSON.parse(ts).claude, { instalado: true, logueado: false });
  });
}

test("trama-estado: claude viejo cae a .credentials.json (CLAUDE_CONFIG_DIR)", async () => {
  const sin = await ambos({ ...casa("viejo-sin"), TRAMA_CLAUDE: "claude-viejo" });
  assert.equal(sin.ts, sin.py);
  assert.equal(JSON.parse(sin.ts).claude.logueado, false);
  const env = casa("viejo-con", (h) => {
    escribir(path.join(h, "cfg", ".credentials.json"), "{}");
    return { TRAMA_CLAUDE: "claude-viejo", CLAUDE_CONFIG_DIR: path.join(h, "cfg") };
  });
  const con = await ambos(env);
  assert.equal(con.ts, con.py);
  assert.equal(JSON.parse(con.ts).claude.logueado, true);
});

test("trama-estado: el dueño con pid muerto no cuenta como proceso", async () => {
  const env = casa("muerto", (h) => {
    escribir(path.join(h, ".local", "state", "hilos", "dueno"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
    return {};
  });
  const { ts, py } = await ambos(env);
  assert.equal(ts, py);
  assert.equal(JSON.parse(ts).motor.proceso, false);
});

test("trama-estado: HILOS_STATE y TRAMA_MODELOS mandan", async () => {
  const env = casa("override", (h) => {
    escribir(path.join(h, "m.json"), JSON.stringify({ locales: [{ url: `http://127.0.0.1:${puertoOllama}` }] }));
    escribir(path.join(h, "estado", "dueno"), JSON.stringify({ pid: process.pid }));
    return { TRAMA_MODELOS: path.join(h, "m.json"), HILOS_STATE: path.join(h, "estado") };
  });
  const { ts, py } = await ambos(env);
  assert.equal(ts, py);
  assert.equal(JSON.parse(ts).motor.proceso, true);
  assert.equal(JSON.parse(ts).ollama.responde, true);
});

test("trama-estado: la salida en palabras es la del script", async () => {
  const env = casa("palabras", (h) => {
    escribir(path.join(h, ".config", "trama", "modelos.json"), JSON.stringify({ locales: [{ url: `http://127.0.0.1:${puertoOllama}` }] }));
    return { TRAMA_CLAUDE: "claude-ok", TRAMA_PUERTO: String(puertoMotor) };
  });
  const { ts, py } = await ambos(env, []);
  assert.equal(ts, py);
  assert.match(ts, /^claude {3}instalado: sí · sesión: sí\n/);
});

test("jsonPython/enPalabras: formato de json.dumps con acentos sin escapar", () => {
  assert.equal(jsonPython({ a: [1, "é"], b: {}, c: [] }), '{"a": [1, "é"], "b": {}, "c": []}');
  const est = { version: 1, claude: { instalado: false, logueado: false }, agy: { instalado: true, logueado: false }, ollama: { url: "http://x", responde: false, modelos: [] }, motor: { vivo: false, url: "http://y", proceso: false } };
  assert.match(enPalabras(est), /modelos: ninguno\n/);
});

test("trama-estado: agy fuera del PATH se encuentra en ~/.antigravity*/bin", async () => {
  const env = casa("antigravity", (h) => {
    const d = path.join(h, ".antigravity-ide", "bin");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "agy"), "#!/bin/sh\nprintf 'gemini-4-argon\\tGemini\\n'\n");
    chmodSync(path.join(d, "agy"), 0o755);
    return {};
  });
  const { ts, py } = await ambos(env);
  assert.equal(ts, py);
  assert.deepEqual(JSON.parse(ts).agy, { instalado: true, logueado: true });
});
