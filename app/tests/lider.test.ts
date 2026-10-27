// Los líderes de la app: argv y entorno de `claude`, el stream-json (con el
// claude falso de scripts/), el transcript y `lideres.json`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  argvLider,
  autoaprueba,
  conversacionDe,
  cortar,
  cwdDeTranscript,
  dirProyecto,
  entornoLider,
  estilosDe,
  escribirGuardados,
  herramienta,
  leerGuardados,
  lineaEffort,
  lineaEstilo,
  lineaInicio,
  lineaModelo,
  lineaModo,
  lineaParar,
  lineaPermiso,
  lineaUsuario,
  nombreNuevo,
  nombreRetomado,
  opcionesLider,
  parsearLinea,
  type Evento,
  type Guardado,
} from "../electron/lider-arma.ts";

const SID = "36ac312b-6241-4230-b3b3-c3decacc39c0";
const HOME = "/home/ana";
const FALSO = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");

test("argv nuevo: stream-json, permisos salteados, modelo, effort, session-id y nombre", () => {
  const a = argvLider({ modelo: "claude-sonnet-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: false });
  assert.deepEqual(a.slice(0, 8), [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
  ]);
  // B13: los pedidos de permiso (el plan de ExitPlanMode) los contesta la app por stdio.
  assert.deepEqual(a.slice(8), [
    "--permission-prompt-tool",
    "stdio",
    "--model",
    "claude-sonnet-5-5",
    "--effort",
    "high",
    ...(process.platform === "win32" ? ["--disallowedTools", "Bash"] : []),
    "--session-id",
    SID,
    "--name",
    "trama-0a1b",
  ]);
});

test("argv con modo (B13): bypass con --dangerously-skip-permissions; otro, --allow… y --permission-mode", () => {
  const base = { modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: true };
  const bypass = argvLider({ ...base, modo: "bypassPermissions" });
  assert.ok(bypass.includes("--dangerously-skip-permissions") && !bypass.includes("--permission-mode"));
  const plan = argvLider({ ...base, modo: "plan" });
  assert.ok(!plan.includes("--dangerously-skip-permissions"));
  // `--dangerously-skip-permissions --permission-mode plan` arranca en bypass (probado con claude 2.1.287): por eso --allow….
  assert.deepEqual(plan.slice(7, 12), ["--allow-dangerously-skip-permissions", "--permission-mode", "plan", "--permission-prompt-tool", "stdio"]);
  assert.throws(() => argvLider({ ...base, modo: "auto" as never }));
});

test("argv retomado: --resume sin --session-id ni --name", () => {
  const a = argvLider({ modelo: "claude-opus-5-5", effort: "xhigh", sid: SID, nombre: "trama-0a1b", resume: true });
  assert.deepEqual(a.slice(-2), ["--resume", SID]);
  assert.ok(!a.includes("--session-id") && !a.includes("--name"));
  assert.ok(a.includes("--dangerously-skip-permissions"));
});

test("argv rechaza lo que sería un flag o tiene espacios", () => {
  const base = { modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: false };
  assert.throws(() => argvLider({ ...base, modelo: "--print" }));
  assert.throws(() => argvLider({ ...base, effort: "high low" }));
  assert.throws(() => argvLider({ ...base, sid: "../../etc" }));
});

test("entorno: sin CLAUDE*, CLAUDECODE, ANTHROPIC_* ni PA_* (salvo PA_STATE); ~/.local/bin adelante", () => {
  const env = entornoLider(
    {
      PATH: "/usr/bin:/home/ana/.local/bin",
      HOME,
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_SESSION_ID: "y",
      CLAUDE_EFFORT: "low",
      ANTHROPIC_API_KEY: "sk-no",
      ANTHROPIC_BASE_URL: "http://proxy",
      PA_WORKER: "1",
      PA_JEFE: "ana-e4",
      PA_JEFE_ID: "z",
      PA_STATE: "/tmp/pa",
      WAYLAND_DISPLAY: "wayland-1",
    },
    HOME,
  );
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "PA_STATE", "WAYLAND_DISPLAY"]);
  assert.equal(env.PATH, "/home/ana/.local/bin:/usr/bin");
  assert.equal(entornoLider({}, HOME).PATH, "/home/ana/.local/bin");
});

