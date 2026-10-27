// Un `claude -p --input-format stream-json --output-format stream-json` falso
// para probar los líderes de la app sin gastar nada (HILOS_CLAUDE=scripts/claude-falso.mjs).
// Por cada línea de usuario contesta "eco: <texto>" en tres deltas, con un
// mensaje entero al final y un `result`. Si el texto dice "herramienta", antes
// usa un Bash. Atiende el interrupt (control_request) cortando la respuesta.
// Palabras gatillo (B12): "reintento" manda un api_retry antes de contestar;
// "límite" contesta con el tope de 5 h (rate_limit_event rechazado, assistant
// con error y result is_error); "morite" escribe en stderr y sale con 1 a mitad del turno;
// "colgate" no contesta nunca ni sale al cerrarle el stdin (sólo con una señal): un líder colgado.
// Modos (B13), como el `claude` real con `--permission-prompt-tool stdio`: arranca en
// bypass con --dangerously-skip-permissions, si no en --permission-mode (default
// "default"); contesta initialize (commands, current_permission_mode) y
// set_permission_mode (y avisa con system/status). En plan, cada turno termina
// pidiendo ExitPlanMode (can_use_tool con el plan): allow vuelve al modo de antes (si sigue en plan) y
// contesta "plan aprobado: …"; deny contesta "sigo planeando: <message>". En default,
// "herramienta" pide permiso para el Bash antes de usarlo.
// Un brief del analista de Ramas (líneas "- id: X") se contesta con veredictos en un bloque json.
// "despacio" tarda 1,5 s antes de contestar (para encolar mientras responde).
// "compactá" compacta antes de contestar, como el real: system/status compacting, 2,5 s
// (TRAMA_FALSO_COMPACTA_MS), el compact_boundary y sigue.
// "muchos pasos" usa el Bash 6 veces (TRAMA_FALSO_PASOS), una cada 300 ms (TRAMA_FALSO_PASO_MS),
// cada una con su descripción ("Paso 3 de 6"), y después contesta.
// "comando largo" corre un Bash de más de 200 caracteres (TRAMA_FALSO_LARGO_MS de espera, default 4000): el pliegue de la tarjeta.
// "preguntame" usa AskUserQuestion (dos preguntas, la segunda multiSelect), como el real en cualquier
// modo: can_use_tool con requires_user_interaction; allow con `answers` → tool_result "The user answered: …"
// y contesta "respuestas: <answers en JSON>"; deny → "sin respuesta: <message>".
// Cambios en vivo, como el real: set_model cambia el modelo de lo que sigue y
// apply_flag_settings el esfuerzo (`effortLevel`); los dos contestan success.
// update_settings (/output-style) recuerda el estilo (en $HILOS_STATE/claude-falso-estilo, como el real en
// settings.local.json) y lo dice el próximo init. No escribe nada en ~/.claude.
//   TRAMA_FALSO_LOG=<archivo>  agrega una línea JSON por arranque (argv, cwd y las claves del entorno)
//                              y otra por set_model / apply_flag_settings ({ control, model | settings }).
//   TRAMA_FALSO_DICHO=<archivo> agrega una línea JSON por mensaje de usuario que le llega ({ sid, texto }): el
//                              texto exacto, para comprobar qué recibió cada líder (la vista lo muestra como markdown).
// "novela" contesta un texto largo en markdown (párrafos, lista, código, tabla) de a un delta por
// palabra, como el stream de verdad: para probar que el texto se ve mientras llega.
// "pensá" razona antes de contestar: un bloque `thinking` con un delta por palabra (`thinking_delta`), su
// mensaje entero (el bloque `thinking` solo, como el real) y después el texto "eco: …".
//   TRAMA_FALSO_MS=<ms>        pausa entre deltas (default 30).
//   TRAMA_FALSO_TOKEN_MS=<ms>  pausa entre las palabras de "novela" (default 4).
//   TRAMA_FALSO_VERSION=<v>    lo que contesta `--version` (default 2.1.287).
//   TRAMA_FALSO_USO=<5h>,<sem> el uso del plan que dice cada turno, en % (default 12,34): rate_limit_event
//                              "allowed" con `unifiedWindows`, como el real.
//   TRAMA_FALSO_USO_OFICIAL=<5h>,<sem>  lo que contesta `get_usage` (el uso que dice claude.ai, el botón
//                              Actualizar límites), en % (default: el de TRAMA_FALSO_USO); `no` contesta el error
//                              de una versión que no lo conoce.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
// El aviso de versión nueva (electron/actualizacion.ts) pregunta esto; no cuenta como arranque.
// `update` (el botón Actualizar) deja la nueva en $HILOS_STATE/claude-falso-version y desde
// ahí `--version` dice esa; con TRAMA_FALSO_UPDATE_FALLA sale con 1 y un error en stderr.
const instalada = () => {
  try {
    return readFileSync(path.join(process.env.HILOS_STATE ?? "/nonexistent", "claude-falso-version"), "utf8").trim();
  } catch {
    return process.env.TRAMA_FALSO_VERSION ?? "2.1.287";
  }
};
if (args[0] === "--version") {
  process.stdout.write(`${instalada()} (Claude Code)\n`);
  process.exit(0);
}
if (args[0] === "update") {
  await new Promise((r) => setTimeout(r, 400));
  if (process.env.TRAMA_FALSO_UPDATE_FALLA) {
    process.stderr.write("Error: EACCES: permission denied, rename 'C:\\Program Files\\nodejs\\node_modules\\@anthropic-ai\\claude-code'\nTry running as administrator or fix your npm prefix\n");
    process.exit(1);
  }
  const nueva = process.env.TRAMA_FALSO_NUEVA ?? "2.1.300";
  const antes = instalada();
  if (process.env.HILOS_STATE) writeFileSync(path.join(process.env.HILOS_STATE, "claude-falso-version"), nueva + "\n");
  process.stdout.write(`Current version: ${antes}\nChecking for updates...\nSuccessfully updated from ${antes} to version ${nueva}\n`);
  process.exit(0);
}
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
const sid = val("--session-id") ?? val("--resume") ?? "00000000-0000-4000-8000-000000000000";
let modelo = val("--model") ?? "claude-opus-5-5";
const ms = Number(process.env.TRAMA_FALSO_MS ?? 30);
let modo = args.includes("--dangerously-skip-permissions") ? "bypassPermissions" : (val("--permission-mode") ?? "default");
const archivoEstilo = process.env.HILOS_STATE ? path.join(process.env.HILOS_STATE, "claude-falso-estilo") : null;
let estilo = "default";
try {
  if (archivoEstilo) estilo = readFileSync(archivoEstilo, "utf8").trim() || "default";
} catch {}
let antesDelPlan = modo === "plan" ? "default" : modo;
const COMANDOS = [
  { name: "compact", description: "Clear conversation history but keep a summary in context", argumentHint: "<optional custom summarization instructions>" },
  { name: "review", description: "Review a pull request", argumentHint: "" },
  { name: "doctor", description: "Diagnose and verify your Claude Code installation", argumentHint: "" },
  { name: "falso-skill", description: "Una skill inventada del claude falso", argumentHint: "" },
];
if (process.env.TRAMA_FALSO_LOG)
  appendFileSync(
    process.env.TRAMA_FALSO_LOG,
    JSON.stringify({ args, cwd: process.cwd(), env: Object.keys(process.env).sort(), path: process.env.PATH }) + "\n",
  );

