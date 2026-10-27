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

## Sesión del 26/10 a la noche (líder en el home, Sonnet 5.5): bugs de la interfaz
Sin commitear en `D:\trama` (rama `windows-0.1.2`): `app/electron/main.ts` y `app/electron/procesos.ts`.
- **Ícono de la bandeja invisible**: `main.ts` leía `public/icon.png`, que no viaja en la app instalada (queda en `dist/icon.png`). Ahora prueba ambas rutas.
- **Workers "sin líder"**: `estadoDeProceso` devolvía `ppid: null` en Windows, así que `campoDeJefe` (pa-lanzar.ts) no subía hasta la sesión del líder. Ahora PowerShell devuelve `<ticks> <ppid>` (`ppidDe`). tsc y `tests/procesos.test.ts` pasan.
- **Worker Gemini**: no está roto (OK en 225 s por `pa`, 12 s con `agy -p` directo). Falta averiguar por qué `pa` tarda tanto.
- **Mensajes forzados**: la cola y el botón "Que lo lea ya" (`src/hilo/Lider.tsx`, commit e5ecb74) existen y están instalados. Gonza dice que no los ve andar: falta revisar con captura.
- Sin hacer: skills, plugins, MCP y Ajustes (Extensiones, Modelos, Plan y cupos, Locales, General); pantallas Ramas, Estadísticas ("no hay corridas": ver si lee bien `eventos.jsonl`) y Tablero.

### Instalación de esa noche y cómo volver atrás
- Backup de la versión que andaba: `C:\trama-win\backup-install-20261026\trama-nativo` (copia de `%LOCALAPPDATA%\Programs\trama-nativo`).
- Script: `C:\trama-win\instalar-arreglos.ps1`, log `C:\trama-win\instalar-arreglos.log`. Si la nueva no arranca, el script restaura el backup y la abre.
- Si Trama no abre: mirar ese log; para volver a mano, copiar el backup sobre `%LOCALAPPDATA%\Programs\trama-nativo` y abrir `Trama.exe`. El instalador nuevo: `C:\trama-win\app\dist-installer\Trama-Setup-0.1.2.exe`. Los chats y cuentas están en `%APPDATA%\Trama` (no se tocan).
- Para retomar: leer este archivo, correr `TaskList` y seguir por lo "Sin hacer".

### 2.ª tanda (26/10 a la noche, sin instalar todavía)
Instalada la 1.ª (ícono del tray + líder de los workers): verificada con captura (`C:\trama-win\caps\bandeja-oculta.png`, `pantalla.png`) y un worker nuevo con `jefe=maxcu-1a`.
Sin commitear en `D:\trama`: `app/electron/cli/pa-lanzar.ts` y `app/electron/cli/medicion.ts`.
- **Gemini devolvía "(sin resultado)"**: agy escribe `response` y `--esperar`/`cierre` leen `result`; ahora `pa-lanzar` guarda el JSON normalizado (la DECISION/SIGUE de los workers Gemini llegan al tablero).
- **Estadísticas siempre vacía**: `pa` de TS no escribía `medicion.tsv`. Nueva `medir()` en `medicion.ts`, llamada al cerrar cada corrida (25 columnas de `MEDICION_HEADER`; `tokens` = `usage.total_tokens` de agy o in+out+cache_creation de Claude). tsc ok; falta ver una corrida real en la pantalla.
- Skills: agy ya tiene 45 en `~/.gemini/config/skills` (se copió `trama-orquestar`). MCP: agy tiene los 7 (UnityMCP, blender, blenderVRC, context7, rea, substancePainter, unityVRC); los workers Claude van sin MCP (`--strict-mcp-config`) salvo `--mcp`.
- `~/.gemini/GEMINI.md` (14/10) está viejo: habla de Desktop Commander MCP, que agy no tiene. No se tocó: es de Gonza.
- Ramas ("No hay ramas sin integrar") y Tablero (6 pendientes) se ven bien.
- Mensajes forzados: andan (compositor "va cuando termine"); falta que Gonza diga qué le falta.
- Los workers viejos siguen "sin líder" (se lanzaron con el bug).

