@echo off
rem cuentas para Windows: corre electron\cli\cuentas.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=cuentas"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
