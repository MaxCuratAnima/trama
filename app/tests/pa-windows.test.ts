// pa en Windows: --estado con varios workers vivos, --modelos (qué modelo sale de modelos.json), `--archivo-tarea` y el shim pa.cmd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsearArgs } from "../electron/cli/args.ts";
import { contextoReal, type CtxPa } from "../electron/cli/contexto.ts";
import { textoRunning } from "../electron/cli/estado-archivos.ts";
import { leerModelos, resolverPolitica } from "../electron/cli/lanzar-politica.ts";
import { main, tareaDeArchivo } from "../electron/cli/pa.ts";
import { AYUDA } from "../electron/cli/pa-ayuda.ts";
import { cmdModelos, filasDeModelos } from "../electron/cli/pa-modelos.ts";

const ahora = Math.floor(Date.now() / 1000);
type Salida = { out: string; err: string };
function armar(env: Record<string, string> = {}) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-win-"));
  const estado = path.join(raiz, "estado");
  mkdirSync(estado, { recursive: true });
  const salida: Salida = { out: "", err: "" };
  const e = { HOME: raiz, PA_STATE: estado, PA_PROJ: path.join(raiz, "proy"), PA_CLAUDE_SETTINGS: path.join(raiz, "no-hay.json"), ...env };
  const real = contextoReal(e as never, "linux");
  const ctx: CtxPa = {
    ...real, estado, home: raiz, env: e, offsetSeg: () => 0, rutaDeSlug: () => null, ramasPa: () => [], commitsSobre: () => "",
    out: (s) => void (salida.out += s), err: (s) => void (salida.err += s),
  };
  return { raiz, ctx, salida, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}
const escribir = (ruta: string, texto: string) => (mkdirSync(path.dirname(ruta), { recursive: true }), writeFileSync(ruta, texto));

test("--estado: tres workers vivos de un mismo proyecto (puestos 1, 2, 3) salen los tres como CORRIENDO", async () => {
  const a = armar();
  try {
    // el puesto 1 ya tiene claude (pid); el 2 y el 3 recién escribieron su .running y todavía preparan el worktree (sólo pa_pid)
    const base = { inicio: ahora - 30, proyecto: "trama", ruta: "/x/trama", leer: 0, tarea: "algo" };
    escribir(path.join(a.ctx.estado, "trama.running"), textoRunning({ ...base, pid: process.pid, pa_pid: process.pid, id: "20261026-100001-1", puesto: 1 }));
    escribir(path.join(a.ctx.estado, "trama@2.running"), textoRunning({ ...base, pid: "", pa_pid: process.pid, id: "20261026-100002-2", puesto: 2 }));
    escribir(path.join(a.ctx.estado, "trama@3.running"), textoRunning({ ...base, pid: "", pa_pid: process.pid, id: "20261026-100003-3", puesto: 3 }));
    assert.equal(await main(["--estado"], a.ctx), 0, a.salida.err);
    assert.equal((a.salida.out.match(/^CORRIENDO /gm) ?? []).length, 3, a.salida.out);
    for (const n of [1, 2, 3]) assert.match(a.salida.out, new RegExp(`puesto ${n} \\(id: 20261026-10000${n}-${n}\\)`));
  } finally {
    a.limpiar();
  }
});

const MODELOS = {
  version: 1,
  workers: { default: { modelo: "claude-sonnet-5-5", effort: "medium" }, mecanico: { modelo: "claude-haiku-5-5", effort: "low" }, debug: { modelo: "claude-opus-5-5", effort: "high" } },
  excluir: ["fable"],
};

