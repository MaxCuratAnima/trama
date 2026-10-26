import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conversacionDe } from "../electron/lider-arma.ts";
import { sistemaDe, vuelve } from "../src/hilo/sistema-datos.ts";
import { turnos, type Item } from "../src/hilo/turnos.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

const SID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TRANSCRIPT = readFileSync(new URL("./fixtures/transcript-sistema.jsonl", import.meta.url), "utf8");

/** Cada item en una palabra: "yo", "turno" o la clase de la línea/tarjeta de sistema. */
const forma = (its: Item[]) => its.map((x) => (x.tipo === "sistema" ? `${x.s.tipo}:${x.s.clase}` : x.tipo));
const sis = (its: Item[], clase: string) => {
  const x = its.find((y) => y.tipo === "sistema" && y.s.clase === clase);
  assert.ok(x && x.tipo === "sistema", clase);
  return x.s;
};
const epoch = (iso: string) => Date.parse(iso) / 1000;

test("transcript de un líder: cada cosa de sistema por sus campos", () => {
  const r = conversacionDe(SID, "/t.jsonl", TRANSCRIPT);
  const its = turnos(r.mensajes);
  assert.deepEqual(forma(its), [
    "yo",
    "tarjeta:skill",
    "turno",
    "tarjeta:tarea",
    "tarjeta:mensaje",
    "tarjeta:comando",
    "tarjeta:salida",
    "tarjeta:caveat",
    "tarjeta:recordatorio",
    "tarjeta:hook",
    "turno",
    "linea:interrumpido",
    "linea:error",
    "linea:limite",
    "tarjeta:continua",
    "linea:nota",
    // La marca de compactar se lleva el resumen que sigue: un divisor que se abre a él (B19).
    "linea:compacto",
    "tarjeta:imagen",
    "yo",
    "turno",
    "linea:limite",
  ]);
  assert.deepEqual(sis(its, "skill"), { tipo: "tarjeta", clase: "skill", dato: "repartir-tareas", estado: null, crudo: r.mensajes[1].texto });
  const tarea = sis(its, "tarea");
  assert.equal(tarea.tipo === "tarjeta" && tarea.dato, "Wait for bug hunt worker result");
  assert.equal(tarea.tipo === "tarjeta" && tarea.estado, "completed");
  assert.equal((sis(its, "mensaje") as { dato: string }).dato, "pa/hilos");
  assert.equal((sis(its, "comando") as { dato: string }).dato, "/model opus");
  assert.equal((sis(its, "salida") as { dato: string }).dato, "Set model to `Opus 5.5`");
  assert.deepEqual(sis(its, "error"), { tipo: "linea", clase: "error", texto: "API Error: 500 Internal server error", codigo: "server_error" });
  const resumen = r.mensajes.find((m) => m.resumen)!.texto;
  assert.deepEqual(sis(its, "compacto"), { tipo: "linea", clase: "compacto", auto: true, antes: 149963, resumen });
  // 4:50pm en Buenos Aires (UTC−3) del día del mensaje.
  const limites = its.flatMap((x) => (x.tipo === "sistema" && x.s.clase === "limite" ? [x.s] : []));
  assert.deepEqual(
    limites.map((l) => [l.hasta, l.semana]),
    [
      [epoch("2026-10-02T19:50:00Z"), false],
      [epoch("2026-10-04T15:00:00Z"), true],
    ],
  );
  // El sintético no es la última respuesta: el anillo sigue con el `usage` del modelo.
  assert.deepEqual(r.usage, { input_tokens: 5, cache_read_input_tokens: 9000, output_tokens: 4 });
  assert.equal(r.modelo, "claude-opus-5-5");
  assert.equal(r.compactaciones, 1);
});

test("worker (pa --hilo, sin campos): lo mismo por el modelo sintético y cómo empieza el texto", () => {
  // Lo que da `pa --hilo`: sin isMeta, isCompactSummary, origin ni error, y sin la marca de compactar.
  const r = conversacionDe(SID, "/t.jsonl", TRANSCRIPT);
  const pa: Mensaje[] = r.mensajes
    .filter((m) => !m.compacto)
    .map(({ i, rol, texto, herramientas, ts, modelo }) => ({ i, rol, texto, herramientas, ts, modelo }));
  const its = turnos(pa);
  assert.deepEqual(forma(its), [
    "yo",
    "tarjeta:skill",
    "turno",
    "tarjeta:tarea",
    "tarjeta:mensaje",
    "tarjeta:comando",
    "tarjeta:salida",
    "tarjeta:caveat",
    "tarjeta:recordatorio",
    "tarjeta:hook",
    "turno",
    "linea:interrumpido",
    "linea:error",
    "linea:limite",
    // Sin `origin` ni `isMeta` no se sabe: queda como mensaje (lo arregla `pa --hilo` pasando los campos).
    "yo",
    "linea:nota",
    "tarjeta:resumen",
    "yo",
    "yo",
    "turno",
    "linea:limite",
  ]);
  assert.deepEqual(sis(its, "error"), { tipo: "linea", clase: "error", texto: "API Error: 500 Internal server error", codigo: null });
});

