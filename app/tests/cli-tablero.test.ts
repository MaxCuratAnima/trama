// node --test tests/cli-tablero.test.ts — el CLI `tablero` (electron/cli/tablero.ts) de punta a punta contra un tablero temporal
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TS = path.resolve(import.meta.dirname, "../electron/cli/tablero.ts");

const base = mkdtempSync(path.join(os.tmpdir(), "cli-tablero-"));
after(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" });
const repo = path.join(base, "proy-uno");
mkdirSync(repo);
git(repo, "init", "-q", "-b", "main");
writeFileSync(path.join(repo, "a.txt"), "x");
git(repo, "add", "a.txt");
git(repo, "commit", "-q", "-m", "primero");

const registry = path.join(base, "registry.json");
writeFileSync(registry, JSON.stringify({ projects: [{ name: "proy-uno", path: repo, estado: "activo" }, { name: "otro", path: path.join(base, "no-existe"), estado: "retirado" }] }));
const dirTablero = path.join(base, "tablero");
const env = {
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
  USERPROFILE: base,
  TABLERO_DIR: dirTablero,
  PA_STATE: path.join(base, "pa"),
  PROYECTOS_REGISTRY: registry,
  TZ: "UTC",
};

async function tablero(args: string[], entrada?: string) {
  const p = run(process.execPath, [TS, ...args], { env, encoding: "utf-8" });
  p.child.stdin?.end(entrada ?? "");
  try {
    const r = await p;
    return { rc: 0, out: r.stdout, err: r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { rc: x.code, out: x.stdout, err: x.stderr };
  }
}
const ok = async (args: string[], entrada?: string) => {
  const r = await tablero(args, entrada);
  assert.equal(r.rc, 0, `tablero ${args.join(" ")}: ${r.err}`);
  return r.out;
};
const items = async (...extra: string[]) => JSON.parse(await ok(["listar", "--json", "--todo", ...extra])) as { id: number; columna: string; proyecto: string; titulo: string; detalle: string; respuesta?: { texto?: string } | null; hasta: string | null }[];

test("tablero: init crea la carpeta y agregar da el id", async () => {
  assert.equal((await ok(["init"])).trim(), dirTablero);
  assert.equal(existsSync(dirTablero), true);
  assert.equal((await ok(["agregar", "Comprar pintura", "--proyecto", "casa"])).trim(), "1");
  assert.equal((await ok(["agregar", "Pregunta", "--columna", "espera-dueno", "--proyecto", "proy-uno", "--simple", "¿Publico?", "--contexto", "ctx", "--opcion", "Sí", "--opcion", "No", "--defecto", "2"])).trim(), "2");
  assert.equal((await ok(["agregar", "Probar", "--columna", "espera-dueno", "--proyecto", "proy-uno", "--prueba", "abrir Ajustes"])).trim(), "3");
});

test("tablero: listar, ver y listar --json", async () => {
  const l = await ok(["listar"]);
  assert.match(l, /^1 +bandeja +casa +Comprar pintura/m);
  assert.match(l, /^2 +espera-dueno +proy-uno +Pregunta/m);
  const v = await ok(["ver", "2"]);
  assert.match(v, /titulo_simple: ¿Publico\?/);
  assert.match(v, /b\) No {2}\(por defecto\)/);
  const todos = await items();
  assert.deepEqual(todos.map((i) => i.id), [1, 2, 3]);
  assert.equal((await tablero(["ver", "99"])).rc, 1);
  assert.match((await tablero(["ver", "99"])).err, /no hay item 99/);
});

test("tablero: clave repetida actualiza, columna mala sale con 2", async () => {
  await ok(["agregar", "Con detalle", "--detalle", "linea 1\nlinea 2", "--columna", "sigue", "--proyecto", "proy-uno", "--origen", "pa", "--clave", "pa:1"]);
  const antes = (await items()).length;
  await ok(["agregar", "Otra vez", "--clave", "pa:1", "--detalle", "nuevo"]);
  assert.equal((await items()).length, antes, "la misma clave no suma un item");
  const mala = await tablero(["agregar", "Columna mala", "--columna", "nada"]);
  assert.equal(mala.rc, 2);
  assert.match(mala.err, /^tablero: error: argument --columna: invalid choice: 'nada'/);
});

test("tablero: mover, editar, responder y cerrar", async () => {
  await ok(["mover", "1", "--columna", "en-curso"]);
  assert.equal((await items()).find((i) => i.id === 1)?.columna, "en-curso");
  await ok(["editar", "1", "--titulo", "Comprar pintura blanca", "--sumar", "ojo con el color"]);
  const i1 = (await items()).find((i) => i.id === 1)!;
  assert.equal(i1.titulo, "Comprar pintura blanca");
  assert.match(i1.detalle, /ojo con el color/);
  assert.match(await ok(["responder", "2", "--opcion", "1"]), /respuesta: a\) Sí/);
  await ok(["responder", "3", "--anda", "--nota", "andaba"]);
  assert.match(await ok(["cerrar", "1", "--nota", "listo"]), /^1 +hecho/);
  assert.equal((await tablero(["mover", "99", "--columna", "hecho"])).rc, 1);
});

