// Hook de resolución para los tests: src/ importa sin extensión ("../../electron/dictado-modelos") y Node no lo
// resuelve; en Windows tampoco acepta rutas absolutas "d:\…". Se carga con
// node --import ./scripts/resolver-ts.mjs --test --experimental-strip-types tests/x.test.ts
import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainThread } from "node:worker_threads";

if (isMainThread) register(import.meta.url);

export function resolve(spec, ctx, next) {
  if (/^[A-Za-z]:[\\/]/.test(spec)) return next(pathToFileURL(spec).href, ctx);
  if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
      if (existsSync(f)) return next(pathToFileURL(f).href, ctx);
  }
  return next(spec, ctx);
}
