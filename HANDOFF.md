# HANDOFF: Trama nativa en Windows (rama `windows-0.1.2`)

Parche de Gonza hasta que salga la versión oficial para Windows. Base: Trama 0.1.2 (origin/main 8acaf9f).

## Hecho
- Corre en Windows sin WSL: rutas en `%APPDATA%\Trama` y `%LOCALAPPDATA%\Trama\state` (`app/electron/plataforma.ts`), procesos con `taskkill`/PowerShell (`app/electron/procesos.ts`).
- CLI portadas a TS (`app/electron/cli/`) con shims `.cmd` en `motor/bin-win`: `pa`, `tablero`, `cuentas`, `proyecto-ruta`, `trama-estado`. Funcionan con node o, si no hay, con el exe de Electron.
- `.cmd`/`.bat` se lanzan con `comandoEjecutable` de `procesos.ts` (cmd /d /s /c + escape). Sin esto Node da `spawn EINVAL`.
- Multi-cuenta oficial de la 0.1.2, más el CLI `cuentas`.
- 14 archivos de `app/src` que diferían solo en mayúsculas renombrados a `*-datos.ts` / `*-estilos.css` (en NTFS rompían los imports). Hay que avisarle al autor.
- Instalador NSIS: `app/electron-builder.yml`, `npm run build:win` → `app/dist-installer/Trama-Setup-0.1.2.exe`. Sin asar (los `.cmd` corren `dist-electron/cli/*.js`).
- Borrado lo de Linux/WSL: `windows/`, `app/systemd/`, los `.sh` de instalación y sus tests.

## Pendiente
- Código systemd todavía vivo: `electron/locales.ts` (cambio de modelos locales por units de usuario; en Windows `sinSystemd` lo apaga), `ollama-entorno.ts` (detecta distro y systemd de Linux), `main.ts`/`motor.ts`/`cierre.ts` (`TRAMA_UNIDAD`, salida 3; lo simulan `scripts/prueba-motor|salir|relanzar.mjs`) y los textos `main.localUnitFija`/`ctxl.unitFija` que mandan a `systemd/locales/` (ya borrado). Sacarlo pide rediseñar el cambio de modelos locales para Windows.
- Quedó el puente `window.carcasa` (`app/src/carcasa.ts`): el preload nativo no lo expone, así que la categoría Cuentas de Ajustes (`AjustesCuentas.tsx`) no se muestra en Windows y el botón Conectar de Bienvenida/Cupos no aparece. Hay que decidir: mostrar Cuentas con el motor (`fuente.cuentas`) o borrarla; los textos `ajustes.cuentasIntro` y `ajustes.ctaNoInstalada` todavía dicen «Ubuntu».  (El panel Actualizaciones/restos de la carcasa ya se sacó.)
- Hooks portados a TS (`app/electron/cli/`, shims en `motor/bin-win`): latido, guardia, comando, `hook-statusline` (ex statusline-espejo), `hook-compactando` y `trama-motor` (run/start/stop/restart/status/logs, pid y log en `PA_STATE`). Sin portar: `agy-pa.sh` (el `pa` de TS no lanza Gemini todavía), `docker-guard.py` (hook-guardia lo llama si hay python). `scripts/registrar-hook.mjs` en Windows registra el shim `hook-compactando.cmd` (PreCompact/PostCompact) y `statusLine` con `hook-statusline.cmd`, sin pisar un statusLine ajeno. `docker-guard.py` (824 líneas) no se porta: nadie setea `TRAMA_GUARD_DIR`, así que hook-guardia no lo corre. Falta decidir borrar `motor/bin/*` y los `.sh` portados.
- El `pa` de TS no tiene reparto, cupo de Gemini ni `cuenta_elegir` por cupo.
- Las ramas `windows-nativo`, `windows-limpio` y `pa/trama/20261025-234454-92288` (WSL, obsoleta) se borran solo con OK de Gonza.

## Cómo verificar
- Compilar desde WSL: en `app/`, `npx tsc --noEmit -p tsconfig.json` y `-p tsconfig.electron.json`.
- Tests: `timeout 900 node --test --test-reporter=tap --test-timeout=60000 tests/*.test.ts`. Unas 17 a 19 fallas vienen de antes (agy, dictado, tailscale, `cuentas` sin node).
- En Windows, desde `C:\trama-win` (clon con origin `D:\trama`; usar el git y npm de Windows):
  - `git checkout windows-0.1.2`, después `cd app`, `npm install`, `npm run build` y `npm run build:win`.
  - Probar las CLI con `node scripts\probar-windows.mjs` y `node scripts\probar-windows.mjs --sin-node`.
- Instalar con `Trama-Setup-0.1.2.exe /S /D=%LOCALAPPDATA%\Programs\trama-nativo`.
- Para probarla al lado de otra Trama: `TRAMA_PUERTO=8792` y `--remote-debugging-port=9333`. La captura sale de `C:\trama-win\cdp-captura.mjs` (PrintWindow sale negro).
