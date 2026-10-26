// src/hilo/worker-datos.ts: lo que la vista de worker saca de los pasos (nombres cortos, grupos, resumen, tests, mapa, diff).
// Puro; los módulos de src/ se importan sin extensión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const D = await import("../src/hilo/worker-datos.ts");
const { pasosFijos } = await import("../src/datos/pasos-fixture.ts");

const corto = (t: string) => ({ t, total: t.length, recortado: false });
const T0 = 1_000_000;
let n = 0;
function paso(tipo: string, detalle: object, mas: object = {}) {
  const i = n++;
  return { n: i, v: i + 1, id: `p${i}`, tipo, titulo: "", t: T0 + i * 1000, dur: 1000, estado: "ok", error: null, detalle, ...mas } as never;
}
const leer = (ruta: string) => paso("leer", { clase: "leer", ruta, desde: 1, lineas: 1, total: 1, imagen: false, texto: corto("x") });
const buscar = (patron: string) => paso("buscar", { clase: "buscar", herramienta: "Grep", patron, ruta: null, resultados: 1, texto: corto("a") });
const correr = (cmd: string, codigo: number, salida: string, extra: object = {}) =>
  paso("correr", { clase: "correr", comando: corto(cmd), descripcion: null, salida: corto(salida), codigo, interrumpido: false, fondo: false }, extra);

