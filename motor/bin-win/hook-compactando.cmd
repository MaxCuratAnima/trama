@echo off
rem hook-compactando para Windows: corre electron\cli\hook-compactando.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=hook-compactando"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
