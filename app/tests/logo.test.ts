import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monograma, PALETA, tono } from "../src/barra/logo-datos.ts";
import { candidatos, iconoDe, iconosDe, LUGARES } from "../electron/iconos.ts";

test("monograma: dos letras de una palabra, iniciales de dos", () => {
  assert.equal(monograma("atlas"), "At");
  assert.equal(monograma("atlas-web"), "AW");
  assert.equal(monograma("Atlas Web"), "AW");
  assert.equal(monograma("SpaceLens"), "SL");
  assert.equal(monograma("ana.corp"), "AC");
  assert.equal(monograma("x"), "X");
  assert.equal(monograma("ñandú"), "Ña");
  assert.equal(monograma("--"), "·");
});

test("el tono es de la paleta y siempre el mismo para el mismo nombre", () => {
  assert.equal(PALETA.length, 10);
  assert.equal(tono("atlas"), tono("Atlas"));
  assert.ok((PALETA as readonly string[]).includes(tono("brote")));
  const usados = new Set(["atlas", "brote", "cauce", "dique", "estela", "faro", "gruta", "hebra"].map(tono));
  assert.ok(usados.size >= 4, "ocho nombres distintos no caen todos en los mismos tonos");
});

test("candidatos: primero el del registry, después los lugares fijos", () => {
  const c = candidatos({ ruta: "/p/atlas", icono: "docs/marca.png" });
  assert.equal(c[0], "/p/atlas/docs/marca.png");
  assert.equal(c.length, LUGARES.length + 1);
  assert.equal(candidatos({ ruta: "/p/atlas", icono: "~/iconos/atlas.svg" })[0], path.join(os.homedir(), "iconos/atlas.svg"));
  assert.equal(candidatos({ ruta: "/p/atlas", icono: "/abs/a.png" })[0], "/abs/a.png");
  assert.equal(candidatos({ ruta: "/p/atlas", icono: null }).length, LUGARES.length);
});

test("iconoDe: lee el primero que exista y lo devuelve como data URL", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hilos-iconos-"));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  assert.equal(await iconoDe({ ruta: dir, icono: null }), null);

  await mkdir(path.join(dir, "public"));
  await writeFile(path.join(dir, "public", "favicon.svg"), svg);
  await writeFile(path.join(dir, "logo.png"), "no importa");
  assert.equal(await iconoDe({ ruta: dir, icono: null }), `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);

  // El del registry gana; los PNG pasan por el achicador.
  await writeFile(path.join(dir, "marca.png"), "png");
  assert.equal(await iconoDe({ ruta: dir, icono: "marca.png" }, (b) => `achicado:${b.length}`), "achicado:3");
  // Uno que no se pudo leer como imagen no corta la búsqueda.
  await writeFile(path.join(dir, "rota.png"), "png");
  assert.match((await iconoDe({ ruta: dir, icono: "rota.png" }, () => null)) ?? "", /^data:image\/svg/);
  // Ni una extensión rara, ni uno que no existe.
  assert.match((await iconoDe({ ruta: dir, icono: "package.json" })) ?? "", /^data:image\/svg/);

  assert.deepEqual(Object.keys(await iconosDe([{ slug: "con", ruta: dir, icono: null }, { slug: "sin", ruta: path.join(dir, "nada"), icono: null }])), ["con"]);
});
