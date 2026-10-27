# Trama por la tailnet (el celular)

Con trama abierta en la PC, la misma interfaz se abre en el navegador de otro dispositivo de la
tailnet, con los mismos datos en vivo. No hay segunda app ni segundo backend: el navegador le habla
al main de Electron que ya está corriendo. Código: `electron/remoto.ts` (servidor),
`electron/remoto-cliente.ts` (lo que corre en el navegador), `electron/tailnet.ts` (quién entra).

## Prenderlo

Apagado por default. Se prende desde **Ajustes → Acceso desde el celular** (Dejar entrar al celular: Prendido / Apagado,
puerto y lista de dispositivos, con Guardar y Cancelar), o a mano en `%LOCALAPPDATA%\Trama\state\hilos\remoto.json`. Al guardar,
trama relee el archivo y vuelve a armar los servidores sin reiniciar: un dispositivo quitado se corta en el acto.

```json
{ "version": 1, "puerto": 8791, "dispositivos": ["mi-celu"] }
```

- `puerto`: 1024–65535. Se escucha **sólo en las IPs de Tailscale de esta máquina** (v4 y v6); dónde se escucha no se elige.
- `dispositivos`: nombres cortos de la tailnet (`tailscale status`) que pueden entrar. Hasta 20. Una dirección (`0.0.0.0`,
  `100.x.y.z`, nada con `.` ni `:`) se rechaza como nombre. Vacío, mal escrito o sin el archivo: no se abre ningún puerto.
- `activo: false` (sólo aparece cuando se apaga desde Ajustes): conserva puerto y dispositivos pero no abre nada.
- Un campo que no es de esta lista (por ejemplo `host`) se rechaza al guardar: no hay forma de escribir otro bind.
- Desde el celular la sección no se ve: el acceso sólo se cambia desde la PC (`remoto:guardar` contesta `main.remotoSoloPc`).

Al arrancar, el main dice en stderr `[remoto] http://<nombre>:<puerto>/ …`. Si Tailscale todavía no
levantó, reintenta a los 5, 15 y 60 s y después no insiste.

Dos maneras de llegar:

| | URL | Hace falta |
|---|---|---|
| Directa | `http://<pc>:<puerto>/` (MagicDNS) o `http://<ip-de-tailscale>:<puerto>/` | nada |
| Con `tailscale serve` | `https://<pc>.<tailnet>.ts.net:<puerto-https>/` | una vez, con sudo: `sudo tailscale serve --bg --https=<puerto-https> http://<ip-de-tailscale>:<puerto>` |

La directa es http pelado: el tráfico igual va cifrado por WireGuard, pero para el navegador no es
un contexto seguro, así que "Agregar a la pantalla principal" deja un acceso directo que abre con la
barra del navegador. Por `tailscale serve` es https con certificado válido: Chrome ofrece
"Instalar app" y abre a pantalla completa (`public/manifest.webmanifest`, `display: standalone`).
Con trama en dos máquinas (la PC y el Dell) cada una sirve su propia entrada: título, color, manifest e ícono
según `maquinas.json`, así el celular tiene un acceso directo por máquina (`docs/estado/celular-maquinas.md`).
El destino de `serve` tiene que ser la IP de Tailscale (en `127.0.0.1` no hay nadie escuchando).
**Nunca `tailscale funnel`**: eso lo saca a internet.

## Modo local (sin Tailscale)

Con `TRAMA_LOCAL=1` en el entorno del motor (la unidad `trama-motor.service` del producto lo pone; `TRAMA_PUERTO` cambia el 8791) el
mismo servidor escucha **sólo en `127.0.0.1`** y no mira `remoto.json` ni Tailscale: lo abre un navegador de la misma máquina (en
Windows con WSL2, `localhost` se reenvía solo). Entra cualquier conexión desde loopback; el `Host` tiene que ser `localhost` o
`127.0.0.1` (DNS rebinding), el `Origin` y la cabecera de `/rpc` valen igual y `X-Forwarded-For` se ignora. Ajustes no ofrece el
acceso desde el celular. Sin la variable, nada de esto cambia. Detalle: `docs/estado/modo-local.md`.

## Quién entra

Quien llega a ese puerto maneja agentes que corren comandos en la PC. Por eso, en orden:

1. **Dónde se escucha**: sólo en las IPs de Tailscale. Nunca `0.0.0.0`, `::`, la LAN ni loopback
   (`escuchar` se niega). Por la IP de la LAN el puerto ni contesta.
2. **Host**: tiene que ser un nombre de esta máquina (el de MagicDNS, el corto o la IP). Corta el
   DNS rebinding.
