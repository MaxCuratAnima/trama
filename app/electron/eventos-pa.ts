// Lo que dice `eventos.jsonl` de `pa`, línea por línea: arranque, fin, parar, integrar…
// La lista (`pa --hilos`) tarda ~11 s, el evento llega al instante: con él la barra pinta
// "Arrancando…" y "frenado" sin esperarla. Sin imports locales: lo prueba `tests/eventos-pa.test.ts`.

/** Una línea de `eventos.jsonl`. `proyecto` es el slug (como en la lista); `ts`, epoch en segundos. */
export type EventoPa = { tipo: string; id: string; proyecto: string; ts: number; jefe_id?: string; jefe?: string | null };

/** Las líneas buenas de un trozo de `eventos.jsonl` (lo que no es JSON o no trae id y tipo se descarta). */
export function eventosDe(texto: string): EventoPa[] {
  const out: EventoPa[] = [];
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    try {
      const e = JSON.parse(linea);
      if (typeof e?.id === "string" && typeof e.tipo === "string")
        out.push({
          tipo: e.tipo,
          id: e.id,
          proyecto: typeof e.proyecto === "string" ? e.proyecto : "",
          ts: typeof e.ts === "number" ? e.ts : 0,
          // Hoy `pa` no lo escribe en el evento: lo completa el main (`jefeDeCorrida`). Si `pa` lo trae, vale.
          ...(typeof e.jefe_id === "string" && e.jefe_id ? { jefe_id: e.jefe_id, jefe: typeof e.jefe === "string" ? e.jefe : null } : {}),
        });
    } catch (e) {
      // una línea a medias (la última, mientras `pa` escribe) es normal; una rota de verdad se avisa
      if (linea.trim() && i < lineas.length - 1) console.error(`[eventos-pa] línea ilegible en eventos.jsonl: ${(e as Error).message}`);
    }
  }
  return out;
}

/** id → cuándo lo frenó `pa --parar` (epoch s). */
export type Frenados = Record<string, number>;

/** Tope de lo que se recuerda: no crece sin fin si nunca se poda. */
const MAX_FRENADOS = 500;

/** Suma los `parar` de una tanda. Devuelve los de ahora, o `null` si no cambió nada. */
export function sumarFrenados(antes: Readonly<Frenados>, eventos: readonly EventoPa[]): Frenados | null {
  let nuevos: Frenados | null = null;
  for (const e of eventos) {
    if (e.tipo !== "parar" || antes[e.id] === e.ts) continue;
    (nuevos ??= { ...antes })[e.id] = e.ts;
  }
  if (!nuevos) return null;
  const ids = Object.keys(nuevos);
  if (ids.length > MAX_FRENADOS) for (const id of ids.sort((a, b) => nuevos![a] - nuevos![b]).slice(0, ids.length - MAX_FRENADOS)) delete nuevos[id];
  return nuevos;
}

/**
 * Se queda con los frenados que la lista muestra como vivos o muertos: lo que se integró,
 * archivó o descartó deja de importar. Devuelve los de ahora, o `null` si no cambió nada.
 */
export function podarFrenados(antes: Readonly<Frenados>, hilos: readonly { id: string; estado: string }[]): Frenados | null {
  const visto = new Map(hilos.map((h) => [h.id, h.estado]));
  const quedan: Frenados = {};
  for (const [id, ts] of Object.entries(antes)) {
    const e = visto.get(id);
    // Lo que la lista todavía no nombra se queda: puede ser un worker que se frenó antes de aparecer.
    if (e === undefined || e === "murio" || e === "trabajando" || e === "colgado") quedan[id] = ts;
  }
  return Object.keys(quedan).length === Object.keys(antes).length ? null : quedan;
}
