// electron/cli/hook-guardia.ts: lo que bloquea destructive-guard.sh (misma tabla de casos), más PowerShell/cmd y git reset --hard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluarGuardia, borradoRecursivoFuera, correrGuardia, dentroDe, leerConfigGuardia, rutaConfigGuardia, type ConfigGuardia, type ContextoGuardia } from "../electron/cli/hook-guardia.ts";

const CFG: ConfigGuardia = {
  etiquetas_usb: ["BACKUPS-X"],
  montajes: ["/mnt/respaldo"],
  congelado: { etiqueta: "CONGELADO-X", marcador: "~/CONGELADO", patrones: [String.raw`\busb-healthcheck\b`] },
};
const SIN_CFG: ConfigGuardia = { etiquetas_usb: [], montajes: [], congelado: null };

const linux: ContextoGuardia = { plataforma: "linux", env: {}, home: "/home/u", cwd: "/home/u/wt", existe: () => false };
const win: ContextoGuardia = { plataforma: "win32", env: {}, home: "C:\\Users\\u", cwd: "C:\\Users\\u\\wt", existe: () => false };
const congelado: ContextoGuardia = { ...linux, existe: (r) => r === "/home/u/CONGELADO" };

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
const ps = (command: string) => ({ tool_name: "PowerShell", tool_input: { command } });
const bloquea = (e: unknown, ctx = linux, cfg = CFG) => evaluarGuardia(e, ctx, cfg).bloquear;

// La tabla del .sh: cada fila es [comando, ¿bloquea?].
const TABLA_SH: [string, boolean][] = [
  ["rm -rf /", true],
  ["rm -rf ~", true],
  ["rm -rf $HOME/algo", true],
  ["rm -r -f build", false],
  ["rm -fr build", true],
  ["rm -rf node_modules", true],
  ["rm -r ~/.config/foo", true],
  ["rm archivo.txt", false],
  ["rm -r carpeta", false],
  ["git rm -rf algo", true],
  ["dd if=/dev/zero of=/dev/sda", true],
  ["dd if=a of=/dev/nvme0n1 bs=1M", true],
  ["echo hola > /dev/sda", true],
  ["echo hola > /dev/null", false],
  ["mkfs.ext4 /dev/sdb1", true],
  ["wipefs -a /dev/sdb", true],
  ["fdisk /dev/sda", false],
  ["fdisk -l /dev/sda", false],
  ["shred -u secreto", true],
  ["truncate -s 0 log", true],
  ["truncate -s 10 log", false],
  ["pacman -Rns algo", true],
  ["pacman -S algo", false],
  ["yay -R algo", true],
  ["paru -Rns algo", true],
  ["git push --force origin main", true],
  ["git push -f", true],
  ["git push origin main", false],
  ["git push --force-with-lease", true],
  ["chmod -R 777 /", true],
  ["chmod -R 755 ./dist", false],
  ["chown -R u:u /", true],
  [":(){ :|:& };:", true],
  ["ls /run/media/u/USB", false],
  ["cat /run/media/u/USB/a > /tmp/x", false],
  ["rm /run/media/u/USB/backup.tar", true],
  ["mv /run/media/u/USB/a /tmp/a", true],
  ["rm /mnt/respaldo/x", true],
  ["rm ~/backups/a.tar", true],
  ["rm /home/u/backups/a.tar", true],
  ["rm -rf algo/.papelera", true],
  ["find /run/media/u/USB -name '*.tar' -delete", true],
  ["find /run/media/u/USB -name '*.tar'", false],
  ["rsync -a --delete src/ /run/media/u/USB/dst/", true],
  ["rsync -a src/ /run/media/u/USB/dst/", false],
  ["echo x > /run/media/u/USB/a", true],
  ["echo x > '/run/media/u/USB/a'", true],
  ["dd if=a of=/run/media/u/USB/img", true],
  ["udisksctl unmount -b /dev/disk/by-label/BACKUPS-X", true],
  ["udisksctl power-off -b /dev/disk/by-label/BACKUPS-X", true],
  ["udisksctl unmount -b /dev/sdz1", false],
  ["CARGO_TARGET_DIR=/tmp/t cargo test", true],
  ["CARGO_TARGET_DIR=\"/dev/shm/t\" cargo build", true],
  ["CARGO_BUILD_TARGET_DIR='$TMPDIR/t' cargo build", true],
  ["cargo build --target-dir /tmp/t", true],
  ["cargo build --target-dir=/dev/shm/t", true],
  ["CARGO_TARGET_DIR=$HOME/.cache/x-target cargo test", false],
  ["ls /tmp", false],
];

