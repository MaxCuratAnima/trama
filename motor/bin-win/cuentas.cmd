@echo off
rem cuentas para Windows: corre electron\cli\cuentas.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=cuentas"
call "%~dp0_trama-cli.cmd" %*
exit /b %ERRORLEVEL%