3. **Origen**: un `Origin` que no sea el propio, o `Sec-Fetch-Site` de otro sitio, se rechaza (salvo
   navegar a la página). Los pedidos (`POST /rpc`) exigen `Origin`, `application/json` y la cabecera
   `x-trama-cliente`: una página de otro sitio no puede armarlos sin preflight, y el preflight no se contesta.
4. **Identidad**: la da Tailscale, no el pedido. `tailscale whois --json <ip de origen>` (sin sudo)
   dice de qué nodo y de qué usuario es la IP, que dentro de la tailnet autentica WireGuard. Entra
   sólo un nodo **sin etiquetas, del mismo usuario que esta máquina y anotado en `dispositivos`**.
   Si quien se conectó es esta misma máquina y viene `X-Forwarded-For`, es el proxy de
   `tailscale serve` (que pisa esa cabecera con la IP de origen): se usa esa IP. De cualquier otro
   origen la cabecera se ignora.

Sin identidad no se entrega **nada**: ni la página, ni el JS, ni el manifest (403, sin datos). La
respuesta de `whois` se recuerda 60 s (también el "no es nadie").

Lo que no cubre: un proceso local de la PC puede conectarse desde la IP de Tailscale propia y decir
cualquier `X-Forwarded-For`. Es el mismo usuario que ya maneja la PC; una página web abierta en un
navegador de la PC no puede (pasos 2 y 3).

## Cómo anda

- **El puente**: `/` es el `dist/index.html` de siempre con un `<script src="./remoto.js">` antes del
  módulo (el `index.html` de Electron no cambia). `/remoto.js` ejecuta **el `preload.cjs` de verdad**
  con un `electron` de mentira: `contextBridge.exposeInMainWorld` deja `window.hilos` y
  `ipcRenderer.invoke/on` van por red. No hay una segunda lista de canales que mantener.
- **Pedidos**: `POST /rpc` `{canal, args}` → `{ok, valor}` o `{ok: false, error}`. Corre el mismo
  manejador que el IPC (`llamarRemoto` en `electron/nucleo.ts`). Los bytes de un adjunto viajan como
  `{ "$bin": base64 }`.
- **Avisos**: `GET /eventos?c=<cliente>` (Server-Sent Events). Todo lo que el main le manda a la
  ventana (`enviar`) sale también por acá, numerado (`<época>-<n>`). Al reconectar (`desde=`), el
  servidor repite lo que faltó; de los canales que son un estado entero sólo el último. Si ya no lo
  tiene (5000 eventos) o trama se reinició (otra época), manda `resinc` y la página se recarga.
  Late cada 20 s; sin latidos en 50 s el navegador reconecta, y también al volver a la pestaña.
  `hilos:cambio` lleva la lista de `pa` **por diferencias** (`electron/hilos-dif.ts`: agregados, cambiados y quitados por
  id contra la lectura `base`): el celular que se perdió una (o recién conecta) no cierra con la base, pide `hilos:completa`
  y sigue; como de ese canal el servidor repite sólo el último, tras un corte siempre pasa por ahí.
- **Si se cae la conexión** (trama se reinició por un build nuevo, la PC reinició, el celular cambió de red): el puente
  no deja al `EventSource` por su cuenta (un 502 de `tailscale serve` lo cierra para siempre): en `onerror` lo cierra y
  reintenta él, primero a los 300 ms y sin decir nada (un corte suelto no parpadea), después cada 1, 2… hasta 5 s. Un
  intento sin respuesta se abandona a los 8 s, y un pedido (`/rpc`) que no llega a trama destapa la caída sin esperar
  los latidos. Mientras, la vista muestra "Reconectando con la PC…" (`src/Conexion.tsx`, canal `remoto:conexion`, que
  arma el puente: no viene del servidor). Al volver, lo de siempre: se repite lo que faltó, o `resinc` y se recarga
  sola (trama reiniciada es otra época). Nunca hace falta recargar a mano. Antes de recargarse (o de irse a segundo
  plano) la página guarda en el `sessionStorage` de la pestaña lo que tenía abierto y lo escrito sin mandar, y al cargar
  lo repone (`src/volver.ts`): una recarga no se lleva un borrador.
- **Actualización disponible**: el cartel de un build nuevo de trama sale también acá, con el mismo Reiniciar (canales
  `reinicio:*`, permitidos desde el celular). Tocarlo reinicia la trama de la PC; el celular dice "Reconectando con la
  PC…" y vuelve solo, con lo que tenía abierto y escrito.