test("modelo sin -m: sale de modelos.json workers.<tipo>, si no workers.default, y sin archivo del default de pa", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pa-mod-"));
  try {
    const f = path.join(dir, "modelos.json");
    writeFileSync(f, JSON.stringify(MODELOS));
    const a = armar({ TRAMA_MODELOS: f });
    const base = { modelo: "", esfuerzo: "", esfuerzoFlag: false, leer: false, seguir: false, okDueno: false, plan: "pro" as const, effortSettings: "", dueno: "" };
    // el módulo lee el archivo por leerModelos; acá se lo damos ya leído igual que lo hace lanzar
    {
      const m = leerModelos(f);
      assert.ok(m && !("error" in m), JSON.stringify(m));
      const d = (tipo: string) => resolverPolitica({ ...base, tipo, modelos: m });
      assert.deepEqual(d("mecanico"), { modelo: "claude-haiku-5-5", esfuerzo: "low", deModelosJson: true });
      assert.deepEqual(d("debug"), { modelo: "claude-opus-5-5", esfuerzo: "high", deModelosJson: true });
      assert.deepEqual(d("frontend"), { modelo: "claude-sonnet-5-5", esfuerzo: "medium", deModelosJson: true }); // sin workers.frontend: workers.default
      const sin = resolverPolitica({ ...base, tipo: "mecanico", modelos: null });
      assert.deepEqual(sin, { modelo: "claude-haiku-5-5", esfuerzo: "xhigh", deModelosJson: false });
      const sinTipo = resolverPolitica({ ...base, tipo: "", modelos: null });
      assert.deepEqual(sinTipo, { modelo: "claude-sonnet-5-5", esfuerzo: "high", deModelosJson: false });
      a.limpiar();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--modelos: la tabla dice el modelo, el effort y de dónde sale cada tipo; --json trae lo mismo", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pa-mod-"));
  try {
    const f = path.join(dir, "modelos.json");
    writeFileSync(f, JSON.stringify({ ...MODELOS, lider: { modelo: "claude-opus-5-5", effort: "high" } }));
    const a = armar({ TRAMA_MODELOS: f });
    const deps = { cupos: async () => [{ suscripcion: "Claude", ventana: "5h", pct: 12 }], sondear: async () => "ok" };
    assert.equal(await cmdModelos(a.ctx, [], deps), 0, a.salida.err);
    assert.match(a.salida.out, /^archivo: .*modelos\.json$/m);
    assert.match(a.salida.out, /^líder: claude-opus-5-5 effort high$/m);
    assert.match(a.salida.out, /^mecanico +claude-haiku-5-5 +low +modelos\.json \(workers\.mecanico\)$/m);
    assert.match(a.salida.out, /^frontend +claude-sonnet-5-5 +medium +modelos\.json \(workers\.default\)$/m);
    assert.match(a.salida.out, /excluir: fable/);
    assert.match(a.salida.out, /Claude +5h +12%/);
    a.salida.out = "";
    assert.equal(await cmdModelos(a.ctx, ["--json"], deps), 0);
    const j = JSON.parse(a.salida.out) as { workers: Record<string, { modelo: string; effort: string; origen: string }>; excluir: string[]; valido: boolean };
    assert.equal(j.valido, true);
    assert.deepEqual(j.excluir, ["fable"]);
    assert.equal(j.workers.mecanico.modelo, "claude-haiku-5-5");
    assert.equal(j.workers.debug.effort, "high");
    assert.equal(j.workers.final.origen, "modelos.json (workers.default)");
    // por el despacho de pa.ts también (sin cupos: no se pudo leer, pero no rompe)
    a.salida.out = "";
    assert.equal(await main(["--modelos", "--json"], { ...a.ctx }), 0, a.salida.err);
    assert.equal((JSON.parse(a.salida.out) as { valido: boolean }).valido, true);
    assert.equal(await cmdModelos(a.ctx, ["--raro"], deps), 2);
    a.limpiar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--modelos: sin modelos.json muestra los defaults de pa; con uno roto lo dice y no lo usa", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pa-mod-"));
  try {
    const deps = { cupos: async () => null };
    const sin = armar({ TRAMA_MODELOS: path.join(dir, "no-existe.json") });
    assert.equal(await cmdModelos(sin.ctx, [], deps), 0);
    assert.match(sin.salida.out, /no existe: modelos de siempre/);
    assert.match(sin.salida.out, /^mecanico +claude-haiku-5-5 +xhigh +default de pa$/m);
    assert.match(sin.salida.out, /^default +claude-sonnet-5-5 +high +default de pa$/m);
    assert.match(sin.salida.out, /cupo: sin dato/);
    const f = path.join(dir, "roto.json");
    writeFileSync(f, "{ no es json");
    const roto = armar({ TRAMA_MODELOS: f });
    assert.equal(await cmdModelos(roto.ctx, [], deps), 0);
    assert.match(roto.salida.out, /inválido: no es JSON válido; no se usa/);
    assert.equal(filasDeModelos(null, "pro", "").length, 9); // default + los 8 tipos
    sin.limpiar();
    roto.limpiar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--ayuda: lista lo que este pa hace (--modelos, --archivo-tarea) y no promete lo que no", async () => {
  const a = armar();
  try {
    assert.equal(await main(["--ayuda"], a.ctx), 0);
    assert.equal(a.salida.out, AYUDA);
    assert.match(AYUDA, /pa --modelos \[--json\]/);
    assert.match(AYUDA, /--archivo-tarea <ruta>/);
    assert.doesNotMatch(AYUDA, /--traspaso|--limpiar|--matar|--ramas/);
    assert.doesNotMatch(AYUDA, /opus effort medium por default/);
  } finally {
    a.limpiar();
  }
});

