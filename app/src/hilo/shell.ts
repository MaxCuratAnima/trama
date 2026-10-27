// Las herramientas que corren un comando: PowerShell, y Bash (Git Bash) si un agente lo usa. Se tratan igual en la vista.
export const esShell = (nombre: string | null | undefined): boolean => nombre === "Bash" || nombre === "PowerShell";
