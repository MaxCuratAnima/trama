@echo off
rem hook-statusline para Windows: corre electron\cli\hook-statusline.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=hook-statusline"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
