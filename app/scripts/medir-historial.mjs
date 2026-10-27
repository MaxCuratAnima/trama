// Cuánto tarda y cuánto ocupa indexar los transcripts (electron/historial.ts), sin tocar el estado
// de trama: el registro va a una carpeta temporal que se borra al terminar. Imprime sólo números.
//
//   node scripts/medir-historial.mjs [carpeta de projects] [días]
//
// Sin argumentos: `~/.claude/projects` y los últimos 30 días. Sin Electron ni build (Node corre el .ts).
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import { crearHistorial } from "../electron/historial.ts";
import { diaDe } from "../electron/historial-parser.ts";

const proyectos = process.argv[2] ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");
const dias = Number(process.argv[3] ?? 30);
const paState = process.env.PA_STATE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Trama", "state", "pa");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-medir-historial-"));
const carpeta = path.join(tmp, "historial");
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const ms = (n) => `${Math.round(n)} ms`;

try {
  const historial = crearHistorial({ proyectos, paState, carpeta });
  // Lo que el resto del main esperaría su turno mientras se indexa.
  const demora = monitorEventLoopDelay({ resolution: 1 });
  demora.enable();
  const cpu = process.cpuUsage();
  const una = await historial.alDia();
  const gasto = process.cpuUsage(cpu);
  demora.disable();
  const dos = await historial.alDia();
  const archivos = readdirSync(carpeta).map((f) => [f, statSync(path.join(carpeta, f)).size]);
  const t0 = performance.now();
  const c = await historial.consultar(diaDe(Date.now() - (dias - 1) * 86_400_000), diaDe(Date.now()));
  const consulta = performance.now() - t0;
  const clases = {};
  for (const p of c.piezas) clases[p.clase] = (clases[p.clase] ?? 0) + 1;
  console.log(`transcripts:        ${una.archivos} (${mb(una.bytes)}, ${una.lineas} líneas)`);
  console.log(`primera pasada:     ${ms(una.ms)} (CPU ${ms((gasto.user + gasto.system) / 1000)})`);
  console.log(`  turno más largo:  ${ms(una.bloqueo)} seguido; demora del bucle p50 ${ms(demora.percentile(50) / 1e6)}, p99 ${ms(demora.percentile(99) / 1e6)}, máx ${ms(demora.max / 1e6)}`);
  console.log(`segunda pasada:     ${ms(dos.ms)}, ${dos.leidos} releídos, ${dos.bytes} bytes`);
  console.log(`registro:           ${mb(archivos.reduce((n, [, t]) => n + t, 0))} en ${archivos.length} archivos (${archivos.map(([f, t]) => `${f} ${mb(t)}`).join(", ")})`);
  console.log(`consulta ${dias} días:   ${ms(consulta)}; ${c.sesiones} sesiones (${c.roles.lider.sesiones} líderes, ${c.roles.worker.sesiones} workers, ${c.roles.subagente.sesiones} subagentes)`);
  console.log(`  piezas:           ${c.piezas.length} (${Object.entries(clases).map(([k, n]) => `${k} ${n}`).join(", ")})`);
  console.log(`  sin dato:         ${JSON.stringify(c.sinDato)}`);
  console.log(`  memoria:          ${mb(process.memoryUsage().rss)} residente`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
