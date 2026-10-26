// "Hoy" del panel de consumo (electron/consumo.ts) y Estadísticas (el registro histórico, electron/historial.ts)
// con los mismos transcripts inventados en un tmp: para el mismo día dan el mismo total, en todo y por modelo.
// El caché escrito está en los dos, pero en ninguna de las cuentas. Los imports de src/ van sin extensión: un hook se las busca.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearConsumo } from "../electron/consumo.ts";
import { crearHistorial } from "../electron/historial.ts";

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

const { resumen } = await import("../src/datos/consumo.ts");
const { total } = await import("../src/datos/tokens.ts");
const { porFamilia } = await import("../src/paneles/historial-datos.ts");

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-hoy-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const casa = path.join(tmp, "casa");
const proyectos = path.join(tmp, "claude", "projects");
const paState = path.join(tmp, "pa");
const CWD = path.join(casa, "Proyectos", "atlas");

// Mediodía de hoy (siempre después de la medianoche de hoy) y de ayer.
const HOY = new Date();
HOY.setHours(12, 0, 0, 0);
const AYER = new Date(HOY);
AYER.setDate(AYER.getDate() - 1);
const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type U = [number, number, number, number];
const linea = (id: string, modelo: string, [i, c, r, o]: U, ms: number) =>
  JSON.stringify({
    type: "assistant",
    cwd: CWD,
    timestamp: new Date(ms).toISOString(),
    message: { id, model: modelo, content: [{ type: "text", text: "respuesta" }], usage: { input_tokens: i, cache_creation_input_tokens: c, cache_read_input_tokens: r, output_tokens: o } },
  }) + "\n";
function escribir(archivo: string, texto: string) {
  mkdirSync(path.dirname(archivo), { recursive: true });
  writeFileSync(archivo, texto);
}
const ms = HOY.getTime();

// Dos líderes (uno con una línea de ayer, que no entra en ninguna de las dos cuentas de hoy), dos workers de `pa`
// y un subagente de uno de ellos. Un modelo aparece en líder y en worker.
escribir(path.join(proyectos, "-tmp-atlas", "lider-a.jsonl"), linea("a0", "claude-opus-5-5", [1, 1, 1, 1], AYER.getTime()) + linea("a1", "claude-opus-5-5", [10, 200, 3000, 40], ms) + linea("a2", "claude-opus-5-5", [4, 0, 60, 6], ms + 1000));
escribir(path.join(proyectos, "-tmp-faro", "lider-b.jsonl"), linea("b1", "claude-fable-5-1", [5, 90, 100, 5], ms));
escribir(path.join(proyectos, "-tmp-wt-1", "sid-w1.jsonl"), linea("w1", "claude-sonnet-5-5", [2, 20, 200, 2], ms) + linea("w2", "claude-sonnet-5-5", [3, 0, 222, 3], ms));
escribir(path.join(proyectos, "-tmp-wt-1", "sid-w1", "subagents", "agent-1.jsonl"), linea("s1", "claude-haiku-5-5", [10, 5, 0, 10], ms));
escribir(path.join(proyectos, "-tmp-wt-2", "sid-w2.jsonl"), linea("x1", "claude-opus-5-5", [1, 0, 50, 1], ms));
escribir(path.join(paState, "atlas", "20260310-100000-111.sid"), "sid-w1");
escribir(path.join(paState, "atlas", "20260310-100100-222.sid"), "sid-w2");

const consumo = crearConsumo({ proyectos, paState, alCambiar: () => {} });
after(() => consumo.soltar());
const historial = crearHistorial({ proyectos, paState, carpeta: path.join(tmp, "estado", "historial"), claude: path.join(tmp, "claude"), casa });
after(() => historial.cerrar());

test("Hoy y Estadísticas dan el mismo total para el mismo día, en todo y por modelo", async () => {
  const c = await consumo.mirar({ lideres: ["lider-a", "lider-b"], workers: ["20260310-100000-111", "20260310-100100-222"] });
  const h = await historial.consultar(dia(HOY), dia(HOY));

  const hoy = resumen(c).lideres + resumen(c).workers;
  assert.ok(hoy > 0);
  assert.equal(porFamilia(h.modelos).total, hoy);
  for (const [modelo, s] of Object.entries(h.modelos))
    assert.equal(total(s), (c.lideres[modelo] ? total(c.lideres[modelo]) : 0) + (c.workers[modelo] ? total(c.workers[modelo]) : 0), modelo);

  // El caché escrito existe, y no entra en ninguna de las dos: sumado a lo de hoy, da los cuatro tipos.
  const escrito = Object.values(h.modelos).reduce((n, s) => n + s.cacheCreado, 0);
  const cuatro = [...Object.values(c.lideres), ...Object.values(c.workers)].reduce((n, s) => n + s.entrada + s.cacheCreado + s.cacheLeido + s.salida, 0);
  assert.ok(escrito > 0);
  assert.equal(hoy + escrito, cuatro);
});

test("ayer no entra en el día de hoy: la línea de ayer sí está en el registro, con su propia cuenta", async () => {
  const ayer = await historial.consultar(dia(AYER), dia(AYER));
  // entrada 1 + caché leído 1 + salida 1 (el caché escrito, 1, no suma).
  assert.equal(porFamilia(ayer.modelos).total, 3);
});
