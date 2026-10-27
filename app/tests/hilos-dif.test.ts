// La lista de hilos por diferencias: lo que arma el main (electron/hilos-dif.ts), lo que aplica la ventana
// (src/datos/hilos-dif.ts) y cómo la recibe src/datos/fuente.ts, incluido pedir la entera si se pierde una.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Envio = { n: number; datos?: unknown; error?: string; dif?: any };
let oyente: ((l: Envio) => void) | null = null;
let entera: Envio = { n: 0, datos: { version: 1, hilos: [] } };
let pedidas = 0;
Object.assign(globalThis, {
  location: { search: "?fixtures=0" },
  window: {
    hilos: {
      hilos: {
        leer: async () => entera,
        completa: async () => (pedidas++, entera),
        guardados: async () => null,
        alCambiar: (fn: (l: Envio) => void) => ((oyente = fn), () => {}),
        alEvento: () => () => {},
      },
    },
  },
});

const { crearEmisor } = await import("../electron/hilos-dif.ts");
const { aplicarDif } = await import("../src/datos/hilos-dif.ts");
const { fuente } = await import("../src/datos/fuente.ts");

const hilo = (id: string, extra: Record<string, unknown> = {}) => ({ id, proyecto: "atlas", tarea: "T " + id, estado: "trabajando", resultado: "x".repeat(200), ...extra });
const lista = (n: number, hilos: unknown[], extra: Record<string, unknown> = {}) => ({ n, datos: { version: 1, hilos, ...extra } });
const ids = (r: { hilos: { id: string }[] }) => r.hilos.map((h) => h.id);

test("hilos-dif: la primera lista va entera y la siguiente sólo lo que cambió", () => {
  const e = crearEmisor();
  const a = lista(1, [hilo("a"), hilo("b"), hilo("c"), hilo("d")]);
  assert.equal(e.siguiente(a), a);
  const r = e.siguiente(lista(2, [hilo("a"), hilo("b", { estado: "listo" }), hilo("c"), hilo("d"), hilo("e")]));
  assert.ok("dif" in r);
  assert.equal(r.n, 2);
  assert.deepEqual(r.dif.cambiados.map((h: any) => h.id), ["b"]);
  assert.deepEqual(r.dif.agregados.map((h: any) => h.id), ["e"]);
  assert.deepEqual(r.dif.quitados, []);
  assert.equal(r.dif.base, 1);
  assert.equal(r.dif.total, 5);
  assert.equal(r.dif.orden, undefined, "agregar al final no cambia el orden");
});

test("hilos-dif: quitar, agregar y reordenar: aplicar da la lista de pa en su orden", () => {
  const e = crearEmisor();
  const hs0 = ["a", "b", "c", "d", "e", "f"].map((id) => hilo(id));
  e.siguiente(lista(1, hs0));
  // pa pone un hilo nuevo al principio, saca c y mueve f.
  const hs1 = [hilo("nuevo"), hilo("a"), hilo("b"), hilo("f"), hilo("d"), hilo("e")];
  const r = e.siguiente(lista(2, hs1));
  assert.ok("dif" in r);
  assert.deepEqual(r.dif.quitados, ["c"]);
  assert.deepEqual(r.dif.orden, ["nuevo", "a", "b", "f", "d", "e"]);
  const filas = new Map(hs0.map((h) => [h.id, h]));
  const sale = aplicarDif(filas, r.dif, (h) => h as any)!;
  assert.deepEqual([...sale.keys()], ["nuevo", "a", "b", "f", "d", "e"]);
  assert.equal(sale.get("a"), filas.get("a"), "lo que no cambió conserva su objeto");
});

test("hilos-dif: un error, una lista sin forma o ids repetidos: la siguiente va entera", () => {
  const e = crearEmisor();
  const base = [hilo("a"), hilo("b"), hilo("c"), hilo("d")];
  e.siguiente(lista(1, base));
  const err = { n: 2, error: "pa se cayó" };
  assert.equal(e.siguiente(err), err);
  assert.equal(e.completa(), null);
  const l3 = lista(3, base);
  assert.equal(e.siguiente(l3), l3, "tras el error no hay con qué comparar");
  assert.equal(e.completa(), l3);
  const rara = { n: 4, datos: { version: 2, hilos: base } };
  assert.equal(e.siguiente(rara), rara);
  const repetidos = lista(5, [hilo("a"), hilo("a")]);
  assert.equal(e.siguiente(repetidos), repetidos);
  const sinId = lista(6, [hilo("a"), { tarea: "sin id" }]);
  assert.equal(e.siguiente(sinId), sinId);
});

test("hilos-dif: cada tanto va la entera, y si casi todo cambió también", () => {
  const e = crearEmisor(3);
  const base = Array.from({ length: 20 }, (_, i) => hilo("h" + i));
  e.siguiente(lista(1, base));
  const tipos: string[] = [];
  for (let n = 2; n <= 8; n++) {
    const r = e.siguiente(lista(n, base.map((h, i) => (i === 0 ? { ...h, tarea: "cambio " + n } : h))));
    tipos.push("dif" in r ? "dif" : "entera");
  }
  assert.deepEqual(tipos, ["dif", "dif", "dif", "entera", "dif", "dif", "dif"]);
  const todo = lista(9, base.map((h) => ({ ...h, estado: "listo", tarea: "otra " + h.id })));
  assert.equal(e.siguiente(todo), todo, "una diferencia casi tan grande como la lista no ahorra nada");
});

