// src/hilo/vivo.ts: el texto que va llegando de un líder (`parcial`) y el mensaje entero que lo
// cierra son UN solo mensaje en la vista, en el mismo lugar, y al final queda igual que si los
// parciales no hubieran llegado nunca. Los eventos entran por un `window.hilos` falso, como del
// main. Los imports de src/ van sin extensión: un hook les busca el `.ts`; `window`, `location`
// y `requestAnimationFrame` van antes del import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventoLider, Mensaje } from "../src/datos/contrato.ts";
import { conversacionDe, parsearLinea } from "../electron/lider-arma.ts";

let emitir: (x: { sid: string; e: EventoLider }) => void = () => {};
const sinSoltar = () => () => {};
Object.assign(globalThis, {
  location: { search: "?fixtures=0" },
  requestAnimationFrame: () => 1,
  window: {
    hilos: {
      hilos: { leer: async () => ({ n: 1, datos: { hilos: [] } }), guardados: async () => null, alCambiar: sinSoltar, alEvento: sinSoltar },
      lider: {
        alEvento: (fn: typeof emitir) => ((emitir = fn), () => {}),
        pendientes: async () => [],
        // La cola vive en el main (electron/cola.ts): vivo.ts la escucha y la pide al suscribirse.
        alCola: sinSoltar,
        colas: async () => [],
      },
    },
  },
});

const { confirmar, contestado, enCurso, enviado, mensajesVistos, suscribir } = await import("../src/hilo/vivo.ts");
const { turnos } = await import("../src/hilo/turnos.ts");
const { tandasPendientes } = await import("../src/hilo/preguntas-datos.ts");

const viejo = (i: number, rol: Mensaje["rol"], texto: string): Mensaje => ({ i, rol, texto, herramientas: [], ts: null, modelo: rol === "assistant" ? "claude-opus-5-5" : null });
/** Lo que ya estaba en el transcript antes del turno. */
const PAG = { mensajes: [viejo(0, "user", "hola"), viejo(1, "assistant", "Hola.")], total: 2 };
const TEXTO = "Va una lista:\n\n- uno\n- **dos**\n\n```js\nconst x = 1;\n```\n\nListo.";
const entero = (mid: string, texto: string, herramientas: string[] = []): EventoLider => ({ tipo: "mensaje", mid, texto, herramientas, modelo: "claude-opus-5-5" });

/** Lo que ve la vista, sin las horas (son las del momento en que llegó cada cosa). */
const visto = (sid: string, pag = PAG) => mensajesVistos(pag, enCurso(sid)).map((m) => ({ ...m, ts: null }));
const items = (sid: string, pag = PAG) => turnos(visto(sid, pag), null);
/** Los mensajes del asistente de este turno (lo que vino después de lo que mandó Ana). */
const delTurno = (sid: string) => visto(sid).filter((m) => m.i > 2);

function empezar(sid: string) {
  suscribir(sid, () => {});
  enviado(sid, "contame", PAG.total);
  emitir({ sid, e: { tipo: "estado", ocupado: true, vivo: true } });
}
function terminar(sid: string) {
  emitir({ sid, e: { tipo: "fin", error: null, ttl: 3600 } });
  emitir({ sid, e: { tipo: "estado", ocupado: false, vivo: true } });
}

test("parciales + definitivo = un solo mensaje, igual al de hoy", () => {
  // Con el texto llegando de a pedazos.
  empezar("con");
  let dicho = "";
  let key: string | null = null;
  for (let k = 0; k < TEXTO.length; k += 7) {
    const pedazo = TEXTO.slice(k, k + 7);
    dicho += pedazo;
    emitir({ sid: "con", e: { tipo: "parcial", texto: pedazo } });
    const ms = delTurno("con");
    assert.equal(ms.length, 1, "mientras llega, un solo mensaje del asistente");
    assert.deepEqual(ms[0], { i: 3, rol: "assistant", texto: dicho, herramientas: [], ts: null, modelo: null });
    const its = items("con");
    const ultimo = its.at(-1)!;
    assert.equal(its.length, 4);
    assert.equal(ultimo.tipo, "turno");
    if (ultimo.tipo !== "turno") return;
    assert.equal(ultimo.texto, dicho);
    // El mismo turno de punta a punta: React no lo desmonta, sólo le cambia el texto.
    key ??= ultimo.key;
    assert.equal(ultimo.key, key);
  }
  assert.equal(dicho, TEXTO);
  emitir({ sid: "con", e: entero("msg_1", TEXTO) });
  assert.equal(enCurso("con").parcial, "");
  assert.equal(delTurno("con").length, 1, "el entero reemplaza al parcial: no hay dos");
  assert.equal(delTurno("con")[0].i, 3);
  const itsCon = items("con");
  assert.equal(itsCon.at(-1)!.key, key);

  // Sin parciales (como llegaba antes): el mensaje entero y nada más.
  empezar("sin");
  emitir({ sid: "sin", e: entero("msg_1", TEXTO) });
  assert.deepEqual(visto("con"), visto("sin"));
  assert.deepEqual(itsCon, items("sin"));

  // Al terminar el turno siguen iguales.
  terminar("con");
  terminar("sin");
  assert.deepEqual(visto("con"), visto("sin"));
  assert.deepEqual(items("con"), items("sin"));
  assert.equal(visto("con").filter((m) => m.texto === TEXTO).length, 1);

  // Y cuando el transcript ya lo trae, queda el transcript solo.
  const pag = { mensajes: [...PAG.mensajes, viejo(2, "user", "contame"), viejo(3, "assistant", TEXTO)], total: 4 };
  confirmar("con", pag.total);
  assert.equal(mensajesVistos(pag, enCurso("con")), pag.mensajes);
});