### 3.ª parte (26/10, 23:05)
2.ª tanda instalada y verificada: `pa --esperar` devuelve el resultado de Gemini, `medicion.tsv` recibe una fila por corrida y Estadísticas la muestra (captura `C:\trama-win\caps\estadisticas.png`).
Sin instalar (en `D:\trama`, `pa-lanzar.ts`): `tokens` de la medición ahora incluye `cache_read` (Estadísticas mostraba "Caché 621 %", porque calcula `cache_read / tokens`). tsc ok. Se instala con `C:\trama-win\instalar-arreglos.ps1` después de copiar el archivo a `C:\trama-win\app\electron\cli\`, `npm run build:win` y un backup nuevo (cambiar `$bk` y el patrón `$nuevo` del script).
Pendiente con Gonza: qué le falla de los mensajes forzados; si se reescribe `~/.gemini/GEMINI.md` (viejo); commitear los cambios de `D:\trama`.

## 4.ª tanda — panel del worker Gemini (pendiente de instalar)
- `app/electron/cli/pa-lanzar.ts`: el worker agy ahora corre con `--output-format stream-json` por pipe; cada línea va al `.json` y se traduce (`Traductor` de `agy-stream.ts`) a un transcript en formato Claude Code en `projects/<ruta>/<sid>.jsonl`, que es lo que lee el panel del worker (comandos, tiempos, rama). Al terminar, el `.json` queda como un solo objeto (el `result` de agy), igual que antes.
- También en esta tanda: Estadísticas con caché ≤100 % (tokens incluye cache_read).
- Cómo verificar: instalar, lanzar un worker Gemini con una tarea que use Bash, hacer clic en el worker en la barra lateral y mirar que aparezcan los comandos y el tiempo.
- Rollback: backup en C:\trama-win\backup-install-<fecha>; script `C:\trama-win\instalar-arreglos.ps1` lo restaura si falla.
- `tests/lanzar-rama.test.ts` falla ya antes de estos cambios (import `..\hilo\elegir.ts` inválido en Windows): no es de esta tanda.

## Modelos (26/10, noche)
- `%APPDATA%\Trama\modelos.json`: líder claude-sonnet-5-5 high; todos los workers `claude-haiku-5-5` (Haiku fuerza xhigh); `diseno` = claude-sonnet-5-5 high (antes agy:claude-opus-5-5-medium, por el cupo). Backup: modelos.json.bak-gemini-20261026 (workers Gemini 3.8 flash).
- Gemini probado por CLI con el build instalado: `--leer`, escribiendo en rama y `--async` + `--esperar` andan (18–25 s). Lo que fallaba era el panel vacío (transcript, 3.ª tanda sin instalar).
- Falta: `pa --seguir` ("todavía no está en la versión TypeScript") — afecta a cualquier worker.

## 5.ª tanda — pasos del subagente + cupos (26/10, pendiente de instalar)
- **Clic en una tarea de Haiku (Agent)** en la barra lateral ahora abre en el panel derecho sus pasos (comandos, tiempos, si razonó), como el panel del worker. Archivos: `electron/subagentes.ts`, `nucleo.ts`, `maquinas-contrato.ts`, `preload.cts`, `src/puente.ts`, `src/datos/fuente.ts`, `src/barra/subagente-visto.ts` (nuevo), `Subagentes.tsx`, `Barra.tsx` (abrir un panel lo suelta), `src/hilo/Worker.tsx` (`VistaSubagente`), `src/hilo/Vista.tsx`, `src/index.css`, i18n `sub.*`. tsc e i18n ok; falta verlo en la app.
- **Cupos**: la cuenta extra `max-curat` (Maxgrove) tiene la sesión vencida (`claude auth status` → loggedIn:false): hay que tocar «Conectar» en Ajustes > Cuentas. Ahora la pantalla lo dice (`uso.sesionVencida`). Gemini no informa su cupo por consola en Windows (`agy -p /quota` no es comando y gasta 2–18 mil tokens): `googleDeAgy` ya no se llama en win32 y la pantalla lo explica (`uso.sinDatoGoogle`). Tipo `sinLectura` agregado a `src/datos/contrato.ts`.
- Instalar: copiar a `C:\trama-win\app`, `npm run build:win`, backup nuevo y `instalar-arreglos.ps1` (el patrón `$nuevo` busca `uso.sesionVencida` en el build).

## 6.ª tanda — Windows de punta a punta, cupos, UI y títulos (26/10, pendiente de instalar)
Hecho (compila los dos tsc; tests nuevos pasan):
- **Windows**: `electron/nota-windows.ts` (NOTA_WINDOWS) se suma al contrato de `pa` (workers Claude y Gemini), al prefacio del líder Gemini y al prompt del líder local; el contrato dice "tool de comandos (Bash o PowerShell)"; los workers `--leer` en Windows también tienen PowerShell. `PowerShell` se trata como shell en pasos (`pasos.ts`), chat y panel (`src/hilo/shell.ts` → `esShell`). Adjuntos con ruta `C:\...`/UNC se reconocen (`adjunto.ts`).
- **Gemini no respondía** (Opus): el líder Gemini lanzaba `pa` sin `--async`, agy lo pasa a segundo plano a los 8 s y el worker muere al cortarse el turno. Ahora `PROMPT_GEMINI` manda lanzar SIEMPRE con `--async` + `pa --esperar`. Ids de Gemini 3.8 siempre `-high` (`agy-puente.ts`, `modelos-tipos.ts`). El EFTYPE de `tests/lider-gemini.test.ts` es del test (`.mjs` directo en Windows), no de la app.
- **Cupos** (`AjustesCupos.tsx`): "sesión vencida" para cuentas sin login, explicación para Gemini sin lectura (`sinPct`).
- **UI**: sin botón Volver en los paneles (`Panel.tsx`); cabecera de Consumo con padding para los botones de ventana (`consumo-estilos.css`).
- **Títulos** (`titulo-auto.ts`, `tema.ts`, `statusline.ts`): resumen de 3-6 palabras con Haiku, una vez por líder, cache `titulos-auto.json`.
- Skill `trama-orquestar`: excepciones con Opus (trabado tras 2 intentos, 3D) y Sonnet para 2D; regla de Windows.
Pendiente: instalar (OK de Gonza), después verificar con capturas: cabecera de Consumo vs botones, mensajes de cupos, sin Volver, títulos nuevos, paso PowerShell con su comando, un líder Gemini lanzando un worker con `--async` y cobrándolo.
Tests que ya fallaban en Windows (rutas de Linux en el test, no en la app): lider.test, contexto-local (carpetasDe/armarContexto), lider-gemini (EFTYPE), lanzar-rama, archivos.test (ERR_INVALID_MODULE_SPECIFIER).
Para Gonza: la cuenta Maxgrove necesita Ajustes > Cuentas > Conectar; la cuota de Gemini no se puede leer sin pantalla en Windows; `pa --seguir/--actualizar` faltan en el pa de TypeScript; `~/.gemini/GEMINI.md` viejo (menciona Desktop Commander) espera su decisión; la vista del subagente aún tiene un "Volver".

## 7.ª tanda — sin Bash en Windows (26/10, instalada al cierre)
- Líderes (`argvLider`), workers (`pa-lanzar.ts`) y líder local: en Windows `--disallowedTools Bash`; los `--leer` y el líder local usan `PowerShell` en vez de `Bash` (probado: `claude -p --disallowedTools Bash` corre con PowerShell). Textos de modo lectura/ahorro y bloqueo del hook sin pipes de Linux; el prompt de Gemini ya no apunta a `~/.config/proyectos`; la skill `trama-orquestar` usa rutas de `%APPDATA%\Trama` y `--archivo-tarea`.
- Títulos: el prompt a Haiku pide 2-5 palabras (máx. 40 car.) con ejemplos; si igual se pasa, se corta a 40. Se vació el cache viejo de `titulos-auto.json`.
- Queda código con ramas de Linux (`/proc`, `bash -c`, `kill(-pid)`, dictado X11/Wayland, systemd de modelos locales, bench): nunca corre en Windows y sus tests dependen de esas ramas; sacarlas es una limpieza grande, no hecha.
