// De qué trata un líder: el título que se ve en la barra y la carpeta a la que
// va mientras no tiene workers (B20). Sale de su transcript: el título que
// guarda Claude Code (`custom-title` de un /rename, `ai-title` del que pone
// solo) o, si no hay, su primer mensaje; la carpeta, del primer proyecto del
// registry que nombra ese mensaje. El transcript se lee una vez y después sólo
// la cola nueva (el statusline se relee seguido). Lo puro lo prueba
// `tests/tema.test.ts`.
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { separarAdjuntos } from "./adjunto.ts";
import { ALIAS_DEFECTO } from "./registro.ts";

/**
 * Lo que se sabe de un transcript leído hasta `bytes`. `resto`: la última línea, si quedó a medias.
 * `creado`: la hora (epoch) de su primera línea fechada, o sea cuándo empezó la conversación.
 */
export type Tema = { custom: string | null; ai: string | null; primero: string | null; creado: number | null; bytes: number; resto: string };

export const TEMA0: Tema = { custom: null, ai: null, primero: null, creado: null, bytes: 0, resto: "" };

/** El nombre que la app le pone a un líder suyo (`nombreNuevo` en lider-arma.ts): no dice nada, no se muestra. */
export const nombreInterno = (s: string) => /^trama-[0-9a-f]{4}$/.test(s);

/** Lo del primer mensaje que se guarda: alcanza para buscar proyectos. */
const PRIMERO_MAX = 4000;

/** El texto de un mensaje del usuario (no un tool_result, ni lo que inyecta Claude Code). */
function textoUsuario(o: any): string | null {
  if (o.isMeta === true || o.isSidechain === true) return null;
  const c = o.message?.content;
  const t =
    typeof c === "string"
      ? c
      : Array.isArray(c) && !c.some((b: any) => b?.type === "tool_result")
        ? c
            .filter((b: any) => b?.type === "text")
            .map((b: any) => String(b.text ?? ""))
            .join("\n")
        : "";
  const s = t.trim();
  if (!s || /^<(command-|local-command|system-reminder|bash-)/.test(s) || s.startsWith("Caveat:")) return null;
  return s;
}

/** Suma un pedazo del transcript (lo que sigue a `t.bytes`, que mide `n` bytes). Puro. */
export function avanzarTema(t: Tema, pedazo: string, n: number = Buffer.byteLength(pedazo)): Tema {
  const lineas = (t.resto + pedazo).split("\n");
  const resto = lineas.pop() ?? "";
  let { custom, ai, primero, creado } = t;
  for (const l of lineas) {
    // Sin parsear lo que seguro no sirve: casi todo el transcript, una vez que se tiene el primer mensaje.
    const titulo = l.includes('"custom-title"') || l.includes('"ai-title"');
    const fechada = creado === null && l.includes('"timestamp"');
    if (!titulo && !fechada && (primero !== null || !l.includes('"user"'))) continue;
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (fechada && typeof o?.timestamp === "string") {
      const ms = Date.parse(o.timestamp);
      if (Number.isFinite(ms)) creado = Math.floor(ms / 1000);
    }
    if (o?.type === "custom-title" && typeof o.customTitle === "string") custom = o.customTitle.trim() || null;
    else if (o?.type === "ai-title" && typeof o.aiTitle === "string") ai = o.aiTitle.trim() || null;
    else if (o?.type === "user" && primero === null) primero = textoUsuario(o)?.slice(0, PRIMERO_MAX) ?? null;
  }
  return { custom, ai, primero, creado, bytes: t.bytes + n, resto };
}

/**
 * Cuándo se creó un líder (`Lider.creado`, su lugar fijo en la barra): lo primero de su
 * transcript; uno de la app, desde que se lo creó acá (su transcript llega con el primer
 * mensaje). Sin transcript todavía, lo que haya: el arranque de la sesión, o cuándo se lo vio.
 */
