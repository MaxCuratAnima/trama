// Tokens de diseño (etapa 4 del plan "Trama terminada": mismo look, emparejado). Lista, por archivo,
// los literales de color, tamaño de letra, radio y espaciado que quedan en los .css de src/ y el token
// que les toca según la tabla de abajo (la misma de docs/estado/tokens.md). Sin dependencias.
//
//   node scripts/tokens-faltan.mjs                 todos los .css de src/: cuántos quedan y cada línea
//   node scripts/tokens-faltan.mjs --resumen       sólo el conteo por archivo
//   node scripts/tokens-faltan.mjs src/x.css ...   sólo esos
//   node scripts/tokens-faltan.mjs --aplicar src/x.css   reemplaza en el archivo lo que la tabla sabe
//   --tipos=color,letra                            sólo esos (color, letra, radio, espacio)
//
// Qué NO cuenta: las definiciones de propiedades propias (`--algo: #123`, son los tokens), lo que ya
// es `var(…)`, `0`, `auto`, `inherit`, `50%` (un círculo), los valores negativos y los `calc()/env()`
// (compensaciones de layout), lo marcado con `/* geometría */` en su línea (íconos dibujados con CSS), las hairlines de 1px y los espaciados de 1.75rem para arriba (medidas
// de layout, no del ritmo). Un literal sin token en la tabla sale con "?": hay que decidirlo, no inventarlo.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

// --- La tabla: literal → token -----------------------------------------------------------------

