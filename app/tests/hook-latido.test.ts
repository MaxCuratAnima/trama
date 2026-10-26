// electron/cli/hook-latido.ts y hook-comando.ts: latido, guardia de git, allowlist de --leer, avisos y el comando por plataforma.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitDeLectura, nombreDueno, procesarLatido, type ContextoLatido } from "../electron/cli/hook-latido.ts";
import { comandoHook, hooksDeWorker, shellDeHooks } from "../electron/cli/hook-comando.ts";

function entorno(extra: Record<string, string> = {}, vivos: number[] = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "latido-"));
  const hb = path.join(dir, "trama.heartbeat");
  const ctx: ContextoLatido = { plataforma: "linux", env: { ...extra }, home: dir, ahora: () => 1_700_000_000.9, vivo: (p) => vivos.includes(p) };
  return { dir, hb, ctx };
}
const bash = (command: string, extra: Record<string, unknown> = {}) => JSON.stringify({ tool_name: "Bash", tool_input: { command, ...extra } });
const conTimeout = (command: string, extra: Record<string, unknown> = {}) => bash(command, { timeout: 600000, ...extra });

test("latido: escribe epoch/tool/envuelo/desc y desc cae a command, file_path o pattern", () => {
  const { hb, ctx } = entorno();
  procesarLatido([hb, "pre"], bash("ls -la", { description: "Listo archivos" }), ctx);
  assert.equal(readFileSync(hb, "utf8"), "epoch=1700000000\ntool=Bash\nenvuelo=1\ndesc=Listo archivos\n");
  procesarLatido([hb, "post"], bash("ls -la"), ctx);
  assert.match(readFileSync(hb, "utf8"), /envuelo=0\ndesc=ls -la\n$/);
  procesarLatido([hb, "pre"], JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x/y.ts" } }), ctx);
  assert.match(readFileSync(hb, "utf8"), /tool=Read\nenvuelo=1\ndesc=\/x\/y\.ts\n$/);
  procesarLatido([hb, "pre"], JSON.stringify({ tool_name: "Grep", tool_input: { pattern: "foo" } }), ctx);
  assert.match(readFileSync(hb, "utf8"), /desc=foo\n$/);
  procesarLatido([hb, "pre"], "basura", ctx);
  assert.match(readFileSync(hb, "utf8"), /tool=\?\nenvuelo=1\ndesc=\n$/);
});

test("latido: la desc pierde saltos de línea y tabs y se corta a 160 caracteres", () => {
  const { hb, ctx } = entorno();
  procesarLatido([hb, "pre"], bash("a\nb\tc\rd" + "é".repeat(300), { description: "" }), ctx);
  const desc = readFileSync(hb, "utf8").split("\n")[3].replace("desc=", "");
  assert.equal(Array.from(desc).length, 160);
  assert.ok(desc.startsWith("a b c d"));
});

test("latido: sin heartbeat no escribe nada y sigue", () => {
  const { ctx } = entorno();
  const r = procesarLatido(["", "pre"], bash("ls"), ctx);
  assert.equal(r.codigo, 0);
});

test("latido: aunque la guardia bloquee, el heartbeat dice qué se intentó", () => {
  const { hb, ctx } = entorno();
  const r = procesarLatido([hb, "pre"], bash("git stash"), ctx);
  assert.equal(r.codigo, 2);
  assert.match(readFileSync(hb, "utf8"), /desc=git stash\n$/);
});

// --- guardia de git ---

const BLOQUEA: [string, RegExp][] = [
  ["git stash", /git stash/],
  ["git stash push -u", /git stash/],
  ["git stash pop", /git stash/],
  ["cd x && git stash", /git stash/],
  ["git -C /repo stash", /git stash/],
  ["git add -A", /git add/],
  ["git add --all", /git add/],
  ["git add -u", /git add/],
  ["git add .", /git add/],
  ["git -C /r add -A", /git add/],
  ["x; git add .", /git add/],
  ["git commit -a -m x", /commit -a/],
  ["git commit -am x", /commit -a/],
  ["git commit --all", /commit -a/],
  ["cargo clean", /cargo clean/],
  ["cargo clean -p x", /cargo clean/],
  ["cargo build --release", /release/],
  ["cargo test --release", /release/],
  ["cargo build -r", /release/],
  ["cargo build --profile release", /release/],
  ["cargo install --path .", /release/],
  ["tauri build", /release/],
  ["npx tauri build", /release/],
  ["npm run tauri -- build", /(?:release|timeout)/],
];
for (const [c, motivo] of BLOQUEA) {
  test(`pre bloquea «${c}»`, () => {
    const { hb, ctx } = entorno();
    const r = procesarLatido([hb, "pre"], conTimeout(c), ctx);
    assert.equal(r.codigo, 2, r.stderr);
    assert.match(r.stderr, /^BLOQUEADO:/);
    assert.match(r.stderr, motivo);
  });
}

const PASA = [
  "git stash list",
  "git stash show -p",
  "git -C /r stash list",
  "git add src/a.ts",
  "git add -p",
  "git add ./src",
  "git commit -m 'arreglo'",
  "git commit --amend",
  "cargo build",
  "cargo test -p x",
  "cargo check",
  "git log --oneline",
  "echo stash",
  "ls",
];
for (const c of PASA) {
  test(`pre pasa «${c}»`, () => {
    const { hb, ctx } = entorno();
    assert.equal(procesarLatido([hb, "pre"], conTimeout(c), ctx).codigo, 0);
  });
}

test("--aca (heartbeat @aca): el release se permite", () => {
  const { dir, ctx } = entorno();
  const hb = path.join(dir, "trama@aca.heartbeat");
  assert.equal(procesarLatido([hb, "pre"], conTimeout("cargo build --release"), ctx).codigo, 0);
});

test("el mensaje del release lleva el nombre del dueño (TRAMA_DUENO, perfil.json, usuario)", () => {
  const { hb, ctx } = entorno({ TRAMA_DUENO: "Gonza" });
  assert.match(procesarLatido([hb, "pre"], conTimeout("cargo build --release"), ctx).stderr, /binario que usa Gonza\)/);
  const { dir, ctx: c2 } = entorno({ TRAMA_PERFIL: "" });
  const perfil = path.join(dir, "perfil.json");
  writeFileSync(perfil, JSON.stringify({ dueno: "Max" }));
  assert.equal(nombreDueno({ ...c2, env: { TRAMA_PERFIL: perfil } }), "Max");
  assert.equal(nombreDueno({ ...c2, env: { USER: "maxcurat", TRAMA_PERFIL: "/no/existe" } }), "Maxcurat");
  assert.equal(nombreDueno({ ...c2, env: { USERNAME: "ana", TRAMA_PERFIL: "/no/existe" } }), "Ana");
  assert.equal(nombreDueno({ ...c2, env: { TRAMA_PERFIL: "/no/existe" } }), "el usuario");
});