test("texto, herramienta y más texto: cada parcial es del mensaje que sigue, nunca uno de más", () => {
  empezar("pasos");
  const pasos: [EventoLider, number][] = [
    [{ tipo: "parcial", texto: "Voy a " }, 1],
    [{ tipo: "parcial", texto: "mirar." }, 1],
    [entero("msg_a", "Voy a mirar."), 1],
    // Otro bloque del mismo mensaje: se junta con el anterior.
    [entero("msg_a", "", ["Bash: ls"]), 1],
    [{ tipo: "parcial", texto: "Lis" }, 2],
    [{ tipo: "parcial", texto: "to." }, 2],
    [entero("msg_b", "Listo."), 2],
  ];
  for (const [e, cuantos] of pasos) {
    emitir({ sid: "pasos", e });
    assert.equal(delTurno("pasos").length, cuantos);
    // Siempre un solo turno, detrás de lo que mandó Ana.
    assert.deepEqual(items("pasos").map((x) => x.tipo), ["yo", "turno", "yo", "turno"]);
  }
  assert.deepEqual(delTurno("pasos").map((m) => [m.texto, m.herramientas]), [["Voy a mirar.", ["Bash: ls"]], ["Listo.", []]]);
  const t = items("pasos").at(-1)!;
  assert.equal(t.tipo === "turno" && t.texto, "Listo.");
});

test("cortado a mitad (Parar, o el proceso murió): el texto a medias no queda colgado", () => {
  empezar("corte");
  emitir({ sid: "corte", e: { tipo: "parcial", texto: "Empiezo a " } });
  assert.equal(delTurno("corte").length, 1);
  terminar("corte");
  assert.equal(enCurso("corte").parcial, "");
  assert.equal(delTurno("corte").length, 0);

  empezar("muerto");
  emitir({ sid: "muerto", e: { tipo: "parcial", texto: "Empiezo a " } });
  emitir({ sid: "muerto", e: { tipo: "salio", codigo: 1, error: "socket hang up" } });
  assert.equal(enCurso("muerto").parcial, "");
});

test("dos tandas de preguntas a la vez: de a una, la más vieja primero; contestar la primera deja la segunda", () => {
  const sid = "dos-tandas";
  suscribir(sid, () => {});
  const qs = (n: string) => [{ question: `¿${n}?`, header: n, multiSelect: false, options: [{ label: "Sí", description: "" }] }];
  const pide = (id: string, preguntas: ReturnType<typeof qs> | null): EventoLider => ({ tipo: "permiso", id, herramienta: preguntas ? "AskUserQuestion" : "Bash", detalle: null, plan: null, preguntas, tool_use_id: `t-${id}` });
  emitir({ sid, e: pide("a", qs("A")) });
  emitir({ sid, e: pide("bash", null) });
  emitir({ sid, e: pide("b", qs("B")) });
  assert.deepEqual(tandasPendientes(enCurso(sid).pide).map((p) => p.id), ["a", "b"]);
  // Contestar la primera: queda la segunda, ahora sola.
  contestado(sid, "a");
  assert.deepEqual(tandasPendientes(enCurso(sid).pide).map((p) => p.id), ["b"]);
  // Un pedido repetido (el main lo reenvía) no duplica la tanda.
  emitir({ sid, e: pide("b", qs("B")) });
  assert.deepEqual(tandasPendientes(enCurso(sid).pide).map((p) => p.id), ["b"]);
  contestado(sid, "b");
  assert.deepEqual(tandasPendientes(enCurso(sid).pide), []);
  assert.deepEqual(enCurso(sid).pide.map((p) => p.id), ["bash"]);
});

// El razonamiento (`thinking`): llega por deltas, se acumula en vivo y al terminar queda en el turno (plegado en la vista).
const STREAM_PENSANDO = readFileSync(path.join(import.meta.dirname, "fixtures", "stream-pensando.jsonl"), "utf8").split("\n").filter(Boolean);
const RAZON = "Ana quiere saber qué falló en el índice. Primero miro el log, después decido.";

