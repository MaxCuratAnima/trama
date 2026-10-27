// Cuánto tarda el reinicio por un build nuevo, paso por paso (marcas de electron/reinicio-marcas.ts).
//   node scripts/medir-reinicio.mjs [archivo]       lee un archivo de marcas (por defecto el de $HILOS_STATE, que es
//                                                   el de la trama de verdad: sólo lectura) e imprime una tabla.
//   node scripts/medir-reinicio.mjs --simular [ms…] corre scripts/prueba-motor.mjs con una unidad de mentira que
//                                                   relanza el motor a los `ms` de caído (por defecto 2000 y 500) y
//                                                   imprime la tabla de cada una. Tras build; abre de a una app.
// Sólo imprime números. Nada se instala ni se toca de la trama de verdad.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");

/** La corrida más reciente del archivo: empieza en el último `inicio`. */
function corrida(texto) {
  let c = null;
  for (const l of texto.split("\n")) {
    const [t, quien, pid, paso, extra] = l.trim().split(/\s+/);
    if (!paso || !Number.isFinite(Number(t))) continue;
    if (paso === "inicio") c = { via: extra ?? "?", marcas: [] };
    if (c) c.marcas.push({ t: Number(t), quien, pid, paso });
  }
  return c;
}

function tabla(titulo, texto) {
  const c = corrida(texto);
  if (!c) return console.log(`${titulo}: sin marcas`);
  const ms = [...c.marcas].sort((a, b) => a.t - b.t);
  const t0 = ms[0].t;
  console.log(`${titulo} (vía ${c.via})`);
  ms.forEach((m, i) => console.log(`  +${String(m.t - t0).padStart(5)} ms  (${String(i ? m.t - ms[i - 1].t : 0).padStart(5)})  ${m.quien.padEnd(8)} ${m.paso}`));
  const lista = ms.find((m) => m.paso === "lista");
  console.log(`  ${lista ? `reinicio completo: ${lista.t - t0} ms` : "no llegó a `lista`"}`);
}

const args = process.argv.slice(2);
if (args[0] === "--simular") {
  const restarts = args.slice(1).map(Number).filter(Boolean);
  for (const r of restarts.length ? restarts : [2000, 500]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-medir-reinicio-"));
    const salida = path.join(dir, "marcas");
    const env = { ...process.env, RESTART_MS: String(r), MARCAS_SALIDA: salida };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawnSync(process.execPath, [path.join(raiz, "scripts/prueba-motor.mjs")], { env, encoding: "utf8" });
    try {
      tabla(`unidad de mentira, RestartSec ${r / 1000} s`, readFileSync(salida, "utf8"));
    } catch {
      console.log(`unidad de mentira, RestartSec ${r / 1000} s: la prueba no dejó marcas (salió ${p.status})`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  const archivo = args[0] ?? path.join(process.env.HILOS_STATE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Trama", "state", "hilos"), "reinicio-marcas");
  try {
    tabla(archivo, readFileSync(archivo, "utf8"));
  } catch {
    console.log(`${archivo}: no existe (todavía no hubo un reinicio medido)`);
  }
}