test("hilos-dif: pesa una fracción de la entera cuando casi nada cambia", () => {
  const e = crearEmisor();
  const base = Array.from({ length: 780 }, (_, i) => hilo(`20261003-${i}`, { resultado: "x".repeat(300) }));
  const a = lista(1, base);
  e.siguiente(a);
  const r = e.siguiente(lista(2, base.map((h, i) => (i === 7 ? { ...h, estado: "listo" } : h))));
  assert.ok("dif" in r);
  assert.ok(JSON.stringify(r).length * 50 < JSON.stringify(a).length, `${JSON.stringify(r).length} vs ${JSON.stringify(a).length}`);
});

test("hilos-dif: aplicar una diferencia que no cierra da null (pedir la entera)", () => {
  const filas = new Map([["a", 1], ["b", 2]]);
  const dif = (x: object) => ({ base: 1, total: 2, agregados: [], cambiados: [], quitados: [], ...x }) as any;
  assert.equal(aplicarDif(filas, dif({ quitados: ["zzz"] }), () => 0), null);
  assert.equal(aplicarDif(filas, dif({ cambiados: [{ id: "zzz" }] }), () => 0), null);
  assert.equal(aplicarDif(filas, dif({ agregados: [{ id: "a" }] }), () => 0), null);
  assert.equal(aplicarDif(filas, dif({ total: 3 }), () => 0), null);
  assert.equal(aplicarDif(filas, dif({ orden: ["a", "zzz"] }), () => 0), null);
  assert.deepEqual([...aplicarDif(filas, dif({}), () => 0)!.keys()], ["a", "b"]);
});

test("hilos-dif: la ventana arma la misma lista por diferencias que con las enteras, y pide la entera si se le pierde una", async () => {
  const emisor = crearEmisor();
  // Con pocos hilos una diferencia pesa lo mismo que la lista y va la entera.
  const fijos = Array.from({ length: 12 }, (_, i) => hilo("z" + i));
  const ids = (r: { hilos: { id: string }[] }) => r.hilos.map((h) => h.id).filter((id) => !id.startsWith("z"));
  const mandar = (l: Envio) => oyente!(l);
  let avisos = 0;
  fuente.alCambiarHilos(() => avisos++);

  const l1 = lista(1, [hilo("a"), hilo("b", { tarea: "" }), hilo("c"), ...fijos]);
  entera = l1;
  assert.deepEqual(ids(await fuente.hilos()), ["a", "b", "c"]);
  assert.equal((await fuente.hilos()).hilos[1].tarea, "", "la tarea vacía queda como vacía");
  const e1 = emisor.siguiente(l1);
  mandar(e1 as Envio);
  assert.equal(avisos, 0, "la misma lectura que ya se tenía no avisa");

  const antes = (await fuente.hilos()).hilos;
  const l2 = lista(2, [hilo("a"), hilo("b", { estado: "listo" }), hilo("c"), hilo("d"), ...fijos]);
  const e2 = emisor.siguiente(l2);
  assert.ok("dif" in e2);
  entera = l2;
  mandar(e2 as Envio);
  assert.equal(avisos, 1);
  const d2 = (await fuente.hilos()).hilos;
  assert.deepEqual(ids({ hilos: d2 }), ["a", "b", "c", "d"]);
  assert.equal(d2[0], antes[0], "la fila que no cambió es el mismo objeto");
  assert.equal(d2[2], antes[2]);
  assert.equal(d2[1].estado, "listo");
  assert.equal(pedidas, 0);

  // Se pierde la lectura 3: la 4 parte de otra base. Se pide la entera y queda igual que la de pa.
  const l3 = lista(3, [hilo("a", { estado: "listo" }), hilo("b", { estado: "listo" }), hilo("c"), hilo("d"), ...fijos]);
  emisor.siguiente(l3);
  const l4 = lista(4, [hilo("a", { estado: "listo" }), hilo("b", { estado: "listo" }), hilo("c", { estado: "colgado" }), hilo("d"), ...fijos]);
  const e4 = emisor.siguiente(l4);
  assert.ok("dif" in e4);
  entera = emisor.completa() as Envio;
  mandar(e4 as Envio);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pedidas, 1);
  assert.equal(avisos, 2);
  const d4 = (await fuente.hilos()).hilos;
  assert.deepEqual(d4.filter((h) => !h.id.startsWith("z")).map((h) => h.estado), ["listo", "listo", "colgado", "trabajando"]);

  // Una diferencia vieja (ya se tiene algo más nuevo) se ignora sin pedir nada.
  mandar(e2 as Envio);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pedidas, 1);
  assert.equal(avisos, 2);

  // Y el hilo sigue: la que sigue a la 4 cierra sin pedir.
  const l5 = lista(5, [hilo("a", { estado: "listo" }), hilo("b", { estado: "listo" }), hilo("c", { estado: "colgado" }), ...fijos]);
  const e5 = emisor.siguiente(l5);
  assert.ok("dif" in e5);
  mandar(e5 as Envio);
  assert.deepEqual(ids(await fuente.hilos()), ["a", "b", "c"]);
  assert.equal(pedidas, 1);
});
