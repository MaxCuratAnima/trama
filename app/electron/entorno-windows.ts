// El entorno de Trama instalada en Windows (sin WSL ni motor): modo todo-en-uno (`TRAMA_LOCAL=1`) y la carpeta de los
// `.cmd` (`pa`, `tablero`, `cuentas`, `proyecto-ruta`, `trama-estado`) adelante en el PATH de la app, de los líderes y de
// los workers, que lo heredan de `process.env`. Se importa primero en main.ts: `pa.ts` y otros leen el entorno al cargarse.
// Fuera de Windows no hace nada. Sin `electron`: lo prueba tests/entorno-windows.test.ts.
import { existsSync } from "node:fs";
import { caminos, entornoConDir, esWindows, type Env, type Plataforma } from "./plataforma.ts";

/**
 * Dónde están los `.cmd`: `<resources>\bin` en la app instalada (extraResources de electron-builder.yml) o, en desarrollo,
 * `motor/bin-win` del repo (`aqui` es `dist-electron`, que cuelga de `app/`). `null` si no hay ninguna.
 */
export function dirBinWindows(p: Plataforma, resourcesPath: string | undefined, aqui: string, existe: (f: string) => boolean = existsSync): string | null {
  const j = caminos(p);
  const candidatas = [...(resourcesPath ? [j.join(resourcesPath, "bin")] : []), j.join(aqui, "..", "..", "motor", "bin-win")];
  return candidatas.find((d) => existe(j.join(d, "pa.cmd"))) ?? null;
}

/** El entorno de la app en Windows: `TRAMA_LOCAL=1`, `TRAMA_ELECTRON` (los `.cmd` sin node corren con el exe de Electron) y `bin` en el PATH. */
export function entornoWindows(p: Plataforma, env: Env, bin: string | null, exe: string): Env {
  if (!esWindows(p)) return env;
  const out = bin ? entornoConDir(p, env, bin) : { ...env };
  out.TRAMA_LOCAL ??= "1";
  out.TRAMA_ELECTRON ??= exe;
  return out;
}

/** Lo aplica a `process.env` (sólo en Windows). */
export function aplicarEntornoWindows(aqui: string = import.meta.dirname): void {
  if (!esWindows(process.platform)) return;
  const nuevo = entornoWindows(process.platform, process.env, dirBinWindows(process.platform, process.resourcesPath, aqui), process.execPath);
  for (const [k, v] of Object.entries(nuevo)) if (v !== undefined && process.env[k] !== v) process.env[k] = v;
}

aplicarEntornoWindows();
