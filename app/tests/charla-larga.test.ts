// La conversación larga de muestra (`charlaLarga`, la que mide scripts/medir-larga.mjs): 3000 mensajes distintos y en orden, y `turnos()`
// los arma en un tiempo corto con una clave estable y única por renglón (de eso depende que la lista memoizada no se vuelva a pintar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

Object.assign(globalThis, { location: { search: "?fixtures=0" }, window: {} });

const { charlaLarga } = await import("../src/datos/fixtures.ts");
const { turnos } = await import("../src/hilo/turnos.ts");
const SID = "s-fix-a3";

test("charlaLarga: 3000 mensajes en orden, cada uno distinto", () => {
  const ms = charlaLarga(SID);
  assert.equal(ms.length, 3000);
  assert.ok(ms.every((m, k) => m.i === k));
  const ts = ms.map((m) => Date.parse(m.ts ?? ""));
  assert.ok(ts.every((t, k) => Number.isFinite(t) && (k === 0 || t >= ts[k - 1])));
  const textos = ms.filter((m) => m.texto).map((m) => m.texto);
  assert.equal(new Set(textos).size, textos.length);
  assert.ok(ms.at(-1)?.texto.includes("caso 999"));
});

test("charlaLarga: un líder que no existe no inventa nada", () => {
  assert.deepEqual(charlaLarga("no-existe"), []);
});

test("turnos de 3000 mensajes: una clave única por renglón, igual si se arma dos veces, y rápido", () => {
  const ms = charlaLarga(SID);
  const t0 = performance.now();
  const a = turnos(ms);
  const dt = performance.now() - t0;
  const b = turnos(ms);
  assert.ok(a.length >= 1000, `armó ${a.length} renglones`);
  assert.equal(new Set(a.map((x) => x.key)).size, a.length);
  assert.deepEqual(a.map((x) => x.key), b.map((x) => x.key));
  assert.ok(dt < 1000, `tardó ${Math.round(dt)} ms`);
});
