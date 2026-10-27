// Las herramientas que corren un comando: Bash (Linux, macOS, Git Bash) y PowerShell (Windows). Se tratan igual en la vista.
export const esShell = (nombre: string | null | undefined): boolean => nombre === "Bash" || nombre === "PowerShell";
