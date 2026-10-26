// Lo que Estadísticas saca de una consulta del historial (src/paneles/historial-datos.ts). Los imports de src/ van
// sin extensión (los resuelve Vite): acá un hook les busca el `.ts` (como en tests/fuente.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Consulta, PiezaConsulta } from "../src/datos/paneles.ts";

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
Object.assign(globalThis, { location: { search: "?fixtures=0" }, window: {} });

const { arranque, cargadas, porFamilia, total, usadas } = await import("../src/paneles/historial-datos.ts");
const { historialFalso, MEDICION } = await import("../src/datos/fixtures-paneles.ts");
const { resumir } = await import("../src/paneles/resumen.ts");

const ROLES = ["lider", "worker", "subagente"] as const;
const pieza = (clase: PiezaConsulta["clase"], nombre: string, peso: number): PiezaConsulta => ({ clase, nombre, sesiones: 1, chars: 1, peso, pesoPorTurnos: 0, despues: 0, usos: null, ganchos: 0, origen: null });
const base = (piezas: PiezaConsulta[], exacto: number): Consulta => ({ ...historialFalso(7), piezas, arranque: { sesiones: 2, tokens: exacto } });

test("el arranque por categoría: la skill de un plugin no se cuenta dos veces", () => {
  const a = arranque(
    base(
      [
        pieza("sistema", "sistema", 100),
        pieza("herramientas", "herramientas", 300),
        pieza("claudemd", "~/CLAUDE.md", 50),
        pieza("skill", "faro:norte", 30),
        pieza("skill", "suelta", 20),
        pieza("plugin", "faro", 40), // 30 de su skill + 10 de un hook
        pieza("hook", "notas", 5),
        pieza("mcp", "correo", 25),
        pieza("agentes", "agentes", 7),
      ],
      1000,
    ),
  );
  assert.deepEqual(a.partes, { sistema: 400, claudemd: 50, skills: 50, plugins: 15, mcp: 25, otros: 7 });
  assert.equal(a.sinDesglosar, 1000 - 547);
  assert.deepEqual([a.exacto, a.sesiones], [1000, 2]);
});

test("el arranque: si las estimaciones pasan al exacto, no hay desglose negativo", () => {
  assert.equal(arranque(base([pieza("sistema", "sistema", 900)], 500)).sinDesglosar, 0);
});

test("modelos juntados en familias", () => {
  const s = (n: number) => ({ entrada: n, cacheCreado: n, cacheLeido: n, salida: n });
  const r = porFamilia({ "claude-opus-5-5": s(1), "claude-sonnet-5-5": s(2), "raro-1": s(3) });
  assert.deepEqual(r.familias, { Opus: 3, Sonnet: 6, Fable: 0, otro: 9 });
  assert.equal(r.total, 18);
  assert.equal(total(s(1)), 3); // el caché escrito no suma: `medicion.tsv` no lo trae
});

test("las dos cifras de tokens de Estadísticas cuentan lo mismo: \"Tokens\" (medicion.tsv) y la fila Workers del registro", () => {
  assert.ok(MEDICION.version === 1 && !("error" in MEDICION));
  const corridas = "corridas" in MEDICION ? MEDICION.corridas : [];
  for (const dias of [7, 30] as const) {
    const arriba = resumir(corridas, dias, Date.now() / 1000, null).tokens;
    const c = historialFalso(dias);
    const abajo = porFamilia(c.roles.worker.modelos).total;
    assert.ok(arriba > 0);
    assert.equal(abajo, arriba);
    // Por modelo también (la leyenda de "Tokens por modelo" y la del registro).
    const fam = porFamilia(c.roles.worker.modelos).familias;
    for (const p of resumir(corridas, dias, Date.now() / 1000, null).porModelo) assert.equal(fam[p.familia], p.tokens);
    // El total del registro es la suma de los tres roles, y el caché escrito no entra en ninguna cuenta.
    assert.equal(porFamilia(c.modelos).total, ROLES.reduce((n, r) => n + porFamilia(c.roles[r].modelos).total, 0));
  }
  // Una corrida de `pa` anota entrada + caché leído + salida: lo mismo que cuenta el registro de ese uso.
  const uso = { entrada: 12, cacheCreado: 1_688, cacheLeido: 61_872, salida: 642 };
  assert.equal(total(uso), uso.entrada + uso.cacheLeido + uso.salida);
});

