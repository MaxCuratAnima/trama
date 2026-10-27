// `medicion.tsv` y `pa --rinde [--dias N] [--json]`: port de MEDICION_HEADER y cmd_rinde de `motor/bin/pa`.
// El archivo tiene el encabezado de hoy (con la columna `cuenta` al final) o uno viejo, que es un prefijo de éste: se lee por NOMBRE de
// columna y se toleran las filas más cortas que el encabezado (las de antes no se reescriben). Todavía no: escribir una fila al terminar
// una corrida (`medir`); esta versión de `pa` sólo lee y actualiza el encabezado.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CtxPa } from "./contexto.ts";

export const MEDICION_HEADER_VIEJO = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien";
// plan, compactaciones, autocompact, origen, la caché, tipo/integrada/retrabajo (`pa --rinde`) y cuenta: todo AL FINAL, las columnas viejas no se movieron.
export const MEDICION_HEADER =
  MEDICION_HEADER_VIEJO + "\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta";

export type FilaMedicion = {
  id: string; proyecto: string; modelo: string; effort: string; leer: boolean; seguir: boolean; esError: boolean;
  turnos: number; duracionS: number; tokens: number; costo: number; plan: string; cacheRead: number; cacheCreation: number;
  origen: string; tipo: string; cuenta: string;
};

/** Una fila al terminar la corrida (la lee Estadísticas). Con el archivo nuevo o con encabezado viejo, deja el de hoy. Nunca tira la corrida: si no puede escribir, sigue. */
export function medir(estado: string, f: FilaMedicion, ahora: Date = new Date()): void {
  try {
    const ruta = path.join(estado, "medicion.tsv");
    if (!existsSync(ruta)) writeFileSync(ruta, MEDICION_HEADER + "\n");
    else actualizarEncabezado(ruta);
    const limpio = (v: string) => v.replace(/[\t\r\n]+/g, " ");
    const col = [
      ahora.toISOString(), f.id, f.proyecto, f.modelo, f.effort, f.leer ? 1 : 0, f.seguir ? 1 : 0, f.esError ? 1 : 0, f.turnos, f.duracionS,
      f.tokens, f.costo, "", f.plan, "", "", f.origen, f.cacheRead, f.cacheCreation, "", "", f.tipo, "", "", f.cuenta,
    ].map((v) => limpio(String(v)));
    appendFileSync(ruta, col.join("\t") + "\n");
  } catch {
    // sin medición: Estadísticas queda sin esta corrida, pero el worker ya terminó bien
  }
}

/** ¿Este encabezado es un prefijo (propio) del de hoy? Entonces se actualiza solo. */
export const encabezadoViejo = (linea: string) => linea !== MEDICION_HEADER && MEDICION_HEADER.startsWith(linea) && linea.startsWith("fecha\t");

/**
 * Pone el encabezado de hoy si el archivo tiene uno viejo; las filas quedan como están (con las columnas nuevas vacías). Reescribe sobre el
 * MISMO archivo (no uno nuevo): un lector con el archivo abierto sigue viendo el mismo.
 */
export function actualizarEncabezado(ruta: string): boolean {
  let t: string;
  try {
    t = readFileSync(ruta, "utf8");
  } catch {
    return false;
  }
  const i = t.indexOf("\n");
  const primera = i < 0 ? t : t.slice(0, i);
  if (!encabezadoViejo(primera)) return false;
  writeFileSync(ruta, MEDICION_HEADER + (i < 0 ? "\n" : t.slice(i)));
  return true;
}

export type Celda = {
  tipo: string; modelo: string; effort: string; cuenta: string | null; n: number; con_dato: number; ok: number; pct_ok: number | null;
  turnos_mediana: number | null; costo_medio_usd: number | null; pct_compacto: number | null;
};

const esNumero = (x: string) => /^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(x);
/** `%.0f` de C: el .5 exacto va al par. */
const redondear = (x: number) => {
  const f = Math.floor(x);
  const d = x - f;
  return String(d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1);
};
/** El `print` de awk (`%.6g`). */
const awkNum = (x: number) => String(Number(x.toPrecision(6)));
const SOLO_DE_SIEMPRE = new Set(["claude", "google", "chatgpt"]);

/** `desde` como lo imprime `date -d "-N days" -Iseconds`: hora local con su desfase (se compara como texto con la fecha de cada fila). */
export function desdeIso(ahora: number, offsetSeg: number, dias: number): string {
  const t = ahora - dias * 86400;
  const iso = new Date((t + offsetSeg) * 1000).toISOString().slice(0, 19);
  const a = Math.abs(offsetSeg);
  const hh = String(Math.floor(a / 3600)).padStart(2, "0");
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, "0");
  return `${iso}${offsetSeg < 0 ? "-" : "+"}${hh}:${mm}`;
}