test("líder nuevo: corre en el home, sin proyecto que elegir (como abrir Claude Code en ~)", () => {
  const o = opcionesLider({ PATH: "/usr/bin", HOME, PWD: "/home/ana/Proyectos/hilos" }, HOME);
  assert.equal(o.cwd, HOME);
  assert.equal(o.env.PATH, "/home/ana/.local/bin:/usr/bin");
  // Ni el argv lleva carpeta: lo que ve es el home.
  const a = argvLider({ modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-a1b2", resume: false });
  assert.ok(!a.includes("--add-dir") && !a.some((x) => x.includes("Proyectos")));
});

test("líder retomado: corre donde vivía la sesión (ahí busca claude su transcript)", () => {
  assert.equal(opcionesLider({ PATH: "/usr/bin", HOME }, HOME, "/home/ana/Proyectos/atlas").cwd, "/home/ana/Proyectos/atlas");
  assert.equal(opcionesLider({ PATH: "/usr/bin", HOME }, HOME, undefined).cwd, HOME);
  const jsonl = ['{"type":"summary"}', "basura", '{"type":"user","cwd":"relativa"}', '{"type":"user","cwd":"/home/ana/Proyectos/atlas"}', '{"cwd":"/otra"}'].join("\n");
  assert.equal(cwdDeTranscript(jsonl), "/home/ana/Proyectos/atlas");
  assert.equal(cwdDeTranscript('{"type":"user"}\n'), null);
  // El nombre de la sesión se conserva si sirve de argumento; si no, uno interno.
  assert.equal(nombreRetomado("ana-d2"), "ana-d2");
  for (const raro of ["", "con espacio", "-flag", undefined, 7]) assert.match(nombreRetomado(raro, () => 0), /^trama-[0-9a-f]{4}$/);
});

test("nombre: trama- y 4 hex", () => {
  assert.equal(nombreNuevo(() => 0), "trama-0000");
  assert.match(nombreNuevo(), /^trama-[0-9a-f]{4}$/);
});

test("líneas de stdin: usuario e interrupt", () => {
  assert.deepEqual(JSON.parse(lineaUsuario("hola\nchau")), { type: "user", message: { role: "user", content: "hola\nchau" } });
  assert.deepEqual(JSON.parse(lineaParar("r1")), { type: "control_request", request_id: "r1", request: { subtype: "interrupt" } });
});

test("parser: deltas, mensaje con herramientas, fin con TTL, control; subagentes afuera", () => {
  const ev = (o: unknown) => parsearLinea(JSON.stringify(o));
  assert.deepEqual(ev({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Ho" } } }), [
    { tipo: "parcial", texto: "Ho" },
  ]);
  assert.deepEqual(ev({ type: "stream_event", parent_tool_use_id: "t9", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } }), []);
  assert.deepEqual(
    ev({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "text", text: "Miro" }, { type: "tool_use", name: "Bash", input: { command: "git status\ngit log" } }] },
    }),
    [
      {
        tipo: "mensaje",
        mid: "m1",
        texto: "Miro",
        herramientas: ["Bash: git status"],
        modelo: "claude-opus-5-5",
        det: [{ nombre: "Bash", entrada: { command: "git status\ngit log" }, id: null }],
      },
      { tipo: "hace", hace: { que: "herramienta", nombre: "Bash", detalle: "git status git log" } },
    ],
  );
  assert.deepEqual(ev({ usage: { cache_creation: { ephemeral_1h_input_tokens: 5 } }, type: "result", is_error: false }), [{ tipo: "fin", error: null, ttl: 3600 }]);
  assert.deepEqual(ev({ type: "result", is_error: true, result: "se cortó" }), [{ tipo: "fin", error: "se cortó", ttl: null }]);
  assert.deepEqual(ev({ type: "control_response", response: { subtype: "success", request_id: "r1" } }), [{ tipo: "control", id: "r1", ok: true }]);
  assert.deepEqual(ev({ type: "system", subtype: "init" }), []);
  assert.deepEqual(parsearLinea("no es json"), []);
});

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const lineas = (archivo: string) => readFileSync(path.join(FIXTURES, archivo), "utf8").split("\n").filter(Boolean);

