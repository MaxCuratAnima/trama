// El aviso de Antigravity CLI (electron/actualizador.ts + electron/actualizacion-agy.ts) con un `agy` de mentira
// (un .cmd en un tmp; nunca el real, nunca `agy update` de verdad): versión vieja avisa, igual no, `agy` ausente no avisa
// ni consulta, Ocultar, Actualizar, y de dónde sale la última (el actualizador).
// Actualizar de agy (el módulo) corre `agy update`: el falso deja la versión nueva en su archivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-agy-"));
process.env.HILOS_STATE = path.join(tmp, "estado");

/** Un `agy` falso (.cmd): `--version` imprime lo que dice su archivo; `update` lo pasa a `nueva`. (El argumento llega entre comillas: `%1=="update"`.) */
function agyFalso(nombre: string, instalada: string, nueva: string) {
  const v = path.join(tmp, `${nombre}.ver`);
  const bin = path.join(tmp, `${nombre}.cmd`);
  writeFileSync(v, instalada);
  writeFileSync(
    bin,
    [
      "@echo off",
      `if %1=="--version" type "${v}" & exit /b 0`,
      `if %1=="update" <nul set /p="${nueva}" >"${v}" & echo actualizado & exit /b 0`,
      "exit /b 2",
      "",
    ].join("\r\n"),
  );
  return bin;
}

// El agy del módulo.
const agyModulo = agyFalso("modulo", "1.4.2", "1.4.3");
// El módulo de agy lee su entorno al cargarse. La última sale del estado (recién chequeada, así no se consulta): sin red.
process.env.HILOS_AGY = agyModulo;
process.env.HILOS_AGY_ACTUALIZADOR = "http://127.0.0.1:9/";
mkdirSync(path.join(tmp, "estado"), { recursive: true });
writeFileSync(path.join(tmp, "estado", "agy-version.json"), JSON.stringify({ version: 1, chequeado: Date.now(), instalada: "1.4.2", ultima: "1.4.3", descartada: null }));

const { crearActualizador } = await import("../electron/actualizador.ts");
const { actualizarAgy, leerAvisoAgy, ultimaAgy } = await import("../electron/actualizacion-agy.ts");

function con(nombre: string, bin: string, ultima: string | null) {
  let consultas = 0;
  const a = crearActualizador({
    archivo: path.join(tmp, `${nombre}.json`),
    bin,
    nombre,
    ultima: async () => (consultas++, ultima),
    actualizar: { args: ["update"] },
    entornoActualizar: () => process.env,
    olvidarSiFalta: true,
  });
  return { a, consultas: () => consultas };
}

test("agy más viejo que la última: hay aviso", async () => {
  const { a } = con("vieja", agyFalso("agy-vieja", "1.4.2\r\n", "1.4.3"), "1.4.3");
  assert.deepEqual(await a.leerAviso(), { instalada: "1.4.2", ultima: "1.4.3" });
});

test("agy igual a la última: no hay aviso", async () => {
  const { a } = con("igual", agyFalso("agy-igual", "1.4.2\r\n", "1.4.2"), "1.4.2");
  assert.equal(await a.leerAviso(), null);
});

test("agy ausente: no hay aviso ni se consulta la última", async () => {
  const { a, consultas } = con("ausente", path.join(tmp, "no-existe.cmd"), "9.9.9");
  assert.equal(await a.leerAviso(), null);
  assert.equal(consultas(), 0);
});

test("agy desinstalado después de un aviso: el aviso se va", async () => {
  const bin = agyFalso("agy-se-va", "1.4.2\r\n", "1.4.3");
  const archivo = path.join(tmp, "se-va.json");
  const cfg = { archivo, nombre: "se-va", ultima: async () => "1.4.3", actualizar: { args: ["update"] }, entornoActualizar: () => process.env, olvidarSiFalta: true };
  assert.ok(await crearActualizador({ ...cfg, bin }).leerAviso());
  assert.equal(await crearActualizador({ ...cfg, bin: path.join(tmp, "ya-no-esta.cmd") }).leerAviso(), null);
});

test("sin red (la última no se sabe): sin aviso, y se vuelve a preguntar", async () => {
  const { a, consultas } = con("sin-red", agyFalso("agy-sin-red", "1.4.2\r\n", "1.4.3"), null);
  assert.equal(await a.leerAviso(), null);
  assert.equal(await a.leerAviso(), null);
  assert.equal(consultas(), 2);
});

test("a la fuente de la última no se le vuelve a preguntar antes de 6 h", async () => {
  const { a, consultas } = con("seis-horas", agyFalso("agy-seis", "1.4.2\r\n", "1.4.3"), "1.4.3");
  await a.leerAviso();
  await a.leerAviso();
  assert.equal(consultas(), 1);
});

test("Ocultar apaga el aviso de esa versión", async () => {
  const { a } = con("oculta", agyFalso("agy-oculta", "1.4.2\r\n", "1.4.3"), "1.4.3");
  const vistos: unknown[] = [];
  a.alCambiarAviso((x) => vistos.push(x));
  assert.ok(await a.leerAviso());
  await a.descartar();
  assert.equal(await a.leerAviso(), null);
  assert.deepEqual(vistos.at(-1), null);
});

test("Actualizar (genérico) corre `<bin> update` y deja la versión nueva", async () => {
  const bin = agyFalso("agy-act", "1.4.2\r\n", "1.4.3");
  const { a } = con("act", bin, "1.4.3");
  await a.leerAviso();
  assert.deepEqual(await a.actualizar(), { ok: true, version: "1.4.3" });
  assert.equal(readFileSync(path.join(tmp, "agy-act.ver"), "utf8"), "1.4.3");
  assert.equal(await a.leerAviso(), null);
});

test("Actualizar que no sube la versión es un error, con lo que dijo", async () => {
  const { a } = con("no-sube", agyFalso("agy-no-sube", "1.4.2\r\n", "1.4.2"), "1.4.3");
  await a.leerAviso();
  const r = await a.actualizar();
  assert.equal(r.ok, false);
});

test("agy (módulo): Actualizar corre `agy update` y deja la versión nueva", async () => {
  assert.deepEqual(await leerAvisoAgy(), { instalada: "1.4.2", ultima: "1.4.3" });
  assert.deepEqual(await actualizarAgy(), { ok: true, version: "1.4.3" });
  assert.equal(readFileSync(path.join(tmp, "modulo.ver"), "utf8"), "1.4.3");
  assert.equal(await leerAvisoAgy(), null);
});

test("la última de agy: la que dice el actualizador, null si no contesta o no se entiende", async () => {
  const respuesta = (r: { ok: boolean; texto: string } | "cae") => async () => {
    if (r === "cae") throw new Error("sin red");
    return { ok: r.ok, text: async () => r.texto };
  };
  assert.equal(await ultimaAgy(respuesta({ ok: true, texto: "Stable Version: 1.4.4. Rolled out to 100%" })), "1.4.4");
  assert.equal(await ultimaAgy(respuesta("cae")), null);
  assert.equal(await ultimaAgy(respuesta({ ok: false, texto: "" })), null);
  assert.equal(await ultimaAgy(respuesta({ ok: true, texto: "<html>" })), null);
});
