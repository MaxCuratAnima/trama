// Volver como estaba tras el reinicio que pide Ana (electron/volver.ts): el archivo que se deja al salir
// y se gasta al arrancar.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { crearGuardadoVolver, guardarVolver, leerVolver } from "../electron/volver.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "trama-volver-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("lo que se guarda vuelve igual, en cada arranque (no se gasta al leerlo)", () => {
  const f = path.join(tmp, "a", "volver.json");
  const ventana = { ancho: 1000, alto: 700, visible: true, foco: true };
  const vistas = { ventana: { activa: "lider:s1", panel: null, scrolls: { "lider:s1": 340 } } };
  guardarVolver(f, { ventana, vistas });
  for (const vuelta of [1, 2, 3]) {
    const v = leerVolver(f);
    assert.deepEqual({ ventana: v?.ventana, vistas: v?.vistas }, { ventana, vistas }, `lectura ${vuelta}`);
    assert.equal(existsSync(f), true, "leerlo no lo borra");
  }
});

test("sin límite de edad: uno de hace un mes también vuelve", () => {
  const f = path.join(tmp, "viejo.json");
  const hace_un_mes = Date.now() - 30 * 24 * 3600_000;
  guardarVolver(f, { ventana: { ancho: 800, alto: 600, visible: false, foco: false }, vistas: { ventana: { activa: "x" } } }, hace_un_mes);
  const v = leerVolver(f);
  assert.equal(v?.cuando, hace_un_mes);
  assert.deepEqual(v?.vistas, { ventana: { activa: "x" } });
  assert.equal(v?.ventana?.ancho, 800);
});

test("uno roto, de otra versión o sin ventana válida no se aplica", () => {
  const f = path.join(tmp, "b.json");
  assert.equal(leerVolver(f), null, "ausente");
  writeFileSync(f, "{no es json");
  assert.equal(leerVolver(f), null);
  writeFileSync(f, JSON.stringify({ version: 2, cuando: Date.now(), ventana: null, vistas: {} }));
  assert.equal(leerVolver(f), null);
  writeFileSync(f, JSON.stringify({ version: 1, cuando: Date.now(), ventana: { ancho: 5, alto: "x" }, vistas: [] }));
  const v = leerVolver(f);
  assert.equal(v?.ventana, null, "un tamaño imposible no se usa");
  assert.deepEqual(v?.vistas, {});
  writeFileSync(f, JSON.stringify({ version: 1, cuando: Date.now(), ventana: { ancho: 800, alto: 600 }, vistas: {} }));
  assert.deepEqual(leerVolver(f)?.ventana, { ancho: 800, alto: 600, visible: false, foco: false });
});

test("el guardado: varios avisos seguidos hacen una sola escritura, y 'ahora' escribe ya", async () => {
  const f = path.join(tmp, "g", "volver.json");
  const v = { ancho: 900, alto: 600, visible: true, foco: false };
  const g = crearGuardadoVolver({ archivo: f, ventana: () => v, demoraMs: 30 });
  g.vista({ activa: "a" });
  g.vista({ activa: "b" });
  g.tocar();
  assert.equal(existsSync(f), false, "no escribe antes de la demora");
  await new Promise((r) => setTimeout(r, 90));
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "b" } }, "lo último");
  assert.equal(leerVolver(f)?.ventana?.ancho, 900);
  g.vista({ activa: "c" });
  g.ahora();
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "c" } }, "ahora no espera");
  g.congelar();
  g.vista({ activa: "d" });
  g.ahora();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "c" } }, "congelado no pisa lo escrito");
});

test("el guardado arranca con la vista de la vez anterior si la ventana todavía no dijo nada", () => {
  const f = path.join(tmp, "h", "volver.json");
  const g = crearGuardadoVolver({ archivo: f, ventana: () => null, vistaInicial: { activa: "antes" }, demoraMs: 10 });
  g.ahora();
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "antes" } }, "cerrar sin abrir nada no pierde lo de antes");
  assert.equal(leerVolver(f)?.ventana, null);
});