test("un mensaje de Ana con una etiqueta a mitad de texto sigue siendo suyo", () => {
  const m = (texto: string, extra: Partial<Mensaje> = {}): Mensaje => ({ i: 0, rol: "user", texto, herramientas: [], ts: null, modelo: null, ...extra });
  assert.equal(sistemaDe(m("¿qué es <system-reminder>?")), null);
  assert.equal(sistemaDe(m("ojo con [Request interrupted by user] en el log")), null);
  assert.equal(sistemaDe(m("<command-name>/x</command-name>", { origen: "human" })), null);
  assert.equal(sistemaDe(m("hola", { origen: "otro" })), null);
  assert.equal(sistemaDe({ ...m("Hola"), rol: "assistant", modelo: "claude-opus-5-5" }), null);
});

test("vuelve: la hora del límite contra la fecha del mensaje", () => {
  const z = " (America/Argentina/Buenos_Aires)";
  // Antes de la hora: ese mismo día; después: el siguiente.
  assert.deepEqual(vuelve(`resets 4:50pm${z}`, "2026-10-02T15:00:00Z"), { hasta: epoch("2026-10-02T19:50:00Z"), semana: false });
  assert.deepEqual(vuelve(`resets 4am${z}`, "2026-10-02T15:00:00Z"), { hasta: epoch("2026-10-03T07:00:00Z"), semana: false });
  assert.deepEqual(vuelve(`resets 12am${z}`, "2026-10-02T15:00:00Z"), { hasta: epoch("2026-10-03T03:00:00Z"), semana: false });
  assert.deepEqual(vuelve("weekly limit · resets Jan 2, 9am (UTC)", "2026-12-30T10:00:00Z"), { hasta: epoch("2027-01-02T09:00:00Z"), semana: true });
  assert.equal(vuelve("resets pronto", "2026-10-02T15:00:00Z"), null);
  assert.equal(vuelve(`resets 4:50pm${z}`, null), null);
  // Zona desconocida: la local.
  assert.ok(vuelve("resets 4:50pm (Marte/Olympus)", "2026-10-02T15:00:00Z"));
});

test("trama_destrabo: una línea de sistema por cada destrabo, sin contar como mensaje del modelo", () => {
  const l = (o: object) => JSON.stringify({ timestamp: "2026-10-25T10:00:00.000Z", sessionId: SID, ...o });
  const texto = [
    l({ type: "user", message: { role: "user", content: "bajá el modelo" } }),
    l({ type: "assistant", message: { role: "assistant", model: "gemini-3.8-flash", content: [{ type: "text", text: "Listo." }], usage: { input_tokens: 5, output_tokens: 2 } } }),
    l({ type: "system", subtype: "trama_destrabo", que: "Bash: curl localhost/progreso", clase: "repite", veces: 6, intento: 1 }),
    l({ type: "system", subtype: "trama_destrabo", que: "Bash: curl localhost/progreso", clase: "repite", veces: 6, intento: 3, agotado: true }),
  ].join("\n");
  const r = conversacionDe(SID, "/t.jsonl", texto);
  assert.deepEqual(r.mensajes.map((m) => m.destrabo ?? null), [null, null, { que: "Bash: curl localhost/progreso", agotado: false }, { que: "Bash: curl localhost/progreso", agotado: true }]);
  assert.equal(r.modelo, "gemini-3.8-flash", "la marca no pisa el último mensaje del modelo");
  const its = turnos(r.mensajes);
  assert.deepEqual(forma(its).slice(-2), ["linea:destrabo", "linea:destrabo"]);
  const s = sis(its, "destrabo");
  assert.equal(s.tipo === "linea" && s.clase === "destrabo" && s.que, "Bash: curl localhost/progreso");
});
