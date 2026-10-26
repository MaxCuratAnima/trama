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
