// Un líder de Gemini de punta a punta (electron/lider.ts → agy-puente.ts → scripts/agy-falso.mjs): los eventos que pinta la
// app, su transcript aparte, el archivo de sesión que ve la barra (y `pa`), la continuidad con `--conversation` (también tras
// cerrar y volver) y su repetición si agy ya no la tiene. Nunca el agy de verdad. HOME en un tmp: el prefacio lee sus CLAUDE.md.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-gemini-"));
const home = path.join(tmp, "home");
mkdirSync(home, { recursive: true });
writeFileSync(path.join(home, "CLAUDE.md"), "# Reglas de prueba\n\n## Jefe (sesión en `~`)\n- Delegás con `pa <proyecto> \"<tarea>\"`. MARCA-CLAUDE-MD\n");
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "no-existe.json");
process.env.TRAMA_DUENO = "Ana"; // los prompts nombran al dueño: aquí es siempre el mismo
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "agy.log");
// Un `pa` fuera del PATH de la app (como bajo la unidad de systemd): el líder de Gemini tiene que poder llamarlo igual.
const dirPa = path.join(tmp, "fuera-del-path");
process.env.HILOS_PA = path.join(dirPa, "pa");
process.env.PATH = "/usr/bin:/bin";
process.env.TRAMA_FALSO_MS = "20";
process.env.TRAMA_FALSO_MS_LENTO = "400";

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);
// El log lo comparten el claude falso y el agy falso: las líneas de agy son las que traen `prompt`.
const llamadas = () =>
  (existsSync(process.env.TRAMA_FALSO_LOG!) ? readFileSync(process.env.TRAMA_FALSO_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []).filter((l) => "prompt" in l);
const textos = (sid: string) => de(sid, "mensaje").map((m) => m.texto as string);

test("un líder de Gemini contesta: modelo con su esfuerzo en agy, el prefacio con sus CLAUDE.md, y la barra lo ve vivo", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "herramienta hola despacio" });
  // Mientras trabaja, el puente anota su sesión (la barra y `pa` la buscan ahí).
  await hasta(() => existsSync(process.env.HILOS_SESIONES!) && readdirSync(process.env.HILOS_SESIONES!).length > 0);
  const [archivo] = readdirSync(process.env.HILOS_SESIONES!);
  const ses = JSON.parse(readFileSync(path.join(process.env.HILOS_SESIONES!, archivo!), "utf8"));
  assert.equal(ses.sessionId, sid);
  assert.equal(String(ses.pid), archivo!.replace(".json", ""));
  await hasta(() => de(sid, "fin").length === 1, 45_000);
  assert.equal(de(sid, "fin")[0].error, null);
  assert.match(textos(sid).join("\n"), /eco: herramienta hola despacio/);
  // La herramienta de agy se ve como un Bash de Claude.
  const hace = de(sid, "hace").filter((h) => h.hace.que === "herramienta").map((h) => h.hace.nombre);
  assert.ok(hace.includes("Bash") && hace.includes("Read"), JSON.stringify(hace));
  // Lo que recibió agy.
  const [l] = llamadas();
  assert.equal(l.args[l.args.indexOf("--model") + 1], "gemini-3.8-flash-high");
  assert.ok(l.args.includes("--output-format") && l.args.includes("stream-json"));
  assert.ok(!l.args.includes("--conversation"), "el primer turno abre la conversación");
  assert.match(l.prompt, /líder de Trama/);
  assert.match(l.prompt, /MARCA-CLAUDE-MD/, "agy no lee CLAUDE.md: el prefacio se lo da");
  assert.match(l.prompt, /Mensaje de [^\n]+:\nherramienta hola despacio/);
  assert.equal(l.env.length, 0, `ninguna variable de Claude/Ollama en agy: ${l.env}`);
  // Delegar: `pa` en el PATH de agy aunque la app no lo traiga, la guía en el prefacio aunque no haya skill y la ruta por si falla.
  assert.ok(l.path.split(":").includes(dirPa), `la carpeta de pa va en el PATH de agy: ${l.path}`);
  assert.match(l.prompt, /pa <proyecto> --async --tipo/, "la guía de delegar viene en el prefacio, sin depender de ningún skill");
  assert.ok(l.prompt.includes(`\`${process.env.HILOS_PA}\``), "la ruta de pa por si el comando no se encuentra");
  // Su transcript es aparte de los de Claude y lo encuentra el mismo lector.
  const t = await lider.transcriptDe(sid);
  assert.equal(t, path.join(process.env.HILOS_STATE!, "gemini", `${sid}.jsonl`));
  assert.match(readFileSync(t!, "utf8"), /eco: herramienta hola despacio/);
  // Al salir ya no queda su archivo de sesión.
  await lider.cerrarTodos(false);
  assert.deepEqual(readdirSync(process.env.HILOS_SESIONES!), []);
});

