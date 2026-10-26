@echo off
rem proyecto-ruta para Windows: corre electron\cli\proyecto-ruta.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=proyecto-ruta"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
