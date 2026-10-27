// Un `agy -p … --output-format stream-json` falso (HILOS_AGY=scripts/agy-falso.mjs) para probar los líderes de
// Gemini sin gastar nada. Habla como el de verdad (init, step_update de user_input / agent_response con
// `text_delta` / tool con ACTIVE y DONE, result); lo que el prompt trae después de "Mensaje de <dueño>:" (o todo)
// lo contesta "eco: <texto>" en tres deltas. Gatillos en el texto:
//   "herramienta"  antes usa un run_command (`echo hola`) y una lectura (view_file)
//   "morite"       escribe en stderr y sale con 1 a mitad del turno
//   "pienso"       razona antes de cada paso: lo escribe en $HILOS_AGY_BRAIN/<id>/.system_generated/logs/transcript_full.jsonl
//                  (donde lo deja agy de verdad; el stream sólo trae `thinking_tokens`) y cierra el paso sin texto
//   "falla"        con "herramienta": el comando sale con código 1 y deja un error por stderr
//   "despacio"     tarda 1,5 s por delta (TRAMA_FALSO_MS_LENTO=<ms>; para encolar o interrumpir)
//   "/compact"     (el prompt entero) como el de verdad: un system_message, un checkpoint (el resumen) y ningún texto;
//                  con un mensaje detrás ("/compact seguí") compacta y después lo contesta
//   "bucle"        se traba: pide `curl …/progreso` una y otra vez con el porcentaje subiendo (12 veces) y sólo
//                  después contesta; con el aviso de trama ("Te trabaste…") sigue normal. TRAMA_FALSO_BUCLE=siempre:
//                  también se traba con el aviso (para probar el tope de reintentos)
//   "bucle-error"  lo mismo con el mismo error (cambia el comando, no el error)
//   (siempre)      si el prompt trae la palabra `pa` (el prefacio la nombra), lo dice en la respuesta
// Una conversación existe en $HILOS_STATE/agy-falso/<id>: `--conversation <id>` que no existe termina con un
// result de error y ningún paso (como el de verdad, se supone); con la que existe, sigue y cuenta cuántos
// turnos lleva ("turno N").
//   TRAMA_FALSO_LOG=<archivo>   agrega una línea JSON por arranque ({ args, cwd, claves del entorno, prompt }).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const valor = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
if (args.includes("--version")) {
  console.log(process.env.TRAMA_FALSO_VERSION_AGY ?? "0.0.0-falso");
  process.exit(0);
}
if (args[0] === "plugin" && args[1] === "list") {
  console.log(
    process.env.TRAMA_FALSO_PLUGINS_AGY ??
      JSON.stringify([{ name: "pa-worker", enabled: true, skills: ["ana-orquestar", "gemini"] }]),
  );
  process.exit(0);
}

// `agy models`: con sesión, un renglón por modelo; sin sesión sólo el aviso (como el de verdad). TRAMA_FALSO_AGY_LOGIN=0 apaga
// la sesión; TRAMA_FALSO_AGY_ERROR=<texto> sale con 1 y lo dice por stderr (sin red, por ejemplo).
if (args[0] === "models") {
  console.log("Fetching available models...");
  if (process.env.TRAMA_FALSO_AGY_ERROR) {
    console.error(process.env.TRAMA_FALSO_AGY_ERROR);
    process.exit(1);
  }
  if (process.env.TRAMA_FALSO_AGY_LOGIN !== "0") {
    console.log("gemini-4-argon-high\tGemini 4 Argon (High)\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)");
  }
  process.exit(0);
}

const prompt = valor("-p") ?? "";
const modelo = valor("--model") ?? "gemini-3.8-flash-low";
const pedida = valor("--conversation");
const dir = path.join(process.env.HILOS_STATE ?? os.tmpdir(), "agy-falso");
mkdirSync(dir, { recursive: true });

if (process.env.TRAMA_FALSO_LOG)
  appendFileSync(
    process.env.TRAMA_FALSO_LOG,
    JSON.stringify({ args: args.map((a) => (a === prompt ? "<prompt>" : a)), cwd: process.cwd(), env: Object.keys(process.env).filter((k) => /^(ANTHROPIC|CLAUDE|PA_|OLLAMA)/.test(k)), path: process.env.PATH, prompt }) + "\n",
  );

const salir = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let id = pedida;
if (pedida && !existsSync(path.join(dir, pedida))) {
  // Sin esa conversación: sólo el resultado de error.
  salir({ event: "result", result: { conversation_id: pedida, status: "ERROR", response: "conversation not found", duration_seconds: 0.1, num_turns: 0, usage: {} } });
  process.exit(1);
}
let turno = 1;
if (id) turno = Number(readFileSync(path.join(dir, id), "utf8")) + 1;
else id = randomUUID();
writeFileSync(path.join(dir, id), String(turno));

const texto = (prompt.split(/Mensaje de [^\n]+:\n/).pop() ?? prompt).trim();
const ms = /despacio/i.test(texto) ? Number(process.env.TRAMA_FALSO_MS_LENTO ?? 1500) : Number(process.env.TRAMA_FALSO_MS ?? 30);
let paso = 0;
const step = (st) => salir({ event: "step_update", step_update: { conversation_id: id, step_index: paso, ...st } });

