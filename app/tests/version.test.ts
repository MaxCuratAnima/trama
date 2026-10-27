// El aviso de Claude Code nuevo (electron/version.ts): comparar versiones, cuándo
// preguntarle a npm y cuándo se muestra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoDe, CADA_MS, comparar, desdeArchivo, hayQueConsultar, normal, parsear, VACIO } from "../electron/version.ts";

test("parsea la salida de claude --version y la de npm view", () => {
  assert.deepEqual(parsear("2.1.287 (Claude Code)"), [2, 1, 287]);
  assert.deepEqual(parsear("2.1.300\n"), [2, 1, 300]);
  assert.deepEqual(parsear("v3.0.1"), [3, 0, 1]);
  assert.deepEqual(parsear("2.2.0-beta.1"), [2, 2, 0]);
  assert.equal(parsear(""), null);
  assert.equal(parsear("command not found"), null);
  assert.equal(parsear("2.1"), null);
  assert.equal(parsear("1.2.3.4"), null);
  assert.equal(parsear(null), null);
  assert.equal(normal(" 2.1.287 (Claude Code) "), "2.1.287");
});

test("compara numérico, no como texto", () => {
  assert.ok(comparar("2.1.287", "2.1.300") < 0);
  assert.ok(comparar("2.1.300", "2.1.287") > 0);
  assert.ok(comparar("2.1.287", "2.2.0") < 0);
  assert.ok(comparar("2.2.0", "2.1.287") > 0);
  assert.ok(comparar("2.1.9", "2.1.10") < 0);
  assert.ok(comparar("2.10.0", "2.9.99") > 0);
  assert.ok(comparar("10.0.0", "9.99.99") > 0);
  assert.equal(comparar("2.1.287", "2.1.287 (Claude Code)"), 0);
  assert.ok(comparar("basura", "2.1.287") < 0);
  assert.equal(comparar(null, null), 0);
});

test("a npm se le pregunta si nunca contestó o pasaron 6 h", () => {
  const t = 1_800_000_000_000;
  assert.equal(hayQueConsultar(0, t), true);
  assert.equal(hayQueConsultar(t - CADA_MS + 1, t), false);
  assert.equal(hayQueConsultar(t - CADA_MS, t), true);
  assert.equal(hayQueConsultar(t + 60_000, t), true);
});

test("el aviso sale sólo si hay una más nueva y no se descartó", () => {
  const c = { ...VACIO, instalada: "2.1.287", ultima: "2.1.300" };
  assert.deepEqual(avisoDe(c), { instalada: "2.1.287", ultima: "2.1.300" });
  assert.deepEqual(avisoDe({ ...c, ultima: "2.2.0" }), { instalada: "2.1.287", ultima: "2.2.0" });
  assert.equal(avisoDe({ ...c, ultima: "2.1.287" }), null);
  assert.equal(avisoDe({ ...c, instalada: "2.1.301" }), null, "instalada más nueva que npm (ya actualizó)");
  assert.equal(avisoDe({ ...c, descartada: "2.1.300" }), null);
  assert.deepEqual(avisoDe({ ...c, ultima: "2.1.301", descartada: "2.1.300" }), { instalada: "2.1.287", ultima: "2.1.301" }, "sale otra: vuelve");
  assert.equal(avisoDe({ ...c, instalada: null }), null);
  assert.equal(avisoDe({ ...c, ultima: null }), null);
});

test("el archivo se valida campo por campo", () => {
  assert.deepEqual(desdeArchivo({ version: 2, chequeado: 5 }, 1), VACIO);
  assert.deepEqual(desdeArchivo(null, 1), VACIO);
  assert.deepEqual(desdeArchivo({ version: 1, chequeado: "x", instalada: "2.1.287 (Claude Code)", ultima: 3, descartada: "2.1.300" }, 1), {
    chequeado: 0,
    instalada: "2.1.287",
    ultima: null,
    descartada: "2.1.300",
  });
});

test("agy: la última sale del actualizador (Stable Version)", async () => {
  const { ultimaDeActualizador } = await import("../electron/version.ts");
  assert.equal(ultimaDeActualizador("Antigravity CLI auto updater is running! Stable Version: 1.4.2. Rolled out to 100%"), "1.4.2");
  assert.equal(ultimaDeActualizador("Stable Version: v10.0.11"), "10.0.11");
  assert.equal(ultimaDeActualizador("<html>404</html>"), null);
  assert.equal(ultimaDeActualizador(null), null);
});
