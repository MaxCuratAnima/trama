// proyecto-ruta <nombre> — resuelve el nombre de un proyecto a su RUTA REAL canónica (port de motor/bin/proyecto-ruta).
//
//   proyecto-ruta omc        -> $HOME/omc
//   proyecto-ruta cartera    -> $HOME/cartera-usd   (match por substring)
//   proyecto-ruta --listar   -> nombres, uno por línea
//
// Misma salida y mismos códigos que el script de bash: 0 ok, 1 no se pudo resolver, 2 uso. Se resuelve a la ruta real y
// no al symlink de ~/Proyectos porque el cwd es la clave con la que Claude indexa la memoria de la sesión.
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rutaRegistry, type Env, type Plataforma } from "../plataforma.ts";

export type Resultado = { codigo: number; out: string; err: string };

type Proyecto = { name: string; path: string };

const ascii = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase()); // jq `ascii_downcase`

function leerProyectos(registry: string): Proyecto[] {
  const j = JSON.parse(readFileSync(registry, "utf-8"));
  const lista: unknown[] = Array.isArray(j?.projects) ? j.projects : [];
  return lista.filter((p): p is Proyecto => !!p && typeof p === "object" && typeof (p as Proyecto).name === "string").map((p) => ({ name: p.name, path: String(p.path ?? "null") }));
}

const esArchivo = (f: string) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
};

const nombres =(ps: Proyecto[]) => [...new Set(ps.map((p) => p.name))].sort();

export function resolver(args: string[], env: Env, plataforma: Plataforma = process.platform, home: string = os.homedir()): Resultado {
  const fin = (codigo: number, out = "", err = ""): Resultado => ({ codigo, out, err });
  const registry = rutaRegistry(plataforma, env, home);
  if (!esArchivo(registry)) return fin(1, "", `no existe el registry: ${registry}\n`);
  let ps: Proyecto[];
  try {
    ps = leerProyectos(registry);
  } catch {
    return fin(5, "", `proyecto-ruta: registry inválido: ${registry}\n`);
  }
  const listar = () => nombres(ps).map((n) => n + "\n").join("");

  if (args[0] === "--listar") return fin(0, listar());
  if (args.length !== 1) return fin(2, "", "uso: proyecto-ruta <nombre> | --listar\n");
  const sel = args[0];
  // un nombre vacío (una selección cancelada en el picker, una variable sin setear) no puede resolver al primero del registry
  if (!sel) return fin(2, "", "proyecto-ruta: nombre vacío\n");

  // match exacto primero, después exacto sin mayúsculas, después por substring
  const minus = sel.toLowerCase();
  let ruta = ps.find((p) => p.name === sel)?.path ?? ps.find((p) => ascii(p.name) === minus)?.path ?? "";
  if (!ruta) {
    // ambigüedad: falla y muestra los candidatos, en vez de apuntar al worker al proyecto equivocado
    const cands = ps.filter((p) => ascii(p.name).includes(minus));
    const rutasUnicas = new Set(cands.map((c) => c.path)).size; // varios nombres a la MISMA carpeta son alias, no ambigüedad
    if (cands.length > 1 && rutasUnicas > 1) {
      return fin(1, "", `proyecto-ruta: '${sel}' es ambiguo, hay ${cands.length} candidatos:\n${cands.map((c) => `  ${c.name}\t${c.path}\n`).join("")}usá el nombre exacto.\n`);
    }
    if (cands.length >= 1) ruta = cands[0].path;
  }
  if (!ruta) return fin(1, "", `no encontré '${sel}'. Proyectos:\n${listar()}`);

  if (ruta.startsWith("~")) ruta = home + ruta.slice(1);
  try {
    // el registry puede apuntar a un archivo (los proyectos de un solo script): voy a su carpeta
    if (statSync(ruta).isFile()) ruta = path.dirname(ruta);
  } catch {
    // no existe: lo dice el chequeo de abajo
  }
  try {
    ruta = realpathSync(ruta);
  } catch {
    ruta = path.resolve(ruta);
  }
  try {
    if (!statSync(ruta).isDirectory()) throw new Error();
  } catch {
    return fin(1, "", `la ruta no existe: ${ruta}\n`);
  }
  return fin(0, ruta + "\n");
}

function main() {
  const r = resolver(process.argv.slice(2), process.env as Env);
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exitCode = r.codigo;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