test("el historial inventado: la skill que se carga siempre y nunca se usa está, con uso 0", () => {
  for (const dias of [7, 30] as const) {
    const c = historialFalso(dias);
    const p = c.piezas.find((x) => x.nombre === "pdf-forms");
    assert.deepEqual([p?.usos, p?.sesiones], [0, c.sesiones]);
  }
});

test("cargado y sin usar: lo nunca usado arriba, por peso; el CLAUDE.md no cuenta como sin usar", () => {
  const p = (clase: PiezaConsulta["clase"], nombre: string, peso: number, usos: number | null, sesiones = 3): PiezaConsulta => ({ ...pieza(clase, nombre, peso), sesiones, usos });
  const lista = cargadas(
    base([p("skill", "chica", 10, 0), p("claudemd", "~/CLAUDE.md", 500, null), p("skill", "grande", 90, 0), p("mcp", "correo", 300, 4), p("skill", "afuera", 5, 7, 0), p("hook", "notas", 99, null), p("sistema", "sistema", 999, null)], 1000),
  );
  assert.deepEqual(lista.map((x) => [x.pieza.nombre, x.sinUsar]), [["grande", true], ["chica", true], ["~/CLAUDE.md", false], ["correo", false]]);
});

test("un plugin cuyos hooks corrieron actúa por ganchos: no es sin usar ni sale arriba, y su skill sin uso sí", () => {
  const p = (clase: PiezaConsulta["clase"], nombre: string, peso: number, usos: number | null, ganchos = 0): PiezaConsulta => ({ ...pieza(clase, nombre, peso), sesiones: 3, usos, ganchos });
  const lista = cargadas(base([p("plugin", "caveman", 900, 0, 36), p("skill", "caveman:compacto", 20, 0), p("skill", "pdf-forms", 50, 0)], 1000));
  assert.deepEqual(lista.map((x) => [x.pieza.nombre, x.sinUsar]), [["pdf-forms", true], ["caveman:compacto", true], ["caveman", false]]);
});

test("el historial inventado: caveman, un plugin de hooks sin invocaciones, actúa por ganchos y no es sin usar", () => {
  for (const rol of [undefined, "lider", "worker"] as const) {
    const p = cargadas(historialFalso(7, rol)).find((x) => x.pieza.nombre === "caveman");
    assert.ok(p, "caveman sale en la lista");
    assert.deepEqual([p.pieza.usos, p.pieza.ganchos > 0, p.sinUsar], [0, true, false]);
  }
});

test("el historial inventado: pdf-forms sale primero y marcada, también filtrado por rol", () => {
  for (const rol of [undefined, "lider", "worker"] as const) {
    const c = historialFalso(7, rol);
    assert.equal(c.rol, rol ?? null);
    const [primera, ...resto] = cargadas(c);
    assert.deepEqual([primera.pieza.nombre, primera.sinUsar], ["pdf-forms", true]);
    assert.ok(resto.every((x, i) => !x.sinUsar || resto.slice(0, i).every((y) => y.sinUsar)), "las sin usar van juntas arriba");
  }
  assert.equal(historialFalso(7, "worker").sesiones, historialFalso(7).roles.worker.sesiones);
});

test("lo usado: skills, MCP y subagentes con su conteo, de mayor a menor, sin los de 0", () => {
  const c = historialFalso(7);
  const u = usadas(c);
  assert.deepEqual(u.skills.map((x) => x[0]), ["simplify", "code-review", "frontend-design:frontend-design"]);
  assert.deepEqual(u.mcp, [["tablero", 21]]);
  assert.deepEqual(u.subagentes, [["Explore", 14]]);
  assert.ok(!u.skills.some((x) => x[0] === "pdf-forms"));
});
