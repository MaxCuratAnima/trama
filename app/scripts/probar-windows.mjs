// Prueba de humo de los .cmd de Trama en Windows: corre pa --estado, tablero resumen, proyecto-ruta --listar y
// trama-estado --json y cuenta si respondieron. Sólo lee (no cambia pendientes ni proyectos).
//   node scripts/probar-windows.mjs                 la carpeta bin de dist-installer\win-unpacked, o de la app instalada, o motor\bin-win
//   node scripts/probar-windows.mjs --bin <carpeta> la carpeta con los .cmd (resources\bin)
//   node scripts/probar-windows.mjs --sin-node      el PATH sin node: los .cmd corren con el exe de Electron (como en un PC sin node)
// Sale con 0 si anduvieron los cuatro, 1 si falla alguno, 2 si no es Windows o no encuentra los .cmd.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(aqui, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

if (process.platform !== "win32") {
  console.error("probar-windows: esto prueba los .cmd, corrélo en Windows (cmd o PowerShell).");
  process.exit(2);
}

const candidatas = [
  valor("--bin"),
  path.join(app, "dist-installer", "win-unpacked", "resources", "bin"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Trama", "resources", "bin"),
  path.join(app, "..", "motor", "bin-win"),
].filter(Boolean);
const bin = candidatas.find((d) => existsSync(path.join(d, "pa.cmd")));
if (!bin) {
  console.error(`probar-windows: no encuentro pa.cmd en:\n  ${candidatas.join("\n  ")}`);
  process.exit(2);
}
console.log(`carpeta de los .cmd: ${path.resolve(bin)}`);

const env = { ...process.env };
const clave = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "Path";
const sys32 = path.join(env.SystemRoot ?? "C:\\Windows", "System32");
env[clave] = flag("--sin-node") ? `${path.resolve(bin)};${sys32}` : `${path.resolve(bin)};${env[clave] ?? ""}`;
if (flag("--sin-node")) console.log("PATH sin node: los .cmd tienen que caer al exe de Electron");

const pruebas = [
  { cmd: "pa.cmd", args: ["--estado"] },
  { cmd: "tablero.cmd", args: ["resumen"] },
  { cmd: "proyecto-ruta.cmd", args: ["--listar"] },
  { cmd: "trama-estado.cmd", args: ["--json"], json: true },
];

let mal = 0;
for (const p of pruebas) {
  const linea = `"${path.join(path.resolve(bin), p.cmd)}" ${p.args.join(" ")}`;
  const r = spawnSync(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${linea}"`], { env, encoding: "utf8", timeout: 60000, windowsVerbatimArguments: true });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  let motivo = r.error ? String(r.error.message) : r.status !== 0 ? `salió con ${r.status}` : "";
  if (!motivo && p.json) {
    try {
      JSON.parse(r.stdout);
    } catch {
      motivo = "la salida no es JSON";
    }
  }
  console.log(`${motivo ? "FALLA" : "ok   "} ${p.cmd} ${p.args.join(" ")}${motivo ? ` (${motivo})` : ""}`);
  console.log(salida.split(/\r?\n/).slice(0, motivo ? 8 : 3).map((l) => `      ${l}`).join("\n"));
  if (motivo) mal++;
}
console.log(mal ? `\n${mal} de ${pruebas.length} fallaron` : `\nlos ${pruebas.length} andan`);
process.exit(mal ? 1 : 0);
