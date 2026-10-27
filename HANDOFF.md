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

## Hecho el 26/10 (sesión desde la nativa)
- Cuentas en Ajustes, Bienvenida y Cupos por el motor (`fuente.cuentas`/`loginCuenta`); se borró `window.carcasa`.
- `pa` de TS: `--estado` con varios vivos, rutas sin distinguir mayúsculas (`mismaRuta`), `--modelos`, `--ayuda` completa, `--archivo-tarea` (cmd.exe corta `%*` en el primer salto de línea) y el modelo sin `-m` sale de modelos.json (Sonnet), no Opus.
- Versión 0.1.2 e ícono de Trama en `Trama.exe` (`signAndEditExecutable: true`, sin certificado).
- Borrada la versión vieja: `Programs\trama-windows` (a mano, sin su desinstalador: comparte `%APPDATA%\Trama`) y en WSL `trama-motor.service`, `~/.local/share/trama`, `~/.config/trama`. Backups en `C:\trama-win\backup-antes-de-borrar-vieja` y `C:\trama-win\version-vieja-wsl\sesiones-y-estado.tgz`. Logins de Gemini y antigravity copiados de WSL a Windows.

## Pendiente
- `pa --seguir` y `pa --actualizar` no están en el `pa` de TS.
- Los tests con `registerHooks` fallan en Windows (esquema `c:` en rutas absolutas): 62 archivos.
- Código systemd todavía vivo: `electron/locales.ts` (cambio de modelos locales por units de usuario; en Windows `sinSystemd` lo apaga), `ollama-entorno.ts` (detecta distro y systemd de Linux), `main.ts`/`motor.ts`/`cierre.ts` (`TRAMA_UNIDAD`, salida 3; lo simulan `scripts/prueba-motor|salir|relanzar.mjs`) y los textos `main.localUnitFija`/`ctxl.unitFija` que mandan a `systemd/locales/` (ya borrado). Sacarlo pide rediseñar el cambio de modelos locales para Windows.
- Hooks portados a TS (`app/electron/cli/`, shims en `motor/bin-win`): latido, guardia, comando, `hook-statusline` (ex statusline-espejo), `hook-compactando` y `trama-motor` (run/start/stop/restart/status/logs, pid y log en `PA_STATE`). Sin portar: `agy-pa.sh` (el `pa` de TS no lanza Gemini todavía), `docker-guard.py` (hook-guardia lo llama si hay python). `scripts/registrar-hook.mjs` en Windows registra el shim `hook-compactando.cmd` (PreCompact/PostCompact) y `statusLine` con `hook-statusline.cmd`, sin pisar un statusLine ajeno. `docker-guard.py` (824 líneas) no se porta: nadie setea `TRAMA_GUARD_DIR`, así que hook-guardia no lo corre. Falta decidir borrar `motor/bin/*` y los `.sh` portados.
- El `pa` de TS no tiene reparto, cupo de Gemini ni `cuenta_elegir` por cupo.
- Las ramas `windows-nativo`, `windows-limpio` y `pa/trama/20261025-234454-92288` (WSL, obsoleta) se borran solo con OK de Gonza.

## Hecho el 26/10 a la noche (rama `arreglo/sesion`, worktree C:	rama-wtsesion, sale de `integra/arreglos`)
- **Cuota**: `agy -p /quota` en el agy de Windows NO es un comando: corre un turno del modelo (2 a 18 mil tokens por lectura, probado dos veces) y no trae `command.data.groups`. `cupos.ts` ahora lo llama solo con "Actualizar límites" (`manual`), nunca por el reloj. El `get_usage` de Claude y el `rate_limit_event` no gastan plan (control request sin turno).
- `modelos.json` de Gonza (`%APPDATA%Trama`, backup `modelos.json.bak-20261026`): líder `agy:claude-sonnet-5-5-medium`, todos los workers `gemini-3.8-flash-high`, `diseno` en `agy:claude-opus-5-5-medium` (Opus solo para verificar o casos muy exigentes), sin `opus` en `excluir`. Regla de Gonza: líder Sonnet medio/high; si duda, consulta a Opus medio.
- Arreglo de agy con Claude (venía sin commitear en D:	rama): nombres `claude-sonnet-*`/`claude-opus-*` → los 4-6 de agy. Se quitó `claude-haiku`→Sonnet: no se disfraza un modelo por otro.
- `trama-motor` ya no pone `TRAMA_UNIDAD=1` en Windows (no hay supervisor: sin esto el motor se iba y nadie lo levantaba).
- `ollama-entorno`: en Windows busca `ollama.exe`, sugiere `winget install --id Ollama.Ollama -e` y arranca con `ollama serve`; la plataforma es un parámetro (test nuevo). Los tests de Linux fijan `"linux"`.
- Tests de referencia: `ollama-entorno` 2 fallas y `modelos-config` 1 ("sigue el symlink") son de antes (rutas/symlinks en Windows).

