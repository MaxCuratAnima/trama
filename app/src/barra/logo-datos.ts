// El logo de una carpeta cuando el proyecto no tiene ícono propio: un
// monograma de una o dos letras sobre un tono que sale del nombre (siempre el
// mismo para el mismo proyecto). Sin React: lo prueban los tests.

/** Diez tonos medios que se leen sobre negro puro, con letra oscura encima. */
export const PALETA = [
  "#e5786d", // coral
  "#e0975c", // naranja
  "#d2b356", // ocre
  "#9fbf5f", // lima
  "#5fbf8a", // verde
  "#52b8b0", // turquesa
  "#5aa9dc", // celeste
  "#7f93ea", // azul lavanda
  "#a984e2", // violeta
  "#dd7fb4", // rosa
] as const;

/** FNV-1a de 32 bits: parejo con nombres cortos y parecidos ("atlas", "atlas-web"). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const tono = (nombre: string): string => PALETA[hash(nombre.toLowerCase()) % PALETA.length];

/**
 * "atlas" → "At", "atlas-web" → "AW", "SpaceLens" → "SL", "x" → "X". Dos
 * palabras (separadas por guion, punto, espacio o mayúscula) dan sus iniciales;
 * una sola, sus dos primeras letras.
 */
export function monograma(nombre: string): string {
  const palabras = nombre
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (palabras.length === 0) return "·";
  if (palabras.length === 1) {
    const [a, b = ""] = [...palabras[0]];
    return a.toUpperCase() + b.toLowerCase();
  }
  return ([...palabras[0]][0] + [...palabras[1]][0]).toUpperCase();
}