/** Grises: cada literal va al escalón de la escala que lo absorbe (diferencia ≤ 7 por canal salvo los anotados). */
const GRIS = {
  "#060606": "#0a0a0a", "#090909": "#0a0a0a", "#0a0a0a": "#0a0a0a",
  "#0d0d0d": "#0f0f0f", "#0f0f0f": "#0f0f0f", "#101010": "#0f0f0f", "#111": "#0f0f0f", "#111111": "#0f0f0f",
  "#131313": "#171717", "#141414": "#171717", "#151515": "#171717", "#161616": "#171717", "#171717": "#171717", "#1a1a1a": "#171717",
  "#1c1c1c": "#1f1f1f", "#1f1f1f": "#1f1f1f", "#222": "#1f1f1f", "#222222": "#1f1f1f",
  "#262626": "#262626", "#2a2a2a": "#262626", "#2b2b2b": "#262626",
  "#2e2e2e": "#333333", "#333": "#333333", "#333333": "#333333",
  "#3f3f3f": "#404040", "#404040": "#404040", "#474747": "#404040",
  "#4a4a4a": "#525252", "#4d4d4d": "#525252", "#525252": "#525252", "#5c5c5c": "#525252",
  "#737373": "#737373", "#8a8a8a": "#8a8a8a", "#a3a3a3": "#a3a3a3", "#d4d4d4": "#d4d4d4",
  "#e5e5e5": "#e5e5e5", "#ededed": "#e5e5e5", "#fafafa": "#fafafa",
};
/** Cada escalón de gris, con su token según para qué se usa (fondo, borde o texto); si el papel no tiene uno, el primero que haya. */
const ESCALON = {
  "#0a0a0a": { fondo: "--sup-0" },
  "#0f0f0f": { fondo: "--sup-1" },
  "#171717": { fondo: "--sup-2", borde: "--borde-1" },
  "#1f1f1f": { fondo: "--sup-3", borde: "--borde-2" },
  "#262626": { fondo: "--sup-4", borde: "--borde-3" },
  "#333333": { borde: "--borde-4" },
  "#404040": { borde: "--borde-5", texto: "--texto-8" },
  "#525252": { borde: "--borde-6", texto: "--texto-7" },
  "#737373": { texto: "--texto-6" },
  "#8a8a8a": { texto: "--texto-5" },
  "#a3a3a3": { texto: "--texto-4" },
  "#d4d4d4": { texto: "--texto-3" },
  "#e5e5e5": { texto: "--texto-2" },
  "#fafafa": { texto: "--texto-1" },
};
/** Colores que van a un token sin importar el papel. */
const FIJO = {
  "#000": "var(--negro)", "#000000": "var(--negro)", "#fff": "var(--blanco)", "#ffffff": "var(--blanco)",
  "#60a5fa": "var(--azul)", "#4ade80": "var(--verde)", "#fbbf24": "var(--ambar)", "#ff453a": "var(--rojo)",
  "#f87171": "var(--rojo-texto)", "#fca5a5": "var(--rojo-claro)", "#e5a0a0": "var(--rojo-claro)",
  "#fecaca": "var(--rojo-palido)", "#bbf7d0": "var(--verde-palido)", "#7ad69b": "var(--verde-suave)",
  "#dbeafe": "var(--azul-palido)", "#f2c24b": "var(--oro)",
  "#9ad48a": "var(--sint-str)", "#f0c27a": "var(--sint-num)", "#b9a3f0": "var(--sint-kw)",
  "#f0a08a": "var(--sint-menos)", "#6b6b6b": "var(--sint-com)", "#8fb5f0": "var(--sint-fn)", "#7fd1c7": "var(--sint-var)",
  "rgb(0 0 0 / 65%)": "var(--sombra)", "rgb(0 0 0 / 70%)": "var(--fondo-modal)", "rgb(0 0 0 / 0.7)": "var(--fondo-modal)",
  "rgb(0 0 0 / 0.82)": "var(--velo)",
  "rgb(255 255 255 / 0.02)": "var(--resalte-1)", "rgb(255 255 255 / 0.06)": "var(--resalte-2)",
  "rgb(255 255 255 / 0.08)": "var(--resalte-2)",
  "rgb(74 222 128 / 0.12)": "var(--verde-tinte)", "rgb(74 222 128 / 10%)": "var(--verde-tinte)",
  "rgb(255 69 58 / 10%)": "var(--rojo-tinte)", "rgb(248 113 113 / 0.13)": "var(--rojo-tinte)",
  "rgb(255 69 58 / 0.35)": "var(--rojo-borde)", "rgb(72 150 140)": "var(--modo-plan)",
  "rgb(143 181 240 / 0.35)": "var(--enlace-subrayado)",
  "rgb(242 194 75 / 0)": "color-mix(in srgb, var(--oro) 0%, transparent)",
  "rgb(242 194 75 / 0.22)": "color-mix(in srgb, var(--oro) 22%, transparent)",
  "rgb(242 194 75 / 0.5)": "color-mix(in srgb, var(--oro) 50%, transparent)",
  "rgb(242 194 75 / 0.55)": "color-mix(in srgb, var(--oro) 55%, transparent)",
  "rgb(122 214 155 / 0.18)": "color-mix(in srgb, var(--verde-suave) 18%, transparent)",
};
/** Letra, en rem (a letra 13: 9, 10, 11, 12, 13, 14, 16 y 18 px). Lo de medio px va al de arriba. */
const LETRA = {
  "0.525rem": "--letra-1", "0.53125rem": "--letra-1", "0.5625rem": "--letra-1",
  "0.625rem": "--letra-2",
  "0.65625rem": "--letra-3", "0.6875rem": "--letra-3",
  "0.71875rem": "--letra-4", "0.75rem": "--letra-4",
  "0.78125rem": "--letra-5", "0.8125rem": "--letra-5",
  "0.84375rem": "--letra-6", "0.875rem": "--letra-6", "0.90625rem": "--letra-6",
  "0.9375rem": "--letra-7", "0.96875rem": "--letra-7", "1rem": "--letra-7",
  "1.0625rem": "--letra-8", "1.125rem": "--letra-8",
};
/** Radios: 2, 6, 8 y 12 px (más `--radio-pastilla` para lo redondeado del todo). */
const RADIO = {
  "1px": "--radio-1", "0.0625rem": "--radio-1", "0.125rem": "--radio-1", "0.1875rem": "--radio-1", "0.21875rem": "--radio-1",
  "0.25rem": "--radio-2", "0.28125rem": "--radio-2", "0.3125rem": "--radio-2", "0.375rem": "--radio-2", "0.4375rem": "--radio-2",
  "0.5rem": "--radio-3",
  "0.625rem": "--radio-4", "0.75rem": "--radio-4",
  "999rem": "--radio-pastilla",
};
/** Espaciado (padding, margin, gap): pasos de 2 px hasta 16, después 20, 24 y 32. Lo impar va al par
 *  múltiplo de 4 (3 y 5 → 4, 7 y 9 → 8, 11 → 12): unos suben y otros bajan, y las filas quedan del mismo alto. */
const ESPACIO = {
  "0.09375rem": "--esp-0-5", "0.125rem": "--esp-0-5",
  "0.1875rem": "--esp-1", "0.25rem": "--esp-1", "0.3125rem": "--esp-1",
  "0.375rem": "--esp-1-5",
  "0.4375rem": "--esp-2", "0.5rem": "--esp-2", "0.5625rem": "--esp-2",
  "0.625rem": "--esp-2-5",
  "0.6875rem": "--esp-3", "0.75rem": "--esp-3",
  "0.875rem": "--esp-3-5",
  "1rem": "--esp-4", "1.0625rem": "--esp-4", "1.125rem": "--esp-4",
  "1.25rem": "--esp-5",
  "1.375rem": "--esp-6", "1.5rem": "--esp-6",
  "2rem": "--esp-8",
};

// --- Qué papel cumple un color según la propiedad -----------------------------------------------

function papel(prop, valor) {
  if (/^(border|outline|column-rule|scrollbar-color)/.test(prop)) return "borde";
  if (prop === "box-shadow" && /inset\s+0\s+0\s+0\s+1px/.test(valor)) return "borde";
  if (/^(background|box-shadow)/.test(prop)) return "fondo";
  return "texto";
}
const ORDEN = { fondo: ["fondo", "borde", "texto"], borde: ["borde", "fondo", "texto"], texto: ["texto", "borde", "fondo"] };

