// "Actualizando Trama…" (src/actualizando.ts): la secuencia de pasos sólo avanza, cada paso es algo que pasó de verdad,
// y la ventana que se va y la que llega recorren los suyos. Con un `window.__act` y un `window.hilos` falsos
// (los de index.html y el preload), y la ventana nueva armada como la arma el main (`?actualizando=1`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pantalla: string[] = [];
const marcas: string[] = [];
let sobre: ((r: unknown) => void) | null = null;
let conexion: ((ok: unknown) => void) | null = null;
let respondeElMotor: () => void = () => {};
const sinSoltar = () => () => {};
Object.assign(globalThis, {
  location: { search: "?actualizando=1&fixtures=0" },
  window: {
    __act: { paso: (n: number, velo: boolean) => pantalla.push(`${n}${velo ? "v" : ""}`), fin: () => pantalla.push("fin") },
    hilos: {
      reinicio: {
        leer: () => new Promise((ok) => (respondeElMotor = () => ok({ hay: false, pedido: false, tareas: 0, saliendo: false, espera: [], integrando: false, colgado: false }))),
        alCambiar: (fn: (r: unknown) => void) => ((sobre = fn), sinSoltar()),
        marca: async (paso: string) => void marcas.push(paso),
      },
      conexion: { alCambiar: (fn: (ok: unknown) => void) => ((conexion = fn), sinSoltar()) },
    },
  },
});

const { armarActualizando, crearSecuencia, listaLista, SE_RINDE_MS } = await import("../src/actualizando.ts");
const espera = () => new Promise((r) => setTimeout(r, 5));

test("la ventana que llega: Reiniciando de entrada, Reconectando al montar, Cargando con la primera respuesta, y se va con la primera lista", async () => {
  armarActualizando();
  assert.deepEqual(pantalla, ["3"], "montó: paso 3 (el 2 ya lo puso index.html)");
  assert.deepEqual(marcas, ["pagina-monto"]);
  respondeElMotor();
  await espera();
  assert.deepEqual(pantalla, ["3", "4"]);
  listaLista();
  listaLista();
  assert.deepEqual(pantalla, ["3", "4", "fin"], "el cartel se va una sola vez");
  assert.deepEqual(marcas, ["pagina-monto", "pagina-conecto", "lista"]);
  sobre?.({ saliendo: true });
  conexion?.(false);
  assert.deepEqual(pantalla, ["3", "4", "fin"], "una ventana que llega no vuelve a mostrar el cartel de la que se va");
});

test("la ventana que se va: Preparando con el aviso del motor, Reiniciando al caer la conexión; sin aviso, una caída no muestra nada", () => {
  const vistos: string[] = [];
  const rindes: [() => void, number][] = [];
  const s = crearSecuencia({ pantalla: { paso: (n, v) => vistos.push(`${n}${v ? "v" : ""}`), fin: () => vistos.push("fin") }, llega: false, seRinde: (fn, ms) => rindes.push([fn, ms]) });
  s.motorCaido();
  assert.deepEqual(vistos, [], "el motor se cayó solo: no es una actualización");
  s.monto();
  s.lista();
  assert.deepEqual(vistos, [], "lo de la ventana que llega no cuenta acá");
  s.saliendo();
  s.saliendo();
  s.motorCaido();
  s.saliendo();
  assert.deepEqual(vistos, ["1v", "2v"], "sólo avanza, y con velo (se ve la app detrás)");
  assert.equal(rindes.length, 1);
  assert.equal(rindes[0][1], SE_RINDE_MS);
  rindes[0][0]();
  assert.deepEqual(vistos, ["1v", "2v", "fin"], "si el reinicio nunca sale, deja de tapar");
});

test("los pasos nunca retroceden ni se repiten", () => {
  const vistos: number[] = [];
  const s = crearSecuencia({ pantalla: { paso: (n) => vistos.push(n), fin: () => {} }, llega: true });
  s.conecto();
  s.monto();
  s.monto();
  s.conecto();
  assert.deepEqual(vistos, [4], "arrancó en el 2; el 4 adelanta al 3 y el 3 ya no vuelve");
});
