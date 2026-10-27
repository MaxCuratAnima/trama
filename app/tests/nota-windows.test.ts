import assert from "node:assert/strict";
import test from "node:test";
import { NOTA_WINDOWS, notaDePlataforma } from "../electron/nota-windows.ts";

test("la nota de Windows sólo sale en win32", () => {
  assert.equal(notaDePlataforma("win32"), NOTA_WINDOWS);
  assert.equal(notaDePlataforma("linux"), "");
  assert.equal(notaDePlataforma("darwin"), "");
});

test("la nota nombra PowerShell y prohíbe los comandos de Linux", () => {
  assert.match(NOTA_WINDOWS, /PowerShell/);
  assert.match(NOTA_WINDOWS, /NO Linux/);
  assert.match(NOTA_WINDOWS, /\$env:/);
});
