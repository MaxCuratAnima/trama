// pa --cuenta: la cuenta de la suscripción (resolverla, validarla contra el proveedor del modelo, aplicar su entorno al worker),
// `excluir` y `permitir_max` de modelos.json, y `pa --rinde` con la columna cuenta. El CLI `cuentas` se falsea (PA_CUENTAS_BIN o
// `dependenciasCuenta.llamar`): acá no se prueba `cuentas`, sino cómo lo usa `pa`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsearArgs } from "../electron/cli/args.ts";
import { contextoReal, type CtxPa } from "../electron/cli/contexto.ts";
import { leerModelos, resolverPolitica, excluidoPor, type ModelosJson } from "../electron/cli/lanzar-politica.ts";
import { main } from "../electron/cli/pa.ts";
import { lanzar } from "../electron/cli/pa-lanzar.ts";
import {
  dependenciasCuenta, entornoConCuenta, proveedorDeCuenta, proveedorDeModelo, resolverCuenta, type LlamarCuentas,
} from "../electron/cli/pa-cuenta.ts";

type Salida = { out: string; err: string };
function armar(): { raiz: string; ctx: CtxPa; salida: Salida; limpiar: () => void } {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-cuenta-"));
  const estado = path.join(raiz, "estado");
  const proyectos = path.join(raiz, "proyectos");
  mkdirSync(estado, { recursive: true });
  mkdirSync(proyectos, { recursive: true });
  const salida: Salida = { out: "", err: "" };
  const real = contextoReal({ HOME: raiz, PA_STATE: estado, PA_PROJ: proyectos } as never, "linux");
  const ctx: CtxPa = {
    ...real, estado, proyectos, home: raiz, env: { HOME: raiz, PA_STATE: estado, PA_PROJ: proyectos, TRAMA_CUENTAS: path.join(raiz, "cuentas.json") },
    offsetSeg: () => 0, rutaDeSlug: () => null, ramasPa: () => [], commitsSobre: () => "",
    out: (s) => void (salida.out += s), err: (s) => void (salida.err += s),
  };
  return { raiz, ctx, salida, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

/** Un `cuentas env` falso: "trabajo" es de Claude con su carpeta; "gmail" es de Google; "rota" falla; el resto no existe. */
const cuentasFalso: LlamarCuentas = (_ctx, id) => {
  if (id === "trabajo") return { rc: 0, out: JSON.stringify({ proveedor: "claude", sacar: ["ANTHROPIC_API_KEY"], poner: { CLAUDE_CONFIG_DIR: "/cuentas/trabajo" } }) };
  if (id === "gmail") return { rc: 0, out: JSON.stringify({ proveedor: "google", sacar: [], poner: { HOME: "/cuentas/gmail" } }) };
  if (id === "rota") return { rc: 0, out: "no es json" };
  return { rc: 1, out: `la cuenta '${id}' no existe.\n` };
};
function conCuentasFalso<T>(f: () => T): T {
  const antes = dependenciasCuenta.llamar;
  dependenciasCuenta.llamar = cuentasFalso;
  try {
    return f();
  } finally {
    dependenciasCuenta.llamar = antes;
  }
}

test("cuenta: el proveedor sale del modelo (local y codex no llevan cuenta)", () => {
  assert.equal(proveedorDeModelo("claude-sonnet-5-5"), "claude");
  assert.equal(proveedorDeModelo("gemini-4-argon-high"), "google");
  assert.equal(proveedorDeModelo("agy:claude-opus-5-5-high"), "google");
  assert.equal(proveedorDeModelo("ollama:qwen3"), "");
  assert.equal(proveedorDeModelo("codex:gpt-6-sol-high"), "");
});

test("cuenta: sin --cuenta se usa la de siempre y no se toca el entorno", () => {
  const { ctx, limpiar } = armar();
  try {
    const r = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-sonnet-5-5", flag: "" }));
    assert.deepEqual(r, { ok: true, cuenta: "claude", entorno: { sacar: [], poner: {} } });
    assert.deepEqual(conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-sonnet-5-5", flag: "claude" })), r);
  } finally {
    limpiar();
  }
});

test("cuenta: --cuenta valida el proveedor del modelo y aplica el entorno de 'cuentas env'", () => {
  const { ctx, limpiar } = armar();
  try {
    const ok = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-opus-5-5", flag: "trabajo" }));
    assert.deepEqual(ok, { ok: true, cuenta: "trabajo", entorno: { sacar: ["ANTHROPIC_API_KEY"], poner: { CLAUDE_CONFIG_DIR: "/cuentas/trabajo" } } });
    const g = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-opus-5-5", flag: "gmail" }));
    assert.deepEqual(g, { ok: false, error: "pa: la cuenta 'gmail' es de google y el modelo 'claude-opus-5-5' es de claude." });
    const s = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-opus-5-5", flag: "google" }));
    assert.deepEqual(s, { ok: false, error: "pa: la cuenta 'google' es de google y el modelo 'claude-opus-5-5' es de claude." });
    const nada = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-opus-5-5", flag: "fantasma" }));
    assert.deepEqual(nada, { ok: false, error: "pa: la cuenta 'fantasma' no existe." });
    const rota = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-opus-5-5", flag: "rota" }));
    assert.deepEqual(rota, { ok: false, error: "pa: la cuenta 'rota' es de ? y el modelo 'claude-opus-5-5' es de claude." });
    const local = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "ollama:qwen3", flag: "trabajo" }));
    assert.deepEqual(local, { ok: false, error: "pa: --cuenta no va con 'ollama:qwen3': un modelo local no usa ninguna suscripción." });
    assert.deepEqual(conCuentasFalso(() => resolverCuenta(ctx, { modelo: "ollama:qwen3", flag: "" })), { ok: true, cuenta: "", entorno: { sacar: [], poner: {} } });
  } finally {
    limpiar();
  }
});