// "Medir exacto" (electron/arranque.ts): `claude -p <mensaje> --output-format json` contesta una vez y sale, con el
// `usage` del primer pedido según lo que se apagó: todo apagado (--safe-mode) pesa 14 300; las skills, 3 100
// (--disable-slash-commands); MCP, 1 700 (--strict-mcp-config); el resto (CLAUDE.md, plugins…), 14 380.
// TRAMA_FALSO_MEDIR_FALLA=sin-uso contesta sin `usage`; =error, un error de claude (rc 1, stderr).
if (args.includes("-p") && val("--output-format") === "json") {
  if (process.env.TRAMA_FALSO_MEDIR_FALLA === "error") {
    process.stderr.write("Error: not logged in\n");
    process.exit(1);
  }
  const vacio = args.includes("--safe-mode");
  const total = 14_300 + (vacio || args.includes("--disable-slash-commands") ? 0 : 3_100) + (vacio || args.includes("--strict-mcp-config") ? 0 : 1_700) + (vacio ? 0 : 14_380);
  const usage = process.env.TRAMA_FALSO_MEDIR_FALLA === "sin-uso" ? undefined : { input_tokens: 6, cache_creation_input_tokens: total - 6 - 100, cache_read_input_tokens: 100, output_tokens: 4 };
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: sid, usage }) + "\n");
  process.exit(0);
}

