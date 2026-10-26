@echo off
rem tablero para Windows: corre electron\cli\tablero.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=tablero"
call "%~dp0_trama-cli.cmd" %*
exit /b %ERRORLEVEL%
