// Un líder de Gemini (agy-puente) escribe su transcript en `$HILOS_STATE/gemini/<sid>.jsonl`, no en
// `~/.claude/projects`: el panel de consumo lo buscaba sólo ahí y dejaba su fila en "sin dato".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearConsumo } from "../electron/consumo.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-consumo-gemini-"));
const proyectos = path.join(tmp, "claude", "projects");
const gemini = path.join(tmp, "hilos", "gemini");
mkdirSync(proyectos, { recursive: true });
mkdirSync(gemini, { recursive: true });

const SID = "afeb4182-34fc-4639-9b5e-31017dd42f71";
// Como los que escribe agy-puente: el usage trae sólo entrada y salida.
const asistente = (id: string, ms: number, usage: object) =>
  JSON.stringify({ type: "assistant", timestamp: new Date(ms).toISOString(), message: { id, role: "assistant", model: "gemini-3.8-flash-high", content: [{ type: "text", text: "hola" }], usage } }) + "\n";
writeFileSync(path.join(gemini, `${SID}.jsonl`), asistente("m1", Date.now() - 5000, { input_tokens: 100, output_tokens: 10 }) + asistente("m2", Date.now(), { input_tokens: 2374, output_tokens: 2230 }));

const consumo = crearConsumo({ proyectos, planas: [gemini], paState: path.join(tmp, "pa"), alCambiar: () => {} });
after(() => consumo.soltar());

test("la fila de un líder de Gemini sale de su transcript en gemini/", async () => {
  const c = await consumo.mirar({ lideres: [SID], workers: [] });
  const f = c.filas[SID];
  assert.ok(f, "sin fila: no encontró el transcript");
  assert.equal(f.modelo, "gemini-3.8-flash-high");
  assert.equal(f.uso?.input_tokens, 2374);
  assert.equal(f.uso?.output_tokens, 2230);
});

test("el 'hoy' incluye al líder de Gemini aunque nadie lo pida", async () => {
  const c = await consumo.mirar({ lideres: [], workers: [] });
  const g = c.lideres["gemini-3.8-flash-high"];
  assert.ok(g, "el líder de Gemini no cuenta en el resumen de hoy");
  assert.equal(g.entrada, 2474);
  assert.equal(g.salida, 2240);
});

test("un worker nuevo cuyo .sid llega tarde no se suma a Líderes", async () => {
  const WSID = "bbbbbbbb-34fc-4639-9b5e-31017dd42f71";
  const ID = "20260310-100000-111";
  const linea = JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { id: "w1", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: "x" }], usage: { input_tokens: 7, output_tokens: 3 } } }) + "\n";
  mkdirSync(path.join(proyectos, "-tmp-w"), { recursive: true });
  writeFileSync(path.join(proyectos, "-tmp-w", `${WSID}.jsonl`), linea);
  // El transcript ya existe pero `pa` todavía no escribió el .sid: hoy cuenta como líder.
  const antes = await consumo.mirar({ lideres: [], workers: [ID] });
  assert.equal(antes.lideres["claude-sonnet-5-5"]?.entrada, 7);
  // Llega el .sid: el repaso lo relee y pasa a workers.
  mkdirSync(path.join(tmp, "pa", "proy"), { recursive: true });
  writeFileSync(path.join(tmp, "pa", "proy", `${ID}.sid`), WSID);
  const despues = await consumo.mirar({ lideres: [], workers: [ID] });
  assert.equal(despues.lideres["claude-sonnet-5-5"], undefined);
  assert.equal(despues.workers["claude-sonnet-5-5"]?.entrada, 7);
});
