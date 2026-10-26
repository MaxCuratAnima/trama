// src/datos/consumo.ts: lo que el panel de consumo hace con lo que manda el main (validar, el
// resumen por modelo, el contexto de cada fila). Puro; los módulos de src/ se importan sin extensión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).split(path.sep).join("/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const { consumoDe, consumoFijo, contextoFila, resumen, totalSesion } = await import("../src/datos/consumo.ts");

const s = (entrada: number, cacheCreado: number, cacheLeido: number, salida: number) => ({ entrada, cacheCreado, cacheLeido, salida });
const fila = (modelo: string | null, uso: [number, number, number, number] | null, mas: object = {}) => ({
  modelo,
  effort: null,
  uso: uso ? { input_tokens: uso[0], cache_creation_input_tokens: uso[1], cache_read_input_tokens: uso[2], output_tokens: uso[3] } : null,
  compactada: false,
  compactaciones: 0,
  total: {},
  ...mas,
});

test("lo que manda el main se valida: sin forma, vacío (sin dato), nunca un número raro", () => {
  assert.deepEqual(consumoDe(null), { n: 0, desde: 0, lideres: {}, workers: {}, filas: {} });
  const c = consumoDe({
    desde: 5,
    lideres: { "claude-opus-5-5": { entrada: 1, cacheCreado: "x", cacheLeido: -3, salida: 2 }, roto: 7 },
    workers: "no",
    filas: { a: null, b: { modelo: 3, uso: { input_tokens: 9 }, compactaciones: 2, compactada: true, total: { m: { salida: 4 } } }, c: "x" },
  });
  assert.deepEqual(c.lideres, { "claude-opus-5-5": s(1, 0, 0, 2) });
  assert.deepEqual(c.workers, {});
  assert.equal(c.filas.a, null);
  assert.equal(c.filas.c, null);
  assert.deepEqual(c.filas.b, {
    modelo: null,
    effort: null,
    uso: { input_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    compactada: true,
    compactaciones: 2,
    total: { m: s(0, 0, 0, 4) },
  });
});

test("el resumen: un renglón por modelo, el que más consumió arriba, y los totales", () => {
  const c = consumoDe({
    lideres: { "claude-opus-5-5": s(10, 200, 3000, 40), "claude-opus-5-5[1m]": s(0, 0, 100, 0), "claude-fable-5-1": s(5, 0, 100, 5) },
    workers: { "claude-sonnet-5-5": s(5, 20, 422, 5), "claude-opus-5-5": s(1, 0, 50, 1), vacio: s(0, 0, 0, 0) },
  });
  // El total es entrada + caché leído + salida (como Estadísticas): el caché escrito (200, 20) no suma.
  const r = resumen(c, (m) => m.replace(/\[.*$/, ""));
  assert.deepEqual(
    r.renglones.map((x) => [x.modelo, x.lideres, x.workers]),
    [
      ["claude-opus-5-5", 3150, 52],
      ["claude-sonnet-5-5", 0, 432],
      ["claude-fable-5-1", 110, 0],
    ],
  );
  assert.deepEqual([r.lideres, r.workers, r.total], [3260, 484, 3744]);
  assert.deepEqual(r.renglones.map((x) => x.total), [3202, 432, 110]);
  // El desglose de cada modelo sí trae el caché escrito.
  assert.deepEqual(r.renglones[0].deLideres, s(10, 200, 3100, 40));
  assert.equal(totalSesion(c.workers), 484);
  assert.deepEqual(resumen(consumoDe({})), { renglones: [], lideres: 0, workers: 0, total: 0 });
});

test("el contexto de una fila: lo que entró en el último mensaje contra la ventana de su modelo", () => {
  assert.deepEqual(contextoFila(fila("claude-opus-5-5", [10, 200, 229_790, 40]), null), { usados: 230_000, ventana: 1_000_000, pct: 23, nivel: "normal" });
  assert.deepEqual(contextoFila(fila("claude-haiku-5-5", [0, 0, 150_000, 1]), null), { usados: 150_000, ventana: 200_000, pct: 75, nivel: "ambar" });
  // El transcript no dijo el modelo: vale el del worker.
  assert.equal(contextoFila(fila(null, [0, 0, 190_000, 1]), "claude-haiku-5-5")?.nivel, "rojo");
  // Sin transcript, sin contestar todavía, o recién compactado: sin dato.
  assert.equal(contextoFila(null, "claude-opus-5-5"), null);
  assert.equal(contextoFila(undefined, null), null);
  assert.equal(contextoFila(fila("claude-opus-5-5", null), null), null);
  assert.equal(contextoFila(fila("claude-opus-5-5", [1, 1, 1, 1], { compactada: true }), null), null);
});

test("los fixtures son fijos y suman", () => {
  const pedido = { lideres: ["l-1", "l-2"], workers: ["20260101-000000-1", "20260101-000000-2", "20260101-000000-3", "20260101-000000-4"] };
  const a = consumoFijo(pedido);
  // Los mismos números cada vez; sólo cambia el orden (`n`).
  assert.deepEqual({ ...a, n: 0 }, { ...consumoFijo(pedido), n: 0 });
  assert.equal(Object.keys(a.filas).length, 6);
  // Uno sin transcript: se ve el "sin dato".
  assert.equal(a.filas["20260101-000000-4"], null);
  const filas = (ids: string[]) => ids.reduce((n, id) => n + (a.filas[id] ? totalSesion(a.filas[id]!.total) : 0), 0);
  assert.equal(totalSesion(a.lideres), filas(pedido.lideres));
  assert.equal(totalSesion(a.workers), filas(pedido.workers));
});
