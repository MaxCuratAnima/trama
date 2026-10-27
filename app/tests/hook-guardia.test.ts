// electron/cli/hook-guardia.ts: push --force, git reset --hard, destinos de backup y los borrados/discos de PowerShell y cmd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluarGuardia, borradoRecursivoFuera, correrGuardia, dentroDe, leerConfigGuardia, rutaConfigGuardia, type ConfigGuardia, type ContextoGuardia } from "../electron/cli/hook-guardia.ts";

const CFG: ConfigGuardia = { montajes: ["D:\\respaldo"] };
const SIN_CFG: ConfigGuardia = { montajes: [] };

const win: ContextoGuardia = { plataforma: "win32", env: {}, home: "C:\\Users\\u", cwd: "C:\\Users\\u\\wt", existe: () => false };

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
const ps = (command: string) => ({ tool_name: "PowerShell", tool_input: { command } });
const bloquea = (e: unknown, ctx = win, cfg = CFG) => evaluarGuardia(e, ctx, cfg).bloquear;

// Cada fila es [comando, ¿bloquea?].
const TABLA: [string, boolean][] = [
  ["git push --force origin main", true],
  ["git push -f", true],
  ["git push origin main", false],
  ["git push --force-with-lease", true],
  ["rm archivo.txt", false],
  ["rm D:\\respaldo\\x", true],
  ["rm ~/backups/a.tar", true],
  ["rm -rf algo/.papelera", true],
  ["mv D:\\respaldo\\a C:\\x\\a", true],
  ["echo x > D:\\respaldo\\a", true],
  ["echo x > 'D:\\respaldo\\a'", true],
  ["ls D:\\respaldo", false],
];

for (const [cmd, esperado] of TABLA) {
  test(`${esperado ? "bloquea" : "pasa"} «${cmd}»`, () => {
    assert.equal(bloquea(ps(cmd)), esperado);
  });
}

test("sin config sólo valen los destinos genéricos", () => {
  assert.equal(bloquea(ps("rm D:\\respaldo\\x"), win, SIN_CFG), false);
  assert.equal(bloquea(ps("rm ~/backups/x"), win, SIN_CFG), true);
});

test("otras herramientas, JSON raro y comandos vacíos pasan", () => {
  assert.equal(bloquea({ tool_name: "Read", tool_input: { command: "git push --force" } }), false);
  assert.equal(bloquea({ tool_name: "PowerShell", tool_input: {} }), false);
  assert.equal(bloquea({ tool_name: "PowerShell" }), false);
  assert.equal(bloquea(null), false);
  assert.equal(bloquea("git push --force"), false);
});

test("el mensaje lleva el patrón y el comando recortado a 300", () => {
  const v = evaluarGuardia(ps("git push --force " + "x".repeat(400)), win, CFG);
  assert.match(v.mensaje, /^GUARD: comando potencialmente destructivo bloqueado/);
  assert.match(v.mensaje, /Patron: .*push/);
  assert.ok(v.mensaje.length < 700);
});

test("git reset --hard se bloquea; reset suave y --soft pasan", () => {
  assert.equal(bloquea(ps("git reset --hard HEAD~1")), true);
  assert.equal(bloquea(ps("git -C C:\\x reset --hard origin/main")), true);
  assert.equal(bloquea(bash("git reset --hard")), true);
  assert.equal(bloquea(ps("git reset --soft HEAD~1")), false);
  assert.equal(bloquea(ps("git reset archivo.txt")), false);
  assert.equal(bloquea(ps("echo reset --hard")), false);
});

// --- PowerShell / cmd ---

