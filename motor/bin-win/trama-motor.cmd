@echo off
rem trama-motor para Windows: corre electron\cli\trama-motor.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=trama-motor"
rem Sin "call": un call vuelve a leer los %% y ^ de %* (rompe tareas con %PATH% o ^) y no hace falta, nada sigue despues.
"%~dp0_trama-cli.cmd" %*
