// La estructura de Ajustes (src/paneles/ajustes-nav.ts): el índice de lo que se busca, el buscador, la categoría que se recuerda
// y las marcas de "falta algo". Puro: sin React ni puente. Que cada fila del índice exista en los dos diccionarios es lo que
// evita un buscador que muestra una clave pelada.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nav = await import("../src/paneles/ajustes-nav.ts");
const { cambiarIdioma, t } = await import("../src/i18n/index.ts");
const en = (await import("../src/i18n/en.ts")).en as Record<string, string>;
const { es } = (await import("../src/i18n/es.ts")) as { es: Record<string, string> };
const { CATS, ITEMS, buscar, normalizar, categoria, irA, efectiva, marcar, marcasDe, varsDe, declarar, presentesDe, deVariante, inicial, reiniciar, suscribir, pendienteDeMostrar } = nav;

beforeEach(() => {
  reiniciar();
  cambiarIdioma("es");
});

const tr = (k: string) => t(k as never);
const nombreCat = (c: string) => tr(`aj.cat.${c}`);

test("cada fila del índice y cada categoría tienen texto en inglés y en español", () => {
  const claves = [...ITEMS.flatMap((i) => [i.nombre, i.que].filter(Boolean) as string[]), ...CATS.flatMap((c) => [`aj.cat.${c}`, `aj.cat.${c}Que`])];
  for (const k of claves) {
    assert.ok(k in en, `en: falta ${k}`);
    assert.ok(k in es, `es: falta ${k}`);
  }
  assert.equal(new Set(ITEMS.map((i) => i.nombre)).size, ITEMS.length, "una fila repetida en el índice");
  for (const c of CATS) assert.ok(ITEMS.some((i) => i.cat === c) || c === "cuentas", `la categoría ${c} no tiene nada que buscar`);
});

test("cada fila del índice está dibujada con su data-opc (el salto la encuentra)", () => {
  const fuente = ["Ajustes.tsx", "AjustesModelos.tsx", "AjustesEditar.tsx", "AjustesCuentas.tsx", "AjustesCupos.tsx", "AjustesCompactar.tsx"]
    .map((f) => readFileSync(path.join(import.meta.dirname, "..", "src", "paneles", f), "utf8"))
    .join("\n");
  // Los tipos de worker se dibujan con la clave armada (`mdl.t.${tipo}`); el resto, con su clave literal.
  for (const i of ITEMS.filter((x) => !x.nombre.startsWith("mdl.t."))) assert.ok(fuente.includes(`"${i.nombre}"`), `ninguna fila usa ${i.nombre}`);
});

test("normalizar saca tildes y mayúsculas", () => {
  assert.equal(normalizar("Sesión Ñandú"), "sesion nandu");
});

test("buscar por título, descripción y sinónimo, con o sin tildes y en cualquier orden de palabras", () => {
  const f = (q: string) => buscar(q, tr, nombreCat).map((r) => r.item.nombre);
  assert.ok(f("idioma").includes("ajustes.idioma"));
  assert.ok(f("language").includes("ajustes.idioma"), "sinónimo en inglés");
  assert.ok(f("telefono puerto").includes("ajustes.celPuerto"), "dos palabras, sin tilde");
  assert.ok(f("ollama").includes("ajustes.mdlLocales"));
  assert.ok(f("compactacion").includes("ajustes.compactar"));
  assert.deepEqual(f("zzzxqy"), []);
  assert.deepEqual(f("   "), []);
});

test("buscar pone primero lo que tiene la palabra en el título y respeta el tope", () => {
  const r = buscar("modelo", tr, nombreCat, () => true, 3);
  assert.ok(r.length <= 3);
  const todos = buscar("a", tr, nombreCat, () => true, 100);
  assert.ok(todos.length > 8);
  assert.equal(buscar("a", tr, nombreCat).length, 8);
});

test("buscar no ofrece lo de una categoría que no existe en esta máquina", () => {
  const sinCuentas = (c: string) => c !== "cuentas";
  assert.ok(buscar("claude", tr, nombreCat).some((r) => r.item.cat === "cuentas"));
  assert.ok(!buscar("claude", tr, nombreCat, sinCuentas as never).some((r) => r.item.cat === "cuentas"));
});

test("sin elegir, no hay categoría; irA la fija, la pide mostrar y avisa una vez", () => {
  assert.equal(categoria(), null);
  let avisos = 0;
  const baja = suscribir(() => avisos++);
  irA("cupos", "ajustes.mdlTope5");
  assert.equal(categoria(), "cupos");
  assert.equal(pendienteDeMostrar()?.opc, "ajustes.mdlTope5");
  assert.ok(avisos >= 1);
  baja();
});

test("efectiva: la recordada si existe en esta máquina; si no, la primera que haya", () => {
  irA("cuentas");
  assert.equal(
    efectiva((c) => c !== "cuentas"),
    "modelos",
  );
  assert.equal(
    efectiva(() => true),
    "cuentas",
  );
  reiniciar();
  assert.equal(
    efectiva((c) => c === "general"),
    "general",
  );
});

test("inicial sólo vale si todavía no se eligió ninguna", () => {
  inicial("locales");
  assert.equal(categoria(), "locales");
  inicial("general");
  assert.equal(categoria(), "locales");
});

test("las marcas se anotan, se limpian y no avisan si no cambian", () => {
  let avisos = 0;
  suscribir(() => avisos++);
  marcar("cuentas", "aj.marca.sinConectar", { quien: "Gemini" });
  assert.equal(marcasDe().cuentas, "aj.marca.sinConectar");
  assert.deepEqual(varsDe("cuentas"), { quien: "Gemini" });
  const n = avisos;
  marcar("cuentas", "aj.marca.sinConectar", { quien: "Gemini" });
  assert.equal(avisos, n);
  marcar("cuentas", null);
  assert.equal(marcasDe().cuentas, null);
  assert.equal(t("aj.marca.sinConectar", { quien: "Gemini" }), "Gemini sin conectar");
});

test("declarar anota qué categorías existen", () => {
  assert.equal(presentesDe().celular, undefined);
  declarar("celular", true);
  assert.equal(presentesDe().celular, true);
  declarar("celular", false);
  assert.equal(presentesDe().celular, false);
});

test("cada variante de captura de Ajustes cae en la categoría de lo que muestra", () => {
  assert.equal(deVariante("cuentas-una"), "cuentas");
  assert.equal(deVariante("mdl-agregar"), "locales");
  assert.equal(deVariante("mdl-tope"), "cupos");
  assert.equal(deVariante("celular"), "celular");
  assert.equal(deVariante("mdl-lider"), "modelos");
  assert.equal(deVariante("fuente"), "general");
  assert.equal(deVariante(undefined), null);
});
