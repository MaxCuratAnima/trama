import assert from "node:assert/strict";
import { test } from "node:test";
import { limpiarTitulo, recortar, tituloEsElPrimero } from "../electron/tema.ts";

test("limpiarTitulo: una línea, sin comillas ni punto final", () => {
  assert.equal(limpiarTitulo('\n"Arreglar Trama: ícono de bandeja."\nmás texto'), "Arreglar Trama: ícono de bandeja");
  assert.equal(limpiarTitulo("**Título corto**"), "Título corto");
  assert.equal(limpiarTitulo("   "), "");
});

test("recortar: corta en una palabra entera y deja los cortos como están", () => {
  assert.equal(recortar("corto"), "corto");
  const r = recortar("Hola buenas, tenemos que arreglar el tema de Trama que ya vengo con varios modelos trabajándolo");
  assert.ok(r.length <= 61 && r.endsWith("…") && !r.includes("modelos trabajándolo"), r);
});

test("tituloEsElPrimero: solo cuando nadie le puso título", () => {
  assert.equal(tituloEsElPrimero({ custom: null, ai: null, primero: "hola" }, ""), true);
  assert.equal(tituloEsElPrimero({ custom: "Mi título", ai: null, primero: "hola" }, ""), false);
  assert.equal(tituloEsElPrimero({ custom: null, ai: "Resumen", primero: "hola" }, ""), false);
  assert.equal(tituloEsElPrimero({ custom: null, ai: null, primero: null }, ""), false);
});