test("tablero: posponer oculta del listado y --pospuestos lo muestra", async () => {
  const id = (await ok(["agregar", "Pospuesto", "--hasta", "+3d"])).trim();
  assert.doesNotMatch(await ok(["listar"]), /Pospuesto/);
  assert.match(await ok(["listar", "--pospuestos"]), /Pospuesto/);
  await ok(["posponer", id, "ya"]);
  assert.match(await ok(["listar"]), /Pospuesto/);
  assert.notEqual((await tablero(["posponer", id, "ayer-no-es-fecha"])).rc, 0);
});

test("tablero: sigue, ficha, proyectos, resumen, hoy y archivar", async () => {
  await ok(["sigue", "proy-uno", "Hacer el siguiente paso"]);
  assert.match(await ok(["ficha", "proy-uno"]), /Hacer el siguiente paso/);
  assert.match(await ok(["proyectos"]), /proy-uno/);
  assert.doesNotMatch(await ok(["proyectos"]), /otro/);
  assert.match(await ok(["proyectos", "--retirados"]), /otro/);
  JSON.parse(await ok(["proyectos", "--json"]));
  assert.ok(JSON.parse(await ok(["resumen", "--json"])).espera_dueno);
  await ok(["hoy"]);
  await ok(["tirar", "3"]);
  assert.equal((await items()).find((i) => i.id === 3)?.columna, "tirado");
  await ok(["archivar", "--dias", "0"]);
});

test("tablero: texto por archivo y por stdin", async () => {
  const f = path.join(base, "detalle.txt");
  writeFileSync(f, "desde archivo\ncon dos líneas\n");
  const a = (await ok(["agregar", "Con archivo", "--detalle-archivo", f, "--prueba-archivo", f])).trim();
  const b = (await ok(["agregar", "Con stdin", "--detalle-archivo", "-"], "por stdin\n")).trim();
  const todos = await items();
  assert.match(todos.find((i) => String(i.id) === a)!.detalle, /desde archivo\ncon dos líneas/);
  assert.match(todos.find((i) => String(i.id) === b)!.detalle, /por stdin/);
  assert.notEqual((await tablero(["editar", a, "--sumar-archivo", path.join(base, "no-existe.txt")])).rc, 0);
});

test("tablero: --help lista los comandos y sale con 0; sin comando, 2", async () => {
  const r = await tablero(["--help"]);
  assert.equal(r.rc, 0);
  for (const c of ["agregar", "listar", "resumen", "archivar", "init"]) assert.match(r.out, new RegExp(`^  ${c} `, "m"));
  assert.equal((await tablero([])).rc, 2);
});
