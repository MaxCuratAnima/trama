// electron/procesos.ts: arranque de un pid, matar un árbol y el shell de un comando.
// Los efectos se inyectan; los casos "real" corren contra este Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { esWindows, estadoDeProceso, grupoPropio, inicioDeProceso, inicioDeProcesoSync, matarArbol, shellDe, deStat, comandoEjecutable, esBatch } from "../electron/procesos.ts";

const STAT = "123 (mi (proc) raro) S 1 123 123 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10 18446744073709551615";

test("deStat: estado, ppid y arranque aunque el nombre tenga paréntesis", () => {
  assert.deepEqual(deStat(STAT), { estado: "S", ppid: 1, arranque: "987654" });
});

test("Windows: existe el pid y PowerShell da el StartTime; un pid reusado da otro arranque", async () => {
  const llamadas: { bin: string; args: string[]; o: unknown }[] = [];
  let ticks = "639000000000000000\r\n";
  const d = {
    plataforma: "win32" as const,
    existe: () => {},
    correr: async (bin: string, args: string[], o: unknown) => (llamadas.push({ bin, args, o }), ticks),
  };
  const a = await inicioDeProceso(4321, d);
  assert.equal(a, "639000000000000000");
  assert.equal(llamadas[0].bin, "powershell");
  assert.ok(llamadas[0].args.includes("-NoProfile"));
  assert.match(llamadas[0].args.join(" "), /Get-Process -Id 4321/);
  assert.equal((llamadas[0].o as { windowsHide: boolean }).windowsHide, true);
  assert.ok((llamadas[0].o as { timeout: number }).timeout > 0);
  ticks = "639000000000999999";
  assert.notEqual(await inicioDeProceso(4321, d), a);
  const e = await estadoDeProceso(4321, d);
  assert.equal(e?.estado, "");
});

test("Windows: pid inexistente, PowerShell que falla o salida rara dan null", async () => {
  const base = { plataforma: "win32" as const };
  assert.equal(await inicioDeProceso(9, { ...base, existe: () => { throw new Error("ESRCH"); }, correr: async () => "1" }), null);
  assert.equal(await inicioDeProceso(9, { ...base, existe: () => {}, correr: async () => { throw new Error("timeout"); } }), null);
  assert.equal(await inicioDeProceso(9, { ...base, existe: () => {}, correr: async () => "no es un número" }), null);
  assert.equal(inicioDeProcesoSync(9, { ...base, existe: () => {}, correrSync: () => "42\n" }), "42");
  assert.equal(inicioDeProcesoSync(9, { ...base, existe: () => {}, correrSync: () => { throw new Error("x"); } }), null);
});

test("matarArbol en Windows: taskkill /PID n /T, con /F si se fuerza, sin ventana", () => {
  const llamadas: { bin: string; args: string[]; o: any }[] = [];
  const correr = async (bin: string, args: string[], o: unknown) => (llamadas.push({ bin, args, o }), "");
  assert.equal(matarArbol(700, false, { plataforma: "win32", correr }), true);
  assert.equal(matarArbol(700, true, { plataforma: "win32", correr: async (b, a, o) => (llamadas.push({ bin: b, args: a, o }), Promise.reject(new Error("no existe"))) }), true);
  assert.deepEqual(llamadas[0].args, ["/PID", "700", "/T"]);
  assert.deepEqual(llamadas[1].args, ["/PID", "700", "/T", "/F"]);
  assert.equal(llamadas[0].bin, "taskkill");
  assert.equal(llamadas[0].o.windowsHide, true);
});