test("el segundo turno retoma la conversación de agy; también tras cerrar y volver; y si agy la perdió, se repite lo hablado", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-4-argon", effort: "high", texto: "uno" });
  await hasta(() => de(sid, "fin").length === 1);
  const conversacion = JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "gemini", `${sid}.json`), "utf8")).conversation_id as string;
  assert.ok(conversacion);
  const n0 = llamadas().length;

  await lider.mandar({ sid, texto: "dos", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  let l = llamadas()[n0]!;
  assert.equal(l.args[l.args.indexOf("--conversation") + 1], conversacion);
  assert.ok(!/líder de Trama/.test(l.prompt), "el prefacio va sólo en la conversación nueva");
  assert.match(textos(sid).join("\n"), /\(turno 2\)/);

  // Cerrar del todo y volver: otro puente, la misma conversación.
  await lider.cerrarTodos(false);
  await lider.mandar({ sid, texto: "tres", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 3);
  l = llamadas().at(-1)!;
  assert.equal(l.args[l.args.indexOf("--conversation") + 1], conversacion);
  assert.match(textos(sid).join("\n"), /\(turno 3\)/);

  // agy ya no la tiene (el falso la guarda en $HILOS_STATE/agy-falso/<id>): un turno nuevo con lo hablado delante.
  rmSync(path.join(process.env.HILOS_STATE!, "agy-falso", conversacion));
  const n1 = llamadas().length;
  await lider.mandar({ sid, texto: "cuatro", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 4);
  const intentos = llamadas().slice(n1);
  assert.equal(intentos.length, 2, "el que falló y el repetido");
  assert.ok(intentos[0]!.args.includes("--conversation"));
  assert.ok(!intentos[1]!.args.includes("--conversation"));
  assert.match(intentos[1]!.prompt, /eco: uno/, "lo hablado antes viaja en el prompt");
  assert.match(intentos[1]!.prompt, /eco: dos/);
  assert.match(intentos[1]!.prompt, /Mensaje de [^\n]+:\ncuatro/);
  assert.equal(de(sid, "fin")[3].error, null, "el turno repetido termina bien y no se ve el error del primero");
  assert.match(textos(sid).at(-1)!, /eco: cuatro/);
  // La conversación nueva quedó anotada: el turno siguiente la usa.
  const nueva = JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "gemini", `${sid}.json`), "utf8")).conversation_id as string;
  assert.notEqual(nueva, conversacion);
});

test("parar corta el turno de agy; si agy se cae a mitad, el turno termina con el error y el líder sigue", { timeout: 40_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "despacio" });
  await hasta(() => de(sid, "hace").length > 0 || textos(sid).length > 0 || eventos.some((x) => x.sid === sid && x.e.tipo === "parcial"));
  lider.parar(sid);
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(lider.procDe(sid)?.ocupado, false);
  assert.equal(de(sid, "salio").length, 0, "parar no mata al puente");

  await lider.mandar({ sid, texto: "morite", modelo: "gemini-3.8-flash", effort: "low" });
  await hasta(() => de(sid, "fin").length === 2);
  assert.ok(de(sid, "fin")[1].error, "el fallo de agy se dice");
  assert.match(de(sid, "fin")[1].error, /agy|me muero/);
  // El líder sigue: el próximo mensaje contesta.
  await lider.mandar({ sid, texto: "estás", modelo: "gemini-3.8-flash", effort: "low" });
  await hasta(() => de(sid, "fin").length === 3);
  assert.equal(de(sid, "fin")[2].error, null);
});

