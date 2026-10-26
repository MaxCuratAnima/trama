// electron/procesos.ts: arranque de un pid, matar un árbol y el shell de un comando, en las dos plataformas.
// Cada rama se prueba con la plataforma y los efectos inyectados; lo que necesita Windows de verdad se saltea si no lo es.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { esWindows, estadoDeProceso, grupoPropio, inicioDeProceso, inicioDeProcesoSync, matarArbol, shellDe, deStat } from "../electron/procesos.ts";

const STAT = "123 (mi (proc) raro) S 1 123 123 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10 18446744073709551615";

test("deStat: estado, ppid y arranque aunque el nombre tenga paréntesis", () => {
  assert.deepEqual(deStat(STAT), { estado: "S", ppid: 1, arranque: "987654" });
});

test("Linux: el arranque sale de /proc/<pid>/stat", async () => {
  const leer = async (r: string) => (r === "/proc/123/stat" ? STAT : Promise.reject(new Error("ENOENT")));
  assert.equal(await inicioDeProceso(123, { plataforma: "linux", leer }), "987654");
  assert.equal(await inicioDeProceso(124, { plataforma: "linux", leer }), null);
  assert.equal(inicioDeProcesoSync(123, { plataforma: "linux", leerSync: () => STAT }), "987654");
  assert.equal(await inicioDeProceso(0, { plataforma: "linux", leer }), null);
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

test("matarArbol en Linux: señal al grupo (-pid), TERM o KILL; ESRCH no lanza", () => {
  const vistas: [number, string][] = [];
  const kill = (p: number, s: string) => void vistas.push([p, s]);
  assert.equal(matarArbol(500, false, { plataforma: "linux", kill }), true);
  assert.equal(matarArbol(500, true, { plataforma: "linux", kill }), true);
  assert.deepEqual(vistas, [[-500, "SIGTERM"], [-500, "SIGKILL"]]);
  assert.equal(matarArbol(500, true, { plataforma: "linux", kill: () => { throw new Error("ESRCH"); } }), false);
  assert.equal(matarArbol(undefined, true, { plataforma: "linux", kill }), false);
  assert.equal(matarArbol(1, true, { plataforma: "linux", kill }), false);
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

test("shellDe: bash -c en Linux, cmd /d /s /c con comillas y argumentos literales en Windows", () => {
  assert.deepEqual(shellDe("npm test", "linux"), { bin: "bash", args: ["-c", "npm test"], opciones: {} });
  const w = shellDe('echo "hola" && dir', "win32", {});
  assert.equal(w.bin, "cmd.exe");
  assert.deepEqual(w.args, ["/d", "/s", "/c", '"echo "hola" && dir"']);
  assert.equal(w.opciones.windowsVerbatimArguments, true);
  assert.equal(shellDe("x", "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }).bin, "C:\\Windows\\System32\\cmd.exe");
});

test("grupoPropio: detached sólo fuera de Windows, siempre sin ventana", () => {
  assert.deepEqual(grupoPropio("linux"), { detached: true, windowsHide: true });
  assert.deepEqual(grupoPropio("win32"), { detached: false, windowsHide: true });
  assert.equal(esWindows("win32"), true);
  assert.equal(esWindows("linux"), false);
});

test("real, Linux: el arranque de este proceso es estable y matarArbol corta un grupo de verdad", { skip: process.platform === "win32" }, async () => {
  const a = await inicioDeProceso(process.pid);
  assert.ok(a && /^\d+$/.test(a));
  assert.equal(inicioDeProcesoSync(process.pid), a);
  const h = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const cierre = new Promise((ok) => h.once("exit", (_c, s) => ok(s)));
  assert.equal(matarArbol(h.pid, false), true);
  assert.equal(await cierre, "SIGTERM");
});

test("real, Windows: el arranque de este proceso es un número estable y un pid que no existe da null", { skip: process.platform !== "win32" }, async () => {
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