test("--archivo-tarea: la tarea de varias líneas se lee entera (sin BOM ni salto final) y un archivo que falta da 2", async () => {
  const a = armar();
  try {
    const f = path.join(a.raiz, "tarea.txt");
    writeFileSync(f, "﻿linea uno\r\nlinea dos\r\nlinea tres\r\n");
    assert.equal(tareaDeArchivo(f), "linea uno\r\nlinea dos\r\nlinea tres");
    const r = parsearArgs(["trama", "--archivo-tarea", f, "--async"]);
    assert.ok(r.clase === "proyecto" && r.opciones.archivoTarea === f && r.opciones.async && r.opciones.tarea === "");
    assert.equal(await main(["trama", "--archivo-tarea", path.join(a.raiz, "no-hay.txt")], a.ctx), 2);
    assert.match(a.salida.err, /no pude leer --archivo-tarea/);
  } finally {
    a.limpiar();
  }
});

test("pa.cmd: cmd.exe corta un argumento en el primer salto de línea; --archivo-tarea llega entero por el shim", { skip: process.platform !== "win32" && "sólo en Windows" }, () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-shim-"));
  try {
    // una copia mínima del repo: motor\bin-win con los shims reales y un cli\pa.js que imprime los argumentos que le llegan
    const bin = path.join(raiz, "motor", "bin-win");
    mkdirSync(bin, { recursive: true });
    for (const n of ["pa.cmd", "_trama-cli.cmd"]) copyFileSync(path.resolve(import.meta.dirname, "../../motor/bin-win", n), path.join(bin, n));
    escribir(path.join(raiz, "app", "dist-electron", "cli", "pa.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    const corre = (...args: string[]) => {
      const r = spawnSync(path.join(bin, "pa.cmd"), args, { encoding: "utf8", shell: true, windowsHide: true });
      return JSON.parse(r.stdout || "[]") as string[];
    };
    // la limitación: con un salto de línea el argumento (y todo lo que sigue) se pierde ANTES de que pa.cmd lo vea
    assert.notDeepEqual(corre("trama", "uno\ndos\ntres"), ["trama", "uno\ndos\ntres"]);
    // el camino que anda: la tarea va por archivo y por la línea de comandos viaja sólo la ruta
    const f = path.join(raiz, "mi-tarea.txt");
    writeFileSync(f, "uno\ndos\ntres\n");
    assert.deepEqual(corre("trama", "--archivo-tarea", f, "--async"), ["trama", "--archivo-tarea", f, "--async"]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
