// Comparación visual: saca la captura offscreen (fixtures) de cada estado de `Captura` (src/modo.ts)
// a ancho de escritorio y a 360 px, y la compara con la referencia guardada en referencias/visual/.
// Sale 1 y lista qué estados difieren (y cuánto, en % de píxeles). Requiere el build (`npm run build`).
//
//   npm run visual                          todos
//   npm run visual -- normal lider@360      sólo esos (nombre = estado[-variante]@ancho)
//   npm run visual -- --aceptar [caso...]   guarda lo que sale como referencia (todos, o los nombrados)
//   npm run visual -- --lista               los nombres, sin correr nada
//   npm run visual -- --ruido               además lista los casos que difirieron algo bajo la tolerancia (los que andan cerca del límite)
//
// Sin dependencias: el PNG se decodifica con zlib. La comparación es por píxel con una tolerancia
// declarada (TOL_CANAL por canal; un píxel cuenta si algún canal se aleja más) y un máximo de
// píxeles distintos (MAX_PCT) que absorbe el ruido de antialiasing del render sin GPU.
// Lo que salió y el mapa de diferencias de lo que falla queda en bench-resultados/visual/ (no va al repo).
// Nunca con la Trama real: todo corre con fixtures, un perfil y un estado propios en una carpeta temporal.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync, inflateSync, crc32 } from "node:zlib";

const RAIZ = path.resolve(import.meta.dirname, "..");
const REFS = path.join(RAIZ, "referencias", "visual");
const FALLAS = path.join(RAIZ, "bench-resultados", "visual");
const ELECTRON = path.join(RAIZ, "node_modules", "electron", "dist", "electron");

/** Cuánto puede alejarse un canal (0–255) para seguir contando como el mismo píxel. */
const TOL_CANAL = 12;
/** Qué fracción de píxeles distintos (en %) se tolera antes de dar el estado por cambiado. */
const MAX_PCT = 0.025;
/** El instante que marca el reloj en todas las capturas (2026-10-13 20:00 UTC): horas y "hace N min" fijos. */
const AHORA = Date.UTC(2026, 9, 13, 20, 0, 0);
/** Espera antes de la foto (ms): los resortes de entrada ya terminaron. */
const ESPERA_MS = 900;

/** Los anchos: escritorio (1280×800 de CSS), el intermedio (800×800; sólo lo de `SOLO_800`) y celular angosto (360×780, la lista; `HILOS_VARIANTE=lista`). */
const ANCHOS = {
  escritorio: { tam: "1280 800", escala: "1" },
  800: { tam: "800 800", escala: "1" },
  360: { tam: "360 780", escala: "1" },
};
/** Lo que se mira también a 800 px, donde el panel de consumo reemplaza a la conversación. */
const SOLO_800 = ["consumo"];

/** Estados sin sentido en una captura estática, y por qué. */
const EXCLUIDOS = new Map([
  // (vacío por ahora: todo lo de `Captura` es una foto fija con fixtures)
]);

/** Variantes que cambian lo que se ve de un estado (`HILOS_VARIANTE`), como casos aparte. */
const VARIANTES = [
  { estado: "lider-muerto", variante: "no" },
  { estado: "lider-formato", variante: "pegado" },
  { estado: "lider-formato", variante: "larga" },
  { estado: "lider-imagenes", variante: "visor" },
  { estado: "lider-dictado", variante: "grabando" },
  { estado: "lider-dictado", variante: "transcribiendo" },
  { estado: "lider-dictado", variante: "error" },
  { estado: "lider-dictado", variante: "inseguro" },
  { estado: "ajustes", variante: "fuente" },
  { estado: "ajustes", variante: "mono" },
  { estado: "ajustes", variante: "error" },
  { estado: "ajustes", variante: "celular" },
  { estado: "ajustes", variante: "editando" },
  { estado: "ajustes", variante: "editando-mal" },
  { estado: "estadisticas", variante: "error" },
  { estado: "tablero-nuevo-avisar", variante: "elegir" },
  { estado: "tablero-nuevo-avisar", variante: "sin" },
  { estado: "leyendo", variante: "lider" },
  { estado: "frenado", variante: "lideres" },
];

