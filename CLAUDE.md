# Trama

- Rutas, PATH y búsqueda de ejecutables por plataforma salen de `app/electron/plataforma.ts` (funciones puras con `(plataforma, env, home)`; Windows se prueba desde Linux). No armes `~/.config/...` ni `split(":")` a mano.
- Tests: `node --test tests/` no anda en este Node (lo toma como archivo); usá `node --test tests/*.test.ts` o archivos sueltos. Fallan también en la base: dictado (timeout), nucleo, remoto-armar, remoto-recarga; `maquina-cliente` falla si corre en paralelo con otra suite (puertos).
