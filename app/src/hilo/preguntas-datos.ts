// AskUserQuestion en la vista: lo que el usuario va eligiendo en cada pregunta, la
// respuesta que se le manda al líder (pregunta → texto, como la terminal: varias
// opciones unidas con ", ", "Otro" con lo escrito) y, ya contestada, lo que se
// eligió leído del tool_result. Puro: lo prueba `tests/preguntas.test.ts`.
import type { Pregunta } from "../datos/contrato";

export const HERRAMIENTA_PREGUNTAS = "AskUserQuestion";

/** Lo elegido en una pregunta: etiquetas y, si se abrió "Otro", lo escrito (`null`: cerrado). */
export type Eleccion = { elegidas: string[]; otro: string | null };

export const NADA: Eleccion = { elegidas: [], otro: null };

/** Clic en una opción: en una de una sola, la reemplaza (y cierra "Otro"); en multiSelect, prende o apaga. */
export function alternar(q: Pregunta, e: Eleccion, label: string): Eleccion {
  if (!q.multiSelect) return { elegidas: [label], otro: null };
  const ya = e.elegidas.includes(label);
  return { ...e, elegidas: ya ? e.elegidas.filter((x) => x !== label) : [...e.elegidas, label] };
}

/** Clic en "Otro": en una de una sola, saca la opción elegida; en multiSelect se suma a las elegidas. */
export function alternarOtro(q: Pregunta, e: Eleccion): Eleccion {
  if (e.otro !== null) return { ...e, otro: null };
  return q.multiSelect ? { ...e, otro: "" } : { elegidas: [], otro: "" };
}

export const escribirOtro = (e: Eleccion, texto: string): Eleccion => ({ ...e, otro: texto });

/** El texto de una respuesta: las etiquetas en el orden de las opciones y, al final, "Otro". "" si no hay nada. */
export function respuesta(q: Pregunta, e: Eleccion | undefined): string {
  const x = e ?? NADA;
  const partes = q.options.map((o) => o.label).filter((l) => x.elegidas.includes(l));
  const otro = x.otro?.trim();
  if (otro) partes.push(otro);
  return partes.join(", ");
}

/** Todas tienen algo: recién ahí se puede mandar. */
export const completo = (qs: readonly Pregunta[], es: readonly (Eleccion | undefined)[]) => qs.every((q, i) => respuesta(q, es[i]) !== "");

/** Las `answers` para el líder: pregunta → respuesta. */
export function armar(qs: readonly Pregunta[], es: readonly (Eleccion | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  qs.forEach((q, i) => (out[q.question] = respuesta(q, es[i])));
  return out;
}

/** Una pregunta ya contestada, para el resumen. */
export type Respondida = { header: string; question: string; respuesta: string };

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);

/** Las preguntas de la entrada de la llamada (las que importan para leer el resultado). */
function preguntasDeEntrada(entrada: Record<string, unknown> | undefined): { question: string; header: string }[] {
  const qs = entrada?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.flatMap((q) => {
    const question = str(q?.question);
    return question ? [{ question, header: str(q?.header) ?? "" }] : [];
  });
}

/** Lo que sigue a la última respuesta en el tool_result del CLI. */
const FIN = /"\.\s+(?:Read the answers|You can now)/;

/**
 * Lo elegido, leído del tool_result de AskUserQuestion (`The user answered:
 * "P1"="R1", "P2"="R2". Read the answers…`). Las comillas de adentro no se
 * escapan: se busca cada `"pregunta"="` de la entrada, y la respuesta va hasta la
 * marca siguiente o el final. El resultado puede llegar recortado por adelante
 * (la cola): la pregunta que no aparece no está. Ninguna → `null`.
 */
export function respondidas(entrada: Record<string, unknown> | undefined, texto: string | null | undefined): Respondida[] | null {
  if (!texto) return null;
  const marcas = preguntasDeEntrada(entrada)
    .map((q) => ({ ...q, en: texto.indexOf(`"${q.question}"="`) }))
    .filter((m) => m.en >= 0)
    .sort((a, b) => a.en - b.en);
  if (!marcas.length) return null;
  return marcas.map((m, k) => {
    const desde = m.en + m.question.length + 4;
    const sig = marcas[k + 1];
    let hasta: number;
    if (sig) hasta = texto.slice(sig.en - 3, sig.en) === '", ' ? sig.en - 3 : sig.en;
    else {
      const f = texto.slice(desde).search(FIN);
      hasta = f >= 0 ? desde + f : Math.max(desde, texto.lastIndexOf('"'));
    }
    return { header: m.header, question: m.question, respuesta: texto.slice(desde, Math.max(desde, hasta)) };
  });
}

/** El renglón de la llamada: "Color: Red · Frutas: Apple, Pear". */
export const resumenRespondidas = (rs: readonly Respondida[]) => rs.map((r) => (r.header ? `${r.header}: ${r.respuesta}` : r.respuesta)).join(" · ");

/**
 * Las tandas de preguntas pendientes, en el orden en que llegaron: se muestran de a una (la más vieja
 * primero) y al contestarla aparece la siguiente. Los pedidos de permiso que no son preguntas no entran.
 */
export const tandasPendientes = <T extends { preguntas: Pregunta[] | null }>(pide: readonly T[]): (T & { preguntas: Pregunta[] })[] =>
  pide.filter((p): p is T & { preguntas: Pregunta[] } => !!p.preguntas?.length);