test("parser con una corrida real (sanitizada): pide, herramienta, tokens, texto y fin; sin avisos", () => {
  const ev = lineas("stream-real.jsonl").flatMap(parsearLinea);
  const hace = ev.filter((e) => e.tipo === "hace").map((e) => (e as Extract<Evento, { tipo: "hace" }>).hace);
  assert.deepEqual(hace, [
    { que: "pidiendo", nombre: null, detalle: null },
    { que: "herramienta", nombre: "Bash", detalle: null },
    { que: "herramienta", nombre: "Bash", detalle: "echo hola" },
    { que: "pidiendo", nombre: null, detalle: null },
    { que: "escribiendo", nombre: null, detalle: null },
  ]);
  assert.deepEqual(
    ev.filter((e) => e.tipo === "mensaje").map((e) => [(e as { herramientas: string[] }).herramientas, (e as { texto: string }).texto]),
    [[["Bash: echo hola"], ""], [[], "Hola."]],
  );
  assert.equal(ev.filter((e) => e.tipo === "parcial").map((e) => (e as { texto: string }).texto).join(""), "Hola.");
  const tk = ev.filter((e) => e.tipo === "tokens") as Extract<Evento, { tipo: "tokens" }>[];
  assert.deepEqual(tk.map((e) => e.nuevo), [true, false, true, false]);
  assert.ok(tk.every((e) => e.salida >= 0));
  // El rate_limit_event "allowed" llega en cada pedido: no es un aviso.
  assert.equal(ev.filter((e) => e.tipo === "aviso").length, 0);
  assert.deepEqual(ev.at(-1), { tipo: "fin", error: null, ttl: 3600 });
});

test("parser con eventos de error (forma sacada del binario de claude 2.1.287): retry, límite, compactar, notas, fallback", () => {
  const ev = lineas("stream-sintetico.jsonl").flatMap(parsearLinea);
  const avisos = ev.filter((e) => e.tipo === "aviso").map((e) => (e as Extract<Evento, { tipo: "aviso" }>).aviso);
  assert.deepEqual(avisos, [
    { clase: "reintento", intento: 1, max: 10, espera_ms: 1200, estado: 529, error: "overloaded" },
    { clase: "reintento", intento: 2, max: 10, espera_ms: 30000, estado: 429, error: "rate_limit" },
    { clase: "limite", rechazado: false, ventana: "five_hour", hasta: 1791060600, uso: 0.9 },
    { clase: "limite", rechazado: true, ventana: "five_hour", hasta: 1791060600, uso: null },
    { clase: "error", texto: "You've hit your session limit · resets 7pm", codigo: "rate_limit" },
    { clase: "compacto", auto: true, antes: 167000 },
    { clase: "nota", texto: "Error compacting conversation", grave: true },
    { clase: "nota", texto: "Context low · run /compact", grave: false },
    { clase: "modelo", de: "claude-opus-5-5", a: "claude-sonnet-5-5" },
  ]);
  // El mensaje de error no se pinta como respuesta.
  assert.equal(ev.filter((e) => e.tipo === "mensaje").length, 0);
  assert.deepEqual(
    ev.filter((e) => e.tipo === "fin"),
    [
      { tipo: "fin", error: "You've hit your session limit · resets 7pm", ttl: null },
      { tipo: "fin", error: "Reached maximum number of turns (50)", ttl: null },
    ],
  );
  assert.deepEqual(
    ev.filter((e) => e.tipo === "hace").map((e) => (e as Extract<Evento, { tipo: "hace" }>).hace.que),
    ["compactando", "pensando"],
  );
});

test("herramienta: lo que hizo, recortado", () => {
  assert.equal(herramienta("Read", { file_path: "/a/b.ts" }), "Read: /a/b.ts");
  assert.equal(herramienta("TodoWrite", { todos: [] }), "TodoWrite");
  assert.equal(herramienta("Bash", { command: "x".repeat(200) }).length, "Bash: ".length + 80);
});

