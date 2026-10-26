@echo off
rem pa para Windows: corre electron\cli\pa.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=pa"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