function tokenColor(lit, rol) {
  const l = lit.toLowerCase().replace(/\s+/g, " ");
  if (FIJO[l]) return FIJO[l];
  const esc = GRIS[l];
  if (!esc) return null;
  for (const r of ORDEN[rol]) if (ESCALON[esc][r]) return `var(${ESCALON[esc][r]})`;
  return null;
}

const RE_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const RE_LARGO = /-?\d*\.?\d+(?:rem|px|em|%)|\b0\b/g;

/** Recorre las declaraciones de un CSS y devuelve cada literal con su token (o null) y dónde reemplazarlo. */
function analizar(css) {
  const hallados = [];
  // Comentarios fuera, sin mover posiciones.
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const RE_DECL = /(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)/g;
  for (const d of limpio.matchAll(RE_DECL)) {
    const prop = d[2];
    if (prop.startsWith("--")) continue; // definiciones: son los tokens
    // Un `/* geometría */` en la misma línea: medida de un ícono dibujado con CSS, queda literal.
    const fin = css.indexOf("\n", d.index + d[0].length);
    if (/\/\*\s*geometr/.test(css.slice(d.index + d[0].length, fin < 0 ? undefined : fin))) continue;
    const valor = d[3];
    const inicio = d.index + d[0].length - valor.length;
    // Un selector con pseudo-clase (`a:hover {`) no es una declaración: la cuenta de llaves lo descarta.
    if (/^[a-z-]+$/.test(prop) && limpio[d.index + d[0].length] === "{") continue;
    const agregar = (tipo, lit, pos, token) => hallados.push({ tipo, lit, pos: inicio + pos, token, prop });
    for (const c of valor.matchAll(RE_COLOR)) agregar("color", c[0], c.index, tokenColor(c[0], papel(prop, valor)));
    if (prop === "font-size") {
      const v = valor.trim();
      if (!/^(var|calc|inherit)|em$/.test(v) || /rem$/.test(v)) {
        if (/^\d*\.?\d+rem$/.test(v)) agregar("letra", v, valor.indexOf(v), LETRA[v] ? `var(${LETRA[v]})` : null);
      }
    }
    if (/^border(-[a-z]+)*-radius$/.test(prop)) {
      for (const m of valor.matchAll(RE_LARGO)) {
        if (m[0] === "0" || m[0] === "50%" || m[0].startsWith("-")) continue;
        agregar("radio", m[0], m.index, RADIO[m[0]] ? `var(${RADIO[m[0]]})` : null);
      }
    }
    if (/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(prop) && !/calc|env|var\(/.test(valor)) {
      for (const m of valor.matchAll(RE_LARGO)) {
        const v = m[0];
        if (v === "0" || v.startsWith("-") || v === "1px" || v === "0.0625rem" || v.endsWith("%") || v.endsWith("em") && !v.endsWith("rem")) continue;
        if (parseFloat(v) >= 1.75 && v !== "2rem") continue;
        agregar("espacio", v, m.index, ESPACIO[v] ? `var(${ESPACIO[v]})` : null);
      }
    }
  }
  return hallados;
}

function archivos(lista) {
  if (lista.length) return lista.map((f) => path.resolve(f));
  const out = [];
  const andar = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) andar(p);
      else if (n.endsWith(".css")) out.push(p);
    }
  };
  andar(path.join(RAIZ, "src"));
  return out.sort();
}

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const resumen = args.includes("--resumen");
// `--tipos=color,letra`: sólo esos (color, letra, radio, espacio).
const tipos = args.find((a) => a.startsWith("--tipos="))?.slice(8).split(",");
const lista = archivos(args.filter((a) => !a.startsWith("--")));
let total = 0;
for (const f of lista) {
  const css = readFileSync(f, "utf8");
  const h = analizar(css).filter((x) => !tipos || tipos.includes(x.tipo));
  const rel = path.relative(RAIZ, f);
  if (aplicar) {
    let out = css;
    const cambiables = h.filter((x) => x.token).sort((a, b) => b.pos - a.pos);
    for (const x of cambiables) out = out.slice(0, x.pos) + x.token + out.slice(x.pos + x.lit.length);
    writeFileSync(f, out);
    const quedan = h.length - cambiables.length;
    console.log(`${rel}: ${cambiables.length} reemplazados, ${quedan} sin token`);
    for (const x of h.filter((y) => !y.token)) console.log(`  ${linea(css, x.pos)}: ${x.tipo} ${x.lit} (${x.prop}) → ?`);
    continue;
  }
  total += h.length;
  const por = {};
  for (const x of h) por[x.tipo] = (por[x.tipo] ?? 0) + 1;
  console.log(`${rel}: ${h.length}` + (h.length ? ` (${Object.entries(por).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""));
  if (!resumen) for (const x of h) console.log(`  ${linea(css, x.pos)}: ${x.tipo} ${x.lit} (${x.prop}) → ${x.token ?? "?"}`);
}
if (!aplicar) console.log(`total: ${total}`);

function linea(css, pos) {
  return css.slice(0, pos).split("\n").length;
}
