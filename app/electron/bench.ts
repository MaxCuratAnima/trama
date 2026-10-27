// Modo bench (slices B0/B0b): con `HILOS_BENCH=<archivo.json>` la UI corre un
// guion fijo (animación → reposo), le pasa los números al main y éste los
// completa con lo que sólo se ve desde afuera del renderer (estado de la GPU,
// versiones, switches) y cierra la app.
import { app, ipcMain } from "electron";
import { renameSync, writeFileSync } from "node:fs";

/** Corte duro: pase lo que pase en el JS, la ventana no vive más que esto. */
const CORTE_MS = 18_000;

const destino = () => process.env.HILOS_BENCH || null;

/** El arranque de este proceso, sacado de cuánto lleva vivo. */
const INICIO = Date.now() - process.uptime() * 1000;
const msDesdeInicio = () => Date.now() - INICIO;

function entorno() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(HILOS_|ELECTRON_)/.test(k)));
}

function escribir(ruta: string, v: unknown) {
  writeFileSync(`${ruta}.tmp`, JSON.stringify(v, null, 2));
  renameSync(`${ruta}.tmp`, ruta);
}

export function armarBench() {
  const ruta = destino();
  ipcMain.handle("bench:modo", () => ruta !== null);
  if (!ruta) return;

  setTimeout(() => {
    escribir(ruta, { error: "corte duro: la UI no terminó el guion" });
    app.exit(3);
  }, CORTE_MS).unref();

  // La UI lo llama en su segundo rAF con la pantalla montada.
  ipcMain.handle("bench:listo", () => msDesdeInicio());
  ipcMain.handle("bench:cpu", () => ({ ms: msDesdeInicio(), procesos: [] }));
  ipcMain.handle("bench:fin", async (_e, reporte: Record<string, unknown>) => {
    escribir(ruta, {
      ...reporte,
      entorno: entorno(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      switches: process.argv.slice(1),
      gpu_estado: app.getGPUFeatureStatus(),
      gpu_info: await app.getGPUInfo("basic").catch(() => null),
    });
    app.exit(0);
  });
}
