// Las líneas que lleva un mensaje a un líder por cada archivo adjunto (B26):
// `adjunto.linea` de los diccionarios, una por ruta, al final del texto
// (`textoConArchivos` en src/hilo/adjuntos.ts). Claude las recibe tal cual; la
// app las saca para mostrar el mensaje (chips con el nombre) y para el título
// del líder. Se reconocen las dos, sea cual sea el idioma de ahora: un
// transcript viejo puede traer cualquiera. Puro: lo prueba tests/archivos.test.ts
// (que también mira que sigan iguales a los diccionarios).

/** Cómo empieza la línea de un archivo, en cada idioma: después va la ruta. */
export const PREFIJOS_ADJUNTO = ["Attached file (read it with Read): ", "Archivo adjunto (leelo con Read): "] as const;

export type ArchivoAdjunto = { nombre: string; ruta: string };

/** La ruta de una línea de archivo; `null` si no es una. */
function rutaDe(linea: string): string | null {
  const p = PREFIJOS_ADJUNTO.find((x) => linea.startsWith(x));
  const ruta = p ? linea.slice(p.length).trim() : "";
  return ruta.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ruta) || ruta.startsWith("\\\\") ? ruta : null;
}

/** El texto sin las líneas de archivo del final, y los archivos que nombraban (en orden). */
export function separarAdjuntos(texto: string): { texto: string; archivos: ArchivoAdjunto[] } {
  const lineas = texto.trimEnd().split("\n");
  const archivos: ArchivoAdjunto[] = [];
  for (let ruta = rutaDe(lineas.at(-1) ?? ""); ruta !== null; ruta = rutaDe(lineas.at(-1) ?? "")) {
    lineas.pop();
    archivos.unshift({ nombre: ruta.split(/[\\/]/).pop() || ruta, ruta });
  }
  return archivos.length ? { texto: lineas.join("\n").trimEnd(), archivos } : { texto, archivos };
}
