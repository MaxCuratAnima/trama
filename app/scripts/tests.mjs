// npm test: corre tests/*.test.ts (o los archivos que se le pasen) con node --test. En Windows `node --test tests/` no
// anda y PowerShell no expande globs, así que la lista se arma acá.
// uso: node scripts/tests.mjs [tests/x.test.ts …]
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pedidos = process.argv.slice(2);
const archivos = pedidos.length
  ? pedidos
  : readdirSync(path.join(raiz, "tests"))
      .filter((f) => f.endsWith(".test.ts"))
      .sort()
      .map((f) => path.join("tests", f));

const r = spawnSync(process.execPath, ["--test", "--experimental-strip-types", ...archivos], { cwd: raiz, stdio: "inherit" });
process.exit(r.status ?? 1);