test("cortar: sólo líneas completas, el resto espera", () => {
  assert.deepEqual(cortar("", '{"a":1}\n{"b"'), { lineas: ['{"a":1}'], resto: '{"b"' });
  assert.deepEqual(cortar('{"b"', ":2}\n"), { lineas: ['{"b":2}'], resto: "" });
});

test("lideres.json: ida y vuelta; versión rara o basura, vacío", () => {
  const g: Guardado = { sid: SID, nombre: "trama-0a1b", modelo: "claude-opus-5-5", effort: "high", creado: 10, ultimo: 20, cache_ttl_s: 3600, modo: "plan" };
  assert.deepEqual(leerGuardados(escribirGuardados([g])), [g]);
  // Uno retomado: la carpeta donde vivía y cuándo se lo retomó. Una carpeta relativa no se cree.
  const r: Guardado = { ...g, cwd: "/home/ana/Proyectos/atlas", retomado: 30 };
  assert.deepEqual(leerGuardados(escribirGuardados([r])), [r]);
  assert.deepEqual(leerGuardados(JSON.stringify({ version: 1, lideres: [{ ...g, cwd: "atlas", retomado: "x" }] })), [g]);
  // Uno de antes de B13 (sin modo), o con un modo raro: bypass, como siempre.
  const { modo: _, ...viejo } = g;
  assert.deepEqual(leerGuardados(JSON.stringify({ version: 1, lideres: [viejo] })), [{ ...g, modo: "bypassPermissions" }]);
  assert.deepEqual(leerGuardados(JSON.stringify({ version: 1, lideres: [{ ...g, modo: "auto" }] })), [{ ...g, modo: "bypassPermissions" }]);
  assert.deepEqual(leerGuardados(JSON.stringify({ version: 2, lideres: [g] })), []);
  assert.deepEqual(leerGuardados("{"), []);
  assert.deepEqual(leerGuardados(JSON.stringify({ version: 1, lideres: [{ ...g, sid: "raro" }, g] })), [g]);
});

test("transcript: como pa --hilo (texto de usuario, mismo mensaje junto, sin subagentes) y paginado", () => {
  const l = (o: unknown) => JSON.stringify(o);
  const t = [
    l({ type: "custom-title", customTitle: "trama-0a1b" }),
    l({ type: "user", timestamp: "2026-10-03T10:00:00Z", message: { content: "decí hola" } }),
    l({ type: "assistant", timestamp: "2026-10-03T10:00:01Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "text", text: "Miro" }] } }),
    l({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } }),
    l({ type: "user", message: { content: [{ type: "tool_result", content: "x" }] } }),
    l({ type: "assistant", isSidechain: true, message: { id: "s1", content: [{ type: "text", text: "subagente" }] } }),
    l({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "¡Hola!" }], usage: { input_tokens: 3 } } }),
    "basura",
  ].join("\n");
  const r = conversacionDe(SID, "/t.jsonl", t);
  assert.equal(r.total, 3);
  assert.deepEqual(
    r.mensajes.map((m) => [m.i, m.rol, m.texto, m.herramientas]),
    [
      [0, "user", "decí hola", []],
      [1, "assistant", "Miro", ["Bash: ls"]],
      [2, "assistant", "¡Hola!", []],
    ],
  );
  assert.deepEqual(r.usage, { input_tokens: 3 });
  const p = conversacionDe(SID, "/t.jsonl", t, { n: 2, antes: 2 });
  assert.deepEqual([p.desde, p.hasta, p.mensajes.map((m) => m.i)], [0, 2, [0, 1]]);
  assert.equal(dirProyecto("/home/ana"), "-home-ana");
  assert.equal(dirProyecto("/home/ana/.local/state"), "-home-ana--local-state");
});

