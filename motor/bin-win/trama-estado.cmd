@echo off
rem trama-estado para Windows: corre electron\cli\trama-estado.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=trama-estado"
call "%~dp0_trama-cli.cmd" %*
exit /b %ERRORLEVEL%
