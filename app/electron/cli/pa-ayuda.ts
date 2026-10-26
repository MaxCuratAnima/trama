// `pa --ayuda`: la ayuda de `motor/bin/pa`, recortada a lo que el pa de TypeScript hoy hace de verdad. Lo que falta (--seguir,
// --aca, --actualizar, --ramas, --matar, --traspaso, --limpiar, --bien, modelos codex/ollama, reparto) no figura: pedirlo sale 2.

export const AYUDA = `pa <proyecto> "<tarea>" — delega una tarea a un Claude que corre DENTRO del proyecto.

Es el gemelo no interactivo de \`p\`: corre el worker en modo -p (headless) para que lo maneje el orquestador por consola. Al
hacer cd a la ruta del puesto, el worker carga el CLAUDE.md del proyecto y su memoria propia.

Lo que vuelve por stdout es SOLO el resultado corto del worker. El JSON completo queda en el estado de pa
(Windows: %LOCALAPPDATA%\\Trama\\state\\pa\\<proyecto>\\; Linux: ~/.local/state/pa/<proyecto>/).

Uso:
  pa <proyecto> "<tarea>"              delegar (el worker puede escribir, en su worktree de un puesto)
  pa <proyecto> --leer "<pregunta>"    sólo lectura (Read/Grep/Glob + git de lectura por Bash, sin Edit)
                                       NO toma puesto: corre en paralelo con los que escriben y con otros --leer
  pa <proyecto> --archivo-tarea <ruta> la tarea sale de ese archivo (\`-\` = stdin), entera y con sus saltos de línea. Usalo para tareas de
                                       varias líneas desde pa.cmd: cmd.exe corta el argumento en el primer salto de línea
  pa <proyecto> --async "<tarea>"      lanzar desacoplado y volver enseguida (si no hay puesto libre, hace cola)
  pa <proyecto> --integrar <id>        mergear la rama de esa corrida en el tree principal (rebase en su puesto + ff, sin forzar)
  pa <proyecto> --descartar <id>       tirar la rama de esa corrida (borra sus commits: confirmarlo antes)
  pa <proyecto> -m <modelo> "<tarea>"  elegir modelo. Sin -m: modelos.json (workers.<tipo>, si no workers.default) y si no el
                                       default de pa (claude-sonnet-5-5 high; claude-haiku-5-5 xhigh con --tipo mecanico).
                                       -m acepta claude-… y gemini-…/agy:… (agy). codex:… y ollama:… todavía no
  pa <proyecto> --effort medium "<t>"  esfuerzo del worker (o env PA_EFFORT). haiku low..max (default xhigh);
                                       sonnet low|medium|high|xhigh (default high); opus (sólo con -m) low..xhigh
                                       (default: plan pro → medium, plan max → el de settings). Sale 2: max fuera de
                                       haiku y cualquier fable, salvo con --ok-dueno
  pa <proyecto> --ok-dueno ...         el dueño aprobó ESTA corrida: deja pasar opus max, sonnet max, fable y lo de excluir
  pa <proyecto> --tipo <tipo> "<t>"    clasificar la corrida (o env PA_TIPO): mecanico | lectura | codigo-acotado | codigo-multi |
                                       frontend | diseno | debug | final. Elige el modelo de modelos.json (workers.<tipo>) y es
                                       lo que agrupa \`pa --rinde\`
  pa <proyecto> --cuenta <id> "<t>"    correr con esa cuenta de la suscripción (ver \`cuentas\`)
  pa <proyecto> --mcp "<tarea>"        dejarle los MCP de claude.ai (default: apagados)
  pa <proyecto> --max-turns N          tope de turnos (default: plan pro 100, plan max 150; 0 = sin tope)
  pa <proyecto> --max-budget-usd N     tope de gasto (sólo modelos Claude)
  pa <proyecto> --id ID                id de la corrida (default: la hora de lanzamiento)
  pa <proyecto> --olvidar              descartar la sesión guardada
  pa --modelos [--json]                tabla efectiva tipo → modelo, de dónde salió, líder, excluir, locales y cupo
  pa --plan [pro|max]                  ver / cambiar el plan de la suscripción (pro = modo ahorro, el default)
  pa --estado                          qué corre ahora, qué espera puesto y qué sesión hay guardada por proyecto
  pa --hilos [--json] [--todo]         las corridas (vivas y terminadas) de todos los proyectos
  pa --hilo <id> [--json] [-n N] [--antes N]   el hilo de mensajes de una corrida
  pa --parar <id>                      bajar esa corrida, corriendo o en cola
  pa --archivar <id>                   sacar una corrida terminada de la vista de la app
  pa --esperar <proyecto> [--timeout N] [--id ID]
                                       entregar el resultado más viejo no entregado (o el de la corrida ID);
                                       si no hay ninguno, bloquear hasta que el worker termine
  pa --esperar-todos [--timeout N]     cobrar TODAS las corridas async pendientes, de todos los proyectos
  pa --rinde [--dias N] [--json]       tipo × modelo × effort: n, % integrada sin retrabajo, mediana de turnos y costo
  pa --ayuda                           esta ayuda

Códigos de salida: 0 ok · 1 el worker falló · 2 error de uso · 75 no hay puesto libre (o tope global) · 76 límite de sesión ·
                   77 API sobrecargada · 78 terminó sin RESULTADO · 79/80 --integrar se negó / chocó ·
                   81 la instalación de claude está rota · 83 la rama trae un symlink peligroso · 84 claude no está en el PATH ·
                   87 no pude preparar el worktree del puesto (nunca cae al tree principal) · 130 matado.

Puestos: hasta PA_PUESTOS (default 3) workers que escriben corren EN PARALELO en el mismo proyecto, cada uno en su worktree
fijo (worktrees/<slug>, worktrees/<slug>@2, …) y su rama pa/<slug>/<id>. El jefe integra con --integrar; pa nunca mergea solo.
Tope global: PA_TOPE (o el archivo "tope" del estado; default 10) workers vivos entre todos los proyectos.
`;
