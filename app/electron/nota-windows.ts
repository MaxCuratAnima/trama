// Lo que se le dice a un líder o worker: corren en Windows y sin esto usan comandos de Linux (ls, grep, sed, /tmp) que ahí no existen.
import type { Plataforma } from "./plataforma.ts";

export const NOTA_WINDOWS = `SISTEMA: Windows 11, NO Linux. Los comandos son de PowerShell (o cmd), nunca de bash:
- Listar/leer/buscar: Get-ChildItem, Get-Content, Select-String (o las herramientas Read/Grep/Glob). No uses ls, cat, grep, sed, awk, head, tail, find, which, chmod, export ni heredocs.
- Variables de entorno: $env:NOMBRE = "x". Encadenar con ; (PowerShell 5.1 no tiene && ni ||). Rutas con \\ o /: no existen /tmp, /proc, /usr ni ~ (usá $env:TEMP, $env:USERPROFILE).
- Si la herramienta de comandos se llama PowerShell, es esa (donde estas reglas dicen "el tool Bash", es el de comandos que tengas). Si sólo hay Bash, es Git Bash: rutas /c/Users/…
- Los programas son .exe/.cmd (pa.cmd, npm.cmd). Un texto largo o con comillas anidadas pasalo por un archivo, no por la línea de comandos.`;

/** La nota, siempre: Trama sólo corre en Windows. La plataforma se ignora. */
export const notaDePlataforma = (_p?: Plataforma): string => NOTA_WINDOWS;
