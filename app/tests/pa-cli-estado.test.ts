// pa en TypeScript (electron/cli): parser, formato de los archivos de estado, candado, y los comandos --estado, --hilos,
// --hilo, --parar y --plan. Los fixtures tienen el formato real de %LOCALAPPDATA%\Trama\state\pa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsearArgs } from "../electron/cli/args.ts";
import { conCandado, tomarCandado } from "../electron/cli/candado.ts";
import { contextoReal, type CtxPa } from "../electron/cli/contexto.ts";
import {
  armarClaveValor, escribirPid, escribirPuesto, escribirSid, evento, hiloPoner, textoCorrida, textoHilo, textoRunning,
} from "../electron/cli/estado-archivos.ts";
import { main } from "../electron/cli/pa.ts";
import { lanzar } from "../electron/cli/pa-lanzar.ts";
import { esperar } from "../electron/cli/pa-esperar.ts";

const ahoraReal = Math.floor(Date.now() / 1000);
const p2 = (n: number) => String(n).padStart(2, "0");
/** El id de una corrida lanzada hace `seg` segundos (en UTC: los tests corren con TZ=UTC). */
const idDe = (seg: number, n: number) => {
  const d = new Date((ahoraReal - seg) * 1000);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}-${n}`;
};

type Salida = { out: string; err: string };
function armar(): { raiz: string; ctx: CtxPa; salida: Salida; limpiar: () => void } {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-cli-"));
  const estado = path.join(raiz, "estado");
  const proyectos = path.join(raiz, "proyectos");
  mkdirSync(estado, { recursive: true });
  mkdirSync(proyectos, { recursive: true });
  const salida: Salida = { out: "", err: "" };
  const real = contextoReal({ HOME: raiz, PA_STATE: estado, PA_PROJ: proyectos } as never, "win32");
  const ctx: CtxPa = {
    ...real, estado, proyectos, home: raiz, env: { HOME: raiz, PA_STATE: estado, PA_PROJ: proyectos },
    offsetSeg: () => 0, rutaDeSlug: () => null, ramasPa: () => [], commitsSobre: () => "",
    out: (s) => void (salida.out += s), err: (s) => void (salida.err += s),
  };
  return { raiz, ctx, salida, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

const escribir = (ruta: string, texto: string) => (mkdirSync(path.dirname(ruta), { recursive: true }), writeFileSync(ruta, texto));

/** Un estado con corridas de todos los tipos: terminada con decisión, corriendo, en cola, muerta en cola, vieja y --leer. */
function fixtures(ctx: CtxPa) {
  const e = ctx.estado;
  const d = path.join(e, "demo");
  const ids = { listo: idDe(3600, 1001), corre: idDe(600, 1002), cola: idDe(300, 1003), muerta: idDe(200, 1004), vieja: idDe(10 * 86400, 1005) };
  const sid = "11111111-2222-3333-4444-555555555555";
  const hilo = (id: string, extra = "") =>
    `tarea=Tarea de ${id}: hacer algo\nmodelo=claude-sonnet-5-5\neffort=high\ninicio=${ahoraReal - 100}\nproyecto=demo\nruta_trabajo=${e}/worktrees/demo\nrama=pa/demo/${id}\norigen=\nleer=0\npuesto=1\nlanzo=jefe\njefe=trama-1919\njefe_id=jefe-uno\ntipo=codigo-acotado\n${extra}`;
  // terminada, con resultado y decisión
  escribir(path.join(d, `${ids.listo}.hilo`), hilo(ids.listo, `fin=${ahoraReal - 3000}\ndecision=nada\ndecision_nada=1\nsigue=correr la suite\n`));
  escribir(path.join(d, `${ids.listo}.corrida`), textoCorrida({ ruta_trabajo: `${e}/worktrees/demo`, rama: `pa/demo/${ids.listo}`, base: "abc", proyecto: "demo", origen: "", leer: 0, puesto: 1, jefe: "trama-1919", jefe_id: "jefe-uno" }));
  escribir(path.join(d, `${ids.listo}.json`), JSON.stringify({ session_id: sid, result: "RESULTADO: hice lo pedido.\nARCHIVOS: a.ts\nDECISION: nada\nSIGUE: nada", total_cost_usd: 0.5, num_turns: 7, usage: { output_tokens: 10 } }));
  escribir(path.join(d, `${ids.listo}.listo`), `salida=${d}/${ids.listo}.json\nrc=0\nsid=${sid}\n`);
  escribir(path.join(d, `${ids.listo}.sid`), sid);
  escribir(path.join(d, `${ids.listo}.puesto`), "1");
  // corriendo (su pid es este proceso)
  escribir(path.join(d, `${ids.corre}.hilo`), hilo(ids.corre));
  escribir(path.join(d, `${ids.corre}.corrida`), textoCorrida({ ruta_trabajo: `${e}/worktrees/demo@2`, rama: `pa/demo/${ids.corre}`, base: "abc", proyecto: "demo", origen: "", leer: 0, puesto: 2 }));
  escribir(path.join(e, "demo@2.running"), textoRunning({ pid: process.pid, pa_pid: process.pid, inicio: ahoraReal - 125, proyecto: "demo", id: ids.corre, ruta: "/x/demo", ruta_trabajo: `${e}/worktrees/demo@2`, rama: `pa/demo/${ids.corre}`, modelo: "claude-sonnet-5-5", leer: 0, jefe: "trama-1919", jefe_id: "jefe-uno", puesto: 2, tarea: "algo" }));
  escribir(path.join(e, "demo@2.heartbeat"), `epoch=${ahoraReal - 40}\ntool=Bash\nenvuelo=1\ndesc=correr tests\n`);
  // en cola (el pa hijo de --async espera puesto)
  escribir(path.join(d, `${ids.cola}.hilo`), hilo(ids.cola));
  escribir(path.join(d, `${ids.cola}.pid`), String(process.pid));
  escribir(path.join(d, `${ids.cola}.cola`), "esperando un puesto libre");
  escribir(path.join(d, `${ids.cola}.jefe`), "jefe=trama-1919\njefe_id=jefe-uno\n");
  // muerta en cola (pid que no existe)
  escribir(path.join(d, `${ids.muerta}.hilo`), hilo(ids.muerta));
  escribir(path.join(d, `${ids.muerta}.pid`), "2999999");
  // vieja, ya integrada
  escribir(path.join(d, `${ids.vieja}.hilo`), hilo(ids.vieja, `fin=${ahoraReal - 9 * 86400}\n`));
  escribir(path.join(d, `${ids.vieja}.listo`), `salida=x\nrc=0\nsid=${sid}\n`);
  escribir(path.join(e, "integradas.tsv"), `fecha\tid\tproyecto\track\track_ppal\thead_antes\thead_despues\tcommits\tauto\taccion\n2026-10-01T00:00:00+00:00\t${ids.vieja}\tdemo\tpa/demo/${ids.vieja}\tmain\ta\tb\t2\t0\tintegrada\n`.replace("track\track_ppal", "rama\trama_ppal"));
  escribir(path.join(e, "demo.session"), sid + "\n");
  // transcript de la corrida terminada
  const l = (o: unknown) => JSON.stringify(o) + "\n";
  escribir(
    path.join(ctx.proyectos, "-x-demo", `${sid}.jsonl`),
    l({ type: "user", timestamp: "2026-10-26T10:00:00Z", message: { role: "user", content: "hacé algo" } }) +
      l({ type: "assistant", timestamp: "2026-10-26T10:00:05Z", message: { id: "m1", model: "claude-sonnet-5-5", usage: { output_tokens: 5 }, content: [{ type: "text", text: "Voy." }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } }) +
      l({ type: "assistant", timestamp: "2026-10-26T10:00:06Z", message: { id: "m1", model: "claude-sonnet-5-5", usage: { output_tokens: 9 }, content: [{ type: "text", text: "Listo." }] } }) +
      l({ type: "user", timestamp: "2026-10-26T10:00:07Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } }) +
      l({ type: "assistant", isSidechain: true, message: { id: "m2", content: [{ type: "text", text: "lateral" }] } }),
  );
  return { ids, sid };
}

process.env.TZ = "UTC";

test("parser: comandos globales, proyecto con opciones y errores como el bash", () => {
  assert.deepEqual(parsearArgs(["--hilo", "20261026-010203-5", "-n", "3"]), { clase: "global", comando: "--hilo", args: ["20261026-010203-5", "-n", "3"] });
  const r = parsearArgs(["miapp", "--async", "--leer", "--max-turns", "20", "--id", "x", "hacé", "algo"]);
  assert.equal(r.clase, "proyecto");
  if (r.clase === "proyecto") {
    assert.equal(r.opciones.proyecto, "miapp");
    assert.equal(r.opciones.async, true);
    assert.equal(r.opciones.leer, true);
    assert.equal(r.opciones.maxTurns, "20");
    assert.equal(r.opciones.id, "x");
    assert.equal(r.opciones.tarea, "hacé algo");
  }
  assert.equal(parsearArgs([]).clase, "error");
  assert.deepEqual(parsearArgs(["--nota"]), { clase: "error", codigo: 2, mensaje: 'uso: pa --nota "<texto>"  (pedido de el usuario, decisión, qué sigue)' });
  assert.equal(parsearArgs(["-h"]).clase, "ayuda");
});

test("formatos: mismas líneas y mismo orden que escribe el bash", () => {
  assert.equal(
    textoCorrida({ ruta_trabajo: "/w", rama: "pa/x/1", base: "abc", proyecto: "x", origen: "", leer: 0, puesto: 1, jefe: "j", jefe_id: "ji" }),
    "ruta_trabajo=/w\nrama=pa/x/1\nbase=abc\nproyecto=x\norigen=\nleer=0\npuesto=1\njefe=j\njefe_id=ji\n",
  );
  assert.equal(
    textoHilo({ tarea: "una\ntarea", modelo: "m", effort: "high", inicio: 5, proyecto: "x", ruta_trabajo: "/w", rama: "r", origen: "", leer: 0, puesto: 2, lanzo: "jefe", jefe: "j", jefe_id: "ji", tipo: "t", cuenta: "claude" }),
    "tarea=una tarea\nmodelo=m\neffort=high\ninicio=5\nproyecto=x\nruta_trabajo=/w\nrama=r\norigen=\nleer=0\npuesto=2\nlanzo=jefe\njefe=j\njefe_id=ji\ntipo=t\ncuenta=claude\n",
  );
  assert.equal(textoRunning({ pid: 1, pa_pid: 2, inicio: 3, proyecto: "x", id: "i", puesto: 1 }).split("\n").slice(0, 4).join("|"), "pid=1|pa_pid=2|inicio=3|proyecto=x");
  assert.equal(armarClaveValor([["a", "1"], ["b", undefined]]), "a=1\nb=\n");
});

test("valores pelados, hilo_poner y eventos: sin salto final, un campo por vez, JSON compacto", async () => {
  const { raiz, limpiar } = armar();
  try {
    const d = path.join(raiz, "estado", "demo");
    await escribirSid(d, "i1", "sid-1");
    await escribirPuesto(d, "i1", 2);
    await escribirPid(d, "i1", 4242);
    assert.equal(readFileSync(path.join(d, "i1.sid"), "utf8"), "sid-1");
    assert.equal(readFileSync(path.join(d, "i1.puesto"), "utf8"), "2");
    assert.equal(readFileSync(path.join(d, "i1.pid"), "utf8"), "4242");
    writeFileSync(path.join(d, "i1.hilo"), "tarea=x\nfin=1\n");
    await hiloPoner(path.join(d, "i1.hilo"), "fin", 99);
    await hiloPoner(path.join(d, "i1.hilo"), "decision", "nada");
    assert.equal(readFileSync(path.join(d, "i1.hilo"), "utf8"), "tarea=x\nfin=99\ndecision=nada\n");
    await evento(path.join(raiz, "estado"), "parar", "i1", "demo", 1700000000);
    await evento(path.join(raiz, "estado"), "termino", "i1", "demo", 1700000001, "0");
    assert.equal(
      readFileSync(path.join(raiz, "estado", "eventos.jsonl"), "utf8"),
      '{"version":1,"ts":1700000000,"tipo":"parar","id":"i1","proyecto":"demo"}\n{"version":1,"ts":1700000001,"tipo":"termino","id":"i1","proyecto":"demo","rc":0}\n',
    );
  } finally {
    limpiar();
  }
});

test("candado: exclusivo, suelta al terminar y recupera el de un pid muerto o reusado", async () => {
  const { raiz, limpiar } = armar();
  try {
    const ruta = path.join(raiz, "x.lock");
    const a = await tomarCandado(ruta);
    assert.ok(a);
    assert.equal(await tomarCandado(ruta), null, "con el dueño vivo no se toma");
    await a!.soltar();
    assert.equal(existsSync(ruta), false);
    writeFileSync(ruta, "pid=2999999\narranque=123\n");
    const b = await tomarCandado(ruta);
    assert.ok(b, "pid muerto: el candado viejo se recupera");
    await b!.soltar();
    writeFileSync(ruta, `pid=${process.pid}\narranque=otro-arranque\n`);
    const c = await tomarCandado(ruta);
    assert.ok(c, "pid vivo pero con otro arranque (pid reusado): se recupera");
    await c!.soltar();
    assert.equal(await conCandado(ruta, async () => 7), 7);
    assert.equal(existsSync(ruta), false);
  } finally {
    limpiar();
  }
});

test("--plan: dice el vigente, guarda pro|max y rechaza lo demás", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    assert.equal(await main(["--plan"], ctx), 0);
    assert.equal(salida.out, "plan: pro\n");
    assert.equal(await main(["--plan", "MAX"], ctx), 0);
    assert.match(salida.out, /plan max guardado en .*plan/);
    assert.equal(readFileSync(path.join(ctx.estado, "plan"), "utf8").trim(), "max");
    salida.out = "";
    assert.equal(await main(["--plan"], ctx), 0);
    assert.equal(salida.out, "plan: max\n");
    assert.equal(await main(["--plan", "otro"], ctx), 2);
    assert.match(salida.err, /uso: pa --plan/);
  } finally {
    limpiar();
  }
});

test("puertas: un worker no delega (1) y con modelo local sólo pasan las consultas (88)", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    assert.equal(await main(["--estado"], { ...ctx, env: { ...ctx.env, PA_WORKER: "1" } }), 1);
    assert.match(salida.err, /sos un worker delegado/);
    assert.equal(await main(["demo", "tarea"], { ...ctx, env: { ...ctx.env, CLAUDE_LOCAL: "1" } }), 88);
    assert.equal(await main(["--estado"], { ...ctx, env: { ...ctx.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:8080" } }), 0);
  } finally {
    limpiar();
  }
});

test("--estado: corriendo, en cola, muerta en cola, sesión y plan", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    const { ids } = fixtures(ctx);
    assert.equal(await main(["--estado"], ctx), 0);
    assert.match(salida.out, new RegExp(`CORRIENDO  demo +hace 2m0[56]s  · puesto 2 \\(id: ${ids.corre}\\)  · en Bash hace 4[01]s`));
    assert.match(salida.out, new RegExp(`EN COLA    demo +\\(id: ${ids.cola}, esperando un puesto libre\\)`));
    assert.match(salida.out, new RegExp(`MURIÓ EN COLA demo +\\(id: ${ids.muerta}, nunca tomó puesto`));
    assert.match(salida.out, /sesión     demo +11111111-2222-3333-4444-555555555555  \(guardada \d{4}-\d\d-\d\d \d\d:\d\d\)/);
    assert.match(salida.out, /plan pro \(modo ahorro\)/);
  } finally {
    limpiar();
  }
});

test("--hilos --json: las corridas de la ventana, sin la vieja ya integrada", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    const { ids } = fixtures(ctx);
    assert.equal(await main(["--hilos", "--json"], ctx), 0);
    const mio = JSON.parse(salida.out);
    assert.equal(mio.version, 1);
    const idsMios = mio.hilos.map((h: { id: string }) => h.id);
    assert.ok(idsMios.includes(ids.listo) && idsMios.includes(ids.corre) && idsMios.includes(ids.cola), "están las corridas de la ventana");
    assert.ok(!idsMios.includes(ids.vieja), "la vieja ya integrada queda afuera");
    // el texto plano también
    salida.out = "";
    assert.equal(await main(["--hilos"], ctx), 0);
    assert.match(salida.out, new RegExp(ids.listo));
  } finally {
    limpiar();
  }
});

test("--hilos: una corrida terminada (.listo) cuyo .pid quedó con un pid vivo reusado no está en cola", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    const d = path.join(ctx.estado, "demo");
    const [reusada, entregada, enCola] = [idDe(300, 4001), idDe(280, 4002), idDe(260, 4003)];
    for (const id of [reusada, entregada, enCola]) {
      escribir(path.join(d, `${id}.hilo`), `tarea=x\nmodelo=m\ninicio=${ahoraReal - 100}\nproyecto=demo\nleer=0\n`);
      escribir(path.join(d, `${id}.pid`), String(process.pid)); // pid vivo: el que Windows reasignó
    }
    escribir(path.join(d, `${reusada}.listo`), "salida=x\nrc=0\nsid=\n");
    escribir(path.join(d, `${entregada}.entregado`), "salida=x\nrc=0\nsid=\n");
    assert.equal(await main(["--hilos", "--json"], ctx), 0);
    const porId = new Map<string, { en_cola: boolean }>(JSON.parse(salida.out).hilos.map((h: { id: string; en_cola: boolean }) => [h.id, h]));
    assert.equal(porId.get(reusada)?.en_cola, false, "con .listo no está en cola");
    assert.equal(porId.get(entregada)?.en_cola, false, "con .entregado no está en cola");
    assert.equal(porId.get(enCola)?.en_cola, true, "sin resultado y con el pid vivo sí");
  } finally {
    limpiar();
  }
});

test("--hilo: mensajes del transcript unidos por mensaje", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    const { ids } = fixtures(ctx);
    assert.equal(await main(["--hilo", ids.listo, "--json"], ctx), 0);
    const mio = JSON.parse(salida.out);
    assert.equal(mio.total, 2);
    assert.equal(mio.mensajes[1].texto, "Voy.\nListo.");
    assert.deepEqual(mio.mensajes[1].herramientas, ["Bash"]);
    salida.err = "";
    assert.equal(await main(["--hilo", "20200101-000000-1"], ctx), 1);
    assert.match(salida.err, /no encuentro la corrida/);
    assert.equal(await main(["--hilo", ids.listo, "-n", "x"], ctx), 2);
  } finally {
    limpiar();
  }
});

test("--parar: baja el worker de un .running (árbol incluido), anota el fin y el evento", async () => {
  const { ctx, salida, limpiar } = armar();
  const hijos: ReturnType<typeof spawn>[] = [];
  try {
    const id = idDe(60, 2001);
    const e = ctx.estado;
    const d = path.join(e, "demo");
    // un "claude" que lanza un nieto
    const claude = spawn(process.execPath, ["-e", `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{},300000)"], { stdio: "ignore" }); setTimeout(()=>{},300000)`], { stdio: "ignore" });
    hijos.push(claude);
    await new Promise((ok) => setTimeout(ok, 300));
    escribir(path.join(d, `${id}.hilo`), `tarea=x\ninicio=${ahoraReal}\nproyecto=demo\n`);
    escribir(path.join(e, "demo.running"), textoRunning({ pid: claude.pid, pa_pid: "", inicio: ahoraReal, proyecto: "demo", id, puesto: 1 }));
    writeFileSync(path.join(e, "demo.heartbeat"), "epoch=1\ntool=Bash\n");
    const rc = await main(["--parar", id], ctx);
    assert.equal(rc, 0, salida.err);
    assert.match(salida.out, new RegExp(`worker de 'demo' matado \\(claude ${claude.pid} y su árbol\\)`));
    assert.equal(ctx.existePid(claude.pid!) && !ctx.esZombi(claude.pid!), false, "el claude murió");
    assert.equal(existsSync(path.join(e, "demo.running")), false);
    assert.equal(existsSync(path.join(e, "demo.heartbeat")), false);
    assert.match(readFileSync(path.join(d, `${id}.hilo`), "utf8"), /^fin=\d+$/m);
    assert.match(readFileSync(path.join(e, "eventos.jsonl"), "utf8"), new RegExp(`"tipo":"parar","id":"${id}","proyecto":"demo"`));
  } finally {
    for (const h of hijos) h.kill();
    limpiar();
  }
});