test("claude falso: un turno por stdin sale como deltas, mensaje y fin; el interrupt corta", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lider-"));
  const log = path.join(dir, "log");
  const argv = argvLider({ modelo: "claude-sonnet-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: false });
  const p = spawn(process.execPath, [FALSO, ...argv], {
    cwd: dir,
    env: entornoLider({ ...process.env, TRAMA_FALSO_LOG: log, TRAMA_FALSO_MS: "40", CLAUDECODE: "1" }, os.homedir()) as NodeJS.ProcessEnv,
  });
  const eventos: Evento[] = [];
  let resto = "";
  let alFin: () => void = () => {};
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d: string) => {
    const c = cortar(resto, d);
    resto = c.resto;
    for (const x of c.lineas) {
      for (const e of parsearLinea(x)) {
        eventos.push(e);
        if (e.tipo === "fin") alFin();
      }
    }
  });
  const fin = () => new Promise<void>((ok) => (alFin = ok));
  let f = fin();
  p.stdin.write(lineaUsuario("hola herramienta"));
  await f;
  assert.equal(eventos.filter((e) => e.tipo === "parcial").map((e) => (e as { texto: string }).texto).join(""), "eco: hola herramienta");
  assert.deepEqual(
    eventos.filter((e) => e.tipo === "mensaje").map((e) => (e as { herramientas: string[]; texto: string }).herramientas.concat(e.texto)),
    [["Bash: ls -la ~", ""], ["eco: hola herramienta"]],
  );
  assert.deepEqual(eventos.at(-1), { tipo: "fin", error: null, ttl: 3600 });

  eventos.length = 0;
  f = fin();
  p.stdin.write(lineaUsuario("una respuesta larga que se corta"));
  setTimeout(() => p.stdin.write(lineaParar("r1")), 60);
  await f;
  assert.ok(eventos.some((e) => e.tipo === "control" && e.ok));
  assert.notEqual(eventos.filter((e) => e.tipo === "parcial").length, 3);

  p.stdin.end();
  await new Promise((ok) => p.on("exit", ok));
  const arranque = JSON.parse(readFileSync(log, "utf8").trim());
  assert.deepEqual(arranque.args, argv);
  assert.ok(!arranque.env.some((k: string) => k.startsWith("CLAUDE")));
  assert.ok(arranque.path.startsWith(path.join(os.homedir(), ".local", "bin") + ":"));
});

// --- B13: modos, permisos y comandos -------------------------------------------

test("líneas de control (B13): set_permission_mode, initialize y la respuesta a un can_use_tool", () => {
  assert.deepEqual(JSON.parse(lineaModo("m1", "plan")), { type: "control_request", request_id: "m1", request: { subtype: "set_permission_mode", mode: "plan" } });
  assert.deepEqual(JSON.parse(lineaInicio("i1")), { type: "control_request", request_id: "i1", request: { subtype: "initialize" } });
  const input = { plan: "# P", planFilePath: "/tmp/p.md" };
  assert.deepEqual(JSON.parse(lineaPermiso("r1", { behavior: "allow", updatedInput: input }, "toolu_1")), {
    type: "control_response",
    response: { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: input, toolUseID: "toolu_1" } },
  });
  assert.equal(JSON.parse(lineaPermiso("r2", { behavior: "deny", message: "no" }, null)).response.response.toolUseID, undefined);
});

