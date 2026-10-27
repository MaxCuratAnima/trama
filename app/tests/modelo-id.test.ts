// El clasificador único de modelos (src/datos/modelo-id.ts): el proveedor manda sobre la familia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esDeGoogle, parsearModelo } from "../src/datos/modelo-id.ts";
import { familiaDe, modeloCorto } from "../src/barra/ficha.ts";
import { familia, nombreModelo } from "../src/paneles/resumen.ts";

test("Claude de Anthropic: familia y versión, sin fecha ni [1m]", () => {
  for (const [id, linea, nombre] of [
    ["claude-opus-5-5", "opus", "Opus 5.5"],
    ["claude-sonnet-5-5[1m]", "sonnet", "Sonnet 5.5"],
    ["claude-opus-4-1-20250805", "opus", "Opus 4.1"],
    ["claude-3-5-sonnet-20241022", "sonnet", "Sonnet 3.5"],
    ["claude-fable-5-1", "fable", "Fable 5.1"],
  ] as const) {
    const p = parsearModelo(id);
    assert.deepEqual([p.proveedor, p.linea, p.nombre], ["anthropic", linea, nombre], id);
  }
  assert.equal(parsearModelo("claude-opus-4-1-20250805").id, "claude-opus-4-1");
});

test("lo que sirve Google nunca es de Anthropic, aunque sea un Claude", () => {
  const a = parsearModelo("agy:claude-opus-5-5-high");
  assert.deepEqual([a.proveedor, a.linea, a.nivel, a.id], ["google", "opus", "high", "agy:claude-opus-5-5"]);
  assert.equal(a.etiqueta, "Claude Opus 5.5 · por Google");
  const g = parsearModelo("gemini-3.8-flash-high");
  assert.deepEqual([g.proveedor, g.linea, g.version, g.nivel, g.id, g.etiqueta], ["google", "gemini", "3.8", "high", "gemini-3.8-flash", "Gemini 3.8 Flash · por Google"]);
  assert.equal(esDeGoogle("agy:gpt-oss-120b"), true);
  assert.equal(esDeGoogle("claude-opus-5-5"), false);
});

test("ollama es local y lo que no se reconoce queda como vino", () => {
  assert.equal(parsearModelo("ollama:qwen3:8b").proveedor, "local");
  assert.deepEqual([parsearModelo("?").proveedor, parsearModelo("?").nombre], ["otro", "?"]);
  assert.equal(parsearModelo(null).id, "");
});

test("las tres vistas (ficha, resumen) dicen lo mismo", () => {
  assert.equal(familiaDe("agy:claude-opus-5-5-high"), "google");
  assert.equal(familiaDe("gemini-3.8-flash-high"), "google");
  assert.equal(familiaDe("claude-opus-5-5"), "opus");
  assert.equal(modeloCorto("agy:claude-opus-5-5-high"), "Opus · Google");
  assert.equal(modeloCorto("gemini-3.8-flash-high"), "Gemini");
  assert.equal(familia("agy:claude-opus-5-5-high"), "Google");
  assert.equal(familia("gemini-3.8-flash-high"), "Google");
  assert.equal(familia("claude-opus-5-5"), "Opus");
  assert.equal(nombreModelo("agy:claude-opus-5-5-high"), "Claude Opus 5.5 · por Google");
  assert.equal(nombreModelo("claude-opus-5-5"), "Opus 5.5");
});