const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: sid }) + "\n");
const espera = (t) => new Promise((r) => setTimeout(r, t));
/** Cada turno dice cuánto va del plan, como el real: las dos ventanas, de 0 a 1 (`TRAMA_FALSO_USO`). */
function usoDelPlan() {
  const [h, sem] = (process.env.TRAMA_FALSO_USO ?? "12,34").split(",").map(Number);
  const ya = Math.floor(Date.now() / 1000);
  const ventanas = { five_hour: { utilization: h / 100, resetsAt: ya + 3 * 3600 + 20 * 60 }, seven_day: { utilization: sem / 100, resetsAt: ya + 4 * 86400 } };
  out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: ventanas.five_hour.resetsAt, rateLimitType: "five_hour", isUsingOverage: false, unifiedWindows: ventanas } });
}
let n = 0;
let cortado = false;
let iniciado = false;
let cola = Promise.resolve();
// Los can_use_tool sin contestar: request_id → resolver (con la respuesta o null si se cortó).
const pendientes = new Map();
let pedidosN = 0;

function ponerModo(m) {
  if (m === "plan" && modo !== "plan") antesDelPlan = modo;
  modo = m;
  out({ type: "system", subtype: "status", status: null, permissionMode: modo });
}

/** Pide permiso como el real (`requires_user_interaction` en ExitPlanMode) y espera la respuesta. */
function pedir(tool_name, input, tool_use_id) {
  const request_id = `falso-${++pedidosN}`;
  out({ type: "control_request", request_id, request: { subtype: "can_use_tool", tool_name, display_name: tool_name, input, tool_use_id, requires_user_interaction: tool_name === "ExitPlanMode" || tool_name === "AskUserQuestion" } });
  return new Promise((r) => pendientes.set(request_id, r));
}

let mensajesN = 0;

/** Lo que contesta "novela": largo (más alto que la ventana) y con todo lo que el markdown arma de a poco. */
const NOVELA = [
  "# La huerta del fondo",
  ...Array.from({ length: 6 }, (_, i) => `Capítulo ${i + 1}. El brote salió despacio, una hoja por vez, y nadie en la casa lo miraba crecer hasta que una mañana ya tapaba la ventana del fondo y hubo que correr la mesa para que entrara la luz.`),
  "- regar a la mañana\n- **no** podar en invierno\n- anotar cada brote nuevo",
  "```js\nconst brote = { hojas: 3, alto: 12 };\nbrote.hojas += 1;\n```",
  "| Planta | Hojas |\n| --- | --- |\n| Albahaca | 14 |\n| Menta | 31 |",
  ...Array.from({ length: 6 }, (_, i) => `Epílogo ${i + 1}. Al final del verano la huerta ocupaba medio patio y los vecinos pasaban a pedir gajos, que se iban envueltos en papel de diario con las instrucciones escritas a lápiz.`),
  "Fin de la novela.",
].join("\n\n");
const msToken = Number(process.env.TRAMA_FALSO_TOKEN_MS ?? 4);

/** Lo que razona "pensá": un delta por palabra. */
const RAZONA = "Ana pide algo corto. Pienso en cómo contestarlo y lo respondo sin vueltas.".match(/\s*\S+/g);