## Pendiente (agregado el 26/10 a la noche)
- `motor.sock` en Windows: `local.ts` hace `listen` sobre una ruta de archivo → EACCES (la ventana siempre corre "todo en uno", así que no afecta a la app; sí a `trama-motor.cmd`). Para usar el motor hay que pasarlo a una named pipe `\.pipe	rama-motor-<usuario>`.
- Lecturas de `/proc` que en Windows caen en el catch y devuelven vacío: `cli/pa-esperar.ts` (sesión padre), `terminal.ts` (ppid), `bench.ts` (solo medición). `locales.ts`: cambio de modelos locales sigue sin soporte en Windows (rediseño: pedir OK a Gonza).
- (Ya hecho) `arreglo/sesion` está integrada en `windows-0.1.2` (D:	rama, merge bd1b386) y el build instalado sale de ella. En `C:	rama-wtintegra` quedó un `pa-lanzar.ts` sin commitear de las 17:56 (trabajo de `--seguir`/`--cuenta` de otra sesión): no se tocó. El `D:	rama` (windows-0.1.2) sigue con su diff de agy sin commitear: ya está dentro de `arreglo/sesion`.

## Cómo verificar
- Compilar desde WSL: en `app/`, `npx tsc --noEmit -p tsconfig.json` y `-p tsconfig.electron.json`.
- Tests: `timeout 900 node --test --test-reporter=tap --test-timeout=60000 tests/*.test.ts`. Unas 17 a 19 fallas vienen de antes (agy, dictado, tailscale, `cuentas` sin node).
- En Windows, desde `C:\trama-win` (clon con origin `D:\trama`; usar el git y npm de Windows):
  - `git checkout windows-0.1.2`, después `cd app`, `npm install`, `npm run build` y `npm run build:win`.
  - Probar las CLI con `node scripts\probar-windows.mjs` y `node scripts\probar-windows.mjs --sin-node`.
- Instalar con `Trama-Setup-0.1.2.exe /S /D=%LOCALAPPDATA%\Programs\trama-nativo`.
- Para probarla al lado de otra Trama: `TRAMA_PUERTO=8792` y `--remote-debugging-port=9333`. La captura sale de `C:\trama-win\cdp-captura.mjs` (PrintWindow sale negro).

## Instalación y limpieza del 26/10 a la noche
- Instalado `C:	rama-wtsesionappdist-installerTrama-Setup-0.1.2.exe` (mismo código que `windows-0.1.2`) sobre `%LOCALAPPDATA%Programs	rama-nativo` con un script suelto (`C:	rama-wininstalar-final.ps1`, log `instalar-final.log`): cierra Trama, instala en silencio y la reabre. Cortó la charla que corría adentro: es normal.
- Borrado: `Trama Nativo.cmd` (escritorio y OneDrive), `Trama - como seguir.txt`, `D:DescargasTrama-Setup-0.1.0.exe`, `%LOCALAPPDATA%	rama-windows-updater` y 69 carpetas `trama-*` de Temp. Quedan: `Trama.lnk` del escritorio y del menú Inicio (apuntan a trama-nativo).
- En `D:	rama` hay un stash `agy-y-handoff-sin-commitear-26oct` con el diff viejo (ya incluido en la rama; se puede `git stash drop`).
- Sin borrar todavía (esperan a que Gonza confirme que la instalada anda): `C:	rama-winackup-*`, `C:	rama-winersion-vieja-wsl`, los worktrees de `C:	rama-wt*` y `C:UsersMaxCu	rama-w0` (pruebas de supuestos de Windows). Las ramas `arreglo/*`, `integra/arreglos` ya integradas se pueden borrar.