test("--parar: una corrida en cola, una que no corre y un id que no existe", async () => {
  const { ctx, salida, limpiar } = armar();
  let cola: ReturnType<typeof spawn> | null = null;
  try {
    const d = path.join(ctx.estado, "demo");
    const id = idDe(60, 3001);
    cola = spawn(process.execPath, ["-e", "setTimeout(()=>{},300000)"], { stdio: "ignore" });
    escribir(path.join(d, `${id}.hilo`), `tarea=x\nproyecto=demo\n`);
    escribir(path.join(d, `${id}.pid`), String(cola.pid));
    assert.equal(await main(["--parar", id], ctx), 0, salida.err);
    assert.match(salida.out, /bajada \(estaba en cola\)/);
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(await main(["--parar", id], ctx), 1);
    assert.match(salida.err, /no está corriendo ni en cola/);
    salida.err = "";
    assert.equal(await main(["--parar", "20200101-000000-9"], ctx), 1);
    assert.match(salida.err, /no encuentro la corrida/);
    assert.equal(await main(["--parar"], ctx), 2);
  } finally {
    cola?.kill();
    limpiar();
  }
});

test("pa-esperar sin proyecto da el uso", async () => {
  const { ctx, salida, limpiar } = armar();
  try {
    assert.equal(await esperar(ctx, []), 2);
    assert.match(salida.err, /^uso: pa --esperar <proyecto>/);
  } finally {
    limpiar();
  }
});

