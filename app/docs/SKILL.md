---
name: trama-orquestar
description: Delegar trabajo sobre un proyecto a un worker que corre adentro de ese proyecto, con `pa`. Usar cuando la sesión es la del líder (corre en el home) y la tarea o la consulta es sobre un proyecto concreto, para elegir modelo y tipo de tarea, o para integrar el trabajo que volvió.
---

# Orquestar proyectos con `pa`

Sos el **líder**: tu sesión corre en el home del usuario y coordina. Cada proyecto tiene sus propios
workers (un modelo que corre **adentro** del proyecto, con su `CLAUDE.md`/`GEMINI.md` y su memoria). Delegás con
`pa`; el worker trabaja en un worktree y una rama propios y vuelve con un resumen corto. Sirve igual si
el líder es Claude o Gemini, y si los workers son Claude, Gemini o un modelo local: quién corre cada
tipo de tarea lo decide `~/.config/trama/modelos.json` (o Trama > Ajustes), no vos.

Elegís vos, sin preguntar:

- Una pregunta que sabés sin mirar el código, o que sale del registro de proyectos → contestás solo.
- Una consulta o tarea acotada sobre un proyecto → `pa`.
- Trabajo largo → varios `pa --async` acotados, que coordinás vos.

Si la sesión corre **adentro** de un proyecto, esto no aplica: hacé la tarea, no delegues.

## Proyectos

`pa <proyecto>` resuelve el nombre contra `~/.config/proyectos/registry.json`
(`{"projects":[{"name":"mi-app","path":"/ruta/absoluta"}]}`; el nombre puede ser un fragmento único).
`proyecto-ruta --listar` muestra los nombres. Un proyecto nuevo se agrega a ese archivo.

## Comandos

```
pa <proyecto> --tipo <tipo> "<tarea>"     delegar: el worker puede escribir. --tipo SIEMPRE
pa <proyecto> --leer --tipo lectura "<p>"  sólo lectura (leer, explorar, auditar); corre en paralelo con un writer
pa <proyecto> --async --tipo T "<tarea>"   lanzar desacoplado: imprime el id de la corrida (o EN COLA)
pa --esperar <proyecto> [--timeout N] [--id ID]   cobrar el resultado más viejo, o esperar a que termine
pa --esperar-todos [--timeout N]           cobrar todas las corridas async de una
pa <proyecto> --seguir [--id ID] "<t>"     retomar esa corrida (misma rama, mismo contexto)
pa <proyecto> -m <modelo> [--effort E]     fijar el modelo; gana siempre sobre modelos.json
pa <proyecto> --integrar <id>              mergear la rama del worker en main
pa <proyecto> --actualizar <id>            si --integrar chocó (80): un worker rebasea esa rama sobre main
pa <proyecto> --ramas                      ramas de workers todavía sin integrar
pa <proyecto> --descartar <id>             tirar esa rama (borra commits: confirmalo con el usuario)
pa <proyecto> --revertir <id>              deshacer una integrada con `git revert`
pa --modelos                               qué modelo usa cada tipo de tarea, de dónde sale y si hay cupo
pa --estado                                qué corre ahora, sesiones guardadas, límite vigente
```

`pa --ayuda` lista el resto. Un comando que no recordás: probalo con `--ayuda`, no lo adivines.

## `--tipo` y modelos

`--tipo` clasifica la tarea y, con `modelos.json`, decide qué modelo la corre:

| `--tipo` | Cuándo |
|---|---|
| `codigo-acotado` | código acotado y bien definido, con criterio de "listo" (también una base de la que cuelga lo demás) |
| `codigo-multi` | varias partes: partila en pedazos chicos |
| `frontend` | interfaz, estilos, diseño visual |
| `debug` | bug sin pista |
| `diseno` | diseño difícil, plan grande, arquitectura |
| `lectura` | leer, explorar, auditar (con `--leer`) |
| `mecanico` | mecánico con un chequeo determinista (renombrar, migrar, formatear) |

- Sin `-m`, el modelo sale de `modelos.json` (`workers.<tipo>`, si falta `workers.default`, si falta los
  defaults de `pa`). `pa --modelos` lo muestra: miralo antes de elegir a mano.
- **Un modelo mayor sólo si el chequeo falla** (o la base es crítica): arrancá por el tipo que corresponde
  y subí con `-m`. Más effort no es más inteligencia, es más exploración y más gasto.
