import { test } from "node:test";
import assert from "node:assert/strict";
import { cuota, diario, etiquetas, familia, inicioSemana, resumir, semanas, tendencia } from "../src/paneles/resumen.ts";
import type { Corrida, Muestra } from "../src/datos/paneles.ts";

// Fechas locales (mes de 1 a 12): los tests andan en cualquier huso horario.
const t = (m: number, d: number, h = 12, min = 0) => new Date(2026, m - 1, d, h, min).getTime() / 1000;
const c = (ts: number, o: Partial<Corrida> = {}): Corrida => ({
  ts,
  proyecto: "atlas",
  modelo: "claude-opus-5-5",
  duracion_s: 60,
  tokens: 1000,
  bien: null,
  compactaciones: null,
  cache_read: null,
  ...o,
});

test("la semana arranca el lunes y el domingo es el último día", () => {
  // 2026-10-04 es domingo; 2026-10-05, lunes.
  assert.equal(inicioSemana(t(10, 4, 23, 59)), t(9, 28, 0));
  assert.equal(inicioSemana(t(10, 5, 0, 0)), t(10, 5, 0));
  assert.equal(inicioSemana(t(10, 3)), t(9, 28, 0));
});

test("semana actual contra la pasada a la misma altura, y la pasada entera aparte", () => {
  const ahora = t(10, 7, 12); // miércoles
  const cs = [c(t(10, 5, 9)), c(t(10, 7, 11)), c(t(9, 28, 10)), c(t(9, 30, 11)), c(t(9, 30, 13)), c(t(10, 4, 22)), c(t(9, 27, 23))];
  const s = semanas(cs, ahora, t(9, 1));
  assert.equal(s.lunes, t(10, 5, 0));
  assert.equal(s.actual.n, 2);
  assert.equal(s.pasada?.n, 4); // lun 28/9 a dom 4/10; el dom 27/9 es de otra semana
  assert.equal(s.aLaAltura?.n, 2); // hasta el mié 30/9 12:00
});

test("sin datos de la semana pasada no hay comparación", () => {
  const s = semanas([c(t(10, 1))], t(10, 3), t(9, 30, 10));
  assert.equal(s.actual.n, 1);
  assert.equal(s.pasada, null);
  assert.equal(s.aLaAltura, null);
});

test("tendencia: promedio diario de 7 días contra los 7 anteriores", () => {
  const ahora = t(10, 15, 12);
  const cs = [
    ...Array.from({ length: 14 }, (_, i) => c(t(10, 8, 13) + i * 3600, { tokens: 700 })), // últimos 7: 14
    ...Array.from({ length: 7 }, (_, i) => c(t(10, 2, 13) + i * 3600, { tokens: 700 })), // anteriores: 7
  ];
  const r = tendencia(cs, ahora, t(9, 1));
  assert.equal(r.dias, 7);
  assert.equal(r.actual.n, 2);
  assert.equal(r.actual.tokens, 1400);
  assert.equal(r.anterior?.n, 1);
});

test("tendencia con datos nuevos: sin anterior y el promedio sobre los días que hay", () => {
  const ahora = t(10, 3, 12);
  const r = tendencia([c(t(10, 1, 12)), c(t(10, 2, 12)), c(t(10, 3, 11))], ahora, t(9, 30, 12));
  assert.equal(r.anterior, null);
  assert.equal(r.dias, 3);
  assert.equal(r.actual.n, 1);
});

