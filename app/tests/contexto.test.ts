// El anillo de contexto (B16): la cuenta (usage → %), los niveles, la ventana
// del modelo y el umbral leído de un settings.json de ejemplo en una carpeta
// temporal: nunca el ~/.claude/settings.json real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { leerUmbral, umbralDeSettings } from "../electron/contexto.ts";
import { conversacionDe, parsearLinea } from "../electron/lider-arma.ts";
import { cuenta, nivel, umbralDe, usados, ventanaDe, ventanaDicha } from "../src/hilo/contexto-datos.ts";

test("cuenta: usage → tokens usados, % y lo que falta", () => {
  const u = { input_tokens: 3, cache_creation_input_tokens: 1240, cache_read_input_tokens: 61872, output_tokens: 410 };
  // La salida no pesa: es la entrada del último turno.
  assert.equal(usados(u), 63115);
  assert.equal(usados(null), 0);
  assert.equal(usados({ output_tokens: 9 }), 0);
  assert.deepEqual(cuenta(u, 200_000), { usados: 63115, umbral: 200_000, pct: 32, falta: 136_885, nivel: "normal" });
  assert.deepEqual(cuenta({ input_tokens: 150_000 }, 200_000), { usados: 150_000, umbral: 200_000, pct: 75, falta: 50_000, nivel: "ambar" });
  assert.deepEqual(cuenta({ cache_read_input_tokens: 190_000 }, 200_000), { usados: 190_000, umbral: 200_000, pct: 95, falta: 10_000, nivel: "rojo" });
  // Pasado del umbral: tope en 100, no falta nada.
  assert.deepEqual(cuenta({ input_tokens: 250_000 }, 200_000), { usados: 250_000, umbral: 200_000, pct: 100, falta: 0, nivel: "rojo" });
  assert.equal(cuenta(null, 200_000).pct, 0);
  assert.equal(cuenta({ input_tokens: 5 }, 0).pct, 0);
});

test("niveles: normal, ámbar desde 70 %, rojo desde 90 %", () => {
  assert.deepEqual([0, 69, 70, 89, 90, 100].map(nivel), ["normal", "normal", "ambar", "ambar", "rojo", "rojo"]);
});

test("ventana del modelo y umbral efectivo", () => {
  assert.equal(ventanaDe("claude-haiku-5-5"), 200_000);
  assert.equal(ventanaDe("claude-opus-5-5"), 1_000_000);
  assert.equal(ventanaDe("fable"), 1_000_000);
  assert.equal(ventanaDe(null), 1_000_000);
  // `autoCompactWindow` manda si está, sin pasar la ventana; si no, la ventana.
  assert.equal(umbralDe(200_000, 1_000_000), 200_000);
  assert.equal(umbralDe(300_000, 200_000), 200_000);
  assert.equal(umbralDe(null, 1_000_000), 1_000_000);
  assert.equal(umbralDe(0, 200_000), 200_000);
  // Lo que dijo el stream (`modelUsage`): el del modelo del líder, no el de un subagente.
  const dicho = { "claude-haiku-5-5": 200_000, "claude-opus-5-5[1m]": 1_000_000 };
  assert.equal(ventanaDicha(dicho, "claude-opus-5-5"), 1_000_000);
  assert.equal(ventanaDicha(dicho, "claude-haiku-5-5"), 200_000);
  assert.equal(ventanaDicha(dicho, "claude-sonnet-5-5"), null);
  assert.equal(ventanaDicha(null, "claude-opus-5-5"), null);
  assert.equal(ventanaDicha(dicho, null), null);
});