test("shellDe: cmd /d /s /c con comillas y argumentos literales", () => {
  const w = shellDe('echo "hola" && dir', "win32", {});
  assert.equal(w.bin, "cmd.exe");
  assert.deepEqual(w.args, ["/d", "/s", "/c", '"echo "hola" && dir"']);
  assert.equal(w.opciones.windowsVerbatimArguments, true);
  assert.equal(shellDe("x", "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }).bin, "C:\\Windows\\System32\\cmd.exe");
});

test("grupoPropio: nunca detached, siempre sin ventana", () => {
  assert.deepEqual(grupoPropio("win32"), { detached: false, windowsHide: true });
  assert.equal(esWindows("win32"), true);
});

test("real: el arranque de este proceso es un número estable y un pid que no existe da null", async () => {
  const a = await inicioDeProceso(process.pid);
  assert.ok(a && /^\d+$/.test(a));
  assert.equal(await inicioDeProceso(process.pid), a);
  assert.equal(await inicioDeProceso(0x7ffffff0), null);
  const h = spawn("cmd.exe", ["/c", "ping -n 30 127.0.0.1"], { stdio: "ignore", windowsHide: true });
  const cierre = new Promise((ok) => h.once("exit", ok));
  matarArbol(h.pid, true);
  await cierre;
});

test("guionTerminalWindows: corre con call, anota el rc por .tmp y espera una tecla si falló", async () => {
  const { guionTerminalWindows } = await import("../electron/procesos.ts");
  const g = guionTerminalWindows(["C:\\Users\\Ana\\.local\\bin\\cuentas.cmd", "login", "100%"], "C:\\Temp\\x\\rc");
  const l = g.split("\r\n");
  assert.equal(l[1], 'call "C:\\Users\\Ana\\.local\\bin\\cuentas.cmd" "login" "100%%"');
  assert.match(g, /move \/y "C:\\Temp\\x\\rc\.tmp" "C:\\Temp\\x\\rc"/);
  assert.match(g, /if not "%rc%"=="0" .*pause/);
});

test("comandoEjecutable: en Windows un .cmd/.bat va por cmd /d /s /c con la línea armada; lo demás queda igual", () => {
  const env = { ComSpec: "C:\\Windows\\System32\\cmd.exe" };
  const c = comandoEjecutable("C:\\Program Files\\Trama\\bin\\pa.cmd", ["--hilos", "--json"], "win32", env);
  assert.equal(c.file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(c.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(c.args[3], '""C:\\Program Files\\Trama\\bin\\pa.cmd" ^^^"--hilos^^^" ^^^"--json^^^""');
  assert.deepEqual(c.opciones, { windowsVerbatimArguments: true });
  assert.equal(comandoEjecutable("x.BAT", [], "win32", {}).file, "cmd.exe");
  // .exe y sin extensión: tal cual
  assert.deepEqual(comandoEjecutable("C:\\bin\\agy.exe", ["a b"], "win32", env), { file: "C:\\bin\\agy.exe", args: ["a b"], opciones: {} });
  assert.deepEqual(comandoEjecutable("git", ["log"], "win32", env), { file: "git", args: ["log"], opciones: {} });
  assert.equal(esBatch("pa.cmd", "win32"), true);
});

test("comandoEjecutable: una tarea con comillas, &, %PATH% y espacios no deja nada suelto para cmd", () => {
  const tarea = 'arregla "esto" & aquello | otro > x < y ^ z con %PATH% y   espacios';
  const c = comandoEjecutable("pa.cmd", ["--tarea", tarea, "termina\\", "a\nb"], "win32", {});
  const linea = c.args[3];
  // cada metacaracter de cmd va con ^ dos veces (cmd lo lee al armar la línea y otra vez cuando el .cmd reenvía %*)
  const sinEscapar = linea.replace(/\^\^\^./g, "");
  assert.doesNotMatch(sinEscapar.replace(/^"/, "").replace(/"$/, "").replace('"pa.cmd"', ""), /[&|<>%^"]/);
  assert.match(linea, /\^\^\^%PATH\^\^\^%/);
  assert.match(linea, /\^\^\^&/);
  assert.ok(!linea.includes("\n"), "los saltos de línea no pasan por cmd: van como espacio");
  assert.match(linea, /a\^\^\^ b/);
  // las comillas de la tarea van con barra (como las lee el runtime de C) y el backslash final se duplica
  assert.match(linea, /\\\^\^\^"esto/);
  assert.match(linea, /termina\\\\\^\^\^"/);
});