test("el nombre corto: el archivo, el patrón o dos palabras del comando", () => {
  assert.equal(D.corto(leer("src/hilo/Vista.tsx")), "Vista.tsx");
  assert.equal(D.corto(buscar("usarCuenta")), "usarCuenta");
  assert.equal(D.corto(correr("cd /tmp/x && FOO=1 npx tsc --noEmit && node --test tests/", 0, "")), "npx tsc --noEmit");
  assert.equal(D.corto(correr("npm test", 0, "")), "npm test");
  const conDescripcion = paso("correr", { clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", salida: null, codigo: 0, interrumpido: false, fondo: false });
  assert.equal(D.corto(conDescripcion), "Corre los tests");
  assert.equal(D.corto(paso("pensar", { clase: "pensar" })), "");
});

test("los chicos seguidos se juntan en un grupo; uno solo queda suelto y un fallo corta el grupo", () => {
  const ps = [leer("a.ts"), buscar("x"), leer("b.ts"), correr("npm test", 1, "", { estado: "fallo" }), leer("c.ts"), paso("pensar", { clase: "pensar" }), leer("d.ts"), leer("e.ts")];
  const f = D.filas(ps);
  assert.deepEqual(f.map((x) => (x.grupo ? x.ps.length : 0)), [3, 0, 0, 0, 2]);
});

test("el rótulo del grupo cuenta las lecturas y las búsquedas por separado", () => {
  assert.deepEqual(D.cuenta([leer("a"), buscar("x")]), { leer: 1, buscar: 1 });
  assert.deepEqual(D.cuenta([leer("a"), leer("b"), leer("c"), leer("d"), leer("e"), leer("f")]), { leer: 6, buscar: 0 });
  assert.deepEqual(D.cuenta([buscar("a"), buscar("b"), leer("c")]), { leer: 1, buscar: 2 });
});

test("la duración sólo se escribe si el paso pasa de 10 s", () => {
  assert.equal(D.durLenta(correr("a", 0, "", { dur: 10_000 })), null);
  assert.equal(D.durLenta(correr("a", 0, "", { dur: 38_000 })), "38 s");
  assert.equal(D.durLenta(correr("a", 0, "", { dur: 251_000 })), "4 m 11 s");
  assert.equal(D.durLenta(correr("a", 0, "", { dur: null })), null);
});

test("el resumen: la sección RESULTADO en una o dos frases y los supuestos aparte", () => {
  const r = D.resumenDe("RESULTADO: arreglé la cuenta. Ahora cuenta bien. Tercera frase que sobra. Supuestos: empieza en 1; no toqué los viejos.\nARCHIVOS: a.ts\nSIGUE: nada");
  assert.equal(r.resultado, "Arreglé la cuenta. Ahora cuenta bien.");
  assert.deepEqual(r.supuestos, ["Empieza en 1", "No toqué los viejos"]);
  assert.deepEqual(D.resumenDe(null), { resultado: null, supuestos: [] });
  assert.equal(D.resumenDe("Hice todo.\n\nOtro párrafo.").resultado, "Hice todo.");
  assert.equal(D.resumenDe("RESULTADO: uno\ndos\nDECISION: nada").resultado, "Uno dos");
  // Sin «…»: lo largo llega entero (la vista lo pliega desde 200 caracteres).
  const largo = D.resumenDe(`RESULTADO: ${"palabra ".repeat(100)}.`).resultado!;
  assert.ok(largo.startsWith("Palabra palabra") && largo.length > 320, largo.length);
  assert.ok(!largo.includes("…"));
});

test("lo que pasa de 200 caracteres se pliega; el nombre corto de un comando no corta palabras", () => {
  assert.equal(D.muyLargo("a".repeat(200)), false);
  assert.equal(D.muyLargo("a".repeat(201)), true);
  const cmd = "node scripts/prueba-actividad.mjs --verbose-long-flag-name-here";
  assert.equal(D.corto(correr(cmd, 0, "")), "node scripts/prueba-actividad.mjs --verbose-long-flag-name-here");
});

test("ninguna pieza de la vista de worker corta con «…» (el texto va entero o se pliega)", () => {
  const dir = new URL("../src/hilo/", import.meta.url);
  for (const f of ["worker-estilos.css", "entero-estilos.css"]) assert.ok(!/text-overflow:\s*ellipsis/.test(readFileSync(new URL(f, dir), "utf8")), f);
});

test("el chip de tests: el último corredor que terminó, verde o rojo, con la cuenta si se la lee", () => {
  assert.equal(D.testsDe([leer("a")]), null);
  const rojo = D.testsDe([correr("npm test", 1, "1 fail", { estado: "fallo" })])!;
  assert.equal(rojo.ok, false);
  assert.equal(rojo.n, null);
  const verde = D.testsDe([correr("npm test", 1, "", { estado: "fallo" }), correr("node --test tests/", 0, "# tests 943\n# pass 943\n# fail 0")])!;
  assert.deepEqual([verde.ok, verde.n], [true, 943]);
  assert.equal(D.testsDe([correr("npm test", 0, "", { estado: "corriendo" })]), null);
  assert.equal(D.cuantosTests("Tests: 2 failed, 5 passed, 7 total"), 5);
  assert.equal(D.cuantosTests("22 pass\n0 fail"), 22);
  assert.equal(D.cuantosTests("nada"), null);
  assert.equal(D.testsDe([correr("ls -la", 0, "")]), null);
});

test("el mapa pesa cada paso por lo que tardó hasta el siguiente y nunca lo deja en cero", () => {
  const ps = [correr("a", 0, "", { t: 0 }), correr("b", 0, "", { t: 9_000 }), correr("c", 0, "", { t: 9_000 })];
  const w = D.pesos(ps, 10_000);
  assert.equal(w.length, 3);
  assert.ok(w[0] > w[1]);
  assert.ok(w[1] > 0);
  assert.deepEqual(D.pesos([], null), []);
});

test("el diff pone lo común como contexto y numera desde la línea del cambio", () => {
  const f = D.diffDe({ viejo: corto("a\nb\nc"), nuevo: corto("a\nB\nB2\nc"), todo: false, desde: 10 });
  assert.deepEqual(f.map((x) => x.t), [" ", "-", "+", "+", " "]);
  assert.deepEqual(f.map((x) => x.a), [10, 11, null, null, 12]);
  assert.deepEqual(f.map((x) => x.b), [10, null, 11, 12, 13]);
  const sin = D.diffDe({ viejo: corto("x"), nuevo: corto("y"), todo: false, desde: null });
  assert.deepEqual(sin.map((x) => [x.t, x.a, x.b]), [["-", null, null], ["+", null, null]]);
});

test("el diff de dos textos enormes no se cuelga: cae a sacar todo y poner todo", () => {
  const v = Array.from({ length: 3000 }, (_, i) => `v${i}`).join("\n");
  const w = Array.from({ length: 3000 }, (_, i) => `w${i}`).join("\n");
  const t0 = Date.now();
  const f = D.diffDe({ viejo: corto(v), nuevo: corto(w), todo: false, desde: 1 });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(f.length, 6000);
});

test("lo leído pierde el cat -n si todas las líneas lo traen y toma su número de la primera", () => {
  const f = D.filasLeidas("     5→uno\n     6→dos", 5);
  assert.deepEqual(f.map((x) => [x.b, x.x]), [[5, "uno"], [6, "dos"]]);
  assert.deepEqual(D.filasLeidas("a\nb", null).map((x) => x.b), [null, null]);
  assert.deepEqual(D.filasEscritas("a\nb\n").map((x) => [x.t, x.b]), [["+", 1], ["+", 2]]);
});

test("con el fixture: el resultado sale del mensaje final y los chips de los archivos tocados", () => {
  const v = pasosFijos("w");
  const r = D.resumenDe(D.textoFinal(v.pasos));
  assert.ok(r.resultado);
  assert.ok(D.testsDe(v.pasos)?.ok);
  assert.deepEqual(D.chipsDe(v.encabezado).map((c) => c.nombre), ["cuenta.ts", "contar.ts"]);
  assert.ok(!D.visibles(v.pasos).some((p) => p.detalle.clase === "texto" && p.detalle.final));
  assert.equal(D.extension("src/a/B.tsx"), "tsx");
});
