// node --test tests/cli-tablero.test.ts  — el port a TypeScript (electron/cli/tablero.ts) hace lo mismo que el script de Python (motor/bin/tablero)
// Cada paso corre en los dos contra su propio tablero temporal y se compara salida, código y archivos (con las fechas normalizadas).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = path.resolve(import.meta.dirname, "../../motor/bin/tablero");
const TS = path.resolve(import.meta.dirname, "../electron/cli/tablero.ts");
const PYTHON = execFileSync("which", ["python3"], { encoding: "utf-8" }).trim();

const base = mkdtempSync(path.join(os.tmpdir(), "cli-tablero-"));
after(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" });
const repo = path.join(base, "proy-uno");
mkdirSync(repo);
git(repo, "init", "-q", "-b", "main");
writeFileSync(path.join(repo, "a.txt"), "x");
git(repo, "add", "a.txt");
git(repo, "commit", "-q", "-m", "primero");

type Lado = { dir: string; env: Record<string, string> };
function lado(nombre: string): Lado {
  const dir = path.join(base, nombre);
  mkdirSync(dir);
  const registry = path.join(dir, "registry.json");
  writeFileSync(registry, JSON.stringify({ projects: [{ name: "proy-uno", path: repo, estado: "activo" }, { name: "otro", path: path.join(base, "no-existe"), estado: "retirado" }] }));
  return {
    dir: path.join(dir, "tablero"),
    env: { PATH: process.env.PATH ?? "", HOME: dir, TABLERO_DIR: path.join(dir, "tablero"), PA_STATE: path.join(dir, "pa"), PROYECTOS_REGISTRY: registry, TZ: "UTC", LC_ALL: "C.UTF-8" },
  };
}

const norm = (s: string, l: Lado) =>
  s
    .split(l.dir.replace(/\/tablero$/, "")).join("<D>")
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(\+00:00|Z)/g, "<T>")
    .replace(/^usage:.*\n/gm, "")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<H>")
    .replace(/\(\d+(m|h|d|s)\)/g, "(<edad>)");

async function correr(cmd: string, args: string[], l: Lado, entrada?: string) {
  const p = run(cmd, args, { env: l.env, encoding: "utf-8" });
  if (entrada !== undefined) p.child.stdin?.end(entrada);
  else p.child.stdin?.end();
  try {
    const r = await p;
    return { rc: 0, out: norm(r.stdout, l), err: norm(r.stderr, l) };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { rc: x.code, out: norm(x.stdout, l), err: norm(x.stderr, l) };
  }
}

function archivos(l: Lado) {
  const r: Record<string, string> = {};
  const rec = (d: string, pre = "") => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.name === ".git") continue;
      if (f.isDirectory()) rec(path.join(d, f.name), pre + f.name + "/");
      else r[pre + f.name] = norm(readFileSync(path.join(d, f.name), "utf-8"), l);
    }
  };
  rec(l.dir);
  return r;
}

const py = lado("py");
const ts = lado("ts");
async function ambos(args: string[], entrada?: string) {
  const [a, b] = [await correr(PYTHON, [SCRIPT, ...args], py, entrada), await correr(process.execPath, [TS, ...args], ts, entrada)];
  assert.deepEqual(b, a, `tablero ${args.join(" ")}`);
  return b;
}