test("cuenta: --seguir reusa la del hilo si sigue existiendo y es del proveedor; si no, la de siempre", () => {
  const { ctx, limpiar } = armar();
  try {
    writeFileSync(ctx.env.TRAMA_CUENTAS!, JSON.stringify({ cuentas: [{ id: "trabajo", proveedor: "claude" }, { id: "gmail", proveedor: "google" }] }));
    assert.equal(proveedorDeCuenta(ctx, "trabajo"), "claude");
    assert.equal(proveedorDeCuenta(ctx, "chatgpt"), "chatgpt");
    assert.equal(proveedorDeCuenta(ctx, "borrada"), "");
    const mismo = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-sonnet-5-5", flag: "", seguir: "trabajo" }));
    assert.equal(mismo.ok && mismo.cuenta, "trabajo");
    const otroProv = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-sonnet-5-5", flag: "", seguir: "gmail" }));
    assert.equal(otroProv.ok && otroProv.cuenta, "claude");
    const borrada = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-sonnet-5-5", flag: "", seguir: "borrada" }));
    assert.equal(borrada.ok && borrada.cuenta, "claude");
    // el flag le gana a la retomada
    const flag = conCuentasFalso(() => resolverCuenta(ctx, { modelo: "claude-sonnet-5-5", flag: "claude", seguir: "trabajo" }));
    assert.equal(flag.ok && flag.cuenta, "claude");
  } finally {
    limpiar();
  }
});

test("cuenta: entornoConCuenta quita y pone sin tocar el original", () => {
  const base = { A: "1", ANTHROPIC_API_KEY: "sk", CLAUDE_CONFIG_DIR: "/viejo" };
  const e = entornoConCuenta(base, { sacar: ["ANTHROPIC_API_KEY"], poner: { CLAUDE_CONFIG_DIR: "/nuevo" } });
  assert.deepEqual(e, { A: "1", CLAUDE_CONFIG_DIR: "/nuevo" });
  assert.equal(base.ANTHROPIC_API_KEY, "sk");
});

test("args: --cuenta lleva un valor", () => {
  const r = parsearArgs(["demo", "--cuenta", "trabajo", "hacé algo"]);
  assert.equal(r.clase, "proyecto");
  if (r.clase === "proyecto") assert.equal(r.opciones.cuenta, "trabajo");
  const sin = parsearArgs(["demo", "--cuenta"]);
  assert.equal(sin.clase, "error");
});