export const creadoEn = (transcript: number | null, app: number | undefined, ...resto: (number | undefined)[]) => {
  const antes = [transcript ?? 0, app ?? 0].filter((x) => x > 0);
  return antes.length ? Math.min(...antes) : (resto.find((x) => x && x > 0) ?? 0);
};

/** Una línea: lo primero que dice, sin saltos ni espacios de más. */
export const unaLinea = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x !== "")
    ?.replace(/\s+/g, " ") ?? "";

/**
 * El título de un líder: el que le puso Claude Code (un /rename, o el nombre
 * de su sesión si no es el interno de la app), el que generó solo, o su primer
 * mensaje en una línea. Nada: "" (la barra dice "Sesión jefe"). El rename de
 * trama gana sobre todo esto, pero vive en el renderer (`nombres.json`).
 */
export function tituloLider(t: Pick<Tema, "custom" | "ai" | "primero">, sesion: string): string {
  const util = (s: string | null | undefined) => (s && !nombreInterno(s) ? s : null);
  return util(t.custom) ?? util(sesion) ?? t.ai ?? (t.primero ? tituloDeTexto(t.primero) : "");
}

const LARGO_TITULO = 60;
/** Un resumen del modelo que se pasó del tope se corta más corto: si no, parece el primer mensaje recortado. */
const LARGO_RESUMEN = 40;

