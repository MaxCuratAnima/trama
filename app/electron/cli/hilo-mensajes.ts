// `pa --hilo <id> [--json] [-n N] [--antes N]`: los mensajes del transcript de una corrida (user y asistente, sin sidechain
// ni tool_result; los tool_use de un mismo mensaje van juntos), los N últimos (default 50) antes del índice --antes.
// `usage`/`modelo` son los del último mensaje del asistente. Port del `cmd_hilo` de `motor/bin/pa`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CtxPa } from "./contexto.ts";
import { leerTexto, proyectoDeId } from "./estado-archivos.ts";

type Json = Record<string, unknown>;
const esObjeto = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const USO = "uso: pa --hilo <id> [--json] [-n N] [--antes N]";

type Msg = {
  rol: string; subtipo?: string; ts: unknown; modelo: unknown; mid: unknown; usage: unknown; herramientas: string[]; herramientas_det: unknown[];
  imagenes: number; texto: string; meta: boolean; resumen_compact: boolean; origen: unknown; error_api: boolean; error: unknown;
};

const unir = (v: unknown, tipo: string, campo: string): string[] =>
  Array.isArray(v) ? v.filter((x) => esObjeto(x) && x.type === tipo).map((x) => String((x as Json)[campo] ?? "")) : [];

/** Los mensajes de un transcript (el texto del `.jsonl`) ya filtrados, unidos por mensaje del asistente y sin vacíos. */
export function mensajesDe(texto: string): Msg[] {
  const out: Msg[] = [];
  for (const linea of texto.split("\n")) {
    if (linea.length === 0) continue;
    let o: unknown;
    try {
      o = JSON.parse(linea);
    } catch {
      continue;
    }
    if (!esObjeto(o) || o.isSidechain === true) continue;
    const tipo = o.type;
    if (!(tipo === "user" || tipo === "assistant" || (tipo === "system" && o.subtype === "compact_boundary"))) continue;
    const origin = esObjeto(o.origin) ? o.origin : null;
    const marcas = {
      meta: o.isMeta === true, resumen_compact: o.isCompactSummary === true, origen: origin?.kind ?? null,
      error_api: o.isApiErrorMessage === true, error: o.error ?? null,
    };
    const base = { modelo: null, mid: null, usage: null, herramientas: [] as string[], herramientas_det: [] as unknown[], imagenes: 0 };
    const msg = esObjeto(o.message) ? o.message : {};
    let m: Msg;
    if (tipo === "system") {
      const c = o.content ?? "";
      m = { rol: "system", subtipo: String(o.subtype), ts: o.timestamp, ...base, texto: typeof c === "string" ? c : JSON.stringify(c), ...marcas };
    } else if (tipo === "user") {
      const c = msg.content;
      m = {
        rol: "user", ts: o.timestamp, ...base,
        imagenes: Array.isArray(c) ? c.filter((x) => esObjeto(x) && x.type === "image").length : 0,
        texto: typeof c === "string" ? c : unir(c, "text", "text").join("\n"), ...marcas,
      };
    } else {
      const c = msg.content;
      const usos = Array.isArray(c) ? c.filter((x): x is Json => esObjeto(x) && x.type === "tool_use") : [];
      m = {
        rol: "assistant", ts: o.timestamp, modelo: msg.model ?? null, mid: msg.id ?? null, usage: msg.usage ?? null, imagenes: 0,
        herramientas: usos.map((x) => String(x.name)),
        herramientas_det: usos.map((x) => ({
          nombre: x.name,
          entrada: esObjeto(x.input)
            ? Object.fromEntries(Object.entries(x.input).map(([k, v]) => [k, typeof v === "string" ? Array.from(v).slice(0, 2000).join("") : v]))
            : {},
        })),
        texto: unir(c, "text", "text").join("\n"), ...marcas,
      };
    }
    if (m.rol === "user" && m.texto === "" && !(m.imagenes > 0)) continue;
    const ult = out[out.length - 1];
    if (m.rol === "assistant" && ult && ult.rol === "assistant" && m.mid !== null && ult.mid === m.mid) {
      ult.texto = [ult.texto, m.texto].filter((x) => x !== "").join("\n");
      ult.herramientas.push(...m.herramientas);
      ult.herramientas_det.push(...m.herramientas_det);
      ult.usage = m.usage ?? ult.usage;
      ult.modelo = m.modelo ?? ult.modelo;
      ult.error_api = ult.error_api || m.error_api;
      ult.error = m.error ?? ult.error;
    } else out.push(m);
  }
  return out.filter((m) => m.rol !== "assistant" || m.texto !== "" || m.herramientas.length > 0);
}

export async function cmdHilo(ctx: CtxPa, args: string[]): Promise<number> {
  const id = args[0] ?? "";
  if (!id || id.startsWith("-")) return ctx.err(USO + "\n"), 2;
  let n = "50";
  let antes = "";
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") continue;
    if (a === "-n") n = args[++i] ?? "";
    else if (a === "--antes") antes = args[++i] ?? "";
    else return ctx.err(USO + "\n"), 2;
  }
  if (!/^[0-9]+$/.test(n) || (antes !== "" && !/^[0-9]+$/.test(antes))) return ctx.err("pa: --hilo: -n y --antes son números.\n"), 2;
  const s = await proyectoDeId(ctx.estado, id);
  if (!s) return ctx.err(`pa: no encuentro la corrida '${id}' en ${ctx.estado}.\n`), 1;
  const d = path.join(ctx.estado, s);
  let sid = ((await leerTexto(path.join(d, `${id}.sid`))) ?? "").replace(/\n+$/, "");
  if (!sid) {
    try {
      const v: unknown = JSON.parse((await leerTexto(path.join(d, `${id}.json`))) ?? "");
      if (esObjeto(v) && typeof v.session_id === "string") sid = v.session_id;
    } catch {
      // sin json
    }
  }
  let t = "";
  if (sid && /^[A-Za-z0-9._-]+$/.test(sid)) {
    let carpetas: string[] = [];
    try {
      carpetas = readdirSync(ctx.proyectos).sort();
    } catch {
      // sin transcripts
    }
    for (const c of carpetas) {
      const a = path.join(ctx.proyectos, c, `${sid}.jsonl`);
      if (existsSync(a) && statSync(a).isFile()) {
        t = a;
        break;
      }
    }
  }
  const todos = t ? mensajesDe(readFileSync(t, "utf8")) : [];
  const total = todos.length;
  const hasta = Math.min(total, antes === "" ? total : Number(antes));
  const desde = Math.max(0, hasta - Number(n));
  const ult = [...todos].reverse().find((m) => m.rol === "assistant");
  const mensajes = todos.slice(desde, hasta).map((m, k) => ({
    i: desde + k, rol: m.rol, texto: m.texto, herramientas: m.herramientas, ts: m.ts ?? null, modelo: m.modelo ?? null,
    herramientas_det: m.herramientas_det, imagenes: m.imagenes, meta: m.meta, resumen_compact: m.resumen_compact, origen: m.origen,
    error_api: m.error_api, error: m.error, ...(m.rol === "system" ? { subtipo: m.subtipo } : {}),
  }));
  const salida = { version: 1, id, proyecto: s, transcript: t || null, total, desde, hasta, mensajes, usage: ult?.usage ?? null, modelo: ult?.modelo ?? null };
  ctx.out(JSON.stringify(salida, null, 2) + "\n");
  return 0;
}
