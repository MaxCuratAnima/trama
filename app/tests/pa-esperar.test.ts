// pa-esperar en TypeScript: `--esperar` y `--esperar-todos` sobre un estado temporal con el formato real de
// ~/.local/state/pa, y la misma salida y rc que `motor/bin/pa` (bash + jq) sobre un estado igual (se saltea sin bash/jq/flock).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextoReal, type CtxPa } from "../electron/cli/contexto.ts";
import { esperar, esperarTodos } from "../electron/cli/pa-esperar.ts";

const PA_BASH = path.resolve(import.meta.dirname, "../../motor/bin/pa");
const hayBash = spawnSync("bash", ["-c", "command -v jq >/dev/null && command -v flock >/dev/null"]).status === 0 && existsSync(PA_BASH);

const JEFE = "jefe-uno";
const A = "20260101-000001-1";
const B = "20260101-000002-1";
const C = "20260101-000003-1";
const TIMEOUT = 60000;

type Salida = { out: string; err: string };
function armar(): { ctx: CtxPa; salida: Salida; raiz: string; limpiar: () => void } {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-esperar-"));
  const estado = path.join(raiz, "estado");
  const proyectos = path.join(raiz, "proyectos");
  mkdirSync(estado, { recursive: true });
  mkdirSync(proyectos, { recursive: true });
  const env = { HOME: raiz, PA_STATE: estado, PA_PROJ: proyectos, PA_JEFE_ID: JEFE, PA_WORKER: "", CLAUDE_LOCAL: "", ANTHROPIC_BASE_URL: "" };
  const salida: Salida = { out: "", err: "" };
  const real = contextoReal(env as never, "linux");
  const ctx: CtxPa = {
    ...real, estado, proyectos, home: raiz, env: env as never,
    out: (s) => void (salida.out += s), err: (s) => void (salida.err += s),
  };
  return { ctx, salida, raiz, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

const escribir = (ruta: string, texto: string) => (mkdirSync(path.dirname(ruta), { recursive: true }), writeFileSync(ruta, texto));
const haceDias = (dias: number) => new Date(Date.now() - dias * 86400 * 1000);

type Opc = { rc?: number; texto?: string; jefe?: string; leer?: boolean; vencida?: boolean; corriendo?: boolean };
/** Una corrida async de `slug`: `.corrida`, `.log`, `.pid` (muerto salvo `corriendo`), y `.json`+`.listo` si terminó. */
function corrida(ctx: CtxPa, slug: string, id: string, o: Opc = {}): void {
  const d = path.join(ctx.estado, slug);
  mkdirSync(path.join(ctx.estado, "lock", slug), { recursive: true }); // ya corrió algo: lo reconoce sin el registry
  escribir(path.join(d, `${id}.corrida`), `proyecto=${slug}\njefe=trama-1919\njefe_id=${o.jefe ?? JEFE}\nruta_trabajo=/no/existe\nrama=\nbase=\n`);
  escribir(path.join(d, `${id}.log`), "log\n");
  escribir(path.join(d, `${id}.pid`), o.corriendo ? `${process.pid}\n` : "999999\n");
  if (o.corriendo) return;
  const json = path.join(d, `${id}.json`);
  escribir(json, JSON.stringify({ session_id: "s1", result: o.texto ?? `RESULTADO de ${id}`, total_cost_usd: 0.5, num_turns: 7, duration_ms: 12345 }));
  escribir(path.join(d, `${id}.listo`), `salida=${json}\nrc=${o.rc ?? 0}\nsid=s1\n`);
  if (o.leer) escribir(path.join(d, `${id}.leer`), "");
  if (o.vencida) utimesSync(path.join(d, `${id}.listo`), haceDias(2), haceDias(2));
}

test("uso: sin proyecto da 2, y una opción desconocida también", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    assert.equal(await esperar(ctx, []), 2);
    assert.match(salida.err, /^uso: pa --esperar <proyecto>/);
    salida.err = "";
    assert.equal(await esperar(ctx, ["demo", "--raro"]), 2);
    assert.match(salida.err, /opción desconocida: --raro/);
  } finally {
    limpiar();
  }
});

test("entrega el más viejo, lo marca .entregado, y la llamada siguiente trae el que sigue", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  const d = path.join(ctx.estado, "demo");
  try {
    corrida(ctx, "demo", A, { texto: "HICE A" });
    corrida(ctx, "demo", B, { texto: "HICE B" });
    assert.equal(await esperar(ctx, ["demo"]), 0);
    assert.match(salida.out, /HICE A\n— 7 turnos · 12s · US\$0\.5\n— corrida 20260101-000001-1 · rc=0\n/);
    assert.ok(existsSync(path.join(d, `${A}.entregado`)) && !existsSync(path.join(d, `${A}.listo`)));
    salida.out = "";
    assert.equal(await esperar(ctx, ["demo"]), 0);
    assert.match(salida.out, /HICE B/);
    salida.out = "";
    assert.equal(await esperar(ctx, ["demo"]), 1);
    assert.match(salida.err, /nada pendiente en 'demo'/);
  } finally {
    limpiar();
  }
});

