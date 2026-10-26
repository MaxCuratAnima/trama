// La conversación de `pa --hilo` como la muestra la vista: cada pedido de
// El usuario y, por cada tanda seguida de mensajes del worker, un turno con lo que
// contestó (su último texto) y el trabajo de antes colapsado en "Trabajó X m".
// Lo que no es del usuario ni del modelo (src/hilo/sistema-datos.ts) va aparte y corta
// la tanda. Puro: lo prueba `tests/turnos.test.ts`.
import type { Mensaje } from "../datos/contrato";
import { agrupar, usosDe, type Uso } from "./herramientas.ts";
import { sistemaDe, type Sistema } from "./sistema-datos.ts";

/** Un renglón del trabajo: un texto suelto del worker y las herramientas que usó después (B19). */
export type Paso = { texto: string; usos: Uso[] };

export type Item =
  /** `ts`: epoch (s) de cuando lo mandó el usuario (`null` si no se sabe). */
  | { tipo: "yo"; key: string; texto: string; ts: number | null; imagenes?: { tipo: string; datos: string }[] }
  /** Una línea o una tarjeta de sistema (B18). */
  | { tipo: "sistema"; key: string; s: Sistema }
  | {
      tipo: "turno";
      key: string;
      pasos: Paso[];
      /** Lo que contestó: el último texto del turno (`null` si todavía no dijo nada). */
      texto: string | null;
      /** Epoch (s): el pedido que lo disparó o, si no está en la página, el primer mensaje. */
      desde: number | null;
      /** Epoch (s) del último mensaje. */
      hasta: number | null;
      /** Su razonamiento (sólo un líder): el de cada mensaje, juntos; `null` si no hay. */
      pensado?: string | null;
    };

const epoch = (ts: string | null) => {
  const t = ts ? Date.parse(ts) / 1000 : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * `transcript`: la ruta del transcript, para mostrar las rutas relativas al
 * proyecto (src/hilo/herramientas.ts, `relativa`).
 */
export function turnos(mensajes: Mensaje[], transcript: string | null = null): Item[] {
  const items: Item[] = [];
  const sis = mensajes.map(sistemaDe);
  let i = 0;
  while (i < mensajes.length) {
    const m = mensajes[i];
    const s = sis[i];
    if (s) {
      // Compactó y siguió con el resumen: una sola raya, que se abre al resumen.
      const r = sis[i + 1];
      if (s.tipo === "linea" && s.clase === "compacto" && r?.tipo === "tarjeta" && r.clase === "resumen") {
        items.push({ tipo: "sistema", key: `m${m.i}`, s: { ...s, resumen: r.crudo } });
        i += 2;
        continue;
      }
      items.push({ tipo: "sistema", key: `m${m.i}`, s });
      i++;
      continue;
    }
    if (m.rol === "user") {
      if (m.texto.trim() || m.imagenes?.length)
        items.push({ tipo: "yo", key: `m${m.i}`, texto: m.texto, ts: epoch(m.ts), ...(m.imagenes?.length ? { imagenes: m.imagenes } : {}) });
      i++;
      continue;
    }
    let j = i;
    while (j < mensajes.length && mensajes[j].rol === "assistant" && !sis[j]) j++;
    const tanda = mensajes.slice(i, j);
    let ultimo = -1;
    tanda.forEach((x, k) => {
      if (x.texto.trim()) ultimo = k;
    });
    const pasos: Paso[] = [];
    tanda.forEach((x, k) => {
      const usos = usosDe(x.herramientas, x.det, transcript);
      if (k === ultimo) {
        // Las herramientas del mensaje que contesta también son trabajo.
        if (usos.length) pasos.push({ texto: "", usos });
        return;
      }
      const prev = pasos[pasos.length - 1];
      if (!x.texto.trim() && prev && !prev.texto && k - 1 !== ultimo) prev.usos.push(...usos);
      else if (x.texto.trim() || usos.length) pasos.push({ texto: x.texto.trim(), usos });
    });
    // Desde el pedido del usuario, o lo que lo despertó (una tarea de fondo, un mensaje de otra sesión).
    const antes = i > 0 && mensajes[i - 1].rol === "user" ? epoch(mensajes[i - 1].ts) : null;
    items.push({
      tipo: "turno",
      key: `m${tanda[0].i}`,
      pasos,
      texto: ultimo >= 0 ? tanda[ultimo].texto : null,
      desde: antes ?? epoch(tanda[0].ts),
      hasta: epoch(tanda[tanda.length - 1].ts),
      pensado: tanda.map((x) => x.pensado).filter(Boolean).join("\n\n") || null,
    });
    i = j;
  }
  return items;
}

/** El paso en curso, en una línea: la herramienta y su descripción (`nombre: null`: sólo texto). */
export type Actual = { nombre: string | null; texto: string; veces: number };

/**
 * Lo último que hizo un turno que todavía corre: su última herramienta ("Bash",
 * "Corre los tests"; `veces` si repitió la misma seguida) o, si el último paso
 * no usó ninguna, el primer renglón de lo que dijo. Es lo que muestra el
 * trabajo cerrado mientras trabaja. `null`: todavía no hizo nada.
 */
export function pasoActual(pasos: Paso[]): Actual | null {
  const p = pasos.at(-1);
  if (!p) return null;
  const g = agrupar(p.usos).at(-1);
  if (g) return { nombre: g.uso.nombre, texto: g.uso.resumen, veces: g.todos.length };
  const texto = p.texto.split("\n")[0].slice(0, 240);
  return texto ? { nombre: null, texto, veces: 1 } : null;
}

/** Una página más vieja delante de lo que ya hay (por `i`, sin repetir). */
export function juntar(viejos: Mensaje[], nuevos: Mensaje[]): Mensaje[] {
  if (!viejos.length) return nuevos;
  if (!nuevos.length) return viejos;
  const corte = nuevos[0].i;
  return [...viejos.filter((m) => m.i < corte), ...nuevos];
}

const DECISION = /^[ \t]*(?:\*\*)?DECISION:?(?:\*\*)?:?[ \t]*/m;

/**
 * Lo que un worker deja en "DECISION:" al final de su respuesta, separado del
 * resto: `pa` da la pregunta en una sola línea y recortada, y acá se quiere
 * entera y con sus listas. `null` si no hay DECISION o dice "nada".
 */
export function partirDecision(texto: string): { antes: string; decision: string } | null {
  let m: RegExpExecArray | null = null;
  const re = new RegExp(DECISION.source, "gm");
  for (let x = re.exec(texto); x; x = re.exec(texto)) {
    m = x;
    if (x[0].length === 0) re.lastIndex++;
  }
  if (!m) return null;
  const decision = texto.slice(m.index + m[0].length).trim();
  if (!decision || /^nada\.?$/i.test(decision)) return null;
  return { antes: texto.slice(0, m.index).trimEnd(), decision };
}

const unaLinea = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x !== "")
    ?.replace(/\s+/g, " ") ?? "";

/**
 * Un líder sin /rename ni título propio se llama como la primera línea de su primer mensaje
 * (`tituloLider`, electron/tema.ts). Arriba de la conversación ese nombre no dice nada que la
 * primera burbuja no diga: si es un eco de ella (y ella está a la vista), no se muestra.
 */
export function repiteElPrimero(nombre: string, items: Item[]): boolean {
  const primero = items.find((x) => x.tipo === "yo");
  return !!nombre && primero?.tipo === "yo" && unaLinea(primero.texto) === nombre;
}
