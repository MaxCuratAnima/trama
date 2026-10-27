// Un líder con un modelo local (llama-server): el argv sin orquestador, el endpoint local SÓLO en su proceso y nunca una
// clave de Anthropic. Sin `claude` ni GPU: sólo lo que se le pasaría.
import { test } from "node:test";
import assert from "node:assert/strict";
import { argvLider, entornoLider, entornoLocal, esLoopback, HERRAMIENTAS_LOCAL, opcionesLider, PROMPT_LOCAL } from "../electron/lider-arma.ts";
import { NOTA_WINDOWS } from "../electron/nota-windows.ts";

const SID = "36ac312b-6241-4230-b3b3-c3decacc39c0";
const HOME = "/home/ana";
const LOCAL = { url: "http://127.0.0.1:8080", ctx: 32768 };
const base = { modelo: "modelo-local-ejemplo", effort: "medium", sid: SID, nombre: "trama-0a1b", resume: false };
const ENV = {
  PATH: "/usr/bin",
  ANTHROPIC_API_KEY: "sk-de-verdad",
  ANTHROPIC_BASE_URL: "https://proxy.ajeno",
  ANTHROPIC_AUTH_TOKEN: "x",
  CLAUDE_CODE_CHILD_SESSION: "1",
  PA_WORKER: "1",
};

const valor = (a: string[], flag: string) => a[a.indexOf(flag) + 1];

test("argv local: --bare con la clave de mentira, sólo Bash/Read/Edit, el prompt corto y sin --effort", () => {
  const a = argvLider({ ...base, local: LOCAL });
  assert.ok(a.includes("--bare"), "sin CLAUDE.md, hooks, plugins ni skills del orquestador");
  assert.ok(!a.includes("--effort"), "el esfuerzo de un local va por el cuerpo del pedido");
  assert.equal(valor(a, "--model"), "modelo-local-ejemplo");
  assert.equal(valor(a, "--tools"), HERRAMIENTAS_LOCAL);
  assert.equal(valor(a, "--system-prompt"), `${PROMPT_LOCAL}\n\n${NOTA_WINDOWS}`);
  assert.equal(valor(a, "--system-prompt-snapshot"), "off");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.deepEqual(JSON.parse(valor(a, "--settings")), { apiKeyHelper: "echo trama-local" });
  assert.match(PROMPT_LOCAL, /no lanzás workers|pa/);
  // El de Claude no cambia.
  const c = argvLider({ ...base, modelo: "claude-opus-5-5", effort: "high" });
  assert.equal(valor(c, "--effort"), "high");
  assert.ok(!c.includes("--bare") && !c.includes("--system-prompt"));
});

test("entorno local: el llama-server sólo en ese proceso, nada de ANTHROPIC heredado y pa no lanza workers", () => {
  const e = entornoLocal(ENV, HOME, { modelo: "modelo-local-ejemplo", effort: "medium", local: LOCAL });
  assert.equal(e.ANTHROPIC_BASE_URL, LOCAL.url);
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(e.PA_WORKER, undefined);
  assert.equal(e.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(e.CLAUDE_LOCAL, "1");
  for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"])
    assert.equal(e[k], "modelo-local-ejemplo", k);
  assert.deepEqual(JSON.parse(e.CLAUDE_CODE_EXTRA_BODY ?? ""), { chat_template_kwargs: { reasoning_effort: "medium" } });
  assert.equal(e.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "32768");
  assert.equal(e.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "32768");
  assert.equal(e.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "8192");
  assert.equal(e.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined, "apagaría CLAUDE_CODE_EXTRA_BODY");
  const off = entornoLocal(ENV, HOME, { modelo: "modelo-local-chico", effort: "off", local: { ...LOCAL, ctx: 131072 } });
  assert.deepEqual(JSON.parse(off.CLAUDE_CODE_EXTRA_BODY ?? ""), { chat_template_kwargs: { enable_thinking: false } });
  assert.equal(off.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "16384");
});

test("entorno: un líder de Claude nunca lleva el endpoint local ni nada de ANTHROPIC", () => {
  for (const e of [entornoLider(ENV, HOME), opcionesLider(ENV, HOME).env]) {
    assert.equal(e.ANTHROPIC_BASE_URL, undefined);
    assert.equal(e.ANTHROPIC_API_KEY, undefined);
    assert.equal(e.CLAUDE_LOCAL, undefined);
    assert.equal(e.CLAUDE_CODE_EXTRA_BODY, undefined);
  }
  assert.equal(opcionesLider(ENV, HOME, undefined, { modelo: "modelo-local-ejemplo", effort: "low", local: LOCAL }).env.ANTHROPIC_BASE_URL, LOCAL.url);
});

test("entorno local: sólo loopback; otra máquina o https se rechaza", () => {
  for (const u of ["http://127.0.0.1:8080", "http://localhost:8080", "http://[::1]:8080"]) assert.equal(esLoopback(u), true, u);
  for (const u of ["https://api.anthropic.com", "http://192.0.2.2:8080", "http://127.0.0.1.evil:8080", "https://127.0.0.1:8080", "basura"]) {
    assert.equal(esLoopback(u), false, u);
    assert.throws(() => entornoLocal(ENV, HOME, { modelo: "modelo-local-ejemplo", effort: "low", local: { url: u, ctx: 4096 } }), /localNoLoopback/);
  }
});