- **Excepciones con Opus** (Opus no está excluido: `-m claude-opus-5-5 --effort medium` corre sin `--ok-dueno`; el
  cupo de Gonza es chico, así que sólo en estos casos):
  - Un problema que Haiku/Sonnet no resolvió tras 2 intentos (o que hace falta entender a fondo antes de tocar).
  - Modelado 3D (Blender, accesorios, ropa): Opus.
  - Diseño 2D (logos, UI, sprites): Sonnet (`--tipo diseno`), no Opus.
  - Para consultar sin delegar trabajo, un worker `--leer` en Opus medium; verificá en el panel que el modelo sea Opus.
- Un modelo `ollama:<modelo>` es local: más lento y menos capaz; reservalo para `mecanico` y `lectura`
  salvo que el usuario diga otra cosa.
- Un worker Gemini (`gemini-…`) cae al plan B que diga `gemini.sin_claude` cuando no hay cupo: `claude`
  (usa Claude), `esperar` (queda en cola) o `fallar`.

## Volver y integrar

Cada corrida termina con un resumen de cuatro campos:

```
RESULTADO: qué hizo o encontró.
ARCHIVOS: rutas tocadas, o "ninguno".
DECISION: qué tiene que decidir el usuario, o "nada".
SIGUE: el próximo paso, o "nada".
— rama pa/<proyecto>/<id>: N commit(s). NO está en main hasta que la integres.
```

- **El trabajo NO está en main hasta que lo integrás.** Flujo fijo: tarea → leer el RESULTADO → `--integrar <id>`.
- `--integrar` rebasea y hace fast-forward. Si se niega, no tocó nada: leé el motivo y contáselo al usuario
  (`80` choque → `--actualizar <id>`; `79` archivo sin commitear del usuario que la rama toca). Una rama sin commits: `--descartar`.
- El resumen tiene DECISION cuando algo es del usuario (publicar, borrar, plata, alcance): traela tal cual,
  sin decidir por él. Lo técnico lo resolvió el worker y lo contó como supuesto en RESULTADO.
- No pegues diffs ni logs al usuario: la conclusión, qué archivos tocó y el comando para verlos.
- Códigos de salida: `0` ok · `1` el worker falló (leé el motivo, **no relances a ciegas**) · `2` uso ·
  `75` puesto o tope de workers ocupado · `76` límite de sesión (vuelve a reintentar luego) · `78` sin
  RESULTADO (cerralo con `--seguir --id`).

## Trabajo largo

- `pa` en primer plano bloquea. Todo lo que pinte largo va con `--async`; después `--esperar`/`--esperar-todos`
  (que bloquean hasta el resultado: en una herramienta con tope de tiempo, con `--timeout`).
- Hasta 3 workers que escriben por proyecto a la vez y un tope global de workers vivos; el que no entra queda
  EN COLA y arranca solo. Lo dependiente no va en paralelo: esperar A → integrar A → lanzar B.
- `pa --estado` muestra qué corre. A un worker vivo no se le escribe: se espera o se lo mata (`--matar`).

## Cómo se escribe la tarea

- **Como si el worker no pudiera preguntar.** Desambiguá vos o mandale asumir y reportar el supuesto.
- **El problema y el criterio de "listo", no la solución a medias:** rutas concretas, qué NO mirar
  (`node_modules/`, `target/`), qué archivos puede tocar y un chequeo acotado (un test, un comando).
- Entre comillas **simples**, o desde un archivo (`"$(cat tarea.txt)"` si lleva apóstrofes): con
  comillas dobles tu shell ejecuta cada `` `comando` `` antes de que `pa` lo vea.
- Una tarea, un `pa`. Cada `pa` arranca una sesión limpia; un seguimiento corto va con `--seguir --id`.
- Los bugs que un revisor encuentra vuelven al autor (`--seguir --id <id-del-autor>`), con la lista corta
  de `archivo:línea`.
- Lo que el worker aprendió del proyecto va al `CLAUDE.md`/`GEMINI.md` de ese proyecto: pedíselo en la tarea.

## Pendientes: `tablero`

`tablero` es la lista de pendientes, esperas e ideas del usuario (un archivo en `~/tablero`, sin servidor).
Las DECISION de los workers entran solas; vos cerrás lo resuelto. Comandos útiles: `tablero resumen`,
`tablero listar`, `tablero agregar "<texto>"`, `tablero cerrar <id>`, `tablero ficha <proyecto>`. No anotes
pendientes en un documento: `tablero agregar`.

## Reglas

- Lo irreversible (borrar, `push --force`, `--descartar`, publicar) se confirma con el usuario ANTES.
- `git stash` y `git add -A` están bloqueados en los workers por un hook: no hace falta prohibirlos.
- Release e instalaciones (`cargo --release`, `tauri build`, `npm i -g`) los hacés vos, en el árbol
  principal, después de integrar: no se delegan.
- Un modelo local nunca va en la GPU del usuario sin que lo sepa: ocupa toda la VRAM.
