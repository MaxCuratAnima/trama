@echo off
rem proyecto-ruta para Windows: corre electron\cli\proyecto-ruta.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=proyecto-ruta"
call "%~dp0_trama-cli.cmd" %*
exit /b %ERRORLEVEL%