test("run_in_background se bloquea; un comando largo sin timeout también, con timeout pasa", () => {
  const { hb, ctx } = entorno();
  const bg = procesarLatido([hb, "pre"], bash("sleep 1", { run_in_background: true }), ctx);
  assert.equal(bg.codigo, 2);
  assert.match(bg.stderr, /run_in_background/);
  assert.equal(procesarLatido([hb, "pre"], bash("sleep 1", { run_in_background: false }), ctx).codigo, 0);
  for (const c of ["cargo test", "npm run build", "npm test", "pnpm build", "npx tsc", "tsc -p x", "pytest -q", "make", "go test ./...", "vitest", "yarn typecheck", "timeout 300 cargo build", "cd x && cargo check"]) {
    const sin = procesarLatido([hb, "pre"], bash(c), ctx);
    assert.equal(sin.codigo, 2, c);
    assert.match(sin.stderr, /parámetro 'timeout'/);
    assert.equal(procesarLatido([hb, "pre"], conTimeout(c), ctx).codigo, 0, c);
  }
  assert.equal(procesarLatido([hb, "pre"], bash("node --test tests/x.test.ts"), ctx).codigo, 0);
  assert.equal(procesarLatido([hb, "pre"], bash("echo maketest"), ctx).codigo, 0);
});