test("parser (B13), con líneas de claude 2.1.287: modo, init con comandos, initialize, can_use_tool y su cancelación", () => {
  const sesion = "c4bd523a-0000-4000-8000-000000000000";
  assert.deepEqual(
    parsearLinea(JSON.stringify({ type: "system", subtype: "status", status: null, permissionMode: "plan", uuid: "u", session_id: sesion })),
    [{ tipo: "modo", modo: "plan" }],
  );
  const init = parsearLinea(
    JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: sesion,
      permissionMode: "bypassPermissions",
      slash_commands: ["compact", "review", "doctor", "mi skill", "review"],
      terminal_slash_commands: ["doctor", "color"],
    }),
  );
  assert.ok(init.some((e) => e.tipo === "modo" && e.modo === "bypassPermissions"));
  const cmds = init.find((e) => e.tipo === "comandos") as { lista: { nombre: string }[] } | undefined;
  assert.deepEqual(cmds?.lista.map((c) => c.nombre), ["compact", "review"]);

  const ini = parsearLinea(
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "i1",
        response: { commands: [{ name: "compact", description: "Clear conversation history but keep a summary", argumentHint: "<instructions>" }], current_permission_mode: "default" },
      },
    }),
  );
  assert.deepEqual(ini, [
    { tipo: "control", id: "i1", ok: true },
    { tipo: "modo", modo: "default" },
    { tipo: "comandos", lista: [{ nombre: "compact", descripcion: "Clear conversation history but keep a summary", args: "<instructions>" }] },
  ]);
  assert.deepEqual(
    parsearLinea(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "m1", response: { mode: "plan" } } })),
    [
      { tipo: "control", id: "m1", ok: true },
      { tipo: "modo", modo: "plan" },
    ],
  );

  const input = { plan: "# Plan\n\n1. Crear hola.txt", planFilePath: "/home/ana/.claude/plans/p.md" };
  const pide = parsearLinea(
    JSON.stringify({
      type: "control_request",
      request_id: "0f6c-uuid",
      request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", display_name: "ExitPlanMode", input, tool_use_id: "toolu_01", requires_user_interaction: true },
    }),
  );
  assert.deepEqual(pide, [{ tipo: "permiso", id: "0f6c-uuid", herramienta: "ExitPlanMode", detalle: null, plan: input.plan, preguntas: null, input, tool_use_id: "toolu_01" }]);
  const bash = parsearLinea(
    JSON.stringify({ type: "control_request", request_id: "b1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, tool_use_id: "toolu_02" } }),
  );
  assert.equal((bash[0] as { detalle: string }).detalle, "ls");
  assert.deepEqual(parsearLinea(JSON.stringify({ type: "control_cancel_request", request_id: "b1" })), [{ tipo: "permisoFuera", id: "b1" }]);
});

test("bypass: los pedidos de permiso se contestan solos, salvo ExitPlanMode y AskUserQuestion", () => {
  assert.equal(autoaprueba("bypassPermissions", "Bash"), true);
  assert.equal(autoaprueba("bypassPermissions", "Edit"), true);
  assert.equal(autoaprueba("bypassPermissions", "ExitPlanMode"), false);
  assert.equal(autoaprueba("bypassPermissions", "AskUserQuestion"), false);
  for (const modo of ["default", "acceptEdits", "plan"]) assert.equal(autoaprueba(modo, "Bash"), false);
  const [e] = parsearLinea(
    JSON.stringify({
      type: "control_request",
      request_id: "b2",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm x" }, tool_use_id: "toolu_03", decision_reason: "regla x", blocked_path: "/tmp/x" },
    }),
  );
  assert.equal((e as { razon?: string }).razon, "regla x");
  assert.equal((e as { ruta?: string }).ruta, "/tmp/x");
});

