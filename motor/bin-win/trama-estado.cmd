@echo off
rem trama-estado para Windows: corre electron\cli\trama-estado.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=trama-estado"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
