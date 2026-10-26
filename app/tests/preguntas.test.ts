// AskUserQuestion: las preguntas del can_use_tool (main), lo que Ana elige,
// las answers que vuelven al líder y el resumen leído del tool_result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inputRespondido, preguntasDe, respuestasValidas } from "../electron/preguntas.ts";
import { parsearLinea } from "../electron/lider-arma.ts";
import { alternar, alternarOtro, armar, completo, escribirOtro, NADA, respondidas, respuesta, resumenRespondidas, type Eleccion } from "../src/hilo/preguntas-datos.ts";

// La línea real de claude 2.1.289 (bypass + `--permission-prompt-tool stdio`): AskUserQuestion pide igual.
const INPUT = {
  questions: [
    {
      question: "Which color do you prefer?",
      header: "Color",
      options: [
        { label: "Red", description: "The color red" },
        { label: "Blue", description: "The color blue" },
      ],
      multiSelect: false,
    },
    {
      question: "Which fruits do you like?",
      header: "Frutas",
      options: [
        { label: "Apple", description: "A red or green fruit" },
        { label: "Pear", description: "A green or brown fruit" },
        { label: "Plum", description: "A purple or red fruit" },
      ],
      multiSelect: true,
    },
  ],
};
const LINEA = JSON.stringify({
  type: "control_request",
  request_id: "cce7bac9-8781-48d3-8aae-d6fe7ee08d3c",
  request: {
    subtype: "can_use_tool",
    tool_name: "AskUserQuestion",
    display_name: "AskUserQuestion",
    input: INPUT,
    tool_use_id: "toolu_01Pk898Fj7FjYbFtJWK3MFCe",
    requires_user_interaction: true,
  },
});
const [COLOR, FRUTAS] = preguntasDe(INPUT)!;

test("parser: el can_use_tool de AskUserQuestion trae las preguntas y no el detalle crudo", () => {
  const [e] = parsearLinea(LINEA);
  assert.equal(e.tipo, "permiso");
  if (e.tipo !== "permiso") return;
  assert.equal(e.herramienta, "AskUserQuestion");
  assert.equal(e.detalle, null);
  assert.equal(e.plan, null);
  assert.equal(e.tool_use_id, "toolu_01Pk898Fj7FjYbFtJWK3MFCe");
  assert.deepEqual(e.preguntas, INPUT.questions);
  // Otra herramienta: sin preguntas.
  const [b] = parsearLinea(JSON.stringify({ type: "control_request", request_id: "b", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } }));
  assert.equal(b.tipo === "permiso" && b.preguntas, null);
});

test("preguntasDe: lo raro da null (vuelve al Permitir / Negar común)", () => {
  assert.equal(preguntasDe(null), null);
  assert.equal(preguntasDe({ questions: [] }), null);
  assert.equal(preguntasDe({ questions: Array(5).fill(INPUT.questions[0]) }), null);
  assert.equal(preguntasDe({ questions: [{ question: "¿?", options: [] }] }), null);
  assert.equal(preguntasDe({ questions: [{ question: "¿?", options: [{ description: "sin label" }] }] }), null);
  assert.equal(preguntasDe({ questions: [INPUT.questions[0], INPUT.questions[0]] }), null);
  assert.equal(preguntasDe({ questions: [{ question: "¿?", options: [{ label: "Sí" }, { label: "Sí" }] }] }), null);
  // Sin header ni description ni multiSelect: defaults.
  assert.deepEqual(preguntasDe({ questions: [{ question: "¿Sí?", options: [{ label: "Sí" }] }] }), [
    { question: "¿Sí?", header: "", options: [{ label: "Sí", description: "" }], multiSelect: false },
  ]);
});

test("respuestasValidas e inputRespondido: todas o nada; el input tal cual más answers", () => {
  const qs = preguntasDe(INPUT)!;
  assert.equal(respuestasValidas(qs, { [COLOR.question]: "Red" }), null);
  assert.equal(respuestasValidas(qs, { [COLOR.question]: "Red", [FRUTAS.question]: "  " }), null);
  assert.equal(respuestasValidas(qs, "Red"), null);
  const r = respuestasValidas(qs, { [COLOR.question]: " Red ", [FRUTAS.question]: "Apple, Pear", "otra?": "x" });
  assert.deepEqual(r, { [COLOR.question]: "Red", [FRUTAS.question]: "Apple, Pear" });
  assert.deepEqual(inputRespondido(INPUT, r!), { ...INPUT, answers: r });
});