salir({ event: "init", conversation_id: id, init: { model: modelo, cwd: process.cwd(), tools: ["run_command", "view_file"], permission_mode: "bypass" } });
step({ state: "DONE", step_type: "user_input" });
paso++;

if (/morite/i.test(texto)) {
  await dormir(100);
  process.stderr.write("agy falso: me muero\n");
  process.exit(1);
}

if (/^\/compact(\s|$)/i.test(texto)) {
  step({ state: "DONE", step_type: "system_message", duration_seconds: 0 });
  paso++;
  await dormir(ms);
  step({ state: "DONE", step_type: "checkpoint", duration_seconds: 3.8 });
  paso++;
  if (texto.replace(/^\/compact\s*/i, "") === "") {
    salir({ event: "result", result: { conversation_id: id, status: "SUCCESS", response: "", duration_seconds: 1, num_turns: 2, usage: { input_tokens: 700, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 700 } } });
    process.exit(0);
  }
}

const brain = process.env.HILOS_AGY_BRAIN ?? path.join(dir, "brain");
// El razonamiento de un paso: agy lo escribe en el transcript de su conversación y el stream sólo dice cuántos tokens fueron.
const pensar = async (razonamiento) => {
  const logs = path.join(brain, id, ".system_generated", "logs");
  mkdirSync(logs, { recursive: true });
  appendFileSync(path.join(logs, "transcript_full.jsonl"), JSON.stringify({ step_index: paso, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", thinking: razonamiento }) + "\n");
  await dormir(ms);
  step({ state: "DONE", step_type: "agent_response", duration_seconds: 0.4, usage: { input_tokens: 5000, output_tokens: 40, thinking_tokens: 40, cache_read_tokens: 0, total_tokens: 5040 } });
  paso++;
};
const piensa = /pienso/i.test(texto);
const herramienta = async (nombre, parametros, salida) => {
  step({ state: "ACTIVE", step_type: "tool", tool_name: nombre, tool_info: { name: nombre, parameters: parametros } });
  await dormir(ms);
  step({ state: "DONE", step_type: "tool", tool_name: nombre, duration_seconds: 0.1, tool_info: { name: nombre, parameters: parametros, output: salida } });
  paso++;
};
if (/herramienta/i.test(texto)) {
  if (piensa) await pensar("Primero miro dónde estoy parado: un `echo` alcanza para ver que el shell responde.\nDespués leo el archivo de prueba.");
  await herramienta("run_command", { CommandLine: "echo hola", Cwd: process.cwd() }, "Command exited with code 0.\n\nCommand output:\nhola\r\n");
  if (/falla/i.test(texto)) {
    if (piensa) await pensar("Ahora pruebo algo que no existe para ver cómo se ve un error.");
    await herramienta("run_command", { CommandLine: "ls /no/existe" }, "Command exited with code 2.\n\nCommand output:\nls: no se puede acceder a '/no/existe': No existe el archivo o el directorio\r\n");
  }
  if (piensa) await pensar("El primero salió bien. Leo el archivo y contesto.");
  await herramienta("view_file", { AbsolutePath: "C:\\x.txt" }, "contenido de x");
} else if (piensa) await pensar("El mensaje es corto: contesto directo, sin herramientas.");

const trabado = /Te trabaste/.test(texto);
const bucle = /bucle-error/i.test(texto) ? "error" : /bucle/i.test(texto) ? "progreso" : trabado && process.env.TRAMA_FALSO_BUCLE === "siempre" ? "progreso" : null;
if (bucle && (!trabado || process.env.TRAMA_FALSO_BUCLE === "siempre")) {
  for (let i = 1; i <= 12; i++) {
    if (bucle === "error")
      await herramienta("run_command", { CommandLine: `ls /no/existe/${i}`, Cwd: process.cwd() }, "Command exited with code 2.\n\nCommand output:\nls: cannot access: No such file or directory\r\n");
    else await herramienta("run_command", { CommandLine: "curl -s localhost:9/progreso", Cwd: process.cwd() }, `Command exited with code 0.\n\nCommand output:\nDescargando… ${i * 8} % (${i * 8}/100 MB)\r\n`);
  }
}

const dicho = [`eco: ${texto}`, `(turno ${turno})`, /\bpa\b/.test(prompt) ? "(el prefacio habla de pa)" : ""].filter(Boolean).join(" ");
const palabras = dicho.split(/(?<= )/);
let acumulado = "";
for (const w of palabras) {
  step({ state: "ACTIVE", step_type: "agent_response", text_delta: w });
  acumulado += w;
  await dormir(ms);
}
step({ state: "DONE", step_type: "agent_response", text_delta: "\n", duration_seconds: 0.5, usage: { input_tokens: 5000 + turno, output_tokens: 12, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 5012 } });
salir({ event: "result", result: { conversation_id: id, status: "SUCCESS", response: acumulado + "\n", duration_seconds: 1, num_turns: 1, usage: { input_tokens: 5000 + turno, output_tokens: 12, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 5012 } } });
