// electron/cli/hook-statusline.ts, hook-compactando.ts y trama-motor.ts: los hooks y el comando del motor que faltaban para Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { espejoDe, filaHistorial, guardarEspejo, type ContextoStatusline } from "../electron/cli/hook-statusline.ts";
import { aplicar, decidir } from "../electron/cli/hook-compactando.ts";
import { entornoMotor, iniciar, detener, pidVivo, rutaLog, rutaMotor, rutaPid } from "../electron/cli/trama-motor.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "trama-hooks-"));
const sesion = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: "abc-123",
    workspace: { current_dir: "/x" },
    model: { id: "claude-opus" },
    rate_limits: { five_hour: { used_percentage: 10, resets_at: 111 }, seven_day: { used_percentage: 20, resets_at: 222 } },
    ...extra,
  });

function ctxStatusline(env: Record<string, string> = {}) {
  const dir = tmp();
  const ctx: ContextoStatusline = { plataforma: process.platform, env: { PA_STATE: dir, ...env }, home: dir, ahora: () => 1_700_000_000.9 };
  return { dir, ctx };
}

test("statusline: el espejo lleva la versión, el modelo, el cupo y el config_dir de la sesión", () => {
  const { ctx } = ctxStatusline({ CLAUDE_CONFIG_DIR: "/cuenta2" });
  const r = espejoDe(sesion(), ctx)!;
  assert.equal(r.id, "abc-123");
  assert.deepEqual(r.espejo, {
    version: 1, ts: 1_700_000_000, session_id: "abc-123", cwd: "/x", modelo: "claude-opus", prompt_cache: null, config_dir: "/cuenta2",
    rate_limits: { five_hour: { used_percentage: 10, resets_at: 111 }, seven_day: { used_percentage: 20, resets_at: 222 } },
  });
  assert.equal(espejoDe(sesion(), ctxStatusline().ctx)!.espejo.config_dir, null);
});

test("statusline: sin session_id usable no se escribe nada", () => {
  const { ctx } = ctxStatusline();
  assert.equal(espejoDe("basura", ctx), null);
  assert.equal(espejoDe(sesion({ session_id: "../x" }), ctx), null);
  assert.equal(espejoDe(sesion({ session_id: undefined }), ctx), null);
});

test("statusline: el historial suma una fila sólo cuando cambia algo", () => {
  const { dir, ctx } = ctxStatusline();
  guardarEspejo(sesion(), ctx);
  guardarEspejo(sesion(), { ...ctx, ahora: () => 1_700_000_100 }); // mismo cupo, otro ts: no suma
  const hist = path.join(dir, "statusline", "historial.jsonl");
  assert.equal(readFileSync(hist, "utf8").trim().split("\n").length, 1);
  guardarEspejo(sesion({ rate_limits: { five_hour: { used_percentage: 11, resets_at: 111 }, seven_day: null } }), ctx);
  const filas = readFileSync(hist, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(filas[0], { ts: 1_700_000_000, h5: 10, h5_reset: 111, sem: 20, sem_reset: 222 });
  assert.equal(filas.length, 2);
  assert.equal(filas[1].sem, null);
  assert.equal(JSON.parse(readFileSync(path.join(dir, "statusline", "abc-123.json"), "utf8")).rate_limits.five_hour.used_percentage, 11);
});

test("statusline: sin porcentajes no hay fila de historial", () => {
  assert.equal(filaHistorial({ ts: 1, rate_limits: { five_hour: null, seven_day: null } }), null);
});

test("statusline: reenvía la entrada al statusline original y devuelve su salida", () => {
  const dir = tmp();
  const script = path.join(import.meta.dirname, "../electron/cli/hook-statusline.ts");
  const eco = path.join(dir, "eco.mjs");
  writeFileSync(eco, `let t="";for await(const c of process.stdin)t+=c;process.stdout.write("eco:"+JSON.parse(t).session_id);`);
  const r = spawnSync(process.execPath, [script, process.execPath, eco], { input: sesion(), encoding: "utf8", env: { ...process.env, PA_STATE: dir } });
  assert.equal(r.stdout, "eco:abc-123");
  assert.ok(existsSync(path.join(dir, "statusline", "abc-123.json")));
});

test("compactando: el evento decide empieza o termina, y el id es PA_TS en un worker o el session_id", () => {
  assert.deepEqual(decidir([], '{"hook_event_name":"PreCompact","session_id":"s1"}', {}), { accion: "empieza", id: "s1" });
  assert.deepEqual(decidir([], '{"hook_event_name":"PostCompact","session_id":"s1"}', {}), { accion: "termina", id: "s1" });
  assert.deepEqual(decidir(["termina"], '{"hook_event_name":"PreCompact","session_id":"s1"}', {}), { accion: "termina", id: "s1" });
  assert.deepEqual(decidir([], '{"session_id":"s1"}', { PA_WORKER: "1", PA_TS: "run-9" }), { accion: "termina", id: "run-9" });
  assert.equal(decidir([], '{"session_id":"../x"}', {}), null);
  assert.equal(decidir([], "", {}), null);
});

test("compactando: deja y saca la marca en <HILOS_STATE>/compactando", () => {
  const dir = tmp();
  const ctx = { plataforma: process.platform, env: { HILOS_STATE: dir }, home: dir };
  aplicar([], '{"hook_event_name":"PreCompact","session_id":"s1"}', ctx);
  assert.ok(existsSync(path.join(dir, "compactando", "s1")));
  aplicar([], '{"hook_event_name":"PostCompact","session_id":"s1"}', ctx);
  assert.ok(!existsSync(path.join(dir, "compactando", "s1")));
  aplicar([], "basura", ctx); // no falla
});

test("trama-motor: rutas, entorno y start/stop de un motor falso", async () => {
  const dir = tmp();
  const motor = path.join(dir, "motor.mjs");
  writeFileSync(motor, `console.log("motor falso", process.env.TRAMA_LOCAL, process.env.HILOS_MOTOR); setInterval(()=>{}, 1000);`);
  const e = { plataforma: process.platform, env: { PA_STATE: dir, TRAMA_MOTOR_JS: motor }, home: dir };
  assert.equal(rutaMotor(e), motor);
  assert.equal(path.basename(rutaPid(e)), "trama-motor.pid");
  assert.equal(entornoMotor(e).TRAMA_LOCAL, "1");
  assert.equal(pidVivo(e), null);
  assert.equal(await iniciar(e), 0);
  const pid = pidVivo(e);
  assert.ok(pid && pid > 1);
  assert.equal(await iniciar(e), 0); // ya corre: no lanza otro
  assert.equal(pidVivo(e), pid);
  await new Promise((r) => setTimeout(r, 500));
  assert.match(readFileSync(rutaLog(e), "utf8"), /motor falso 1 1/);
  assert.equal(await detener(e), 0);
  assert.equal(pidVivo(e), null);
  assert.ok(!existsSync(rutaPid(e)));
});