test("pa-lanzar: worktree y rama propios, claude falso, .hilo/.ultimo/.corrida y salida", async () => {
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
    // claude.exe falso, compilado con el csc de Windows (un .cmd no sirve: cmd.exe corta la línea a 8191 caracteres y el contrato la pasa)
    const fuente = path.join(raiz, "claude-falso.cs");
    const falso = path.join(raiz, "claude-falso.exe");
    writeFileSync(
      fuente,
      `class P { static void Main() {
  System.IO.File.WriteAllText("hecho.txt", "x");
  System.Console.WriteLine("{\\"result\\":\\"RESULTADO: listo.\\\\nARCHIVOS: hecho.txt\\\\nDECISION: nada\\\\nSIGUE: nada\\",\\"session_id\\":\\"sid-falso\\",\\"num_turns\\":2,\\"duration_ms\\":1500,\\"total_cost_usd\\":0.01}");
} }`,
    );
    const csc = path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const c = spawnSync(csc, ["/nologo", `/out:${falso}`, fuente], { encoding: "utf8" });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    ctx.env = { ...ctx.env, TRAMA_CLAUDE: falso, PA_JEFE: "jefe-test", PA_JEFE_ID: "jid", PA_CLAUDE_SETTINGS: path.join(raiz, "no-hay.json") };
    mkdirSync(path.join(raiz, "AppData", "Roaming", "Trama", "proyectos"), { recursive: true });
    writeFileSync(path.join(raiz, "AppData", "Roaming", "Trama", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: repo }] }));
    const r = parsearArgs(["demo", "haceme algo"]);
    assert.equal(r.clase, "proyecto");
    if (r.clase !== "proyecto") return;
    const rc = await lanzar(ctx, r.opciones);
    const logs = existsSync(path.join(ctx.estado, "demo")) ? readdirSync(path.join(ctx.estado, "demo")).filter((n) => n.endsWith(".log")).map((n) => readFileSync(path.join(ctx.estado, "demo", n), "utf8")).join("\n") : "";
    assert.equal(rc, 0, salida.err + logs);
    assert.match(salida.out, /RESULTADO: listo\./);
    const ultimo = readFileSync(path.join(ctx.estado, "demo.ultimo"), "utf8");
    assert.match(ultimo, /rc=0/);
    assert.match(ultimo, /sid=/);
    const hilos = readdirSync(path.join(ctx.estado, "demo")).filter((n) => n.endsWith(".hilo"));
    assert.equal(hilos.length, 1);
    const hilo = readFileSync(path.join(ctx.estado, "demo", hilos[0]), "utf8");
    assert.match(hilo, /decision_nada=1/);
    assert.match(hilo, /rama=pa\/demo\//);
    const rama = /rama=(\S+)/.exec(hilo)![1];
    assert.ok(g("branch", "--list", rama).stdout.includes(rama));
    const ruta = /ruta_trabajo=(.+)/.exec(hilo)![1].trim();
    assert.ok(existsSync(path.join(ruta, "hecho.txt")), "el claude corrió dentro del worktree");
    assert.ok(!existsSync(path.join(ctx.estado, "demo", "demo.running")), "soltó el .running");
  } finally {
    limpiar();
  }
});