- **El texto de un líder mientras llega** viaja por ese mismo flujo, igual que a la ventana: el
  main ya lo manda juntado (a lo sumo un evento cada 50 ms por líder, `PARCIAL_MS` en
  `electron/lider.ts`), no uno por token. No hay nada propio de la red que mantener.
- **Configuración de la ventana**: el idioma, la letra y la vista viajan en la query como en
  Electron (`consulta()` en `main.ts`); el puente la pone con `history.replaceState` antes de que
  cargue el frontend.
- **Sólo de la ventana**: `app:salir`, `lider:ir`, `lider:ubicable`, `claude:changelog` y `bench:*` no se
  piden por red (`SOLO_VENTANA`); "ver cambios" abre el changelog en el navegador del celular. "Ir a la
  ventana" enfoca una terminal en la pantalla de la PC: por red no se ofrece (`lider:ubicable` falla y
  el frontend lo toma como que no se la pudo ubicar). Traer a un líder de terminal (`lider:traer`) sí
  anda desde el celular: cierra ese `claude` en la PC y sigue en trama, igual que desde la ventana.
- **El transcript que se mira** es por vista (`mirarTranscript(vista, sid)`): el celular y la PC
  pueden estar en líderes distintos. Un cliente que no vuelve en 10 min suelta el suyo.

## Reglas al tocar

- Un canal nuevo se registra con `manejar` de `nucleo.ts` (ya queda para los dos lados)
  y se agrega al preload como siempre. Si es sólo de la ventana, a `SOLO_VENTANA`.
- El preload tiene que seguir pudiendo correr en un navegador: sólo `contextBridge` e `ipcRenderer`
  (`invoke`, `on`, `off`), nada más de `electron` ni de Node.
- `cliente()` viaja como texto (`toString()`): no puede usar nada de afuera de su cuerpo.
- Lo que el main le manda al renderer va por `enviar()`: un `webContents.send` suelto no llega al celular.
- Un manejador que necesite saber quién pide usa `quien(e)` (la ventana o el id del cliente remoto).

## Límites conocidos

- **Sin el proceso que sirve no hay nada**: el servidor vive en el motor (`electron/motor.ts`,
  `docs/estado/motor.md`) o, si no hay motor, en la ventana (todo en uno). Cerrar la ventana no lo toca. Por eso corre siempre,
  mientras la app esté abierta, y vuelve
  sola si muere (el motor a los 0,5 s) o al reiniciarlo por un build nuevo (el celular dice "Reconectando" y se pone al día). Sin sesión de Windows iniciada (la PC en la
  pantalla de bloqueo o de inicio de sesión) no hay trama. Lo escrito en la caja del celular sin mandar sobrevive a una recarga, pero
  no a cerrar la pestaña, y las imágenes adjuntas no se guardan.
- Lo que se le escribe a un líder desde un dispositivo aparece en el otro cuando termina el turno
  (la respuesta sí se ve en vivo en los dos). La cola de mensajes mientras responde es de cada dispositivo.
- Los atajos de teclado (Ctrl+N…) no existen en el celular; el layout para pantalla chica es otra pieza.
- Si cambia la IP de Tailscale (otra red, tailscale que se reinicia) el servidor se rearma solo en la nueva (`electron/remoto-armar.ts`:
  `ip -o monitor address dev tailscale0`, `HILOS_IP` para un falso, y un respaldo cada 5 min); no hace falta reiniciar nada.
- Sin Tailscale andando al arrancar se reintenta sola: a los 5, 15 y 60 s y después cada 5 min (al iniciar la sesión
  trama puede arrancar antes que la red).

## Probar

- `npm run build && node scripts/prueba-motor.mjs`: con el motor sin ventana y los fakes, matar la ventana no corta el `/rpc` del
  motor, reiniciarlo pasa por "Reconectando" y vuelve, y un cambio de IP (`HILOS_IP`, `HILOS_TAILSCALE` falsos) rearma el remoto.

- `node --test tests/remoto.test.ts tests/tailnet.test.ts`: el servidor en `127.0.0.1` con una
  identidad de mentira (rechazos, pedidos, avisos, el puente en un `vm`) y las reglas de identidad.
- `npm run build && node scripts/prueba-remoto.mjs`: de punta a punta contra la IP de Tailscale de
  esta máquina, con los fakes: 403 sin estar anotado, el puerto no contesta por LAN ni loopback, la
  página carga en un Chrome sin ventana, se le escribe a un líder falso desde ahí y se ve en la
  ventana de la PC, y al revés; y una respuesta larga se ve crecer en el navegador mientras llega. `HILOS_TAILSCALE` cambia el binario de `tailscale`.