const pasos: string[][] = [
  ["init"],
  ["agregar", "Comprar pintura", "--proyecto", "casa"],
  ["agregar", "Sin proyecto"],
  ["agregar", "Con detalle", "--detalle", "linea 1\nlinea 2", "--columna", "sigue", "--proyecto", "proy-uno", "--origen", "pa", "--clave", "pa:1"],
  ["agregar", "Otra vez", "--clave", "pa:1", "--detalle", "nuevo"],
  ["agregar", "Pregunta", "--columna", "espera-dueno", "--proyecto", "proy-uno", "--simple", "¿Publico?", "--contexto", "ctx", "--opcion", "Sí", "--opcion", "No", "--defecto", "2"],
  ["agregar", "Probar", "--columna", "espera-dueno", "--proyecto", "proy-uno", "--prueba", "abrir Ajustes"],
  ["agregar", "Proyecto raro", "--proyecto", "zzz-no-existe"],
  ["agregar", "Columna mala", "--columna", "nada"],
  ["agregar", "Pospuesto", "--hasta", "+3d"],
  ["listar"],
  ["listar", "--json"],
  ["listar", "--todo"],
  ["listar", "--pospuestos"],
  ["listar", "--columna", "sigue,espera-dueno", "--proyecto", "proy-uno"],
  ["ver", "3"],
  ["ver", "4", "--json"],
  ["ver", "99"],
  ["ver"],
  ["mover", "1", "--columna", "en-curso"],
  ["mover", "2", "--proyecto", "personal", "--hasta", "mañana"],
  ["mover", "2", "--hasta", "ya"],
  ["mover", "99", "--columna", "hecho"],
  ["editar", "1", "--titulo", "Comprar pintura blanca", "--sumar", "ojo con el color"],
  ["editar", "4", "--opcion", "A", "--opcion", "B", "--opcion", "C", "--defecto", "b"],
  ["editar", "4", "--sin-opciones"],
  ["editar", "5", "--tipo", "pregunta", "--simple", ""],
  ["responder", "4", "--respuesta", "dale"],
  ["responder", "4", "--opcion", "1"],
  ["responder", "5", "--anda", "--nota", "andaba"],
  ["responder", "5", "--no-anda"],
  ["responder", "4", "--borrar"],
  ["responder", "1", "--anda", "--no-anda"],
  ["posponer", "1", "2", "+2s"],
  ["posponer", "1", "ya"],
  ["posponer", "1", "ayer-no-es-fecha"],
  ["sigue", "proy-uno", "Hacer el siguiente paso"],
  ["sigue", "proy-uno", "Otro paso", "--head", "abc1234"],
  ["sigue", "no-existe-ni-de-casualidad", "x"],
  ["ficha", "proy-uno"],
  ["ficha", "proy-uno", "--corta"],
  ["ficha", "proy-uno", "--json"],
  ["proyectos"],
  ["proyectos", "--retirados"],
  ["proyectos", "--json"],
  ["resumen"],
  ["resumen", "--max", "3"],
  ["resumen", "--json"],
  ["cerrar", "1", "--nota", "listo"],
  ["cerrar", "--clave", "pa:1"],
  ["cerrar", "--clave", "no-hay"],
  ["cerrar"],
  ["tirar", "3"],
  ["listar", "--todo", "--json"],
  ["hoy"],
  ["hoy", "--json"],
  ["archivar"],
  ["archivar", "--dias", "0"],
  ["listar", "--todo"],
  ["--help"],
  ["agregar", "--help"],
  ["nada"],
  [],
];

test("tablero: una sesión entera de comandos sale igual que con el script de Python", async () => {
  for (const p of pasos) {
    await ambos(p);
    // El estado en disco también tiene que coincidir después de cada paso que escribe.
    assert.deepEqual(archivos(ts), archivos(py), `archivos después de: tablero ${p.join(" ")}`);
  }
});

test("tablero: texto por archivo y por stdin", async () => {
  const f = path.join(base, "detalle.txt");
  writeFileSync(f, "desde archivo\ncon dos líneas\n");
  await ambos(["agregar", "Con archivo", "--detalle-archivo", f, "--prueba-archivo", f]);
  await ambos(["agregar", "Con stdin", "--detalle-archivo", "-"], "por stdin\n");
  await ambos(["editar", "99", "--sumar-archivo", f]);
  await ambos(["editar", String((await ambos(["listar", "--json"])).out.match(/"id": (\d+)/)?.[1] ?? 1), "--sumar-archivo", "/no/existe"]);
  assert.deepEqual(archivos(ts), archivos(py));
});
