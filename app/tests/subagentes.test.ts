import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { avisosDe, crearSubagentes, informeDe, leerCarpeta, leerSubagente, modeloCorto, resumir, type Subagentes, cortado } from "../electron/subagentes.ts";

const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-subagentes-"));
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond: () => boolean, ms = 4000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await espera(20);
  return cond();
}

const USO = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 };
const linea = (o: object) => JSON.stringify(o) + "\n";
const pedido = (ts: string) => linea({ type: "user", timestamp: ts, message: { role: "user", content: "contá hasta tres" } });
const usa = (ts: string) =>
  linea({ type: "assistant", timestamp: ts, message: { model: "claude-haiku-5-5", stop_reason: "tool_use", usage: USO, content: [{ type: "tool_use", name: "Bash", input: { command: "sleep 20\necho hola" } }] } });
const vuelta = (ts: string) => linea({ type: "user", timestamp: ts, message: { role: "user", content: [{ type: "tool_result", content: "hola" }] } });
const cierra = (ts: string, texto: string) =>
  linea({ type: "assistant", timestamp: ts, message: { model: "claude-haiku-5-5", stop_reason: "end_turn", usage: USO, content: [{ type: "text", text: texto }] } });
const ruido = linea({ type: "attachment", timestamp: "2026-10-24T10:00:00.500Z", attachment: { type: "x" } });

const meta = { agentType: "general-purpose", description: "prueba contar", model: "haiku", requestShape: "background" };

test("el nombre del modelo sale lindo, y lo que no reconoce queda como vino", () => {
  assert.equal(modeloCorto("claude-haiku-5-5"), "Haiku 5.5");
  assert.equal(modeloCorto("claude-opus-5-5-20261001"), "Opus 5.5");
  assert.equal(modeloCorto("gpt-raro"), "gpt-raro");
});

test("corriendo: el último mensaje no cerró el turno; ahí está la herramienta, la hora de inicio y los tokens", () => {
  const texto = pedido("2026-10-24T10:00:00.000Z") + ruido + usa("2026-10-24T10:00:03.000Z") + vuelta("2026-10-24T10:00:23.000Z");
  const u = leerSubagente("sid1", "a1", meta, texto.split("\n")[0], texto, 0);
  assert.equal(u.estado, "corriendo");
  assert.equal(u.descripcion, "prueba contar");
  assert.equal(u.modelo, "Haiku 5.5");
  assert.equal(u.tipo, "general-purpose");
  assert.equal(u.inicio, Date.parse("2026-10-24T10:00:00.000Z") / 1000);
  assert.equal(u.ultimo_en, Date.parse("2026-10-24T10:00:23.000Z") / 1000);
  assert.equal(u.ultimo, "Bash: sleep 20 echo hola", "una sola línea");
  assert.equal(u.tokens, 1112);
  assert.equal(u.resultado, null);
});

test("terminado: cierra con end_turn y deja las primeras líneas de su informe", () => {
  const informe = Array.from({ length: 10 }, (_, i) => `punto ${i + 1}`).join("\n");
  const texto = pedido("2026-10-24T10:00:00.000Z") + usa("2026-10-24T10:00:03.000Z") + vuelta("2026-10-24T10:00:23.000Z") + cierra("2026-10-24T10:00:25.000Z", informe);
  const u = leerSubagente("sid1", "a1", { ...meta, finished: true }, texto.split("\n")[0], texto, 0);
  assert.equal(u.estado, "terminado");
  assert.equal(u.resultado, informe.split("\n").slice(0, 6).join("\n"));
  assert.equal(u.hay_mas, true);
  assert.equal(u.ultimo, informe.replace(/\n/g, " "), "su cierre, en una línea");
  const corto = leerSubagente("sid1", "a1", meta, "", pedido("2026-10-24T10:00:00.000Z") + cierra("2026-10-24T10:00:01.000Z", "listo"), 0);
  assert.deepEqual([corto.resultado, corto.hay_mas], ["listo", false]);
});

test("error: un mensaje de error de la API al final", () => {
  const texto = pedido("2026-10-24T10:00:00.000Z") + linea({ type: "assistant", timestamp: "2026-10-24T10:00:02.000Z", isApiErrorMessage: true, message: { model: "<synthetic>", content: [{ type: "text", text: "API Error: 529" }] } });
  const u = leerSubagente("sid1", "a1", meta, texto.split("\n")[0], texto, 0);
  assert.equal(u.estado, "error");
});

test("sin ningún mensaje legible: corre; salvo que su meta diga que terminó", () => {
  assert.equal(leerSubagente("s", "a", meta, "", "basura\n{", 5).estado, "corriendo");
  assert.equal(leerSubagente("s", "a", { ...meta, finished: true }, "", "", 5).estado, "terminado");
  assert.equal(leerSubagente("s", "a", null, "", "", 5).descripcion, "a", "sin meta, su id");
  assert.equal(leerSubagente("s", "a", null, "", "", 5).inicio, 5, "sin mensajes, cuando nació el archivo");
});

test("resumir: tope de líneas y de caracteres", () => {
  assert.deepEqual(resumir("uno\ndos"), { resumen: "uno\ndos", mas: false });
  assert.equal(resumir("x".repeat(2000)).resumen.length, 700);
  assert.equal(resumir("x".repeat(2000)).mas, true);
});

test("avisos: lo que la sesión recibió de cada subagente, el último gana", () => {
  const n = (id: string, status: string, ts: string) => linea({ type: "user", timestamp: ts, message: { content: `<task-notification><task-id>${id}</task-id><status>${status}</status></task-notification>` } });
  const r = avisosDe(n("a1", "completed", "2026-10-24T10:00:00.000Z") + n("a2", "killed", "2026-10-24T10:00:05.000Z") + linea({ type: "user", message: { content: "hola" } }));
  assert.equal(r.get("a1")?.status, "completed");
  assert.equal(r.get("a2")?.status, "killed");
  assert.equal(r.get("a2")?.ts, Date.parse("2026-10-24T10:00:05.000Z") / 1000);
  assert.equal(r.size, 2);
});