async function contestar(mid, resp, trozos = [resp.slice(0, 3), resp.slice(3, 8), resp.slice(8)], pausa = ms, razona = null) {
  // El peso de la conversación (B16, el anillo de contexto): crece con cada mensaje.
  const usage = { input_tokens: 3, cache_creation_input_tokens: 400, cache_read_input_tokens: 61_000 + 3_000 * mensajesN++, output_tokens: 1 };
  out({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: mid, usage } } });
  if (razona) {
    out({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } });
    for (const t of razona) {
      await espera(msToken);
      if (cortado) break;
      out({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } } });
    }
    out({ type: "assistant", parent_tool_use_id: null, message: { id: mid, model: modelo, role: "assistant", content: [{ type: "thinking", thinking: razona.join(""), signature: "firma-falsa" }] } });
  }
  const bloque = razona ? 1 : 0;
  out({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: bloque, content_block: { type: "text", text: "" } } });
  let dicho = "";
  for (const t of trozos) {
    await espera(pausa);
    if (cortado) break;
    dicho += t;
    out({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: bloque, delta: { type: "text_delta", text: t } } });
  }
  out({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_delta", delta: {}, usage: { output_tokens: dicho.length } } });
  if (dicho) out({ type: "assistant", parent_tool_use_id: null, message: { id: mid, model: modelo, role: "assistant", content: [{ type: "text", text: dicho }] } });
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: dicho,
    usage: { cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 } },
    modelUsage: { [modelo]: { inputTokens: 3, outputTokens: dicho.length, contextWindow: 1_000_000 } },
  });
}