test("una sola: elegir reemplaza; Otro saca la opción y manda lo escrito", () => {
  let e: Eleccion = NADA;
  e = alternar(COLOR, e, "Red");
  e = alternar(COLOR, e, "Blue");
  assert.equal(respuesta(COLOR, e), "Blue");
  e = alternarOtro(COLOR, e);
  assert.deepEqual(e, { elegidas: [], otro: "" });
  assert.equal(respuesta(COLOR, e), "");
  e = escribirOtro(e, "  verde agua ");
  assert.equal(respuesta(COLOR, e), "verde agua");
  // Elegir una opción cierra Otro.
  assert.deepEqual(alternar(COLOR, e, "Red"), { elegidas: ["Red"], otro: null });
});

test("multiSelect: prende y apaga, en el orden de las opciones, con Otro al final", () => {
  let e: Eleccion = NADA;
  e = alternar(FRUTAS, e, "Plum");
  e = alternar(FRUTAS, e, "Apple");
  e = alternar(FRUTAS, e, "Pear");
  e = alternar(FRUTAS, e, "Pear");
  assert.equal(respuesta(FRUTAS, e), "Apple, Plum");
  e = escribirOtro(alternarOtro(FRUTAS, e), "kiwi");
  assert.equal(respuesta(FRUTAS, e), "Apple, Plum, kiwi");
  // Cerrar Otro lo saca; las elegidas quedan.
  assert.equal(respuesta(FRUTAS, alternarOtro(FRUTAS, e)), "Apple, Plum");
});

test("completo y armar: cada pregunta necesita algo", () => {
  const qs = [COLOR, FRUTAS];
  const color = alternar(COLOR, NADA, "Red");
  assert.equal(completo(qs, [color]), false);
  assert.equal(completo(qs, [color, alternarOtro(FRUTAS, NADA)]), false);
  const frutas = escribirOtro(alternarOtro(FRUTAS, NADA), "kiwi");
  assert.equal(completo(qs, [color, frutas]), true);
  assert.deepEqual(armar(qs, [color, frutas]), { [COLOR.question]: "Red", [FRUTAS.question]: "kiwi" });
});

test("respondidas: lee el tool_result del CLI (las dos formas), con comillas adentro y recortado", () => {
  const real =
    'The user answered: "Which color do you prefer?"="mi respuesta libre", "Which fruits do you like?"="Apple, Pear". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.';
  const rs = respondidas(INPUT, real)!;
  assert.deepEqual(rs, [
    { header: "Color", question: COLOR.question, respuesta: "mi respuesta libre" },
    { header: "Frutas", question: FRUTAS.question, respuesta: "Apple, Pear" },
  ]);
  assert.equal(resumenRespondidas(rs), "Color: mi respuesta libre · Frutas: Apple, Pear");
  // La otra forma, y comillas sin escapar en la pregunta y en la respuesta.
  const q = 'Ya existe `servicios/suscripciones`. ¿Qué hago con "suscripciones"?';
  const entrada = { questions: [{ question: q, header: "Suscripciones", options: [{ label: "Separar" }] }] };
  const otra = `Your questions have been answered: "${q}"="dejala, "así" está bien". You can now continue with these answers in mind.`;
  assert.deepEqual(respondidas(entrada, otra), [{ header: "Suscripciones", question: q, respuesta: 'dejala, "así" está bien' }]);
  // Recortado por adelante (la cola del resultado): la primera no está.
  assert.deepEqual(respondidas(INPUT, `…\n you prefer?"="Red", "Which fruits do you like?"="Plum". Read the answers carefully.`), [
    { header: "Frutas", question: FRUTAS.question, respuesta: "Plum" },
  ]);
  // Sin cola conocida: hasta la última comilla.
  assert.equal(respondidas(INPUT, '"Which color do you prefer?"="Blue".')![0].respuesta, "Blue");
  // Negado o raro: nada.
  assert.equal(respondidas(INPUT, "The user doesn't want to proceed with this tool use."), null);
  assert.equal(respondidas(undefined, real), null);
  assert.equal(respondidas(INPUT, null), null);
});