test("pa-lanzar --cuenta: el worker corre con el entorno de la cuenta, el .hilo la anota y --hilos --json la muestra", { skip: process.platform === "win32" }, async () => {
  const { raiz, ctx, salida, limpiar } = armar();
  try {
    const repo = path.join(raiz, "demo");
    const g = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    mkdirSync(repo, { recursive: true });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    writeFileSync(path.join(repo, "a.txt"), "hola\n");
    g("add", "a.txt");
    g("commit", "-qm", "base");
    // claude falso: anota el entorno que le tocó
    const falso = path.join(raiz, "claude-falso.mjs");
    writeFileSync(
      falso,
      `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync("entorno.json", JSON.stringify({ dir: process.env.CLAUDE_CONFIG_DIR ?? null, clave: process.env.ANTHROPIC_API_KEY ?? null }));
console.log(JSON.stringify({ result: "RESULTADO: listo.\\nDECISION: nada\\nSIGUE: nada", session_id: "sid-falso", num_turns: 1, duration_ms: 10, total_cost_usd: 0 }));
`,
      { mode: 0o755 },
    );
    // `cuentas` falso, como proceso (PA_CUENTAS_BIN): lo que imprime es lo que usaría el CLI real
    const cuentas = path.join(raiz, "cuentas-falso");
    writeFileSync(
      cuentas,
      `#!/bin/sh
[ "$1" = env ] && [ "$3" = --json ] || exit 9
case "$2" in
  trabajo) echo '{"proveedor":"claude","sacar":["ANTHROPIC_API_KEY"],"poner":{"CLAUDE_CONFIG_DIR":"/cuentas/trabajo"}}' ;;
  gmail) echo '{"proveedor":"google","sacar":[],"poner":{}}' ;;
  *) echo "la cuenta '$2' no existe." >&2; exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    ctx.env = {
      ...ctx.env, TRAMA_CLAUDE: falso, PA_CUENTAS_BIN: cuentas, ANTHROPIC_API_KEY: "sk-de-la-api", PA_JEFE: "jefe-test", PA_JEFE_ID: "jid",
      PA_CLAUDE_SETTINGS: path.join(raiz, "no-hay.json"),
    };
    mkdirSync(path.join(raiz, ".config", "proyectos"), { recursive: true });
    writeFileSync(path.join(raiz, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: repo }] }));
    const opciones = (...a: string[]) => {
      const r = parsearArgs(["demo", ...a]);
      assert.equal(r.clase, "proyecto");
      if (r.clase !== "proyecto") throw new Error("no es de proyecto");
      return r.opciones;
    };

    // una cuenta que es de otro proveedor, o que no existe: rc 2 y no lanza nada
    assert.equal(await lanzar(ctx, opciones("--cuenta", "gmail", "haceme algo")), 2);
    assert.match(salida.err, /la cuenta 'gmail' es de google y el modelo 'claude-sonnet-5-5' es de claude/);
    salida.err = "";
    assert.equal(await lanzar(ctx, opciones("--cuenta", "fantasma", "haceme algo")), 2);
    assert.match(salida.err, /pa: la cuenta 'fantasma' no existe\./);
    assert.ok(!existsSync(path.join(ctx.estado, "demo")) || !spawnSync("bash", ["-c", `ls ${ctx.estado}/demo/*.hilo 2>/dev/null`], { encoding: "utf8" }).stdout.trim(), "no dejó ningún hilo");
    salida.err = "";

    // la cuenta buena
    assert.equal(await lanzar(ctx, opciones("--cuenta", "trabajo", "haceme algo")), 0, salida.err);
    assert.match(salida.err, /pa: cuenta trabajo\./);
    const hilo = spawnSync("bash", ["-c", `cat ${ctx.estado}/demo/*.hilo`], { encoding: "utf8" }).stdout;
    assert.match(hilo, /\ncuenta=trabajo\n/);
    const ruta = /ruta_trabajo=(.+)/.exec(hilo)![1].trim();
    assert.deepEqual(JSON.parse(readFileSync(path.join(ruta, "entorno.json"), "utf8")), { dir: "/cuentas/trabajo", clave: null });
    assert.equal(ctx.env.ANTHROPIC_API_KEY, "sk-de-la-api", "el entorno de pa no se tocó");

    salida.out = "";
    assert.equal(await main(["--hilos", "--json"], ctx), 0);
    const j = JSON.parse(salida.out) as { hilos: { cuenta: string | null }[] };
    assert.equal(j.hilos.length, 1);
    assert.equal(j.hilos[0].cuenta, "trabajo");
  } finally {
    limpiar();
  }
});

// --- modelos.json: excluir y permitir_max ---

const modelos = (extra: object): ModelosJson => {
  const { raiz } = { raiz: mkdtempSync(path.join(os.tmpdir(), "pa-modelos-")) };
  try {
    const f = path.join(raiz, "modelos.json");
    writeFileSync(f, JSON.stringify({ version: 1, ...extra }));
    const m = leerModelos(f);
    assert.ok(m && !("error" in m), JSON.stringify(m));
    return m as ModelosJson;
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
};
const politica = (m: ModelosJson | null, extra: Partial<Parameters<typeof resolverPolitica>[0]> = {}) =>
  resolverPolitica({ modelo: "", esfuerzo: "", esfuerzoFlag: false, tipo: "", leer: false, seguir: false, okDueno: false, plan: "pro", modelos: m, effortSettings: "", dueno: "Max", ...extra });

test("excluir: familia, id, prefijo y patrón con *, igual que reparto --excluido", () => {
  assert.equal(excluidoPor("claude-opus-5-5", ["opus"]), "opus");
  assert.equal(excluidoPor("claude-sonnet-5-5", ["opus", "haiku"]), null);
  assert.equal(excluidoPor("gemini-4-argon-high", ["Argon"]), "Argon");
  assert.equal(excluidoPor("agy:gpt-oss-120b-medium", ["gpt-oss"]), "gpt-oss");
  assert.equal(excluidoPor("codex:gpt-6-luna-low", ["luna"]), "luna");
  assert.equal(excluidoPor("claude-sonnet-5-5", ["claude-sonnet-5-5"]), "claude-sonnet-5-5");
  assert.equal(excluidoPor("claude-sonnet-5-5-x", ["claude-sonnet-5-5"]), "claude-sonnet-5-5");
  assert.equal(excluidoPor("claude-sonnet-5-55", ["claude-sonnet-5-5"]), null, "el prefijo va seguido de '-'");
  assert.equal(excluidoPor("agy:claude-opus-5-5-high", ["agy:*"]), "agy:*");
  assert.equal(excluidoPor("ollama:qwen3", ["agy:*"]), null);
  assert.equal(excluidoPor("claude-opus-5-5", ["  ", "OPUS "]), "OPUS ");
});

test("excluir: un -m excluido no corre sin --ok-dueno; lo que eligió la política o el hijo de --async sí", () => {
  const m = modelos({ excluir: ["opus"], workers: { default: { modelo: "claude-opus-5-5", effort: "high" } } });
  const r = politica(m, { modelo: "claude-opus-5-5" });
  assert.deepEqual(r, { error: "pa: modelo 'claude-opus-5-5' está excluido en modelos.json (excluir: opus). Si Max aprobó esta corrida, repetila con --ok-dueno; si no, elegí otro con -m o sacalo de excluir." });
  assert.ok(!("error" in politica(m, { modelo: "claude-opus-5-5", okDueno: true })));
  assert.ok(!("error" in politica(m, { modelo: "claude-opus-5-5", hijoAsync: true })));
  assert.ok(!("error" in politica(m)), "el modelo que vino de modelos.json (workers) no es un -m");
  assert.ok(!("error" in politica(m, { modelo: "claude-sonnet-5-5" })));
});

test("permitir_max: effort max sin --ok-dueno sólo si el archivo lo dice", () => {
  const sin = modelos({});
  assert.ok("error" in politica(sin, { modelo: "claude-sonnet-5-5", esfuerzo: "max" }));
  const con = modelos({ permitir_max: true });
  const r = politica(con, { modelo: "claude-sonnet-5-5", esfuerzo: "max" });
  assert.ok(!("error" in r) && r.esfuerzo === "max");
  assert.ok("error" in politica(sin, { modelo: "claude-fable-5-1" }), "fable sigue pidiendo --ok-dueno");
  assert.ok("error" in politica(con, { modelo: "claude-fable-5-1" }));
});

test("modelos.json: excluir, permitir_max, sin_cupo y reserva mal puestos tiran el archivo", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pa-modelos-"));
  try {
    const leer = (c: object) => {
      const f = path.join(dir, "m.json");
      writeFileSync(f, JSON.stringify({ version: 1, ...c }));
      return leerModelos(f);
    };
    assert.deepEqual(leer({ excluir: "opus" }), { error: 'excluir "opus" (una lista de ids o familias)' });
    assert.deepEqual(leer({ excluir: ["opus", " "] }), { error: 'excluir ["opus"," "] (una lista de ids o familias)' });
    assert.deepEqual(leer({ permitir_max: "si" }), { error: 'permitir_max "si" (true o false)' });
    assert.deepEqual(leer({ sin_cupo: "nunca" }), { error: 'sin_cupo "nunca" (otro, esperar o fallar)' });
    assert.deepEqual(leer({ reserva: 1.5 }), { error: 'reserva 1.5 (un número de 0 a 1, {"5h":…,"7d":…} o null)' });
    assert.ok(!("error" in (leer({ reserva: { "5h": 0.2 }, sin_cupo: "esperar", excluir: [], permitir_max: false }) as object)));
    assert.ok(!("error" in (leer({ reserva: null, excluir: null }) as object)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
