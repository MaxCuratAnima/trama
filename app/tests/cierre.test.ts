// Cerrar trama sin Electron: cerrar la ventana no sale; "Cerrar del todo" con cada opción hace lo suyo; la bandeja
// arma su menú con lo que le manda el renderer; "parar todo" frena sólo a los workers de los líderes de trama.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-cierre-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const SID = "11111111-2222-4333-8444-555555555555";
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_HISTORIAL = "0";
process.env.HILOS_CLAUDE_SETTINGS = path.join(tmp, "claude-settings.json");
// Un líder de la app que trama recuerda (sin proceso): sus workers son "de trama"; los de otro jefe, no.
mkdirSync(process.env.HILOS_STATE, { recursive: true });
writeFileSync(
  path.join(process.env.HILOS_STATE, "lideres.json"),
  JSON.stringify({ version: 1, lideres: [{ sid: SID, nombre: "uno", modelo: "sonnet", effort: "medium", creado: 1, ultimo: 0, cache_ttl_s: null, modo: "default" }] }),
);

const cierre = await import("../electron/cierre.ts");
const { armarBandeja, textosValidos } = await import("../electron/bandeja.ts");
const { workersVivosDe } = await import("../electron/relanzar.ts");
const nucleo = await import("../electron/nucleo.ts");

test("cerrar la ventana (Super+Q, ✕) la esconde y no sale; ya saliendo, no se interpone", () => {
  let escondida = 0;
  let evitado = 0;
  let saliendo = false;
  const cerrar = cierre.esconderAlCerrar({ hide: () => escondida++ }, () => saliendo);
  cerrar({ preventDefault: () => evitado++ });
  assert.deepEqual([escondida, evitado], [1, 1]);
  saliendo = true;
  cerrar({ preventDefault: () => evitado++ });
  assert.deepEqual([escondida, evitado], [1, 1]);
});

test("el pedido de salida: sólo valen los dos modos; lo raro es seguir sin forzar", () => {
  assert.deepEqual(cierre.pedidoDeSalida({ modo: "parar", forzar: true }), { modo: "parar", forzar: true });
  assert.deepEqual(cierre.pedidoDeSalida({ modo: "seguir" }), { modo: "seguir", forzar: false });
  for (const raro of [undefined, null, true, "parar", { modo: "matar", forzar: "sí" }]) assert.deepEqual(cierre.pedidoDeSalida(raro), { modo: "seguir", forzar: false });
});

test("Cerrar del todo: con 0 líderes respondiendo el proceso se va; con alguien respondiendo, no", async () => {
  const visto: string[] = [];
  let idos = 0;
  const d = (n: number) => ({ hacer: async (m: string, f: boolean) => (visto.push(`${m}:${f}`), n), irse: () => idos++ });
  assert.equal(await cierre.cerrarDelTodo({ modo: "seguir", forzar: false }, d(0)), 0);
  assert.equal(await cierre.cerrarDelTodo({ modo: "parar", forzar: false }, d(2)), 2);
  assert.equal(idos, 1);
  assert.equal(await cierre.cerrarDelTodo({ modo: "parar", forzar: true }, d(0)), 0);
  assert.equal(idos, 2);
  assert.deepEqual(visto, ["seguir:false", "parar:false", "parar:true"]);
});

test("la bandeja: clic trae la ventana, el menú (Abrir, Cerrar del todo) llega con los textos del renderer", () => {
  const llamadas: string[] = [];
  let menu: { label?: string; type?: string; click?: () => void }[] | null = null;
  let clic: (() => void) | null = null;
  const b = armarBandeja({
    crear: () => ({ setToolTip: (t) => llamadas.push(`tip:${t}`), setContextMenu: (m) => (menu = m as typeof menu), on: (_e, fn) => (clic = fn), destroy: () => llamadas.push("destruida") }),
    menu: (items) => items,
    abrir: () => llamadas.push("abrir"),
    cerrarDelTodo: () => llamadas.push("cerrar"),
  });
  assert.equal(menu, null, "sin textos no hay menú");
  clic!();
  b.textos({ abrir: "Abrir", cerrar: "Cerrar del todo" });
  assert.deepEqual(menu!.map((i) => i.label ?? i.type), ["Abrir", "separator", "Cerrar del todo"]);
  menu![0].click!();
  menu![2].click!();
  b.destruir();
  assert.deepEqual(llamadas, ["tip:trama", "abrir", "abrir", "cerrar", "destruida"]);
});

test("textos de la bandeja: dos no vacíos, o nada", () => {
  assert.deepEqual(textosValidos({ abrir: "Open", cerrar: "Quit" }), { abrir: "Open", cerrar: "Quit" });
  for (const x of [null, {}, { abrir: "a" }, { abrir: " ", cerrar: "b" }, { abrir: 1, cerrar: "b" }]) assert.equal(textosValidos(x), null);
  assert.equal(textosValidos({ abrir: "x".repeat(500), cerrar: "y" })!.abrir.length, 80);
});

test("workersVivosDe: sólo los vivos de los líderes dados, nunca por nombre ni de otro jefe", () => {
  const hilos = [
    { id: "a", estado: "trabajando", jefe_id: SID },
    { id: "b", estado: "colgado", jefe_id: SID },
    { id: "c", estado: "listo", jefe_id: SID },
    { id: "d", estado: "trabajando", jefe_id: "otro" },
    { id: "e", estado: "trabajando" },
    { id: "f", estado: "x", en_cola: true, jefe_id: SID },
    { id: "a", estado: "trabajando", jefe_id: SID },
  ];
  assert.deepEqual(workersVivosDe(hilos, [SID]).sort(), ["a", "b", "f"]);
  assert.deepEqual(workersVivosDe(hilos, []), []);
});

test("canales: parar todo y los textos de la bandeja son de la ventana (no van por la tailnet)", () => {
  assert.ok(nucleo.SOLO_VENTANA.has("app:pararTodo"));
  assert.ok(nucleo.SOLO_VENTANA.has("bandeja:textos"));
});

test("parar todo: frena los workers de los líderes de trama (cada uno por su id), no los de otro jefe, y no marca que el proceso se va", async () => {
  const parados: string[] = [];
  let ido = 0;
  const hilos = () =>
    [
      { id: "w1", estado: "trabajando", jefe_id: SID },
      { id: "w2", estado: "colgado", jefe_id: SID },
      { id: "w3", estado: "trabajando", jefe_id: "otro-jefe" },
      { id: "w4", estado: "listo", jefe_id: SID },
    ] as never;
  assert.equal(await nucleo.pararTodo(false, () => ido++, { hilos, pararWorker: async ({ id }) => void parados.push(id) }), 0);
  assert.deepEqual(parados.sort(), ["w1", "w2"]);
  assert.equal(ido, 1);
  // Lo que no pudo parar se cuenta y se sigue con los demás.
  parados.length = 0;
  await nucleo.pararTodo(true, () => {}, {
    hilos,
    pararWorker: async ({ id }) => {
      if (id === "w1") throw new Error("ya no existe");
      parados.push(id);
    },
  });
  assert.deepEqual(parados, ["w2"]);
  // No dijo "saliendo": el próximo cierre de verdad sigue pudiendo esperar a los líderes.
  assert.equal(nucleo.esperarSalida(), null, "sin líderes con proceso no hay a quién esperar, pero tampoco quedó marcado");
});
