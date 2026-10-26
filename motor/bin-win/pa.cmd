@echo off
rem pa para Windows: corre electron\cli\pa.js compilado (ver _trama-cli.cmd).
setlocal
set "TRAMA_CLI=pa"
call "%~dp0_trama-cli.cmd" %*
exit /b %ERRORLEVEL%
