import assert from "node:assert/strict";
import test from "node:test";
import { NOTA_WINDOWS, notaDePlataforma } from "../electron/nota-windows.ts";

test("la nota sale siempre", () => {
  assert.equal(notaDePlataforma("win32"), NOTA_WINDOWS);
  assert.equal(notaDePlataforma(), NOTA_WINDOWS);
});

test("la nota nombra PowerShell y prohíbe los comandos de Linux", () => {
  assert.match(NOTA_WINDOWS, /PowerShell/);
  assert.match(NOTA_WINDOWS, /NO Linux/);
  assert.match(NOTA_WINDOWS, /\$env:/);
});