test("umbral: autoCompactWindow de un settings.json de ejemplo", async () => {
  assert.equal(umbralDeSettings('{"autoCompactWindow": 200000, "model": "opus"}'), 200_000);
  assert.equal(umbralDeSettings('{"model": "opus"}'), null);
  assert.equal(umbralDeSettings('{"autoCompactWindow": "200000"}'), null);
  assert.equal(umbralDeSettings('{"autoCompactWindow": -1}'), null);
  assert.equal(umbralDeSettings("{"), null);
  const dir = mkdtempSync(path.join(os.tmpdir(), "contexto-"));
  const ruta = path.join(dir, "settings.json");
  writeFileSync(ruta, JSON.stringify({ autoCompactWindow: 180_000 }));
  assert.equal(await leerUmbral(ruta), 180_000);
  assert.equal(await leerUmbral(path.join(dir, "no-esta.json")), null);
});

test("sin relevo: el anillo de un líder cuenta contra autoCompactWindow, o la ventana del modelo, igual que el de un worker", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "umbrales-"));
  const ruta = path.join(dir, "settings.json");
  writeFileSync(ruta, JSON.stringify({ autoCompactWindow: 150_000 }));
  assert.equal(await leerUmbral(ruta), 150_000);
  assert.equal(umbralDe(150_000, 1_000_000), 150_000);
  // Sin autoCompactWindow: la ventana entera (y nunca más que ella).
  assert.equal(umbralDe(null, 1_000_000), 1_000_000);
  assert.equal(umbralDe(2_000_000, 1_000_000), 1_000_000);
});

test("stream: el usage de cada mensaje y la ventana del modelo salen como evento `contexto`", () => {
  const ev = (o: unknown) => parsearLinea(JSON.stringify(o));
  const usage = { input_tokens: 4, cache_creation_input_tokens: 900, cache_read_input_tokens: 52_000, output_tokens: 1 };
  assert.deepEqual(ev({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "m1", usage } } }), [
    { tipo: "tokens", salida: 1, nuevo: true },
    { tipo: "contexto", usage },
  ]);
  // Sin tokens de entrada (o de un subagente) no hay evento.
  assert.deepEqual(ev({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { usage: { output_tokens: 1 } } } }), [
    { tipo: "tokens", salida: 1, nuevo: true },
  ]);
  assert.deepEqual(ev({ type: "stream_event", parent_tool_use_id: "t1", event: { type: "message_start", message: { usage } } }), []);
  assert.deepEqual(
    ev({
      type: "result",
      is_error: false,
      modelUsage: { "claude-opus-5-5": { inputTokens: 4, contextWindow: 1_000_000 }, "claude-haiku-5-5": { contextWindow: 200_000 }, raro: {} },
    }),
    [
      { tipo: "contexto", ventanas: { "claude-opus-5-5": 1_000_000, "claude-haiku-5-5": 200_000 } },
      { tipo: "fin", error: null, ttl: null },
    ],
  );
});

test("transcript: cuenta las compactaciones (compact_boundary), sin las de subagentes", () => {
  const l = (o: unknown) => JSON.stringify(o);
  const t = [
    l({ type: "user", message: { content: "hola" } }),
    l({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 167_000 } }),
    l({ type: "system", subtype: "compact_boundary", isSidechain: true }),
    l({ type: "system", subtype: "turn_duration" }),
    l({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hola." }], usage: { input_tokens: 3 } } }),
    l({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "manual" } }),
  ].join("\n");
  const r = conversacionDe("00000000-0000-4000-8000-000000000000", "/t.jsonl", t);
  assert.equal(r.compactaciones, 2);
  // Cada compactación va en la conversación como línea de sistema (B18).
  assert.equal(r.total, 4);
  assert.deepEqual(
    r.mensajes.map((m) => m.compacto ?? null),
    [null, { auto: true, antes: 167_000 }, null, { auto: false, antes: null }],
  );
  // Compactó después del último mensaje: su `usage` es de antes.
  assert.equal(r.compactada, true);
  const sigue = conversacionDe("00000000-0000-4000-8000-000000000000", "/t.jsonl", t + "\n" + l({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Sigo." }], usage: { input_tokens: 9 } } }));
  assert.equal(sigue.compactada, false);
  assert.deepEqual(sigue.usage, { input_tokens: 9 });
  assert.equal(conversacionDe("00000000-0000-4000-8000-000000000000", "/t.jsonl", "").compactaciones, 0);
});