test("--id: entrega esa corrida; una ya cobrada o inexistente sale 1 con su aviso", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "demo", A, { texto: "HICE A" });
    assert.equal(await esperar(ctx, ["demo", "--id", A]), 0);
    assert.equal(await esperar(ctx, ["demo", "--id", A]), 1);
    assert.match(salida.err, /ya se entregó/);
    assert.equal(await esperar(ctx, ["demo", "--id", "20260101-999999-9"]), 1);
    assert.match(salida.err, /no existe la corrida 20260101-999999-9/);
  } finally {
    limpiar();
  }
});

test("un .listo de más de un día se saltea con aviso; --id lo trae igual", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "demo", A, { texto: "VIEJO", vencida: true });
    assert.equal(await esperar(ctx, ["demo"]), 1);
    assert.match(salida.err, /salteé 1 resultado\(s\) de 'demo' de más de un día/);
    assert.equal(await esperar(ctx, ["demo", "--id", A]), 0);
    assert.match(salida.out, /VIEJO/);
  } finally {
    limpiar();
  }
});

test("el pelado no entrega una corrida --leer y avisa con el comando para cobrarla", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "demo", B, { leer: true });
    assert.equal(await esperar(ctx, ["demo"]), 1);
    assert.match(salida.err, /tiene 1 corrida\(s\) --leer/);
    assert.match(salida.err, new RegExp(`--id ${B}   # \\(terminada\\)`));
  } finally {
    limpiar();
  }
});

test("una corrida de otro jefe no se entrega", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "demo", A, { jefe: "otro-jefe" });
    assert.equal(await esperar(ctx, ["demo"]), 1);
    assert.match(salida.err, /nada pendiente en 'demo'/);
  } finally {
    limpiar();
  }
});

test("rc 84 del worker: avisa que claude no está en el PATH y devuelve 84", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "demo", A, { rc: 84 });
    assert.equal(await esperar(ctx, ["demo"]), 84);
    assert.match(salida.err, /claude no está en el PATH/);
  } finally {
    limpiar();
  }
});

test("un writer vivo de este jefe hace esperar hasta el --timeout y sale 75", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "demo", C, { corriendo: true });
    assert.equal(await esperar(ctx, ["demo", "--timeout", "1"]), 75);
    assert.match(salida.err, /sigue trabajando después de 1s/);
  } finally {
    limpiar();
  }
});

test("--esperar-todos: cobra una corrida de cada proyecto, en orden alfabético, con su encabezado", { timeout: TIMEOUT }, async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    corrida(ctx, "uno", A, { texto: "DE UNO" });
    corrida(ctx, "dos", B, { texto: "DE DOS" });
    assert.equal(await esperarTodos(ctx, []), 0);
    assert.ok(salida.out.indexOf("══ dos (corrida") < salida.out.indexOf("══ uno (corrida"));
    assert.match(salida.out, /DE DOS[\s\S]*DE UNO/);
    assert.match(salida.out, /\n\n— 2 corrida\(s\) cobradas · rc=0\n$/);
    assert.match(salida.err, /esperando 2 corrida\(s\)/);
    assert.equal(await esperarTodos(ctx, []), 1);
    assert.match(salida.err, /nada pendiente tuyo/);
  } finally {
    limpiar();
  }
});

test("pa --esperar: misma salida y rc que motor/bin/pa sobre el mismo estado", { skip: !hayBash && "sin bash/jq/flock", timeout: TIMEOUT }, async () => {
  const uno = armar();
  const dos = armar();
  try {
    for (const { ctx } of [uno, dos]) corrida(ctx, "demo", A, { texto: "HICE A\nen dos líneas" });
    const ts = await esperar(uno.ctx, ["demo"]);
    const r = spawnSync("bash", [PA_BASH, "--esperar", "demo"], {
      encoding: "utf8", timeout: 60000,
      env: { ...process.env, PA_STATE: dos.ctx.estado, PA_PROJ: dos.ctx.proyectos, TZ: "UTC", HOME: dos.ctx.home, PA_JEFE_ID: JEFE, PA_WORKER: "", CLAUDE_LOCAL: "", ANTHROPIC_BASE_URL: "" },
    });
    assert.equal(uno.salida.out, r.stdout);
    assert.equal(ts, r.status);
  } finally {
    uno.limpiar();
    dos.limpiar();
  }
});
