// "Ir a la ventana" (electron/terminal.ts): en Windows no se puede ubicar la ventana de un proceso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { irA, ubicar } from "../electron/terminal.ts";

test("ubicar da null e irA da false: no hay ventana a la que ir", async () => {
  assert.equal(await ubicar(process.pid), null);
  assert.equal(await irA(process.pid), false);
});