const leerEstados = () => {
  const src = readFileSync(path.join(RAIZ, "src", "modo.ts"), "utf8");
  const bloque = /const CAPTURAS = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "";
  return [...bloque.matchAll(/^\s*"([a-z0-9-]+)",/gm)].map((m) => m[1]);
};

function casos() {
  const lista = [];
  for (const ancho of Object.keys(ANCHOS)) {
    for (const estado of leerEstados()) {
      if (EXCLUIDOS.has(estado)) continue;
      if (ancho === "800" && !SOLO_800.includes(estado)) continue;
      if (ancho === "360" && estado === "consumo") continue; // en el celular el panel no existe
      lista.push({ nombre: `${estado}@${ancho}`, estado, ancho });
    }
    if (ancho === "800") continue;
    for (const v of VARIANTES) lista.push({ nombre: `${v.estado}-${v.variante}@${ancho}`, estado: v.estado, variante: v.variante, ancho });
  }
  return lista;
}

// --- PNG: decodificar (8 bits, RGB o RGBA, sin entrelazado) y codificar (mapa de diferencias) ---

function decodificar(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("no es un PNG");
  let off = 8;
  let w = 0, h = 0, tipo = 0;
  const idat = [];
  while (off < buf.length) {
    const largo = buf.readUInt32BE(off);
    const nombre = buf.toString("latin1", off + 4, off + 8);
    const datos = buf.subarray(off + 8, off + 8 + largo);
    if (nombre === "IHDR") {
      w = datos.readUInt32BE(0);
      h = datos.readUInt32BE(4);
      tipo = datos[9];
      if (datos[8] !== 8 || datos[12] !== 0 || (tipo !== 2 && tipo !== 6)) throw new Error("PNG no soportado (hace falta RGB/RGBA de 8 bits)");
    } else if (nombre === "IDAT") idat.push(datos);
    else if (nombre === "IEND") break;
    off += 12 + largo;
  }
  const bpp = tipo === 6 ? 4 : 3;
  const crudo = inflateSync(Buffer.concat(idat));
  const fila = w * bpp;
  const px = Buffer.alloc(w * h * 4, 255);
  let prev = Buffer.alloc(fila);
  let cur = Buffer.alloc(fila);
  for (let y = 0; y < h; y++) {
    const f = crudo[y * (fila + 1)];
    const lin = crudo.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1));
    for (let i = 0; i < fila; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = lin[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      px[(y * w + x) * 4] = cur[x * bpp];
      px[(y * w + x) * 4 + 1] = cur[x * bpp + 1];
      px[(y * w + x) * 4 + 2] = cur[x * bpp + 2];
      if (bpp === 4) px[(y * w + x) * 4 + 3] = cur[x * bpp + 3];
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, px };
}

function codificar({ w, h, px }) {
  const crudo = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(crudo, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const trozo = (nombre, datos) => {
    const out = Buffer.alloc(12 + datos.length);
    out.writeUInt32BE(datos.length, 0);
    out.write(nombre, 4, "latin1");
    datos.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + datos.length)), 8 + datos.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", deflateSync(crudo)), trozo("IEND", Buffer.alloc(0))]);
}

/** Cuántos píxeles difieren (más allá de la tolerancia) y el mapa: rojo donde cambió, el resto apagado. */
function comparar(a, b) {
  if (a.w !== b.w || a.h !== b.h) return { distintos: Infinity, pct: 100, tamano: `${a.w}×${a.h} vs ${b.w}×${b.h}` };
  const mapa = Buffer.alloc(a.px.length);
  let distintos = 0;
  for (let i = 0; i < a.px.length; i += 4) {
    const d = Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]), Math.abs(a.px[i + 2] - b.px[i + 2]), Math.abs(a.px[i + 3] - b.px[i + 3]));
    if (d > TOL_CANAL) {
      distintos++;
      mapa[i] = 255;
      mapa[i + 3] = 255;
    } else {
      mapa[i] = mapa[i + 1] = mapa[i + 2] = b.px[i] >> 2;
      mapa[i + 3] = 255;
    }
  }
  return { distintos, pct: (distintos / (a.w * a.h)) * 100, mapa: { w: a.w, h: a.h, px: mapa } };
}

