# HANDOFF: Trama nativa en Windows (rama `windows-0.1.2`)

Parche de Gonza hasta que salga la versión oficial para Windows. Base: Trama 0.1.2 (origin/main 8acaf9f).

## Hecho
- Corre en Windows sin WSL: rutas en `%APPDATA%\Trama` y `%LOCALAPPDATA%\Trama\state` (`app/electron/plataforma.ts`), procesos con `taskkill`/PowerShell (`app/electron/procesos.ts`).
- CLI portadas a TS (`app/electron/cli/`) con shims `.cmd` en `motor/bin-win`: `pa`, `tablero`, `cuentas`, `proyecto-ruta`, `trama-estado`. Funcionan con node o, si no hay, con el exe de Electron.
- `.cmd`/`.bat` se lanzan con `comandoEjecutable` de `procesos.ts` (cmd /d /s /c + escape). Sin esto Node da `spawn EINVAL`.
- Multi-cuenta oficial de la 0.1.2, más el CLI `cuentas`.
- 14 archivos de `app/src` que diferían solo en mayúsculas renombrados a `*-datos.ts` / `*-estilos.css` (en NTFS rompían los imports). Hay que avisarle al autor.
- Instalador NSIS: `app/electron-builder.yml`, `npm run build:win` → `app/dist-installer/Trama-Setup-0.1.0.exe`. Sin asar (los `.cmd` corren `dist-electron/cli/*.js`).
- Borrado lo de Linux/WSL: `windows/`, `app/systemd/`, los `.sh` de instalación y sus tests.

## Pendiente
- Código systemd todavía vivo: `electron/locales.ts` (cambio de modelos locales por units de usuario; en Windows `sinSystemd` lo apaga), `ollama-entorno.ts` (detecta distro y systemd de Linux), `main.ts`/`motor.ts`/`cierre.ts` (`TRAMA_UNIDAD`, salida 3; lo simulan `scripts/prueba-motor|salir|relanzar.mjs`) y los textos `main.localUnitFija`/`ctxl.unitFija` que mandan a `systemd/locales/` (ya borrado). Sacarlo pide rediseñar el cambio de modelos locales para Windows.
- Quedó el puente `window.carcasa` (`app/src/carcasa.ts`): el preload nativo no lo expone, así que la categoría Cuentas de Ajustes (`AjustesCuentas.tsx`) no se muestra en Windows y el botón Conectar de Bienvenida/Cupos no aparece. Hay que decidir: mostrar Cuentas con el motor (`fuente.cuentas`) o borrarla; los textos `ajustes.cuentasIntro` y `ajustes.ctaNoInstalada` todavía dicen «Ubuntu».  (El panel Actualizaciones/restos de la carcasa ya se sacó.)
- Hooks sin versión de Windows: `motor/hooks/docker-guard.py`, `agy-pa`, `destructive-guard`, `latido`, `statusline-espejo` (`.sh`). Falta el `.cmd` de `trama-motor`. Después, borrar `motor/bin/*`.
- El `pa` de TS no tiene reparto, cupo de Gemini ni `cuenta_elegir` por cupo.
- `Trama.exe` queda con el ícono de Electron (`signAndEditExecutable: false`). El instalador sí lleva el de Trama.
- La versión del paquete dice 0.1.0.
- Las ramas `windows-nativo`, `windows-limpio` y `pa/trama/20261025-234454-92288` (WSL, obsoleta) se borran solo con OK de Gonza.

## Cómo verificar
- Compilar desde WSL: en `app/`, `npx tsc --noEmit -p tsconfig.json` y `-p tsconfig.electron.json`.
- Tests: `timeout 900 node --test --test-reporter=tap --test-timeout=60000 tests/*.test.ts`. Unas 17 a 19 fallas vienen de antes (agy, dictado, tailscale, `cuentas` sin node).
- En Windows, desde `C:\trama-win` (clon con origin `D:\trama`; usar el git y npm de Windows):
  - `git checkout windows-0.1.2`, después `cd app`, `npm install`, `npm run build` y `npm run build:win`.
  - Probar las CLI con `node scripts\probar-windows.mjs` y `node scripts\probar-windows.mjs --sin-node`.
- Instalar con `Trama-Setup-0.1.0.exe /S /D=%LOCALAPPDATA%\Programs\trama-nativo`.
- Para probarla al lado de otra Trama: `TRAMA_PUERTO=8792` y `--remote-debugging-port=9333`. La captura sale de `C:\trama-win\cdp-captura.mjs` (PrintWindow sale negro).