for (const [cmd, esperado] of TABLA_SH) {
  test(`.sh: ${esperado ? "bloquea" : "pasa"} «${cmd}»`, () => {
    assert.equal(bloquea(bash(cmd)), esperado);
  });
}

test("congelado: con el marcador puesto bloquea el montaje y los patrones de la config; sin marcador pasa", () => {
  assert.equal(bloquea(bash("udisksctl mount -b /dev/disk/by-label/CONGELADO-X"), congelado), true);
  assert.equal(bloquea(bash("sudo mount LABEL=CONGELADO-X /mnt/z"), congelado), true);
  assert.equal(bloquea(bash("bash usb-healthcheck.sh"), congelado), true);
  assert.equal(bloquea(bash("udisksctl mount -b /dev/disk/by-label/CONGELADO-X"), linux), false);
  assert.equal(bloquea(bash("bash usb-healthcheck.sh"), linux), false);
});

test("congelado: `bash -n x.sh` solo queda exento; encadenado con algo no", () => {
  const cfg: ConfigGuardia = { ...CFG, congelado: { etiqueta: "CONGELADO-X", marcador: "~/CONGELADO", patrones: [String.raw`\bhealth\b`] } };
  assert.equal(bloquea(bash("bash -n health.sh"), congelado, cfg), false);
  assert.equal(bloquea(bash("bash -n x.sh; bash health.sh"), congelado, cfg), true);
});

test("congelado: TRAMA_GUARD_FORZAR_CONGELADO=1 lo agrega aunque no haya marcador", () => {
  const forzado = { ...linux, env: { TRAMA_GUARD_FORZAR_CONGELADO: "1" } };
  assert.equal(bloquea(bash("bash usb-healthcheck.sh"), forzado), true);
});

test("sin config sólo valen los destinos genéricos", () => {
  assert.equal(bloquea(bash("rm /mnt/respaldo/x"), linux, SIN_CFG), false);
  assert.equal(bloquea(bash("rm /run/media/u/USB/x"), linux, SIN_CFG), true);
  assert.equal(bloquea(bash("udisksctl unmount -b /dev/disk/by-label/BACKUPS-X"), linux, SIN_CFG), false);
});

test("otras herramientas, JSON raro y comandos vacíos pasan", () => {
  assert.equal(bloquea({ tool_name: "Read", tool_input: { command: "rm -rf /" } }), false);
  assert.equal(bloquea({ tool_name: "Bash", tool_input: {} }), false);
  assert.equal(bloquea({ tool_name: "Bash" }), false);
  assert.equal(bloquea(null), false);
  assert.equal(bloquea("rm -rf /"), false);
});

test("el mensaje lleva el patrón y el comando recortado a 300", () => {
  const v = evaluarGuardia(bash("git push --force " + "x".repeat(400)), linux, CFG);
  assert.match(v.mensaje, /^GUARD: comando potencialmente destructivo bloqueado/);
  assert.match(v.mensaje, /Patron: .*push/);
  assert.ok(v.mensaje.length < 700);
});

test("git reset --hard se bloquea; reset suave y --soft pasan", () => {
  assert.equal(bloquea(bash("git reset --hard HEAD~1")), true);
  assert.equal(bloquea(bash("git -C /x reset --hard origin/main")), true);
  assert.equal(bloquea(ps("git reset --hard")), true);
  assert.equal(bloquea(bash("git reset --soft HEAD~1")), false);
  assert.equal(bloquea(bash("git reset archivo.txt")), false);
  assert.equal(bloquea(bash("echo reset --hard")), false);
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
  assert.equal(dentroDe("linux", "/home/u/wt", "build/x"), true);
  assert.equal(dentroDe("linux", "/home/u/wt", "/home/u/otro"), false);
});

test("borradoRecursivoFuera devuelve el trozo ofensor", () => {
  assert.equal(borradoRecursivoFuera("win32", "C:\\wt", "dir && rd /s /q C:\\x"), "rd /s /q C:\\x");
  assert.equal(borradoRecursivoFuera("win32", "C:\\wt", "dir && rd /s /q x"), null);
});