test("un líder de Claude no se toca: nada de gemini/ en su estado y su proceso es el claude de siempre", { timeout: 30_000 }, async () => {
  const antes = llamadas().length;
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(llamadas().length, antes, "agy no corrió");
  assert.equal(existsSync(path.join(process.env.HILOS_STATE!, "gemini", `${sid}.json`)), false);
  assert.notEqual(await lider.transcriptDe(sid), path.join(process.env.HILOS_STATE!, "gemini", `${sid}.jsonl`));
});

test("un líder elegido como agy:* (Claude o GPT por Google) corre en el puente de agy con su --model", { timeout: 30_000 }, async () => {
  const antes = llamadas().length;
  const sid = await lider.nuevo({ modelo: "agy:claude-opus-5-5", effort: "high", texto: "por google" });
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(de(sid, "fin")[0].error, null);
  const nuevas = llamadas().slice(antes);
  assert.equal(nuevas.length, 1);
  assert.equal(nuevas[0].args[nuevas[0].args.indexOf("--model") + 1], "claude-opus-5-5-high");
});

test("agy expone sus skills de plugins sin pisar comandos.json de Claude, y cruzar de proveedor con mandar nunca hace --resume ajeno", { timeout: 40_000 }, async () => {
  const sidClaude = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola claude" });
  await hasta(() => de(sidClaude, "fin").length === 1);

  const sidGem = await lider.nuevo({ modelo: "gemini-4-argon", effort: "high", texto: "/pa-worker:ana-orquestar hola gemini" });
  await hasta(() => de(sidGem, "fin").length === 1);
  const cmdEv = de(sidGem, "comandos")[0];
  assert.ok(cmdEv, "agy mandó sus skills en el initialize");
  assert.equal(cmdEv.agy, true);
  assert.deepEqual(cmdEv.lista.map((c: { nombre: string }) => c.nombre), ["pa-worker:ana-orquestar", "pa-worker:gemini"]);
  // En el primer turno con prefacio, la skill con / va al inicio del prompt para que agy la expanda.
  const u = llamadas().at(-1)!;
  assert.match(u.prompt, /^\/pa-worker:ana-orquestar\n\n/);

  // Los comandos de Claude siguen intactos y separados de los de agy.
  const conocidos = await lider.comandosConocidos();
  assert.ok(conocidos.some((c) => !c.agy && c.nombre === "compact"), "los de Claude siguen en comandos.json");
  assert.ok(conocidos.some((c) => c.agy && c.nombre === "pa-worker:ana-orquestar"), "los de agy vienen marcados con agy: true");

  // Cruzar de Gemini a Claude o de Claude a Gemini rechaza sin matar ni relanzar con --resume ajeno.
  const nAntes = llamadas().length;
  await assert.rejects(
    () => lider.mandar({ sid: sidGem, texto: "cruzado", modelo: "claude-opus-5-5", effort: "high" }),
    /cambioProveedor/,
  );
  await assert.rejects(
    () => lider.mandar({ sid: sidClaude, texto: "cruzado", modelo: "gemini-4-argon", effort: "high" }),
    /cambioProveedor/,
  );
  await assert.rejects(
    () => lider.mandar({ sid: sidClaude, texto: "cruzado", modelo: "agy:claude-opus-5-5", effort: "high" }),
    /cambioProveedor/,
  );
  assert.equal(llamadas().length, nAntes, "no se lanzó agy con el sid de Claude");
  const guardados = await lider.lideresApp();
  assert.equal(guardados.find((g) => g.sid === sidGem)?.modelo, "gemini-4-argon");
  assert.equal(guardados.find((g) => g.sid === sidClaude)?.modelo, "claude-opus-5-5");
});

