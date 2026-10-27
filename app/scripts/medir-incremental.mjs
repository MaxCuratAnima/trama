// Cuánto cuesta abrir una conversación y procesar un mensaje nuevo, y cuántos bytes pesa cada cambio de la lista de
// hilos, antes (se relee todo) y después (sólo lo nuevo / sólo las diferencias). Todo inventado, en una carpeta
// temporal que se borra: un transcript falso de ~20 MB y una lista de ~780 hilos. Sin Electron ni build.
//
//   node scripts/medir-incremental.mjs [MB del transcript] [cantidad de hilos]
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convDe, lecturas, olvidarConv } from "../electron/conv-cache.ts";
import { crearEmisor } from "../electron/hilos-dif.ts";
import { conversacionDe, paginaDe } from "../electron/lider-arma.ts";

const MB = Number(process.argv[2] ?? 20);
const N = Number(process.argv[3] ?? 780);
const SID = "00000000-0000-4000-8000-000000000001";
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-medir-inc-"));
const archivo = path.join(tmp, `${SID}.jsonl`);
const ms = (x) => `${x.toFixed(1)} ms`;
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const l = (o) => JSON.stringify(o) + "\n";
const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function tiempo(fn, veces = 5) {
  const t = [];
  for (let i = 0; i < veces; i++) {
    const a = performance.now();
    await fn(i);
    t.push(performance.now() - a);
  }
  return mediana(t);
}

try {
  // --- Un transcript de ~MB megas: turnos con herramientas y resultados largos ---
  const relleno = "texto de la conversación con ñ y acentos áéíóú ".repeat(40);
  let k = 0;
  const turno = () => {
    const i = ++k;
    return (
      l({ type: "user", timestamp: "2026-10-14T10:00:00Z", message: { content: `pedido ${i}: ${relleno.slice(0, 400)}` } }) +
      l({ type: "assistant", timestamp: "2026-10-14T10:00:01Z", message: { id: "m" + i, model: "claude-opus-5-5", content: [{ type: "text", text: relleno }, { type: "tool_use", id: "t" + i, name: "Bash", input: { command: "dir C:\\\\Temp" } }], usage: { input_tokens: 10, output_tokens: 20 } } }) +
      l({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t" + i, content: relleno.repeat(2) }] } }) +
      l({ type: "assistant", timestamp: "2026-10-14T10:00:02Z", message: { id: "m" + i + "b", model: "claude-opus-5-5", content: [{ type: "text", text: "Listo " + i }], usage: { input_tokens: 11, output_tokens: 3 } } })
    );
  };
  const trozo = [];
  let bytes = 0;
  while (bytes < MB * 1024 * 1024) {
    const t = turno();
    trozo.push(t);
    bytes += Buffer.byteLength(t);
  }
  writeFileSync(archivo, trozo.join(""));
  console.log(`transcript falso: ${(bytes / 1024 / 1024).toFixed(1)} MB, ${k} turnos`);

  // --- Abrir la conversación (primera lectura) y un mensaje nuevo ---
  const antesAbrir = await tiempo(async () => conversacionDe(SID, archivo, await readFile(archivo, "utf8")), 3);
  const antesNuevo = await tiempo(async () => {
    appendFileSync(archivo, turno());
    return conversacionDe(SID, archivo, await readFile(archivo, "utf8"));
  });
  const despuesAbrir = await tiempo(async () => {
    olvidarConv();
    return paginaDe(await convDe(SID, archivo), SID, archivo);
  }, 3);
  olvidarConv();
  await convDe(SID, archivo);
  lecturas.completas = lecturas.incrementales = 0;
  const despuesNuevo = await tiempo(async () => {
    appendFileSync(archivo, turno());
    return paginaDe(await convDe(SID, archivo), SID, archivo);
  });
  const igual = JSON.stringify(paginaDe(await convDe(SID, archivo), SID, archivo)) === JSON.stringify(conversacionDe(SID, archivo, readFileSync(archivo, "utf8")));
  console.log(`abrir la conversación:   antes ${ms(antesAbrir)}  después ${ms(despuesAbrir)}  (la primera vez se lee entera)`);
  console.log(`mensaje nuevo (4 líneas): antes ${ms(antesNuevo)}  después ${ms(despuesNuevo)}  (${lecturas.completas} lecturas enteras, ${lecturas.incrementales} de la cola)`);
  console.log(`mismo resultado que leerlo entero: ${igual ? "sí" : "NO"}`);

  // --- La lista de hilos: bytes por cambio ---
  const hilo = (i, extra = {}) => ({
    id: `20261003-${String(100000 + i).slice(1)}-${10000 + i}`, proyecto: ["atlas", "brote", "cauce"][i % 3], tarea: `Tarea inventada ${i}: ${"detalle ".repeat(12)}`,
    modelo: "claude-opus-5-5", effort: "medium", origen: "jefe", jefe: null, jefe_id: null, sigue_de: null, estado: "listo", en_cola: false, inicio: 1760000000 + i,
    duracion_s: 300, puesto: "1", rama: `pa/atlas/${i}`, commits: 2, decision: null, decision_nada: null, resultado: "Hecho. ".repeat(20), archivado: null, leer: false,
    cache_ttl_s: 3600, cache_vence: 1760003600 + i, cache_frio: null, cache_modelo: "claude-opus-5-5", ...extra,
  });
  const base = Array.from({ length: N }, (_, i) => hilo(i));
  const emisor = crearEmisor();
  const entera = (n, hilos) => ({ n, datos: { version: 1, hilos } });
  const pesa = (x) => Buffer.byteLength(JSON.stringify(x));
  const completa = pesa(entera(1, base));
  emisor.siguiente(entera(1, base));
  // Cada caso parte de la lista que dejó el anterior.
  const casos = [
    ["un worker cambia de estado", (ls) => ls.map((h, i) => (i === 3 ? { ...h, estado: "trabajando", duracion_s: null } : h))],
    ["arranca un worker nuevo", (ls) => [...ls, hilo(N, { estado: "trabajando" })]],
    ["no cambió nada", (ls) => ls],
    ["integran uno (sale de la lista)", (ls) => ls.slice(0, -2)],
  ];
  console.log(`hilos (${N}): lista entera ${kb(completa)} por cambio`);
  let n = 2;
  let ref = base;
  for (const [que, cambiar] of casos) {
    ref = cambiar(ref);
    const t = performance.now();
    const e = emisor.siguiente(entera(n, ref));
    const dt = performance.now() - t;
    console.log(`  ${que.padEnd(34)} antes ${kb(pesa(entera(n++, ref)))}  después ${kb(pesa(e))}${"dif" in e ? "" : " (entera)"}  (armar la diferencia ${ms(dt)})`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