// --- config y protocolo ---

test("rutaConfigGuardia: TRAMA_GUARD_CONFIG, XDG en Linux, %APPDATA% en Windows", () => {
  assert.equal(rutaConfigGuardia("linux", { TRAMA_GUARD_CONFIG: "/x/g.json" }, "/h"), "/x/g.json");
  assert.equal(rutaConfigGuardia("linux", {}, "/h"), "/h/.config/trama/guard.json");
  assert.equal(rutaConfigGuardia("linux", { XDG_CONFIG_HOME: "/xdg" }, "/h"), "/xdg/trama/guard.json");
  assert.equal(rutaConfigGuardia("win32", { APPDATA: "C:\\A" }, "C:\\Users\\u"), "C:\\A\\Trama\\guard.json");
});

test("leerConfigGuardia: lee el JSON, ignora lo que no es lista y tolera archivo roto o ausente", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "guardia-"));
  const f = path.join(d, "guard.json");
  writeFileSync(f, JSON.stringify({ etiquetas_usb: ["A", 3, ""], montajes: "no", congelado: { etiqueta: "C", marcador: "~/M", patrones: ["x"] } }));
  assert.deepEqual(leerConfigGuardia(f), { etiquetas_usb: ["A"], montajes: [], congelado: { etiqueta: "C", marcador: "~/M", patrones: ["x"] } });
  writeFileSync(f, "{roto");
  assert.deepEqual(leerConfigGuardia(f), SIN_CFG);
  assert.deepEqual(leerConfigGuardia(path.join(d, "no-existe.json")), SIN_CFG);
});

test("correrGuardia: exit 2 con el motivo, 0 si pasa o si el JSON es basura", () => {
  const prev = process.env.TRAMA_GUARD_CONFIG;
  process.env.TRAMA_GUARD_CONFIG = "/no/existe.json";
  try {
    const mal = correrGuardia(JSON.stringify(bash("rm -rf /")));
    assert.equal(mal.codigo, 2);
    assert.match(mal.stderr, /^GUARD:/);
    assert.deepEqual(correrGuardia(JSON.stringify(bash("ls"))), { codigo: 0, stderr: "" });
    assert.deepEqual(correrGuardia("no es json"), { codigo: 0, stderr: "" });
    assert.deepEqual(correrGuardia(""), { codigo: 0, stderr: "" });
  } finally {
    if (prev === undefined) delete process.env.TRAMA_GUARD_CONFIG;
    else process.env.TRAMA_GUARD_CONFIG = prev;
  }
});

test("como proceso: stdin → exit code y stderr, con el cwd del JSON", () => {
  const script = path.resolve(import.meta.dirname, "../electron/cli/hook-guardia.ts");
  const correr = (e: unknown) =>
    spawnSync(process.execPath, [script], { input: JSON.stringify(e), encoding: "utf8", env: { ...process.env, TRAMA_GUARD_CONFIG: "/no/existe.json", TRAMA_GUARD_DIR: "" } });
  const a = correr({ ...bash("git push --force"), cwd: "/tmp" });
  assert.equal(a.status, 2);
  assert.match(a.stderr, /GUARD:/);
  assert.equal(correr({ ...bash("git status"), cwd: "/tmp" }).status, 0);
  assert.equal(correr({ ...bash("rm -r build/out"), cwd: "/tmp" }).status, 0, "rm -r sin -f pasa como en el .sh");
});

test("docker-guard.py: si TRAMA_GUARD_DIR lo trae y bloquea (exit 2), el motivo vuelve; sin docker en el comando ni se llama", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "guardia-docker-"));
  writeFileSync(path.join(d, "docker-guard.py"), "import sys\nsys.stderr.write('GUARD docker falso')\nsys.exit(2)\n");
  const ctx = { ...linux, env: { TRAMA_GUARD_DIR: d } };
  const v = evaluarGuardia(bash("docker run --privileged x"), ctx, SIN_CFG);
  if (spawnSync("python3", ["-V"]).status !== 0) return;
  assert.equal(v.bloquear, true);
  assert.match(v.mensaje, /GUARD docker falso/);
  assert.equal(evaluarGuardia(bash("ls"), ctx, SIN_CFG).bloquear, false);
});