async function turno(texto) {
  cortado = false;
  if (!iniciado) {
    iniciado = true;
    out({
      type: "system",
      subtype: "init",
      cwd: process.cwd(),
      model: modelo,
      permissionMode: modo,
      output_style: estilo,
      slash_commands: [...COMANDOS.map((c) => c.name), "doctor"],
      terminal_slash_commands: ["doctor"],
    });
  }
  const mid = `msg_falso_${++n}`;
  out({ type: "system", subtype: "status", status: "requesting" });
  usoDelPlan();
  if (/despacio/.test(texto)) await espera(1500);
  if (/compactá/.test(texto)) {
    out({ type: "system", subtype: "status", status: "compacting" });
    await espera(Number(process.env.TRAMA_FALSO_COMPACTA_MS ?? 2500));
    out({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 167000 } });
    out({ type: "system", subtype: "status", status: "requesting" });
  }
  if (/reintento/.test(texto)) {
    out({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 1200, error_status: 529, error: "overloaded" });
    await espera(ms);
  }
  if (/límite/.test(texto)) {
    const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600 + 20 * 60;
    const dice = "You've hit your session limit · resets 7pm";
    out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour", isUsingOverage: false } });
    out({
      type: "assistant",
      parent_tool_use_id: null,
      error: "rate_limit",
      message: { id: mid, model: "<synthetic>", role: "assistant", content: [{ type: "text", text: dice }] },
    });
    out({ type: "result", subtype: "success", is_error: true, result: dice, usage: {} });
    return;
  }
  if (/colgate/.test(texto)) {
    // Un handle vivo y una promesa que no se resuelve: el turno no termina, ni cerrando el stdin.
    setInterval(() => {}, 1 << 30);
    return new Promise(() => {});
  }
  if (/morite/.test(texto)) {
    await espera(ms);
    process.stderr.write("Error: socket hang up\n");
    process.exit(1);
  }
  if (/pensá/.test(texto)) return contestar(mid, `eco: ${texto}`, undefined, ms, RAZONA);
  if (/novela/.test(texto)) return contestar(mid, NOVELA, NOVELA.match(/\s*\S+/g), msToken);
  if (/preguntame/.test(texto)) {
    const input = {
      questions: [
        { question: "¿Qué color?", header: "Color", multiSelect: false, options: [{ label: "Rojo", description: "El rojo" }, { label: "Azul", description: "El azul" }] },
        { question: "¿Qué frutas?", header: "Frutas", multiSelect: true, options: [{ label: "Manzana", description: "" }, { label: "Pera", description: "" }, { label: "Ciruela", description: "" }] },
      ],
    };
    const id = `toolu_q${n}`;
    out({ type: "assistant", parent_tool_use_id: null, message: { id: `${mid}q`, model: modelo, role: "assistant", content: [{ type: "tool_use", id, name: "AskUserQuestion", input }] } });
    const r = await pedir("AskUserQuestion", input, id);
    const answers = r?.behavior === "allow" ? r.updatedInput?.answers : null;
    if (!answers) {
      out({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: r?.message ?? "cortado" }] } });
      return contestar(mid, `sin respuesta: ${r?.message ?? "cortado"}`);
    }
    const dicho = Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(", ");
    const content = `The user answered: ${dicho}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
    out({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] }, tool_use_result: { ...r.updatedInput } });
    return contestar(mid, `respuestas: ${JSON.stringify(answers)}`);
  }
  if (modo === "plan") {
    const plan = `# Plan falso\n\n1. Leer: ${texto}\n2. Hacerlo.`;
    const input = { plan, planFilePath: "C:\\plan-falso.md" };
    out({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: `${mid}p`, model: modelo, role: "assistant", content: [{ type: "tool_use", id: `toolu_p${n}`, name: "ExitPlanMode", input }] },
    });
    const r = await pedir("ExitPlanMode", input, `toolu_p${n}`);
    if (r?.behavior === "allow") {
      // Como el real: vuelve al modo de antes sólo si sigue en plan (la app pudo pedir bypass antes).
      if (modo === "plan") ponerModo(antesDelPlan);
      return contestar(mid, `plan aprobado: ${texto}`);
    }
    return contestar(mid, `sigo planeando: ${r?.message ?? "cortado"}`);
  }
  if (/muchos pasos/.test(texto)) {
    const total = Number(process.env.TRAMA_FALSO_PASOS ?? 6);
    for (let k = 1; k <= total && !cortado; k++) {
      const id = `tp${n}_${k}`;
      const input = { command: `echo paso ${k}`, description: `Paso ${k} de ${total}` };
      out({ type: "assistant", parent_tool_use_id: null, message: { id: `${mid}s${k}`, model: modelo, role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input }] } });
      await espera(Number(process.env.TRAMA_FALSO_PASO_MS ?? 300));
      out({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `paso ${k}` }] } });
    }
  }
  // "comando largo": un Bash con un comando de más de 200 caracteres (el pliegue de la tarjeta), corriendo un rato.
  if (/comando largo/.test(texto)) {
    const id = `tl${n}`;
    const command = `cd ~/Proyectos/hilos && ${"npm run prueba -- actividad --verbose --sin-cache "}${"--tope 120 ".repeat(18)}&& echo listo-${n}`;
    const input = { command, description: "Prueba larga de la tarjeta" };
    out({ type: "assistant", parent_tool_use_id: null, message: { id: `${mid}l`, model: modelo, role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input }] } });
    await espera(Number(process.env.TRAMA_FALSO_LARGO_MS ?? 4000));
    out({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "listo" }] } });
  }
  if (/herramienta/.test(texto)) {
    if (modo === "default") {
      const r = await pedir("Bash", { command: "ls -la ~", description: "List home" }, "t1");
      if (r?.behavior !== "allow") return contestar(mid, `negado: ${r?.message ?? "cortado"}`);
    }
    out({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: `${mid}t`, model: modelo, role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la ~" } }] },
    });
    out({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
  }
  // El analista de Ramas (B22): por cada "- id: X" del brief, un veredicto (rotan) en un bloque json.
  const ids = [...texto.matchAll(/^- id: (\S+)$/gm)].map((m) => m[1]);
  if (ids.length) {
    const vs = ["integrar", "retomar", "descartar", "revisar"];
    const juicios = ids.map((id, i) => ({ id, veredicto: vs[i % vs.length], motivo: `motivo falso ${i + 1}` }));
    return contestar(mid, `Miré ${ids.length} ramas.\n\n\`\`\`json\n${JSON.stringify(juicios)}\n\`\`\``);
  }
  return contestar(mid, `eco: ${texto}`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (l) => {
  let o;
  try {
    o = JSON.parse(l);
  } catch {
    return;
  }
  if (o.type === "control_request") {
    const q = o.request ?? {};
    let r = {};
    if (q.subtype === "interrupt") {
      cortado = true;
      for (const [id, f] of pendientes) {
        out({ type: "control_cancel_request", request_id: id });
        f(null);
      }
      pendientes.clear();
    }
    if (q.subtype === "initialize")
      r = { commands: COMANDOS, current_permission_mode: modo, output_style: estilo, available_output_styles: ["default", "Explanatory", "Learning", "Concise"] };
    // `/output-style`, como /config: el real lo guarda en settings.local.json; el falso, en $HILOS_STATE (y lo anota).
    if (q.subtype === "update_settings") {
      if (typeof q.settings?.outputStyle === "string") {
        estilo = q.settings.outputStyle;
        if (archivoEstilo) writeFileSync(archivoEstilo, estilo + "\n");
      }
      if (process.env.TRAMA_FALSO_LOG) appendFileSync(process.env.TRAMA_FALSO_LOG, JSON.stringify({ control: q.subtype, source: q.source, settings: q.settings }) + "\n");
    }
    if (q.subtype === "set_model" || q.subtype === "apply_flag_settings") {
      if (q.subtype === "set_model") modelo = q.model ?? "claude-opus-5-5";
      if (process.env.TRAMA_FALSO_LOG)
        appendFileSync(process.env.TRAMA_FALSO_LOG, JSON.stringify({ control: q.subtype, model: q.model, settings: q.settings }) + "\n");
    }
    if (q.subtype === "set_permission_mode") {
      ponerModo(q.mode);
      r = { mode: modo };
    }
    // Como el real desde 2.1.300: utilization de 0 a 100 y resets_at en ISO 8601.
    if (q.subtype === "get_usage") {
      const oficial = process.env.TRAMA_FALSO_USO_OFICIAL ?? process.env.TRAMA_FALSO_USO ?? "12,34";
      if (process.env.TRAMA_FALSO_LOG) appendFileSync(process.env.TRAMA_FALSO_LOG, JSON.stringify({ control: q.subtype }) + "\n");
      if (oficial === "no") {
        out({ type: "control_response", response: { subtype: "error", request_id: o.request_id, error: "Unsupported control request subtype: get_usage" } });
        return;
      }
      const [h, sem] = oficial.split(",").map(Number);
      const ya = Date.now();
      const ventana = (u, s) => ({ utilization: u, resets_at: new Date(ya + s * 1000).toISOString() });
      r = { rate_limits: { five_hour: ventana(h, 3 * 3600 + 20 * 60), seven_day: ventana(sem, 4 * 86400) } };
    }
    out({ type: "control_response", response: { subtype: "success", request_id: o.request_id, response: r } });
  } else if (o.type === "control_response") {
    const id = o.response?.request_id;
    const f = pendientes.get(id);
    if (f) {
      pendientes.delete(id);
      f(o.response?.response ?? null);
    }
  } else if (o.type === "user") {
    const c = o.message?.content;
    // Con imágenes (B26), `content` viene en bloques: el texto y "[N imágenes]" para el eco.
    const bs = Array.isArray(c) ? c : [];
    const n = bs.filter((b) => b?.type === "image").length;
    const texto =
      typeof c === "string"
        ? c
        : [n ? `[${n} ${n === 1 ? "imagen" : "imágenes"}]` : "", ...bs.filter((b) => b?.type === "text").map((b) => b.text)].filter(Boolean).join(" ");
    if (process.env.TRAMA_FALSO_DICHO) appendFileSync(process.env.TRAMA_FALSO_DICHO, JSON.stringify({ sid, texto }) + "\n");
    cola = cola.then(() => turno(texto));
  }
});
rl.on("close", () => void cola.then(() => process.exit(0)));