test("PowerShell se guarda igual que Bash", () => {
  const { hb, ctx } = entorno();
  const ps = (c: string) => JSON.stringify({ tool_name: "PowerShell", tool_input: { command: c } });
  assert.equal(procesarLatido([hb, "pre"], ps("git add -A"), ctx).codigo, 2);
  assert.equal(procesarLatido([hb, "pre"], ps("git stash; git status"), ctx).codigo, 2);
  assert.equal(procesarLatido([hb, "pre"], ps("git status"), ctx).codigo, 0);
  assert.equal(procesarLatido([hb, "pre", "leer"], ps("Get-ChildItem"), ctx).codigo, 2);
  assert.equal(procesarLatido([hb, "pre", "leer"], ps("git log -3"), ctx).codigo, 0);
});

test("otras herramientas no pasan por la guardia de comandos", () => {
  const { hb, ctx } = entorno();
  const edit = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/x", new_string: "git stash" } });
  assert.equal(procesarLatido([hb, "pre"], edit, ctx).codigo, 0);
  assert.equal(procesarLatido([hb, "pre", "leer"], edit, ctx).codigo, 0);
});

// --- dependencias con otro worker vivo ---

function conOtroWorker(vivo: boolean, leer = false) {
  const { dir, hb, ctx } = entorno({}, vivo ? [4242] : []);
  writeFileSync(path.join(dir, "trama.running"), "proyecto=trama\npid=1111\n");
  writeFileSync(path.join(dir, "trama@2.running"), `proyecto=trama\npid=4242\n${leer ? "leer=1\n" : ""}`);
  return { hb, ctx };
}
test("instalar dependencias: bloquea con otro writer vivo; pasa si murió, si es --leer o si no hay .running", () => {
  for (const c of ["npm install", "npm i x", "pnpm add y", "yarn remove z", "npm ci", "pip install x", "pip3 install -r r.txt", "python3 -m pip install x", "uv sync", "uv pip install x", "bun add x"]) {
    const { hb, ctx } = conOtroWorker(true);
    const r = procesarLatido([hb, "pre"], conTimeout(c), ctx);
    assert.equal(r.codigo, 2, c);
    assert.match(r.stderr, /otro worker/);
  }
  const muerto = conOtroWorker(false);
  assert.equal(procesarLatido([muerto.hb, "pre"], conTimeout("npm install"), muerto.ctx).codigo, 0);
  const lector = conOtroWorker(true, true);
  assert.equal(procesarLatido([lector.hb, "pre"], conTimeout("npm install"), lector.ctx).codigo, 0);
  const solo = entorno();
  assert.equal(procesarLatido([solo.hb, "pre"], conTimeout("npm install"), solo.ctx).codigo, 0);
  const { hb, ctx } = conOtroWorker(true);
  assert.equal(procesarLatido([hb, "pre"], conTimeout("npm run lint"), ctx).codigo, 0);
});

test("instalar dependencias: usa pa_pid si falta pid", () => {
  const { dir, hb, ctx } = entorno({}, [77]);
  writeFileSync(path.join(dir, "trama.running"), "proyecto=trama\n");
  writeFileSync(path.join(dir, "trama@3.running"), "proyecto=trama\npa_pid=77\n");
  assert.equal(procesarLatido([hb, "pre"], conTimeout("npm install"), ctx).codigo, 2);
});

// --- --leer ---

const LEER_OK = [
  "git log --oneline -5",
  "git -C /repo diff HEAD~1",
  "git --no-pager show abc123",
  "git status",
  "git rev-parse HEAD",
  "git merge-base a b",
  "git ls-files",
  "git ls-tree HEAD",
  "git blame f.ts",
  "git shortlog -sn",
  "git describe --tags",
  "git cat-file -p HEAD",
  "git grep foo",
  "git rev-list --count HEAD",
  "git worktree list",
  "git stash list",
  "git stash show -p",
  "git branch",
  "git branch --list 'pa/*'",
  "git branch -a",
  "git branch -vv",
  "git branch --merged main",
  "git branch --show-current",
  "git log --oneline | head -5",
  "git log | grep fix | wc -l",
  "git -C /r log | cut -c1-20",
];
const LEER_NO = [
  "ls",
  "cat f",
  "git add x",
  "git commit -m x",
  "git push",
  "git checkout x",
  "git stash",
  "git stash pop",
  "git worktree add x",
  "git branch nueva",
  "git branch -D x",
  "git branch -d x",
  "git branch -m a b",
  "git branch --delete x",
  "git branch -f x",
  "git branch --set-upstream-to=o/x",
  "git log; rm x",
  "git log && ls",
  "git log > f",
  "git log | tee f",
  "git log | sort -o f",
  "git log | sed -n 1p",
  "git log $(whoami)",
  "git log `x`",
  "git log\nls",
  "git log || ls",
  "git diff --output=f",
  "git diff -O x",
  "git log --ext-diff",
  "git show --open-files-in-pager",
  "echo hi",
  "",
  "git",
  "|",
];
for (const c of LEER_OK) test(`--leer deja pasar «${c}»`, () => assert.equal(gitDeLectura(c), true));
for (const c of LEER_NO) test(`--leer bloquea «${c.replace(/\n/g, "\\n")}»`, () => assert.equal(gitDeLectura(c), false));