function sesion(base: string) {
  const sid = "s-sub-1";
  const proyecto = path.join(base, "proyecto");
  mkdirSync(proyecto, { recursive: true });
  const transcript = path.join(proyecto, `${sid}.jsonl`);
  writeFileSync(transcript, linea({ type: "user", timestamp: "2026-10-24T09:59:00.000Z", message: { content: "hola" } }));
  return { sid, proyecto, transcript, dir: path.join(proyecto, sid, "subagents") };
}

test("leerCarpeta: una carpeta con corriendo y terminado, los nuevos primero, ids raros ignorados; informeDe pide el entero", async () => {
  const base = temporal();
  const { sid, dir } = sesion(base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "agent-aaa.jsonl"), pedido("2026-10-24T10:00:00.000Z") + usa("2026-10-24T10:00:03.000Z"));
  writeFileSync(path.join(dir, "agent-aaa.meta.json"), JSON.stringify(meta));
  const largo = Array.from({ length: 12 }, (_, i) => `línea ${i}`).join("\n");
  writeFileSync(path.join(dir, "agent-bbb.jsonl"), pedido("2026-10-24T10:05:00.000Z") + cierra("2026-10-24T10:05:09.000Z", largo));
  writeFileSync(path.join(dir, "agent-..sss.jsonl"), "x");
  writeFileSync(path.join(dir, "otra-cosa.txt"), "x");
  const lista = await leerCarpeta(dir, sid);
  assert.deepEqual(lista.map((u) => [u.id, u.estado]), [["bbb", "terminado"], ["aaa", "corriendo"]]);
  assert.equal(lista[1].descripcion, "prueba contar");
  assert.equal(await informeDe(dir, "bbb"), largo);
  assert.equal(await informeDe(dir, "aaa"), null, "uno que corre no tiene informe");
  assert.equal(await informeDe(dir, "../../etc/passwd"), null);
  assert.equal(await informeDe(dir, 7), null);
  rmSync(base, { recursive: true });
});

test("el vigía: ve nacer la carpeta de subagentes, uno que corre, que termina, y avisa sólo cuando algo cambió", async () => {
  const base = temporal();
  const { sid, transcript, dir } = sesion(base);
  const vistos: Subagentes[] = [];
  const s = crearSubagentes({ transcript: async (x) => (x === sid ? transcript : null), alCambiar: (t) => vistos.push(t) });
  await s.sincronizar([sid, "no-existe", "../raro"]);
  assert.deepEqual(await s.leer(), {}, "sin subagentes no hay nada");
  assert.equal(vistos.length, 0, "y no se avisa de nada");

  mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, "agent-x1.jsonl");
  writeFileSync(path.join(dir, "agent-x1.meta.json"), JSON.stringify(meta));
  writeFileSync(archivo, pedido("2026-10-24T10:00:00.000Z") + usa("2026-10-24T10:00:03.000Z"));
  assert.ok(await hasta(() => vistos.at(-1)?.[sid]?.[0]?.estado === "corriendo"), "aparece corriendo");
  assert.equal(vistos.at(-1)?.[sid]?.[0]?.descripcion, "prueba contar");

  appendFileSync(archivo, vuelta("2026-10-24T10:00:23.000Z") + cierra("2026-10-24T10:00:25.000Z", "tres, dos, uno"));
  assert.ok(await hasta(() => vistos.at(-1)?.[sid]?.[0]?.estado === "terminado"), "pasa a terminado");
  assert.equal(vistos.at(-1)?.[sid]?.[0]?.resultado, "tres, dos, uno");
  assert.equal(await s.informe(sid, "x1"), "tres, dos, uno");
  assert.equal(await s.informe("otra", "x1"), null, "sólo de una sesión seguida");

  const n = vistos.length;
  appendFileSync(archivo, ruido);
  await espera(500);
  assert.equal(vistos.length, n, "una línea que no cambia nada visible no se avisa");

  await s.sincronizar([]);
  assert.deepEqual(await s.leer(), {}, "sin proceso ya no se sigue");
  s.cerrar();
  rmSync(base, { recursive: true });
});

test("la sesión recibió que lo cortaron: un subagente que parecía correr queda en error", async () => {
  const base = temporal();
  const { sid, transcript, dir } = sesion(base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "agent-k1.jsonl"), pedido("2026-10-24T10:00:00.000Z") + usa("2026-10-24T10:00:03.000Z"));
  appendFileSync(transcript, linea({ type: "user", timestamp: "2026-10-24T10:01:00.000Z", message: { content: "<task-notification><task-id>k1</task-id><status>killed</status></task-notification>" } }));
  const s = crearSubagentes({ transcript: async () => transcript, alCambiar: () => {} });
  await s.sincronizar([sid]);
  assert.equal((await s.leer())[sid]?.[0]?.estado, "error");
  s.cerrar();
  rmSync(base, { recursive: true });
});

test("cortado: un corriendo sin escribir hace más de 20 min pasa a error; uno reciente o terminado no cambia", () => {
  const base = leerSubagente("s", "a", null, "", "", 5);
  assert.equal(cortado(base, 0, 21 * 60 * 1000).estado, "error");
  assert.equal(cortado(base, 0, 19 * 60 * 1000).estado, "corriendo");
  assert.equal(cortado({ ...base, estado: "terminado" }, 0, 99 * 60 * 1000).estado, "terminado");
});