test("/compact en un líder de Gemini compacta de verdad la conversación de agy y se ve como en Claude: compactando, el cierre con el peso de antes y el transcript", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "uno" });
  await hasta(() => de(sid, "fin").length === 1);
  const conversacion = JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "gemini", `${sid}.json`), "utf8")).conversation_id as string;
  const n0 = llamadas().length;
  const avisos0 = de(sid, "aviso").length;

  await lider.mandar({ sid, texto: "/compact", modelo: "gemini-3.8-flash", effort: "low" });
  await hasta(() => de(sid, "fin").length === 2);
  assert.equal(de(sid, "fin")[1].error, null);
  // agy recibió el /compact tal cual, en la misma conversación.
  const l = llamadas()[n0]!;
  assert.equal(l.prompt, "/compact");
  assert.equal(l.args[l.args.indexOf("--conversation") + 1], conversacion);
  // La vista: "compactando" y después el aviso de compactó, con lo que pesaba (el contexto del turno anterior).
  assert.ok(de(sid, "hace").some((h) => h.hace.que === "compactando"));
  const compacto = de(sid, "aviso").slice(avisos0).map((a) => a.aviso).find((a) => a.clase === "compacto");
  assert.deepEqual(compacto, { clase: "compacto", auto: false, antes: 5001 });
  // El transcript lo anota como el de Claude: lo lee la conversación al abrirla de nuevo.
  const linea = readFileSync(path.join(process.env.HILOS_STATE!, "gemini", `${sid}.jsonl`), "utf8")
    .trim().split("\n").map((x) => JSON.parse(x)).find((o) => o.subtype === "compact_boundary");
  assert.deepEqual(linea.compactMetadata, { trigger: "manual", preTokens: 5001 });

  // Con un mensaje detrás: compacta y lo contesta.
  await lider.mandar({ sid, texto: "/compact seguí con X", modelo: "gemini-3.8-flash", effort: "low" });
  await hasta(() => de(sid, "fin").length === 3);
  assert.match(textos(sid).join("\n"), /eco: \/compact seguí con X/);
});

test("/compact sin conversación de agy no corre nada: no hay qué compactar", { timeout: 60_000 }, async () => {
  const n0 = llamadas().length;
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "/compact" });
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(de(sid, "fin")[0].error, null);
  assert.equal(llamadas().length, n0, "agy no se lanzó");
});

test("el razonamiento de Gemini (que agy deja en su transcript, no en el stream) llega como `pensamiento` y `pensado`, con cada comando y su error", { timeout: 60_000 }, async () => {
  process.env.HILOS_AGY_BRAIN = path.join(tmp, "brain");
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "herramienta pienso falla" });
  await hasta(() => de(sid, "fin").length === 1, 45_000);
  assert.equal(de(sid, "fin")[0].error, null);
  const pensado = de(sid, "mensaje").map((m) => m.pensado).filter(Boolean);
  assert.equal(pensado.length, 3, "un razonamiento por paso que razonó: " + JSON.stringify(pensado));
  assert.match(pensado[0], /shell responde/);
  assert.match(pensado[1], /algo que no existe/);
  assert.ok(de(sid, "pensamiento").length >= 3, "también llega mientras piensa");
  // Los dos comandos y el segundo con error.
  const cmds = de(sid, "hace").filter((h) => h.hace.que === "herramienta" && h.hace.nombre === "Bash");
  assert.ok(cmds.length >= 2);
  delete process.env.HILOS_AGY_BRAIN;
});

test("el transcript cuenta un paso que sólo razonó: la tanda del stream y la conversación leída miden igual (el turno no se duplica)", async () => {
  const { conversacionDe } = await import("../electron/lider-arma.ts");
  const l = (o: object) => JSON.stringify(o);
  const texto = [
    l({ type: "user", message: { role: "user", content: "hacé algo" } }),
    l({ type: "assistant", message: { id: "p1", content: [{ type: "thinking", thinking: "Primero miro." }] } }),
    l({ type: "assistant", message: { id: "t1", content: [{ type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } }] } }),
    l({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "a" }] } }),
    l({ type: "assistant", message: { id: "x1", content: [{ type: "text", text: "listo" }] } }),
  ].join("\n");
  const pag = conversacionDe("g", null, texto);
  // user + razonamiento solo + herramienta + texto: los mismos 4 que arma la tanda.
  assert.equal(pag.total, 4);
  assert.equal(pag.mensajes[1].pensado, "Primero miro.");
});