/** Lo que dijo el modelo como título: una línea, sin comillas ni punto final, de largo razonable. Vacío si no sirve. */
export function limpiarTitulo(salida: string): string {
  const linea = salida.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  const t = linea.replace(/^["'«“`*#\s]+|["'»”`*\s.]+$/g, "").replace(/\s+/g, " ");
  return t.length > LARGO_TITULO ? recortar(t, LARGO_RESUMEN) : t;
}

/** El primer mensaje como título corto: hasta el largo de un título, cortado en una palabra entera. */
export function recortar(s: string, largo: number = LARGO_TITULO): string {
  if (s.length <= largo) return s;
  const corte = s.slice(0, largo);
  const i = corte.lastIndexOf(" ");
  return (i > largo / 2 ? corte.slice(0, i) : corte).replace(/[\s,;:.-]+$/, "") + "…";
}

/** ¿El título de este líder sería su primer mensaje (nadie le puso uno y Claude Code tampoco)? Entonces conviene un resumen. */
export function tituloEsElPrimero(t: Pick<Tema, "custom" | "ai" | "primero">, sesion: string): boolean {
  const util = (s: string | null | undefined) => (s && !nombreInterno(s) ? s : null);
  return !util(t.custom) && !util(sesion) && !t.ai && !!t.primero;
}

/** Un mensaje como título: sin las líneas de archivo adjunto; si sólo traía archivos, sus nombres. */
export function tituloDeTexto(s: string): string {
  const { texto, archivos } = separarAdjuntos(s);
  return unaLinea(texto) || archivos.map((a) => a.nombre).join(", ");
}

/** Lo que hace falta de un proyecto del registry para reconocerlo en un texto. */
export type ProyectoTexto = { nombre: string; slug: string; ruta: string; alias?: string[] };

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * El proyecto del que habla un mensaje: el que aparece primero, por nombre del
 * registry, slug o ruta (la real, con `~/` o por el último pedazo). Devuelve el
 * slug (la carpeta de la barra) o `null`. Un nombre suelto cuenta como palabra
 * entera ("omc" sí en "Retomá omc v2", no en "nomcito").
 */
const DETERMINANTE_PREVIO = new RegExp("(?:^|\\s)(?:el|la|los|las|un|una|unos|unas|al|del|su|sus|mi|mis|tu|tus|nuestr[oa]s?|vuestr[oa]s?|este|esta|est[oe]s|esas?|aquell[oa]s?|the|a|an|my|your|his|her|its|our|their|this|that|these|those)\\s+$", "i");
const PREFIJO_EXPLICITO = new RegExp("(?:^|\\s)(?:proyecto|repo|carpeta|project|repository)\\s+(?:de\\s+)?$", "i");

type Coincidencia = {
  slug: string;
  i: number;
  largo: number;
  peso: number;
};

export function proyectoEnTexto(texto: string, proyectos: ProyectoTexto[], home: string): string | null {
  let mejor: Coincidencia | null = null;
  const textoLimpio = separarAdjuntos(texto).texto;
  const bajo = textoLimpio.toLowerCase();

  for (const p of proyectos) {
    const rutas = [p.ruta, p.ruta.startsWith(home + "/") ? "~" + p.ruta.slice(home.length) : null].filter((x): x is string => !!x);
    const alias = [...(p.alias ?? []), ...(ALIAS_DEFECTO[p.slug] ?? ALIAS_DEFECTO[p.nombre] ?? [])];
    const nombres = [...new Set([p.nombre, p.slug, path.basename(p.ruta), ...alias])].filter((x) => x.length >= 2);

    for (const r of rutas) {
      const re = new RegExp(escapar(r.toLowerCase()) + "(?![\\w.-])", "g");
      for (const m of bajo.matchAll(re)) {
        if (m.index === undefined) continue;
        const largo = m[0].length;
        const c: Coincidencia = { slug: p.slug, i: m.index, largo, peso: 2 };
        if (!mejor || c.peso > mejor.peso || (c.peso === mejor.peso && (c.i < mejor.i || (c.i === mejor.i && c.largo > mejor.largo)))) {
          mejor = c;
        }
      }
    }

    for (const n of nombres) {
      const re = new RegExp("(?<![\\w./-])" + escapar(n.toLowerCase()) + "(?![\\w-])", "g");
      for (const m of bajo.matchAll(re)) {
        if (m.index === undefined) continue;
        const largo = m[0].length;
        const antes = textoLimpio.slice(0, m.index);
        const original = textoLimpio.slice(m.index, m.index + largo);
        const esPalabraComun = original === original.toLowerCase() && DETERMINANTE_PREVIO.test(antes) && !PREFIJO_EXPLICITO.test(antes);
        const peso = esPalabraComun ? 1 : 2;
        const c: Coincidencia = { slug: p.slug, i: m.index, largo, peso };
        if (!mejor || c.peso > mejor.peso || (c.peso === mejor.peso && (c.i < mejor.i || (c.i === mejor.i && c.largo > mejor.largo)))) {
          mejor = c;
        }
      }
    }
  }
  return mejor?.slug ?? null;
}

// --- Del disco, con caché por sesión ----------------------------------------------

/** Más de esto por lectura: un transcript enorme se lee de a pedazos, sin cargarlo entero. */
const PEDAZO = 1 << 22;

const cache = new Map<string, { archivo: string; tema: Tema }>();

/** El tema del transcript de `sid`, leyendo sólo lo que creció desde la última vez. Nunca rechaza. */
export async function temaDe(sid: string, archivo: string | null): Promise<Tema> {
  if (!archivo) return TEMA0;
  let c = cache.get(sid);
  if (!c || c.archivo !== archivo) cache.set(sid, (c = { archivo, tema: TEMA0 }));
  try {
    const { size } = await stat(archivo);
    // Más chico: lo reescribieron. Se empieza de nuevo.
    if (size < c.tema.bytes) c.tema = TEMA0;
    if (size === c.tema.bytes) return c.tema;
    const f = await open(archivo, "r");
    try {
      let t = c.tema;
      const buf = Buffer.alloc(Math.min(PEDAZO, size - t.bytes));
      while (t.bytes < size) {
        const { bytesRead } = await f.read(buf, 0, Math.min(buf.length, size - t.bytes), t.bytes);
        if (bytesRead <= 0) break;
        // Corta en el último salto de línea: un carácter de varios bytes no queda partido.
        const fin = buf.lastIndexOf(10, bytesRead - 1);
        const n = fin < 0 ? bytesRead : fin + 1;
        t = avanzarTema(t, buf.toString("utf8", 0, n), n);
      }
      c.tema = t;
    } finally {
      await f.close();
    }
  } catch {}
  return c.tema;
}