test("resumen del período: agregados, por modelo y proyecto, sólo evaluadas", () => {
  const ahora = t(10, 3, 18);
  const cs = [
    c(t(9, 26, 10), { tokens: 9e9 }), // fuera de los 7 días (empiezan el 27/9 0:00)
    c(t(9, 27, 0, 30), { tokens: 600, bien: "si", cache_read: 300, compactaciones: 1 }),
    c(t(10, 1), { modelo: "claude-sonnet-5-5", tokens: 300, bien: "no", proyecto: "brote", cache_read: 270 }),
    c(t(10, 3), { modelo: "claude-fable-5-1", tokens: 100, duracion_s: 30, compactaciones: 0 }),
    c(t(10, 3, 9), { modelo: "gpt-raro", tokens: 0 }),
  ];
  const r = resumir(cs, 7, ahora, t(9, 1));
  assert.equal(r.inicio, t(9, 27, 0));
  assert.equal(r.desde, null);
  assert.equal(r.corridas, 4);
  assert.equal(r.tokens, 1000);
  assert.equal(r.tiempo_s, 210);
  assert.equal(r.cache, 570 / 900);
  assert.equal(r.compactaciones, 1);
  assert.equal(r.conCompactaciones, 2);
  assert.deepEqual(r.bien, { si: 1, parcial: 0, no: 1 });
  assert.deepEqual(
    r.porModelo.map((m) => [m.familia, m.tokens]),
    [["Opus", 600], ["Sonnet", 300], ["Fable", 100], ["otro", 0]],
  );
  assert.deepEqual(r.porProyecto.map((p) => p.nombre), ["atlas", "brote"]);
  assert.deepEqual(r.porProyecto[0].modelos, { Opus: 600, Sonnet: 0, Fable: 100, Google: 0, otro: 0 });
  assert.deepEqual(r.porDia.map((d) => d.n), [1, 0, 0, 0, 1, 0, 2]);
});

test("el período avisa desde cuándo hay datos si arrancan después", () => {
  const r = resumir([c(t(9, 30, 10))], 7, t(10, 3), t(9, 30, 10));
  assert.equal(r.desde, t(9, 30, 10));
  assert.equal(resumir([], 7, t(10, 3), null).desde, null);
});

test("consumo diario: 60 días de calendario terminando hoy", () => {
  const d = diario([c(t(10, 3, 1), { tokens: 5 }), c(t(8, 5, 23), { tokens: 7 })], 60, t(10, 3, 12));
  assert.equal(d.length, 60);
  assert.equal(d[59].ts, t(10, 3, 0));
  assert.equal(d[59].tokens, 5);
  assert.equal(d[0].ts, t(8, 5, 0));
  assert.equal(d[0].tokens, 7);
});

const m = (ts: number, sem: number, sem_reset: number, h5 = 10): Muestra => ({ ts, h5, h5_reset: ts + 3600, sem, sem_reset });

test("cuota: la semana actual, las anteriores al reset y los workers de esta semana", () => {
  const r1 = t(9, 27, 12);
  const r2 = t(10, 4, 12);
  const muestras = [m(t(9, 25), 60, r1), m(t(9, 27, 11), 91, r1 + 20), m(t(9, 28), 3, r2), m(t(10, 3, 10), 48, r2)];
  const cs = [c(t(9, 27, 13), { tokens: 50 }), c(t(10, 3), { tokens: 25 }), c(t(9, 27, 11), { tokens: 999 })];
  const q = cuota(muestras, cs, t(10, 3, 12))!;
  assert.equal(q.ultima.sem, 48);
  assert.equal(q.semVencida, false);
  assert.deepEqual(q.anteriores, [{ reset: r1, sem: 91 }]);
  assert.equal(q.desde, t(9, 25));
  assert.deepEqual(q.workers, { n: 2, tokens: 75 });
});

test("cuota: pasado el reset la última semana va a anteriores y no se muestra como actual", () => {
  const r = t(10, 4, 12);
  const q = cuota([m(t(10, 3), 48, r)], [], t(10, 4, 13))!;
  assert.equal(q.semVencida, true);
  assert.deepEqual(q.anteriores, [{ reset: r, sem: 48 }]);
  assert.equal(cuota([], [], 0), null);
  assert.equal(cuota(null, [], 0), null);
});

test("etiquetas: todo en pocos días, el número del día en un mes, los lunes en 60", () => {
  assert.deepEqual(etiquetas(7), { dia: "largo", numero: "todas" });
  assert.deepEqual(etiquetas(30), { dia: "corto", numero: "todas" });
  assert.deepEqual(etiquetas(60), { dia: "lunes", numero: "extremos" });
});

test("familia de modelo", () => {
  assert.equal(familia("claude-opus-5-5"), "Opus");
  assert.equal(familia("claude-sonnet-5-5"), "Sonnet");
  assert.equal(familia("claude-fable-5-1"), "Fable");
  assert.equal(familia("?"), "otro");
});