// --- Correr una captura ---

function entornoLimpio(tmp) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("HILOS_") || k.startsWith("TRAMA_") || k.startsWith("PA_")) delete env[k];
  // Perfil y estado propios: ni el candado ni los archivos de la Trama de Ana. Y un HOME vacío: nada de ~/.claude,
  // ~/tablero ni los datos de usuario de la máquina (que también cambian el render).
  const casa = path.join(tmp, "casa");
  mkdirSync(casa, { recursive: true });
  delete env.CLAUDE_CONFIG_DIR;
  return {
    ...env,
    TZ: "UTC",
    LANG: "C.UTF-8",
    HOME: casa,
    USERPROFILE: casa,
    APPDATA: path.join(casa, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(casa, "AppData", "Local"),
    HILOS_AHORA: String(AHORA),
    HILOS_STATE: path.join(tmp, "estado"),
    HILOS_PERFIL: path.join(tmp, "perfil"),
    HILOS_AISLAR_LOG: path.join(tmp, "aislar.log"),
  };
}

function sacar(caso, salida, base) {
  const a = ANCHOS[caso.ancho];
  const env = {
    ...base,
    HILOS_CAPTURA: caso.estado,
    HILOS_CAPTURA_PNG: salida,
    HILOS_TAM: a.tam,
    HILOS_ESCALA: a.escala,
    HILOS_CAPTURA_ESPERA: String(ESPERA_MS),
    HILOS_IDIOMA: "en",
  };
  // A 360 px, sin variante, la lista de la barra (lo abierto es la otra mitad: `lider` y compañía lo muestran).
  const variante = caso.variante ?? (caso.ancho === "360" && !/^(lider|tablero|ajustes|ramas|estadisticas|settle|contexto|herramientas|sistema|compactando|buscar|ocultos|conexion|leyendo|foco-caja|maquinas-lider|maquinas-selector)/.test(caso.estado) ? "lista" : null);
  if (variante) env.HILOS_VARIANTE = variante;
  // Con la máquina cargada (otro build, otra prueba) Electron a veces no llega: se reintenta antes de dar el estado por roto.
  let r;
  for (let intento = 0; intento < 3; intento++) {
    rmSync(base.HILOS_AISLAR_LOG, { force: true });
    r = spawnSync(ELECTRON, [RAIZ], { env, timeout: 30_000, stdio: "ignore" });
    // Un acceso fuera del aislamiento (electron/aislar.ts) no se reintenta: es un dato de Ana a la vista.
    if (existsSync(base.HILOS_AISLAR_LOG)) throw new Error(`tocó lo de Ana (electron/aislar.ts): ${readFileSync(base.HILOS_AISLAR_LOG, "utf8").trim().split("\n").join("; ")}`);
    if (r.status === 0 && existsSync(salida)) return;
  }
  throw new Error(`Electron salió con ${r.status ?? r.signal} sin dejar el PNG (3 intentos)`);
}

// --- Main ---

const args = process.argv.slice(2);
const aceptar = args.includes("--aceptar");
const pedidos = args.filter((x) => !x.startsWith("--"));
const todos = casos();
if (args.includes("--lista")) {
  console.log(todos.map((c) => c.nombre).join("\n"));
  process.exit(0);
}
// Un nombre sin `@ancho` vale para los dos anchos.
const elegidos = pedidos.length ? todos.filter((c) => pedidos.some((p) => c.nombre === p || c.nombre.startsWith(`${p}@`))) : todos;
const sinCaso = pedidos.filter((p) => !todos.some((c) => c.nombre === p || c.nombre.startsWith(`${p}@`)));
if (sinCaso.length) {
  console.error(`no existe: ${sinCaso.join(", ")} (npm run visual -- --lista)`);
  process.exit(2);
}
if (!existsSync(ELECTRON) || !existsSync(path.join(RAIZ, "dist-electron", "main.js")) || !existsSync(path.join(RAIZ, "dist", "index.html"))) {
  console.error("falta el build (npm run build)");
  process.exit(2);
}