test("claude falso (B13): set_permission_mode a plan, ExitPlanMode → negar sigue en plan, aprobar vuelve a bypass", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lider-"));
  const argv = argvLider({ modelo: "claude-sonnet-5-5", effort: "medium", sid: SID, nombre: "trama-0a1b", resume: false, modo: "bypassPermissions" });
  const p = spawn(process.execPath, [FALSO, ...argv], { cwd: dir, env: entornoLider({ ...process.env, TRAMA_FALSO_MS: "5" }, os.homedir()) as NodeJS.ProcessEnv });
  const eventos: Evento[] = [];
  let resto = "";
  let esperando: { f: (e: Evento) => boolean; ok: (e: Evento) => void } | null = null;
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d: string) => {
    const c = cortar(resto, d);
    resto = c.resto;
    for (const x of c.lineas)
      for (const e of parsearLinea(x)) {
        eventos.push(e);
        if (esperando?.f(e)) {
          const w = esperando;
          esperando = null;
          w.ok(e);
        }
      }
  });
  const hasta = (f: (e: Evento) => boolean) => new Promise<Evento>((ok) => (esperando = { f, ok }));
  const modos = () => eventos.filter((e) => e.tipo === "modo").map((e) => (e as { modo: string }).modo);

  let e = hasta((x) => x.tipo === "comandos");
  p.stdin.write(lineaInicio("i1"));
  await e;
  e = hasta((x) => x.tipo === "modo" && x.modo === "plan");
  p.stdin.write(lineaModo("m1", "plan"));
  await e;

  let pide = hasta((x) => x.tipo === "permiso");
  p.stdin.write(lineaUsuario("crear hola.txt"));
  let q = (await pide) as Extract<Evento, { tipo: "permiso" }>;
  assert.equal(q.herramienta, "ExitPlanMode");
  assert.match(q.plan ?? "", /crear hola\.txt/);
  let fin = hasta((x) => x.tipo === "fin");
  p.stdin.write(lineaPermiso(q.id, { behavior: "deny", message: "agregá un test" }, q.tool_use_id));
  await fin;
  const textos = () => eventos.filter((x) => x.tipo === "mensaje").map((x) => (x as { texto: string }).texto);
  assert.equal(textos().at(-1), "sigo planeando: agregá un test");
  assert.equal(modos().at(-1), "plan");

  pide = hasta((x) => x.tipo === "permiso");
  p.stdin.write(lineaUsuario("con el test"));
  q = (await pide) as Extract<Evento, { tipo: "permiso" }>;
  fin = hasta((x) => x.tipo === "fin");
  p.stdin.write(lineaPermiso(q.id, { behavior: "allow", updatedInput: q.input }, q.tool_use_id));
  await fin;
  assert.equal(textos().at(-1), "plan aprobado: con el test");
  assert.equal(modos().at(-1), "bypassPermissions");

  p.stdin.end();
  await new Promise((ok) => p.on("exit", ok));
});

test("modelo y esfuerzo en vivo: set_model, apply_flag_settings y el control rechazado con su error", () => {
  assert.deepEqual(JSON.parse(lineaModelo("c1", "claude-sonnet-5-5")), {
    type: "control_request",
    request_id: "c1",
    request: { subtype: "set_model", model: "claude-sonnet-5-5" },
  });
  assert.deepEqual(JSON.parse(lineaEffort("c2", "low")), {
    type: "control_request",
    request_id: "c2",
    request: { subtype: "apply_flag_settings", settings: { effortLevel: "low" } },
  });
  assert.deepEqual(parsearLinea(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: "c1", error: "modelo raro" } })), [
    { tipo: "control", id: "c1", ok: false, error: "modelo raro" },
  ]);
});

test("output style (B23): update_settings en localSettings; el init y el initialize lo dicen; nombres limpios", () => {
  assert.deepEqual(JSON.parse(lineaEstilo("c3", "Concise")), {
    type: "control_request",
    request_id: "c3",
    request: { subtype: "update_settings", source: "localSettings", settings: { outputStyle: "Concise" } },
  });
  assert.deepEqual(estilosDe(["default", " Concise ", "default", "-x", "a\nb", 3, ""]), ["default", "Concise"]);
  assert.deepEqual(estilosDe(null), []);
  const init = parsearLinea(JSON.stringify({ type: "system", subtype: "init", session_id: SID, output_style: "Concise", slash_commands: [] }));
  assert.ok(init.some((e) => e.tipo === "estilos" && e.actual === "Concise" && e.lista === null));
  const resp = parsearLinea(
    JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: "i1", response: { commands: [], output_style: "default", available_output_styles: ["default", "Explanatory", "Concise"] } },
    }),
  );
  assert.ok(resp.some((e) => e.tipo === "estilos" && e.actual === "default" && JSON.stringify(e.lista) === JSON.stringify(["default", "Explanatory", "Concise"])));
});

test("argv (B23): nada que pise los settings de Ana (output style, prompt de sistema)", () => {
  for (const resume of [false, true]) {
    const a = argvLider({ modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume });
    for (const f of ["--setting-sources", "--settings", "--system-prompt", "--append-system-prompt", "--bare"]) assert.ok(!a.includes(f), f);
  }
});

test("entornoLider en Windows: ~\\.local\\bin adelante con ; sobre la clave Path", () => {
  assert.equal(entornoLider({ Path: "C:\\Windows", CLAUDE_X: "1" }, "C:\\Users\\Ana", "win32").Path, "C:\\Users\\Ana\\.local\\bin;C:\\Windows");
});
