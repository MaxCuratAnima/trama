import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Los tokens de diseño (docs/estado/tokens.md): ningún var() apunta a un token que no existe (el CSS
// lo tomaría como inválido sin avisar) y los archivos ya pasados a tokens no vuelven a tener literales.
const raiz = path.resolve(import.meta.dirname, "..");

const archivos = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p, ext) : ext.test(n) ? [p] : [];
  });

test("cada var(--x) sin valor de reserva está definido en un CSS o lo pone el código", () => {
  const css = archivos(path.join(raiz, "src"), /\.css$/).map((f) => readFileSync(f, "utf8"));
  const codigo = archivos(path.join(raiz, "src"), /\.tsx?$/).map((f) => readFileSync(f, "utf8")).join("\n");
  const definidos = new Set(css.flatMap((s) => [...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
  for (const s of css) {
    for (const m of s.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
      if (m[2] === ",") continue;
      assert.ok(definidos.has(m[1]) || codigo.includes(`"${m[1]}"`), `${m[1]} no está definido`);
    }
  }
});

test("los CSS ya pasados a tokens no tienen literales", () => {
  const hechos = [
    "src/index.css",
    "src/paneles/tablero-estilos.css",
    "src/paneles/paneles.css",
    "src/paneles/pendientes.css",
    "src/paneles/consumo-estilos.css",
  ];
  const salida = execFileSync(process.execPath, [path.join(raiz, "scripts/tokens-faltan.mjs"), "--resumen", ...hechos], {
    cwd: raiz,
    encoding: "utf8",
  });
  for (const f of hechos) assert.match(salida, new RegExp(`^${f.replace(/[./]/g, "\\$&")}: 0$`, "m"), salida);
});