const tmp = mkdtempSync(path.join(tmpdir(), "trama-visual-"));
const base = entornoLimpio(tmp);
mkdirSync(REFS, { recursive: true });
rmSync(FALLAS, { recursive: true, force: true });
const t0 = Date.now();
const cambiados = [];
const nuevos = [];
const errores = [];
let aceptados = 0;
/** El caso con más ruido entre los que dieron por iguales: sirve para saber cuánto margen queda bajo `MAX_PCT`. */
let ruido = { nombre: "", pct: 0 };
/** Todo lo que difirió algo (aunque bajo la tolerancia): con `--ruido` se lista, para ver qué casos andan cerca del límite. */
const ruidosos = [];
try {
  for (const caso of elegidos) {
    const png = path.join(tmp, `${caso.nombre}.png`);
    const ref = path.join(REFS, `${caso.nombre}.png`);
    try {
      sacar(caso, png, base);
    } catch (e) {
      errores.push(`${caso.nombre}: ${e.message}`);
      continue;
    }
    if (aceptar) {
      copyFileSync(png, ref);
      aceptados++;
      continue;
    }
    if (!existsSync(ref)) {
      nuevos.push(caso.nombre);
      continue;
    }
    const r = comparar(decodificar(readFileSync(png)), decodificar(readFileSync(ref)));
    if (r.distintos !== Infinity && r.pct > ruido.pct) ruido = { nombre: caso.nombre, pct: r.pct };
    if (r.distintos !== Infinity && r.distintos > 0) ruidosos.push({ nombre: caso.nombre, pct: r.pct });
    if (r.distintos === Infinity || r.pct > MAX_PCT) {
      cambiados.push({ nombre: caso.nombre, pct: r.pct, tamano: r.tamano });
      mkdirSync(FALLAS, { recursive: true });
      copyFileSync(png, path.join(FALLAS, `${caso.nombre}.png`));
      if (r.mapa) writeFileSync(path.join(FALLAS, `${caso.nombre}.diff.png`), codificar(r.mapa));
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const seg = ((Date.now() - t0) / 1000).toFixed(0);
if (aceptar) {
  // Sin pedidos, la carpeta queda con exactamente los casos vigentes (borra las de estados que ya no existen).
  if (!pedidos.length)
    for (const f of readdirSync(REFS)) if (f.endsWith(".png") && !todos.some((c) => `${c.nombre}.png` === f)) rmSync(path.join(REFS, f));
  console.log(`${aceptados} referencias guardadas en referencias/visual/ (${seg} s)${errores.length ? `; fallaron ${errores.length}` : ""}`);
  for (const e of errores) console.error(`  ${e}`);
  process.exit(errores.length ? 1 : 0);
}
if (args.includes("--ruido")) for (const r of ruidosos.sort((a, b) => b.pct - a.pct)) console.log(`ruido ${r.pct.toFixed(4)} % ${r.nombre}`);
for (const c of cambiados) console.error(`DISTINTO ${c.nombre}: ${c.tamano ? `tamaño ${c.tamano}` : `${c.pct.toFixed(3)} % de los píxeles`}`);
for (const n of nuevos) console.error(`SIN REFERENCIA ${n} (npm run visual -- --aceptar ${n})`);
for (const e of errores) console.error(`ERROR ${e}`);
const mal = cambiados.length + nuevos.length + errores.length;
console.log(`${elegidos.length - mal} de ${elegidos.length} iguales a su referencia (${seg} s; ruido máximo ${ruido.pct.toFixed(4)} %${ruido.nombre ? ` en ${ruido.nombre}` : ""}, tolerancia ${MAX_PCT} %)${cambiados.length ? `; lo que salió y su mapa de diferencias: bench-resultados/visual/` : ""}`);
process.exit(mal ? 1 : 0);
