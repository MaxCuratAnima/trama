// Agrupar los chats por carpeta (ruta completa normalizada), nombres desambiguados y orden por última actividad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorCarpeta, claveCarpeta, nombresDeCarpetas, rutaProyecto } from "../electron/historial-parser.ts";

const CASA = "C:\\Users\\MaxCu";

test("Windows: la misma carpeta con otras mayúsculas o con / es el mismo grupo", () => {
  assert.equal(claveCarpeta("C:\\Trama\\Atlas", CASA), claveCarpeta("c:/trama/atlas", CASA));
});

test("un worktree de pa (@N) cae en la carpeta del proyecto", () => {
  assert.equal(claveCarpeta("C:\\wt\\faro@12", CASA), claveCarpeta("C:\\wt\\faro", CASA));
  assert.equal(rutaProyecto("C:\\wt\\faro@12", CASA), "C:\\wt\\faro");
});

test("la carpeta del usuario es ~ en Windows y en Linux", () => {
  assert.equal(claveCarpeta("C:/Users/MaxCu/", CASA), "~");
  assert.equal(rutaProyecto("/home/ana", "/home/ana"), "~");
});

test("dos carpetas con el mismo nombre se distinguen por el padre", () => {
  const n = nombresDeCarpetas(new Map([["a", "C:\\proy\\app\\atlas"], ["b", "D:\\otro\\atlas"], ["c", "C:\\proy\\faro"]]));
  assert.deepEqual([n.get("a"), n.get("b"), n.get("c")], ["app/atlas", "otro/atlas", "faro"]);
});

test("si el padre también choca, sube hasta distinguirlas", () => {
  const n = nombresDeCarpetas(new Map([["a", "C:\\a\\p\\atlas"], ["b", "D:\\a\\p\\atlas"]]));
  assert.deepEqual([n.get("a"), n.get("b")], ["C:/a/p/atlas", "D:/a/p/atlas"]);
});

test("chats dentro de cada carpeta por última actividad; carpetas por la más reciente", () => {
  const g = agruparPorCarpeta(
    [
      { cwd: "C:\\p\\atlas", fin: 100, id: "a1" },
      { cwd: "c:\\P\\Atlas", fin: 300, id: "a2" },
      { cwd: "C:\\p\\faro", fin: 200, id: "f1" },
      { cwd: "", fin: 999, id: "x" },
    ],
    CASA,
  );
  assert.deepEqual(g.map((x) => x.nombre), ["atlas", "faro"]);
  assert.deepEqual(g[0].chats.map((c) => c.id), ["a2", "a1"]);
  assert.equal(g[0].ultimo, 300);
});