test("razonamiento: se acumula en vivo, el entero lo reemplaza en su lugar y queda en el turno", () => {
  empezar("razona");
  const sid = "razona";
  const ultimo = () => {
    const t = items(sid).at(-1)!;
    assert.equal(t.tipo, "turno");
    return t as Extract<ReturnType<typeof items>[number], { tipo: "turno" }>;
  };
  let key: string | null = null;
  let hubo = 0;
  let pensado = "";
  for (const linea of STREAM_PENSANDO) {
    for (const ev of parsearLinea(linea)) {
      // El main solo manda lo que le importa a la vista: el resto de los eventos no cambia este turno.
      if (ev.tipo !== "pensamiento" && ev.tipo !== "parcial" && ev.tipo !== "mensaje" && ev.tipo !== "fin") continue;
      const e = ev as EventoLider;
      emitir({ sid, e });
      if (ev.tipo === "pensamiento") {
        hubo++;
        pensado += ev.texto;
        // En vivo: lo que llegó hasta ahora, en el turno, todavía sin texto.
        assert.equal(enCurso(sid).pensando, pensado);
        assert.equal(ultimo().pensado, pensado);
        assert.equal(ultimo().texto, null);
        key ??= ultimo().key;
        assert.equal(ultimo().key, key, "el mismo turno de punta a punta");
      }
    }
  }
  assert.equal(hubo, 4, "los cuatro deltas del fixture");
  assert.equal(pensado, RAZON);
  // El mensaje entero del razonamiento ya lo reemplazó: nada vivo, y un solo mensaje del asistente con las dos cosas.
  assert.equal(enCurso(sid).pensando, "");
  const ms = delTurno(sid);
  assert.equal(ms.length, 1, "los bloques del mismo mensaje van juntos");
  assert.equal(ms[0].pensado, RAZON);
  assert.equal(ms[0].texto, "Falló el orden de las claves.");
  assert.equal(ultimo().key, key);
  assert.equal(ultimo().pensado, RAZON);
  assert.equal(ultimo().texto, "Falló el orden de las claves.");
  // Al terminar el turno queda igual.
  terminar(sid);
  assert.equal(ultimo().pensado, RAZON);
  assert.equal(enCurso(sid).pensando, "");
});

test("razonamiento: sin mensaje entero (cortado) se queda lo que llegó; si el entero no lo trae, no se pierde", () => {
  empezar("corta");
  emitir({ sid: "corta", e: { tipo: "pensamiento", texto: "voy a mirar " } });
  emitir({ sid: "corta", e: { tipo: "pensamiento", texto: "el log" } });
  // El mensaje llega sin `pensado` (un claude que no lo repite): lo que llegó por deltas pasa al mensaje.
  emitir({ sid: "corta", e: entero("msg_c", "Listo.") });
  assert.equal(delTurno("corta")[0].pensado, "voy a mirar el log");
  assert.equal(enCurso("corta").pensando, "");

  // Parar a mitad: el fin lo suelta, no queda colgado como mensaje vivo.
  empezar("para");
  emitir({ sid: "para", e: { tipo: "pensamiento", texto: "pienso…" } });
  assert.equal(delTurno("para").length, 1);
  emitir({ sid: "para", e: { tipo: "fin", error: null, ttl: null } });
  assert.equal(enCurso("para").pensando, "");
});

test("razonamiento: el transcript lo trae y los bloques del mismo mensaje se juntan", () => {
  const sid = "0e0e0e0e-1111-4222-8333-444444444444";
  const bloques = STREAM_PENSANDO.map((l) => JSON.parse(l)).filter((o) => o.type === "assistant");
  const lineas = [
    JSON.stringify({ type: "user", message: { role: "user", content: "¿qué falló?" }, timestamp: "2026-10-14T12:00:00Z" }),
    ...bloques.map((o) => JSON.stringify({ ...o, timestamp: "2026-10-14T12:00:05Z" })),
  ].join("\n");
  const pag = conversacionDe(sid, null, lineas);
  assert.equal(pag.mensajes.length, 2);
  assert.equal(pag.mensajes[1].texto, "Falló el orden de las claves.");
  assert.equal((pag.mensajes[1] as Mensaje).pensado, RAZON);
  assert.equal((pag.mensajes[0] as Mensaje).pensado, undefined);
  // Y en la vista, el turno lo trae plegado con el mismo texto.
  const t = turnos(pag.mensajes as Mensaje[], null).at(-1)!;
  assert.equal(t.tipo === "turno" && t.pensado, RAZON);
});

test("razonamiento: un bloque vacío o redactado no dice nada", () => {
  const o = { type: "assistant", message: { id: "m1", model: "claude-opus-5-5", role: "assistant", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "redacted_thinking", data: "x" }, { type: "text", text: "Hola." }] }, parent_tool_use_id: null };
  const ev = parsearLinea(JSON.stringify(o));
  assert.equal(ev.length, 1);
  assert.equal("pensado" in ev[0], false);
  const solo = { ...o, message: { ...o.message, content: [o.message.content[0]] } };
  assert.deepEqual(parsearLinea(JSON.stringify(solo)), []);
});
