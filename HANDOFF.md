# HANDOFF: pa en TypeScript, tarea 7 (`--esperar` y `--esperar-todos`)

Rama: `pa/trama/20261026-012416-214647` (sacada de main). No mergeada.

## Hecho
- `app/electron/cli/pa-esperar.ts`: `esperar` y `esperarTodos` con sus helpers, port de `cmd_esperar` y `cmd_esperar_todos` de `motor/bin/pa`. Salidas y rc iguales al bash. Cubre: entrega en orden, `--id`, vencidos de más de un día, `--leer`, claude en rc 84, writer vivo con `--timeout` (rc 75), corrida de otro jefe, y `--esperar-todos` en orden alfabético.
- `app/tests/pa-esperar.test.ts`: 10 casos, incluido el de paridad con `motor/bin/pa` (corre bash/jq/flock).
- `app/tests/pa-cli-estado.test.ts`: el caso del esqueleto de `--esperar` ya no espera el stub.

## Pendiente
- `solapamiento` (aviso de solapamiento en `linea_rama`) no está portado: depende de `ramas_sin_integrar` (bash ~1045), que todavía no existe en TS.
- Windows: `jefeId` devuelve "" (no hay walk de `/proc`).
- `rutaPorSlug` en `app/electron/cli/contexto.ts` sigue usando el registry directo. Cambiarlo para que se apoye en `proyecto-ruta.ts`, después de integrar.
- Tarea 6 (`pa-lanzar.ts`) vive en la rama `pa/trama/20261026-012300-209911`, no acá. Al integrar, habrá conflicto esperable en `app/tests/pa-cli-estado.test.ts` (el caso que dice "pa-lanzar es esqueleto") y en `app/electron/cli/pa-lanzar.ts`.

## Archivos tocados
- `app/electron/cli/pa-esperar.ts`
- `app/tests/pa-esperar.test.ts` (nuevo)
- `app/tests/pa-cli-estado.test.ts`

## Cómo verificar
```
timeout 540 node --test --test-timeout=60000 app/tests/pa-esperar.test.ts app/tests/pa-cli-estado.test.ts
timeout 280 app/node_modules/.bin/tsc -p app/tsconfig.electron.json --noEmit
```
Último resultado: 22 de 22 pasan (ninguno salteado) y `tsc` sale en 0.
