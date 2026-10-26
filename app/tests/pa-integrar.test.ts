// pa en TypeScript: --integrar, --descartar y --archivar contra un repo git real en un directorio temporal. Fixtures con el
// formato real de ~/.local/state/pa; los códigos de salida son los de `motor/bin/pa` (75, 79, 80, 86, 92).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextoReal, type CtxPa } from "../electron/cli/contexto.ts";
import { textoCorrida, textoHilo, textoRunning } from "../electron/cli/estado-archivos.ts";
import { main } from "../electron/cli/pa.ts";

const SLUG = "demo";
const ID = "20261026-010101-111";
const RAMA = `pa/${SLUG}/${ID}`;

// el rebase de pa-integrar hereda el entorno: sin identidad de git (CI, máquina limpia) no puede commitear
Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const escribir = (ruta: string, texto: string) => (mkdirSync(path.dirname(ruta), { recursive: true }), writeFileSync(ruta, texto));

type Salida = { out: string; err: string };
/** Un repo `demo` con un commit, una rama de worker con un commit sobre archivo propio y su estado de pa. */
function armar(opciones: { ramaToca?: string } = {}) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-integrar-"));
  const estado = path.join(raiz, "estado");
  const repo = path.join(raiz, "demo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  escribir(path.join(repo, "base.txt"), "base\n");
  escribir(path.join(repo, "compartido.txt"), "uno\n");
  git(repo, "add", "."), git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", RAMA);
  const wt = path.join(estado, "worktrees", SLUG);
  mkdirSync(path.dirname(wt), { recursive: true });
  git(repo, "worktree", "add", "-q", "--detach", wt, "HEAD");
  git(wt, "checkout", "-q", RAMA);
  escribir(path.join(wt, opciones.ramaToca ?? "nuevo.txt"), "del worker\n");
  git(wt, "add", "."), git(wt, "commit", "-qm", "trabajo del worker");
  git(wt, "checkout", "-q", "--detach");
  const dir = path.join(estado, SLUG);
  escribir(path.join(dir, `${ID}.corrida`), textoCorrida({ ruta_trabajo: wt, rama: RAMA, base, proyecto: SLUG, origen: "", leer: 0, puesto: 1, jefe: "j", jefe_id: "j1" }));
  escribir(path.join(dir, `${ID}.hilo`), textoHilo({ tarea: "t", modelo: "m", effort: "high", inicio: 1, proyecto: SLUG, ruta_trabajo: wt, rama: RAMA, origen: "", leer: 0, puesto: 1, lanzo: "j", jefe: "j", jefe_id: "j1", tipo: "codigo-acotado" } as never));
  escribir(path.join(raiz, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: SLUG, path: repo }] }));
  const salida: Salida = { out: "", err: "" };
  const real = contextoReal({ HOME: raiz, PA_STATE: estado } as never, "linux");
  const ctx: CtxPa = {
    ...real, estado, home: raiz, env: { HOME: raiz, PA_STATE: estado }, offsetSeg: () => 0,
    rutaDeSlug: (s) => (s === SLUG ? repo : null), out: (s) => void (salida.out += s), err: (s) => void (salida.err += s),
  };
  return { raiz, repo, wt, dir, estado, ctx, salida, base, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

test("--integrar: la rama entra por ff al tree principal, se borra y queda en integradas.tsv", async () => {
  const a = armar();
  try {
    assert.equal(await main([SLUG, "--integrar", ID], a.ctx), 0, a.salida.err);
    assert.match(a.salida.out, /integrada pa\/demo\/.* en main de 'demo' \(1 commit\(s\)\)/);
    assert.equal(readFileSync(path.join(a.repo, "nuevo.txt"), "utf8"), "del worker\n");
    assert.equal(git(a.repo, "branch", "--list", RAMA), "");
    assert.equal(existsSync(path.join(a.dir, `${ID}.corrida`)), false);
    const fila = readFileSync(path.join(a.estado, "integradas.tsv"), "utf8").split("\n")[1].split("\t");
    assert.deepEqual([fila[1], fila[2], fila[3], fila[4], fila[7], fila[9]], [ID, SLUG, RAMA, "main", "1", "integrada"]);
    // repetirlo no es un error: ya está en integradas.tsv
    a.salida.out = "";
    assert.equal(await main([SLUG, "--integrar", ID], a.ctx), 0);
    assert.match(a.salida.out, /ya integrada/);
  } finally {
    a.limpiar();
  }
});

test("--integrar: con main adelantado rebasea la rama y entra", async () => {
  const a = armar();
  try {
    escribir(path.join(a.repo, "otro.txt"), "main avanzó\n");
    git(a.repo, "add", "otro.txt"), git(a.repo, "commit", "-qm", "main avanza");
    assert.equal(await main([SLUG, "--integrar", ID], a.ctx), 0, a.salida.err);
    assert.equal(git(a.repo, "rev-list", "--count", "HEAD"), "3");
    assert.equal(existsSync(path.join(a.repo, "nuevo.txt")), true);
    assert.equal(git(a.repo, "status", "--porcelain"), "");
  } finally {
    a.limpiar();
  }
});

test("--integrar: un choque en el rebase da 80 y no toca el tree principal ni la rama", async () => {
  const a = armar({ ramaToca: "compartido.txt" });
  try {
    escribir(path.join(a.repo, "compartido.txt"), "dos\n");
    git(a.repo, "commit", "-qam", "main toca lo mismo");
    const head = git(a.repo, "rev-parse", "HEAD");
    assert.equal(await main([SLUG, "--integrar", ID], a.ctx), 80);
    assert.match(a.salida.err, /conflictos/);
    assert.equal(git(a.repo, "rev-parse", "HEAD"), head);
    assert.notEqual(git(a.repo, "branch", "--list", RAMA), "");
    assert.equal(git(a.wt, "status", "--porcelain"), "");
  } finally {
    a.limpiar();
  }
});

test("--integrar: sin commitear en el tree principal algo que la rama toca da 79", async () => {
  const a = armar({ ramaToca: "compartido.txt" });
  try {
    escribir(path.join(a.repo, "compartido.txt"), "cambio a mano\n");
    assert.equal(await main([SLUG, "--integrar", ID], a.ctx), 79);
    assert.match(a.salida.err, /compartido\.txt/);
    assert.equal(readFileSync(path.join(a.repo, "compartido.txt"), "utf8"), "cambio a mano\n");
  } finally {
    a.limpiar();
  }
});

test("--integrar: la corrida que dejó trabajo sin commitear en su worktree da 86", async () => {
  const a = armar();
  try {
    git(a.wt, "checkout", "-q", RAMA);
    escribir(path.join(a.wt, "sin-commit.txt"), "x\n");
    assert.equal(await main([SLUG, "--integrar", ID], a.ctx), 86);
    assert.match(a.salida.err, /SIN COMMITEAR/);
    assert.equal(existsSync(path.join(a.repo, "nuevo.txt")), false);
  } finally {
    a.limpiar();
  }
});

test("--integrar: espera el candado de git y entra apenas lo sueltan", async () => {
  const a = armar();
  try {
    const { tomarCandado } = await import("../electron/cli/candado.ts");
    const c = await tomarCandado(path.join(a.estado, "lock", `${SLUG}@git`));
    assert.ok(c);
    const corrida = main([SLUG, "--integrar", ID], a.ctx);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(existsSync(path.join(a.repo, "nuevo.txt")), false);
    await c.soltar();
    assert.equal(await corrida, 0, a.salida.err);
    assert.equal(existsSync(path.join(a.repo, "nuevo.txt")), true);
  } finally {
    a.limpiar();
  }
});

test("--descartar: borra la rama, anota 'descartada' y se niega (92) con la corrida viva", async () => {
  const a = armar();
  try {
    const running = path.join(a.estado, `${SLUG}.running`);
    escribir(running, textoRunning({ pid: process.pid, pa_pid: "", inicio: 1, proyecto: SLUG, id: ID, puesto: 1 }));
    assert.equal(await main(["--descartar", ID], a.ctx), 92);
    assert.notEqual(git(a.repo, "branch", "--list", RAMA), "");
    rmSync(running, { force: true });
    assert.equal(await main([SLUG, "--descartar", ID], a.ctx), 0, a.salida.err);
    assert.equal(git(a.repo, "branch", "--list", RAMA), "");
    assert.match(readFileSync(path.join(a.estado, "integradas.tsv"), "utf8"), /\tdescartada\n$/);
    assert.equal(existsSync(path.join(a.dir, `${ID}.corrida`)), false);
  } finally {
    a.limpiar();
  }
});

test("--archivar: marca el .hilo con archivado= y no toca la rama", async () => {
  const a = armar();
  try {
    assert.equal(await main(["--archivar", ID], a.ctx), 0, a.salida.err);
    assert.match(readFileSync(path.join(a.dir, `${ID}.hilo`), "utf8"), /^archivado=\d{4}-\d\d-\d\dT/m);
    assert.notEqual(git(a.repo, "branch", "--list", RAMA), "");
    assert.equal(await main(["--archivar"], a.ctx), 2);
  } finally {
    a.limpiar();
  }
});