/** Las celdas (tipo × modelo × effort × cuenta) de las corridas desde `desde`, ordenadas como `LC_ALL=C sort`. */
export function celdasDeRinde(texto: string, desde: string): Celda[] {
  const filas = texto.split("\n");
  if (filas.length && filas[filas.length - 1] === "") filas.pop();
  if (!filas.length) return [];
  const col: Record<string, number> = {};
  filas[0].split("\t").forEach((n, i) => (col[n] = i));
  const acum = new Map<string, { k: string[]; n: number; dato: number; ok: number; tur: number[]; usd: number; nu: number; nc: number; comp: number }>();
  for (const linea of filas.slice(1)) {
    const f = linea.split("\t");
    if (f.length < 5 || !/^[0-9]{4}-/.test(f[0]) || f[0] < desde) continue;
    const v = (n: string) => (n in col && col[n] < f.length ? f[col[n]] : "");
    const tipo = v("tipo") || "~";
    const effort = v("effort") || "settings";
    let cuenta = v("cuenta");
    if (SOLO_DE_SIEMPRE.has(cuenta)) cuenta = "";
    const k = [tipo, v("modelo"), effort, cuenta];
    const clave = k.join("\t");
    let a = acum.get(clave);
    if (!a) acum.set(clave, (a = { k, n: 0, dato: 0, ok: 0, tur: [], usd: 0, nu: 0, nc: 0, comp: 0 }));
    a.n++;
    const i = v("integrada");
    const r = v("retrabajo");
    if (i === "0" || (i === "1" && (r === "0" || r === "1"))) {
      a.dato++;
      if (i === "1" && r === "0") a.ok++;
    }
    let x = v("num_turns");
    if (esNumero(x)) a.tur.push(Number(x));
    x = v("costo_usd");
    if (esNumero(x)) {
      a.usd += Number(x);
      a.nu++;
    }
    x = v("compactaciones");
    if (esNumero(x)) {
      a.nc++;
      if (Number(x) > 0) a.comp++;
    }
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...acum.values()]
    .sort((a, b) => cmp(a.k[0], b.k[0]) || cmp(a.k[1], b.k[1]) || cmp(a.k[2], b.k[2]) || cmp(a.k[3], b.k[3]))
    .map((a) => {
      const t = [...a.tur].sort((p, q) => p - q);
      const m = t.length;
      const med = m === 0 ? null : m % 2 ? t[(m + 1) / 2 - 1] : (t[m / 2 - 1] + t[m / 2]) / 2;
      return {
        tipo: a.k[0] === "~" ? "?" : a.k[0], modelo: a.k[1], effort: a.k[2], cuenta: a.k[3] === "" ? null : a.k[3], n: a.n, con_dato: a.dato, ok: a.ok,
        pct_ok: a.dato ? Number(redondear((100 * a.ok) / a.dato)) : null,
        turnos_mediana: med === null ? null : Number(awkNum(med)),
        costo_medio_usd: a.nu ? Number((a.usd / a.nu).toFixed(2)) : null,
        pct_compacto: a.nc ? Number(redondear((100 * a.comp) / a.nc)) : null,
      };
    });
}

const USO_RINDE = "uso: pa --rinde [--dias N] [--json]";
const pad = (s: string, n: number) => s.padEnd(n);
const lado = (s: string, n: number) => s.padStart(n);

/** `pa --rinde`: qué rinde cada modelo × effort en cada tipo de tarea. Una cuenta que no es la de siempre es `modelo@cuenta` (en --json, `cuenta`). */
export function cmdRinde(ctx: CtxPa, args: string[]): number {
  let dias = "30";
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dias") dias = args[++i] ?? "";
    else if (args[i] === "--json") json = true;
    else return ctx.err(USO_RINDE + "\n"), 2;
  }
  if (!/^[0-9]+$/.test(dias)) return ctx.err(`${USO_RINDE}  (N = días, un número)\n`), 2;
  const desde = desdeIso(ctx.ahora(), ctx.offsetSeg(), Number(dias));
  let texto = "";
  try {
    texto = readFileSync(path.join(ctx.estado, "medicion.tsv"), "utf8");
  } catch {
    // sin medicion.tsv: ninguna corrida
  }
  const celdas = celdasDeRinde(texto, desde);
  if (json) {
    ctx.out(JSON.stringify({ version: 1, dias: Number(dias), desde, celdas }, null, 2) + "\n");
    return 0;
  }
  if (!celdas.length) return ctx.out(`pa: ninguna corrida en los últimos ${dias} días.\n`), 0;
  const num = (x: number | null, dec?: number) => (x === null ? "-" : dec === undefined ? String(x) : x.toFixed(dec));
  let s = `últimos ${dias} días · ok% = integrada sin retrabajo, sobre las que ya tienen dato (pa --bien-auto) · turnos = mediana · US$ = costo medio · comp% = compactaron\n`;
  const fila = (c: string[]) => [pad(c[0], 15), pad(c[1], 18), pad(c[2], 8), lado(c[3], 4), lado(c[4], 5), lado(c[5], 5), lado(c[6], 7), lado(c[7], 8), lado(c[8], 6)].join(" ") + "\n";
  s += fila(["tipo", "modelo", "effort", "n", "dato", "ok%", "turnos", "US$", "comp%"]);
  for (const c of celdas) {
    s += fila([c.tipo, c.cuenta ? `${c.modelo}@${c.cuenta}` : c.modelo, c.effort, String(c.n), String(c.con_dato), num(c.pct_ok), num(c.turnos_mediana), num(c.costo_medio_usd, 2), num(c.pct_compacto)]);
  }
  ctx.out(s);
  return 0;
}
