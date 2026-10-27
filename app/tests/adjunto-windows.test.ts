import assert from "node:assert/strict";
import test from "node:test";
import { PREFIJOS_ADJUNTO, separarAdjuntos } from "../electron/adjunto.ts";

test("separarAdjuntos: reconoce las rutas de Windows (C:\… y UNC) y las de Linux", () => {
  const [p] = PREFIJOS_ADJUNTO;
  const r = separarAdjuntos(["hola", p + String.raw`C:\Users\Ana\adjuntos\foto final.png`, p + String.raw`\\pc\share\b.pdf`, p + "/tmp/c.md"].join("\n"));
  assert.equal(r.texto, "hola");
  assert.deepEqual(r.archivos.map((a) => a.nombre), ["foto final.png", "b.pdf", "c.md"]);
});

test("separarAdjuntos: una línea que no es una ruta se queda en el texto", () => {
  const [p] = PREFIJOS_ADJUNTO;
  assert.equal(separarAdjuntos(`hola\n${p}relativa.txt`).archivos.length, 0);
});