const CASOS_WINDOWS_BLOQUEA = [
  "Remove-Item -Recurse -Force C:\\Users\\u\\Documents",
  "Remove-Item C:\\Users\\u\\wt\\..\\otro -Recurse",
  "Remove-Item -Path 'D:\\datos' -Recurse -Force",
  "remove-item -recurse $env:USERPROFILE",
  "Remove-Item -Recurse $HOME\\x",
  "Remove-Item -Recurse -Force ~\\x",
  "Remove-Item -Recurse -Force",
  "Get-ChildItem C:\\x | Remove-Item -Recurse",
  "ri -r C:\\x",
  "rm -Recurse C:\\x",
  "del -Recurse C:\\x",
  "rd /s /q C:\\Users",
  "rd /s /q %USERPROFILE%",
  "rmdir /S /Q D:\\datos",
  "del /s /q C:\\*.*",
  "del /f /s /q D:\\x",
  'cmd /c "rd /s /q C:\\x"',
  "cmd /c rmdir /s /q ..\\afuera",
  "echo hecho && rd /s /q C:\\Windows",
  "Remove-Item -Recurse C:\\Users\\u\\wt",
  "Remove-Item -Recurse C:\\",
  "Format-Volume -DriveLetter D",
  "Clear-Disk -Number 1 -RemoveData",
  "Remove-Partition -DiskNumber 1 -PartitionNumber 2",
  "diskpart /s script.txt",
  "format D: /q",
  "vssadmin delete shadows /all",
  "cipher /w:C:\\",
  "git push --force",
];
for (const c of CASOS_WINDOWS_BLOQUEA) {
  test(`Windows bloquea «${c}»`, () => {
    assert.equal(bloquea(ps(c), win), true);
    assert.equal(bloquea(bash(c), win), true);
  });
}

const CASOS_WINDOWS_PASA = [
  "Remove-Item -Recurse -Force .\\node_modules",
  "Remove-Item -Recurse build",
  "Remove-Item .\\a.txt",
  "Remove-Item C:\\Users\\u\\wt\\dist -Recurse",
  "Remove-Item 'C:\\Users\\u\\wt\\dist cache' -Recurse",
  "rd /s /q dist",
  "rmdir /s /q build\\out",
  "del /s /q *.tmp",
  "del archivo.txt",
  "rd carpeta-vacia",
  'cmd /c "rd /s /q dist"',
  "Get-ChildItem -Recurse",
  "git rm -r dir",
  "echo rd /s /q C:\\x",
  "Write-Host 'Remove-Item -Recurse C:\\x'",
  "dir C:\\Users\\u",
  "cd /d C:\\x && dir",
  "git status",
];
for (const c of CASOS_WINDOWS_PASA) {
  test(`Windows pasa «${c}»`, () => {
    assert.equal(bloquea(ps(c), win), false);
  });
}

test("el mensaje de un borrado recursivo dice dónde sí se puede", () => {
  const v = evaluarGuardia(ps("Remove-Item -Recurse C:\\x"), win, SIN_CFG);
  assert.equal(v.bloquear, true);
  assert.match(v.mensaje, /C:\\Users\\u\\wt/);
});

test("dentroDe: relativas, absolutas, .., variables y la raíz de la sesión", () => {
  const w = (r: string) => dentroDe("win32", "C:\\Users\\u\\wt", r);
  assert.equal(w(".\\a"), true);
  assert.equal(w("a\\b"), true);
  assert.equal(w("c:\\users\\U\\WT\\a"), true, "Windows no distingue mayúsculas");
  assert.equal(w("C:/Users/u/wt/a"), true);
  assert.equal(w("..\\a"), false);
  assert.equal(w("a\\..\\..\\b"), false);
  assert.equal(w("."), false);
  assert.equal(w("C:\\Users\\u\\wt"), false);
  assert.equal(w("C:\\Users\\u\\wtx"), false);
  assert.equal(w("$env:TEMP\\x"), false);
  assert.equal(w("%TEMP%\\x"), false);
  assert.equal(w("D:\\a"), false);
});

test("borradoRecursivoFuera devuelve el trozo ofensor", () => {
  assert.equal(borradoRecursivoFuera("win32", "C:\\wt", "dir && rd /s /q C:\\x"), "rd /s /q C:\\x");
  assert.equal(borradoRecursivoFuera("win32", "C:\\wt", "dir && rd /s /q x"), null);
});

