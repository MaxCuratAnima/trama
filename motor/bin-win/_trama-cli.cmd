@echo off
rem Ayudante de los shims de motor\bin-win: corre app\dist-electron\cli\%TRAMA_CLI%.js con los argumentos recibidos.
rem Todas las rutas son relativas a este archivo. Corre con node si esta en el PATH; si no, con el exe de Electron
rem y ELECTRON_RUN_AS_NODE=1 (TRAMA_ELECTRON fija cuál). No definas variables fuera del setlocal del shim que lo llama.
set "TRAMA_JS=%~dp0..\..\app\dist-electron\cli\%TRAMA_CLI%.js"
if not exist "%TRAMA_JS%" set "TRAMA_JS=%~dp0..\app\dist-electron\cli\%TRAMA_CLI%.js"
if not exist "%TRAMA_JS%" set "TRAMA_JS=%~dp0..\dist-electron\cli\%TRAMA_CLI%.js"
if not exist "%TRAMA_JS%" (
  >&2 echo %TRAMA_CLI%: no encuentro cli\%TRAMA_CLI%.js compilado ^(corre "npm run build" en app^)
  exit /b 127
)

where node >nul 2>&1
if not errorlevel 1 (
  node "%TRAMA_JS%" %*
  exit /b %ERRORLEVEL%
)

set "TRAMA_EXE=%TRAMA_ELECTRON%"
if defined TRAMA_EXE if exist "%TRAMA_EXE%" goto :electron
set "TRAMA_EXE=%~dp0..\..\app\node_modules\electron\dist\electron.exe"
if exist "%TRAMA_EXE%" goto :electron
set "TRAMA_EXE=%~dp0..\..\Trama.exe"
if exist "%TRAMA_EXE%" goto :electron
set "TRAMA_EXE=%~dp0..\Trama.exe"
if exist "%TRAMA_EXE%" goto :electron
>&2 echo %TRAMA_CLI%: no hay node en el PATH ni el exe de Electron ^(defini TRAMA_ELECTRON^)
exit /b 127

:electron
set "ELECTRON_RUN_AS_NODE=1"
"%TRAMA_EXE%" "%TRAMA_JS%" %*
exit /b %ERRORLEVEL%