test("--leer: el hook devuelve el mensaje de modo lectura, sólo en pre y sólo en shell", () => {
  const { hb, ctx } = entorno();
  const r = procesarLatido([hb, "pre", "leer"], bash("ls"), ctx);
  assert.equal(r.codigo, 2);
  assert.match(r.stderr, /modo LECTURA \(pa --leer\)/);
  assert.equal(procesarLatido([hb, "pre", "leer"], bash("git log -1"), ctx).codigo, 0);
  assert.equal(procesarLatido([hb, "post", "leer"], bash("ls"), ctx).codigo, 0);
  assert.equal(procesarLatido([hb, "pre", "leer"], JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }), ctx).codigo, 0);
});

// --- recorte de salida de tests ---

test("PA_RECORTE: reescribe un runner de tests con awk y conserva el resto de tool_input", () => {
  const { hb, ctx } = entorno({ PA_RECORTE: "150" });
  const r = procesarLatido([hb, "pre"], bash("cargo test -p x", { timeout: 600000, description: "d" }), ctx);
  assert.equal(r.codigo, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(j.hookSpecificOutput.updatedInput.command, /^set -o pipefail; \( cargo test -p x \) 2>&1 \| awk -v n=150 /);
  assert.equal(j.hookSpecificOutput.updatedInput.timeout, 600000);
  assert.equal(j.hookSpecificOutput.updatedInput.description, "d");
  for (const c of ["npm test", "pytest -q", "go test ./...", "make test", "vitest run", "./tests/run.sh"]) {
    assert.ok(procesarLatido([hb, "pre"], conTimeout(c), ctx).stdout.includes("updatedInput"), c);
  }
});

test("PA_RECORTE: no toca comandos con pipe, redirección o encadenado, ni --leer, ni PA_RECORTE 0/vacío, ni Windows", () => {
  const { hb, ctx } = entorno({ PA_RECORTE: "150" });
  for (const c of ["cargo test | tail", "cargo test > f", "cargo test && x", "cargo test; x", "cargo build", "cd x && cargo test", "echo $(cargo test)"]) {
    assert.equal(procesarLatido([hb, "pre"], conTimeout(c), ctx).stdout, "", c);
  }
  assert.equal(procesarLatido([hb, "pre", "leer"], conTimeout("git log"), ctx).stdout, "");
  for (const v of ["0", "", "abc", "-5"]) assert.equal(procesarLatido([hb, "pre"], conTimeout("cargo test"), { ...ctx, env: { PA_RECORTE: v } }).stdout, "", v);
  assert.equal(procesarLatido([hb, "pre"], conTimeout("cargo test"), { ...ctx, env: { PA_RECORTE: "150" }, plataforma: "win32" }).stdout, "");
});

test("PA_RECORTE: el comando reescrito de verdad recorta y conserva el exit code (bash + awk)", { skip: process.platform === "win32" }, () => {
  const { hb, ctx } = entorno({ PA_RECORTE: "3" });
  const r = procesarLatido([hb, "pre"], conTimeout("pytest"), { ...ctx, env: { PA_RECORTE: "3" } });
  const nuevo = JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command.replace("( pytest )", "( seq 1 10; exit 4 )");
  const out = spawnSync("bash", ["-c", nuevo], { encoding: "utf8" });
  assert.equal(out.status, 4);
  assert.match(out.stdout, /^\[recortado por el hook: se omitieron las primeras 7 líneas.*\]\n8\n9\n10\n$/);
});

// --- avisos (post) ---

test("post: aviso de background sólo si la respuesta de un shell EMPIEZA con la frase del harness", () => {
  const { hb, ctx } = entorno();
  const post = (resp: unknown, tool = "Bash") => procesarLatido([hb, "post"], JSON.stringify({ tool_name: tool, tool_input: { command: "x" }, tool_response: resp }), ctx);
  const frase = "Command did not complete within its 120000ms timeout and was moved to the background. Use BashOutput";
  const a = post(frase);
  assert.equal(a.codigo, 0);
  assert.equal(JSON.parse(a.stdout).hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(JSON.parse(a.stdout).hookSpecificOutput.additionalContext, /NO lo pollees/);
  assert.match(JSON.parse(post({ stdout: frase }).stdout).hookSpecificOutput.additionalContext, /NO lo pollees/);
  assert.equal(post("x".repeat(400) + frase).stdout, "", "más allá de los primeros 300 bytes no cuenta");
  assert.equal(post("salida normal").stdout, "");
  assert.equal(post(frase, "Read").stdout, "");
});

test("post: cuenta herramientas en .turnos y avisa cuando quedan 5 o menos", () => {
  const { hb, ctx } = entorno({ PA_MAX_TURNS: "8" });
  const post = () => procesarLatido([hb, "post"], bash("ls"), ctx);
  assert.equal(post().stdout, "");
  assert.equal(readFileSync(`${hb}.turnos`, "utf8"), "1");
  assert.equal(post().stdout, "");
  assert.match(JSON.parse(post().stdout).hookSpecificOutput.additionalContext, /te quedan como mucho 5 turnos/);
  assert.equal(readFileSync(`${hb}.turnos`, "utf8"), "3");
  for (let i = 0; i < 4; i++) post();
  assert.match(JSON.parse(post().stdout).hookSpecificOutput.additionalContext, /te quedan como mucho 0 turnos/);
  assert.equal(post().stdout, "", "pasado el tope ya no avisa");
});

test("post: con PA_MAX_TURNS ausente o no numérico no cuenta; con los dos avisos arma un solo JSON", () => {
  const { hb, ctx } = entorno();
  assert.equal(procesarLatido([hb, "post"], bash("ls"), ctx).stdout, "");
  assert.throws(() => readFileSync(`${hb}.turnos`, "utf8"));
  const x = entorno({ PA_MAX_TURNS: "abc" });
  assert.equal(procesarLatido([x.hb, "post"], bash("ls"), x.ctx).stdout, "");
  const y = entorno({ PA_MAX_TURNS: "1" });
  const frase = "did not complete within its 120000ms timeout and was moved to the background";
  const r = procesarLatido([y.hb, "post"], JSON.stringify({ tool_name: "Bash", tool_input: { command: "x" }, tool_response: frase }), y.ctx);
  const ctxto = JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
  assert.match(ctxto, /NO lo pollees.*te quedan como mucho 0 turnos/);
});

test("pre no cuenta turnos ni avisa", () => {
  const { hb, ctx } = entorno({ PA_MAX_TURNS: "1" });
  assert.equal(procesarLatido([hb, "pre"], conTimeout("ls"), ctx).stdout, "");
  assert.throws(() => readFileSync(`${hb}.turnos`, "utf8"));
});

// --- como proceso ---

test("como proceso: stdin → exit code, stderr y heartbeat", () => {
  const { dir, hb } = entorno();
  const script = path.resolve(import.meta.dirname, "../electron/cli/hook-latido.ts");
  const r = spawnSync(process.execPath, [script, hb, "pre"], { input: bash("git add -A"), encoding: "utf8", env: { ...process.env, PA_RECORTE: "", PA_MAX_TURNS: "" }, cwd: dir });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^BLOQUEADO: nada de 'git add -A/);
  assert.match(readFileSync(hb, "utf8"), /^epoch=\d+\ntool=Bash\nenvuelo=1\ndesc=git add -A\n$/);
  const ok = spawnSync(process.execPath, [script, hb, "pre"], { input: conTimeout("git status"), encoding: "utf8", cwd: dir });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "");
});

// --- hook-comando ---

test("comandoHook bash: sin comillas si no hacen falta, con ellas si hay espacios, y barras hacia adelante en Windows", () => {
  assert.equal(comandoHook({ plataforma: "linux", ejecutable: "node", script: "/o/hook-latido.js", args: ["/s/trama.heartbeat", "pre", "leer"] }), "node /o/hook-latido.js /s/trama.heartbeat pre leer");
  assert.equal(comandoHook({ plataforma: "linux", ejecutable: "/usr/bin/node", script: "/my dir/h.js", args: ["it's"] }), `/usr/bin/node '/my dir/h.js' 'it'\\''s'`);
  assert.equal(
    comandoHook({ plataforma: "win32", ejecutable: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\Trama\\app\\hook-latido.js", args: ["C:\\Users\\u\\AppData\\Local\\Trama\\state\\pa\\trama.heartbeat", "pre"] }),
    `'C:/Program Files/nodejs/node.exe' C:/Trama/app/hook-latido.js C:/Users/u/AppData/Local/Trama/state/pa/trama.heartbeat pre`,
  );
});

test("comandoHook con Electron prende ELECTRON_RUN_AS_NODE en cada shell", () => {
  const base = { ejecutable: "C:\\Trama\\Trama.exe", script: "C:\\Trama\\r\\hook-guardia.js", electron: true };
  assert.equal(comandoHook({ ...base, plataforma: "win32" }), "ELECTRON_RUN_AS_NODE=1 C:/Trama/Trama.exe C:/Trama/r/hook-guardia.js");
  assert.equal(comandoHook({ ...base, plataforma: "win32", shell: "powershell", args: ["a b"] }), `$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\Trama\\Trama.exe' 'C:\\Trama\\r\\hook-guardia.js' 'a b'`);
  assert.equal(comandoHook({ ...base, plataforma: "win32", shell: "cmd", args: ["x"] }), `set ELECTRON_RUN_AS_NODE=1&& "C:\\Trama\\Trama.exe" "C:\\Trama\\r\\hook-guardia.js" "x"`);
  assert.equal(comandoHook({ plataforma: "win32", ejecutable: "node.exe", script: "h.js", shell: "powershell", args: ["it's"] }), `& 'node.exe' 'h.js' 'it''s'`);
});

test("shellDeHooks: bash salvo que PA_HOOK_SHELL pida otro", () => {
  assert.equal(shellDeHooks("win32", {}), "bash");
  assert.equal(shellDeHooks("linux", {}), "bash");
  assert.equal(shellDeHooks("win32", { PA_HOOK_SHELL: "PowerShell" }), "powershell");
  assert.equal(shellDeHooks("win32", { PA_HOOK_SHELL: "cmd" }), "cmd");
  assert.equal(shellDeHooks("win32", { PA_HOOK_SHELL: "zsh" }), "bash");
});

test("hooksDeWorker: la guardia en Bash|PowerShell, el latido pre (con leer) y post en todo", () => {
  const h = hooksDeWorker({ plataforma: "linux", ejecutable: "node", scripts: { latido: "/o/hook-latido.js", guardia: "/o/hook-guardia.js" }, hb: "/s/t.heartbeat" });
  assert.deepEqual(h, {
    PreToolUse: [
      { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: "node /o/hook-guardia.js" }] },
      { hooks: [{ type: "command", command: "node /o/hook-latido.js /s/t.heartbeat pre" }] },
    ],
    PostToolUse: [{ hooks: [{ type: "command", command: "node /o/hook-latido.js /s/t.heartbeat post" }] }],
  });
  const l = hooksDeWorker({ plataforma: "linux", ejecutable: "node", scripts: { latido: "/o/l.js", guardia: "/o/g.js" }, hb: "/s/t.heartbeat", leer: true });
  assert.equal(l.PreToolUse[1].hooks[0].command, "node /o/l.js /s/t.heartbeat pre leer");
  assert.equal(l.PostToolUse[0].hooks[0].command, "node /o/l.js /s/t.heartbeat post");
});