// --- config y protocolo ---

test("rutaConfigGuardia: TRAMA_GUARD_CONFIG o %APPDATA%\\Trama", () => {
  assert.equal(rutaConfigGuardia("win32", { TRAMA_GUARD_CONFIG: "C:\\x\\g.json" }, "C:\\Users\\u"), "C:\\x\\g.json");
  assert.equal(rutaConfigGuardia("win32", { APPDATA: "C:\\A" }, "C:\\Users\\u"), "C:\\A\\Trama\\guard.json");
});

test("leerConfigGuardia: lee el JSON, ignora lo que no es lista y tolera archivo roto o ausente", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "guardia-"));
  const f = path.join(d, "guard.json");
  writeFileSync(f, JSON.stringify({ montajes: ["A", 3, ""] }));
  assert.deepEqual(leerConfigGuardia(f), { montajes: ["A"] });
  writeFileSync(f, JSON.stringify({ montajes: "no" }));
  assert.deepEqual(leerConfigGuardia(f), SIN_CFG);
  writeFileSync(f, "{roto");
  assert.deepEqual(leerConfigGuardia(f), SIN_CFG);
  assert.deepEqual(leerConfigGuardia(path.join(d, "no-existe.json")), SIN_CFG);
});

test("correrGuardia: exit 2 con el motivo, 0 si pasa o si el JSON es basura", () => {
  const prev = process.env.TRAMA_GUARD_CONFIG;
  process.env.TRAMA_GUARD_CONFIG = "C:\\no\\existe.json";
  try {
    const mal = correrGuardia(JSON.stringify(ps("git push --force")));
    assert.equal(mal.codigo, 2);
    assert.match(mal.stderr, /^GUARD:/);
    assert.deepEqual(correrGuardia(JSON.stringify(ps("ls"))), { codigo: 0, stderr: "" });
    assert.deepEqual(correrGuardia("no es json"), { codigo: 0, stderr: "" });
    assert.deepEqual(correrGuardia(""), { codigo: 0, stderr: "" });
  } finally {
    if (prev === undefined) delete process.env.TRAMA_GUARD_CONFIG;
    else process.env.TRAMA_GUARD_CONFIG = prev;
  }
});

test("como proceso: stdin → exit code y stderr, con el cwd del JSON", () => {
  const script = path.resolve(import.meta.dirname, "../electron/cli/hook-guardia.ts");
  const cwd = os.tmpdir();
  const correr = (e: unknown) =>
    spawnSync(process.execPath, [script], { input: JSON.stringify(e), encoding: "utf8", env: { ...process.env, TRAMA_GUARD_CONFIG: "C:\\no\\existe.json", TRAMA_GUARD_DIR: "" } });
  const a = correr({ ...ps("git push --force"), cwd });
  assert.equal(a.status, 2);
  assert.match(a.stderr, /GUARD:/);
  assert.equal(correr({ ...ps("git status"), cwd }).status, 0);
  assert.equal(correr({ ...ps("Remove-Item -Recurse build\\out"), cwd }).status, 0, "dentro del cwd se puede");
});

test("docker-guard.py: si TRAMA_GUARD_DIR lo trae y bloquea (exit 2), el motivo vuelve; sin docker en el comando ni se llama", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "guardia-docker-"));
  writeFileSync(path.join(d, "docker-guard.py"), "import sys\nsys.stderr.write('GUARD docker falso')\nsys.exit(2)\n");
  const ctx = { ...win, env: { TRAMA_GUARD_DIR: d } };
  const v = evaluarGuardia(ps("docker run --privileged x"), ctx, SIN_CFG);
  if (spawnSync("python", ["-V"]).status !== 0) return;
  assert.equal(v.bloquear, true);
  assert.match(v.mensaje, /GUARD docker falso/);
  assert.equal(evaluarGuardia(ps("ls"), ctx, SIN_CFG).bloquear, false);
});
