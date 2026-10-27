// Archivos que no son imágenes a un líder: validación y guardado en el main
// (electron/archivos.ts) y el texto que lleva sus rutas (src/hilo/adjuntos.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archivoDe, guardarArchivo, nombreSeguro } from "../electron/archivos.ts";
import { ARCHIVO_MAX } from "../electron/imagenes.ts";
import { PREFIJOS_ADJUNTO, separarAdjuntos } from "../electron/adjunto.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";

const { agregarAdjuntos, archivosDe, imagenesDe, leerAdjuntos, prepararAdjunto, textoConArchivos } = await import("../src/hilo/adjuntos.ts");

const clave = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return String((e as Error).message).split("\u0001")[1];
  }
  return null;
};

test("nombreSeguro: sin carpetas, sin controles, sin punto inicial", () => {
  assert.equal(nombreSeguro("notas.md"), "notas.md");
  assert.equal(nombreSeguro("../../etc/passwd"), "passwd");
  assert.equal(nombreSeguro("a\\b\\c.txt"), "c.txt");
  assert.equal(nombreSeguro("..oculto"), "oculto");
  assert.equal(nombreSeguro("x\u0000y.pdf"), "xy.pdf");
  assert.equal(nombreSeguro(""), "archivo");
  assert.equal(nombreSeguro(".."), "archivo");
});

test("archivoDe: bytes y tope de tamaño", () => {
  assert.equal(clave(() => archivoDe({ nombre: "a.md", datos: "hola" })), "i18n:main.archivoRaro");
  assert.equal(clave(() => archivoDe(null)), "i18n:main.archivoRaro");
  assert.equal(clave(() => archivoDe({ nombre: "a.bin", datos: new Uint8Array(ARCHIVO_MAX + 1) })), "i18n:main.archivoGrande");
  assert.equal(archivoDe({ nombre: "a.md", datos: new Uint8Array(3) }).nombre, "a.md");
});

test("guardarArchivo: lo deja con su nombre en una carpeta propia y devuelve la ruta absoluta", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hilos-adjuntos-"));
  const datos = new TextEncoder().encode("# hola\n");
  const a = await guardarArchivo(dir, { nombre: "notas.md", datos });
  const b = await guardarArchivo(dir, { nombre: "notas.md", datos });
  assert.ok(path.isAbsolute(a));
  assert.equal(path.basename(a), "notas.md");
  assert.notEqual(a, b);
  assert.ok(a.startsWith(dir + path.sep));
  assert.equal(await readFile(a, "utf8"), "# hola\n");
});

test("caja: las imágenes van como imágenes, el resto como rutas al final del texto", async () => {
  const img = { tipo: "image/png", datos: "AAAA" };
  const md = { nombre: "notas.md", ruta: "/tmp/x/notas.md" };
  assert.equal(agregarAdjuntos("t", [img, md, { nombre: "b.pdf", ruta: "/tmp/y/b.pdf" }]), 0);
  const l = leerAdjuntos("t");
  assert.deepEqual(imagenesDe(l), [img]);
  assert.deepEqual(archivosDe(l).map((a) => a.ruta), ["/tmp/x/notas.md", "/tmp/y/b.pdf"]);
  const linea = (r: string) => `> ${r}`;
  assert.equal(textoConArchivos("hola", archivosDe(l), linea), "hola\n\n> /tmp/x/notas.md\n> /tmp/y/b.pdf");
  assert.equal(textoConArchivos("", [md], linea), "> /tmp/x/notas.md");
  assert.equal(textoConArchivos("hola", [], linea), "hola");

  // Un .md (o un SVG, que la API no toma como imagen) lo guarda `guardar`; uno de más de 25 MB, no.
  const guardados: string[] = [];
  const guardar = async (n: string) => (guardados.push(n), `/tmp/z/${n}`);
  const f = (nombre: string, tipo: string, size = 4) => ({ name: nombre, type: tipo, size, arrayBuffer: async () => new ArrayBuffer(size) }) as unknown as File;
  assert.deepEqual(await prepararAdjunto(f("leeme.md", "text/markdown"), guardar), { nombre: "leeme.md", ruta: "/tmp/z/leeme.md" });
  assert.deepEqual(await prepararAdjunto(f("logo.svg", "image/svg+xml"), guardar), { nombre: "logo.svg", ruta: "/tmp/z/logo.svg" });
  await assert.rejects(prepararAdjunto(f("enorme.bin", "", ARCHIVO_MAX + 1), guardar), (e: { grande?: string }) => e.grande === "enorme.bin");
  assert.deepEqual(guardados, ["leeme.md", "logo.svg"]);
});

test("las líneas de archivo de los diccionarios son las que reconoce separarAdjuntos", () => {
  for (const d of [en, es]) {
    const l = d["adjunto.linea"];
    assert.ok(l.endsWith("{ruta}") && (PREFIJOS_ADJUNTO as readonly string[]).includes(l.slice(0, -"{ruta}".length)), l);
  }
});

test("separarAdjuntos: el globo muestra el texto sin las rutas, y los archivos aparte", () => {
  const [en0, es0] = PREFIJOS_ADJUNTO;
  const md = { nombre: "diagnostico-sistema.md", ruta: "/home/ana/.local/state/hilos/adjuntos/1a2b/diagnostico-sistema.md" };
  const pdf = { nombre: "b.pdf", ruta: "/tmp/y/b.pdf" };
  // Ida y vuelta con lo que arma la caja, en los dos idiomas.
  for (const p of PREFIJOS_ADJUNTO) {
    const linea = (r: string) => p + r;
    assert.deepEqual(separarAdjuntos(textoConArchivos("hola\n\nchau", [md, pdf], linea)), { texto: "hola\n\nchau", archivos: [md, pdf] });
    assert.deepEqual(separarAdjuntos(textoConArchivos("", [md], linea)), { texto: "", archivos: [md] });
  }
  // Mezclados (un transcript de antes de cambiar el idioma).
  assert.deepEqual(separarAdjuntos(`mirá\n\n${en0}${md.ruta}\n${es0}${pdf.ruta}`).archivos, [md, pdf]);
  // Sin archivos, o una línea así en el medio del texto: el texto queda igual.
  assert.deepEqual(separarAdjuntos("hola  \n"), { texto: "hola  \n", archivos: [] });
  const medio = `${es0}${md.ruta}\nesto es lo que dice`;
  assert.deepEqual(separarAdjuntos(medio), { texto: medio, archivos: [] });
  // Sin ruta absoluta no es una línea de archivo.
  assert.deepEqual(separarAdjuntos(`${en0}notas.md`).archivos, []);
});
