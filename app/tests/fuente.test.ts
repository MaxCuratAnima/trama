// src/datos/fuente.ts con un `window.hilos` falso: lo que hace con lo que
// contesta `pa --hilos`. Los imports de src/ van sin extensión (los resuelve
// Vite): acá un hook de resolución les busca el `.ts`. `window` y `location`
// van antes del import (puente.ts y modo.ts los leen al cargar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `pa --hilos` contesta un JSON sin `version`.
const leer = async () => ({ n: 1, datos: { hilos: [] } });
const sinSoltar = () => () => {};
Object.assign(globalThis, {
  location: { search: "?fixtures=0" },
  window: { hilos: { hilos: { leer, guardados: async () => null, alCambiar: sinSoltar, alEvento: sinSoltar } } },
});

const { fuente } = await import("../src/datos/fuente.ts");
const { t } = await import("../src/i18n/index.ts");

test("pa --hilos sin version: el error previsto, también al volver a pedir", async () => {
  await assert.rejects(fuente.hilos(), { message: t("error.sinVersion") });
  await assert.rejects(fuente.hilos(), { message: t("error.sinVersion") });
});
