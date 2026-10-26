// `pa --modelos [--json]`: la tabla efectiva tipo → modelo y effort que usaría pa sin `-m`, de dónde sale (modelos.json
// `workers.<tipo>`, `workers.default` o el default de pa), el líder, `excluir`, los locales (Ollama) y el cupo de cada suscripción.
// Port de `cmd_modelos` de `motor/bin/pa`. Diferencia a propósito: el pa de TypeScript no consulta `reparto` para elegir modelo
// (no viaja con Trama), así que no hay columna "reparto hoy": lo que se ve es lo que se lanza.
import { readFileSync } from "node:fs";
import type { CtxPa } from "./contexto.ts";
import { planDe } from "./estado-archivos.ts";
import { leerModelos, resolverPolitica, TIPOS_VALIDOS, type ModelosJson } from "./lanzar-politica.ts";
import { dirClaudeConfig, rutaModelos } from "../plataforma.ts";
import path from "node:path";

type Motor = "claude" | "agy" | "codex" | "ollama";
const motorDe = (m: string): Motor => {
  const x = m.toLowerCase();
  return x.startsWith("ollama:") ? "ollama" : x.startsWith("codex:") ? "codex" : x.startsWith("gemini") || x.startsWith("agy:") ? "agy" : "claude";
};

export type FilaModelo = { tipo: string; modelo: string; effort: string | null; motor: Motor; origen: string };
export type Cupo = { suscripcion: string; ventana: string; pct: number | null };
export type Local = { id: string; nombre: string; url: string; modelo: string; responde: boolean; detalle: string | null };

/** Lo que `--modelos` necesita de afuera y los tests reemplazan: el cupo de cada suscripción y si un servidor local responde. */
export type DepsModelos = {
  cupos?: () => Promise<Cupo[] | null>;
  sondear?: (url: string, modelo: string) => Promise<string>;
};

/** El cupo de las suscripciones por el lector de la app (`reparto --cupos` o el consultor nativo). `null`: no se pudo leer. */
async function cuposReales(): Promise<Cupo[] | null> {
  try {
    const m = (await import("../cupos.js")) as typeof import("../cupos.ts");
    const leidos = await Promise.race([m.refrescarCupos(true), new Promise<null>((ok) => setTimeout(() => ok(null), 10000))]);
    if (!leidos) return null;
    const out: Cupo[] = [];
    for (const s of leidos.suscripciones) {
      for (const v of s.ventanas ?? []) out.push({ suscripcion: s.nombre, ventana: v.id, pct: v.pct });
      for (const g of s.grupos ?? []) for (const v of g.ventanas) out.push({ suscripcion: `${s.nombre} · ${g.nombre}`, ventana: v.id, pct: v.pct });
    }
    if (leidos.claude && !out.some((c) => c.suscripcion === (leidos.claudeNombre || "Claude"))) {
      out.unshift({ suscripcion: leidos.claudeNombre || "Claude", ventana: "5h", pct: leidos.claude.cincoH }, { suscripcion: leidos.claudeNombre || "Claude", ventana: "7d", pct: leidos.claude.sieteD });
    }
    return out;
  } catch {
    return null;
  }
}

/** "ok" o por qué no: un servidor Ollama que contesta `/api/tags` y tiene el modelo. */
async function sondearReal(url: string, modelo: string): Promise<string> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return `el servidor ${url} contestó ${r.status}`;
    const j = (await r.json()) as { models?: { name?: string; model?: string }[] };
    if (Array.isArray(j.models) && !j.models.some((x) => [x.name, x.model].some((n) => n === modelo || n === `${modelo}:latest`))) {
      return `el servidor ${url} no tiene el modelo '${modelo}' (ollama pull ${modelo})`;
    }
    return "ok";
  } catch {
    return `el servidor ${url} no responde (${url}/api/tags)`;
  }
}

/** Las filas: `default` y cada tipo, con el modelo y effort que daría `pa --tipo <tipo>` sin `-m`. */
export function filasDeModelos(modelos: ModelosJson | null, plan: "pro" | "max", effortSettings: string): FilaModelo[] {
  const filas: FilaModelo[] = [];
  for (const t of ["default", ...TIPOS_VALIDOS]) {
    const w = modelos ? (modelos.workers[t] ?? modelos.workers.default) : undefined;
    const clave = modelos?.workers[t] ? t : "default";
    const d = resolverPolitica({
      modelo: "", esfuerzo: "", esfuerzoFlag: false, tipo: t === "default" ? "" : t, leer: false, seguir: false, okDueno: true, plan, modelos, effortSettings, dueno: "",
    });
    if ("error" in d) {
      // codex/ollama en modelos.json: este pa no los lanza, pero la tabla los muestra tal cual
      if (w) filas.push({ tipo: t, modelo: w.modelo, effort: null, motor: motorDe(w.modelo), origen: `modelos.json (workers.${clave}); este pa no lo lanza` });
      continue;
    }
    const motor = motorDe(d.modelo);
    filas.push({
      tipo: t, modelo: d.modelo, effort: motor === "claude" ? d.esfuerzo || "settings" : null, motor,
      origen: d.deModelosJson ? `modelos.json (workers.${clave})` : "default de pa",
    });
  }
  return filas;
}

const leerCrudo = (ruta: string): Record<string, unknown> | null => {
  try {
    const j = JSON.parse(readFileSync(ruta, "utf8")) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export async function cmdModelos(ctx: CtxPa, args: string[], deps: DepsModelos = {}): Promise<number> {
  const json = args[0] === "--json";
  if (args.length > (json ? 1 : 0)) return ctx.err("uso: pa --modelos [--json]\n"), 2;
  const { plan } = await planDe(ctx.estado, ctx.env);
  const archivo = rutaModelos(ctx.plataforma, ctx.env, ctx.home);
  const m = leerModelos(archivo);
  const invalido = m && "error" in m ? m.error : null;
  const modelos = m && !("error" in m) ? m : null;
  const crudo = modelos ? leerCrudo(archivo) : null;
  let effortSettings = "";
  try {
    const cfg = ctx.env.PA_CLAUDE_SETTINGS ?? path.join(ctx.env.CLAUDE_CONFIG_DIR ?? dirClaudeConfig(ctx.plataforma, ctx.home), "settings.json");
    effortSettings = String((JSON.parse(readFileSync(cfg, "utf8")) as { effortLevel?: unknown }).effortLevel ?? "");
  } catch {
    // sin settings
  }
  const filas = filasDeModelos(modelos, plan, effortSettings);
  const lider = (crudo?.lider ?? null) as { modelo?: string; effort?: string } | null;
  const locales: Local[] = [];
  for (const l of Array.isArray(crudo?.locales) ? (crudo!.locales as Record<string, unknown>[]) : []) {
    const url = String(l.url ?? "");
    const modelo = String(l.modelo ?? "");
    const est = await (deps.sondear ?? sondearReal)(url, modelo);
    locales.push({ id: String(l.id ?? ""), nombre: String(l.nombre ?? modelo), url, modelo, responde: est === "ok", detalle: est === "ok" ? null : est });
  }
  const cupos = await (deps.cupos ?? cuposReales)();
  const excluir = modelos?.excluir ?? [];
  const sinCupo = String(crudo?.sin_cupo ?? "otro");

  if (json) {
    ctx.out(JSON.stringify({
      archivo, existe: m !== null, valido: modelos !== null, error: invalido, plan,
      reparto: "fijo", excluir, permitir_max: modelos?.permitirMax ?? false, sin_cupo: sinCupo,
      lider: lider?.modelo ? { modelo: lider.modelo, effort: lider.effort ?? null, motor: motorDe(lider.modelo) } : null,
      workers: Object.fromEntries(filas.map((f) => [f.tipo, { modelo: f.modelo, effort: f.effort, motor: f.motor, origen: f.origen, reparto: null }])),
      cupos, locales,
    }, null, 2) + "\n");
    return 0;
  }
  const L: string[] = [];
  L.push(m === null ? `archivo: ${archivo} (no existe: modelos de siempre)` : invalido ? `archivo: ${archivo} (inválido: ${invalido}; no se usa)` : `archivo: ${archivo}`);
  if (lider?.modelo) L.push(`líder: ${lider.modelo}${lider.effort ? ` effort ${lider.effort}` : ""}`);
  L.push(`${"tipo".padEnd(15)} ${"modelo".padEnd(26)} ${"effort".padEnd(8)} de dónde`);
  for (const f of filas) L.push(`${f.tipo.padEnd(15)} ${f.modelo.padEnd(26)} ${(f.effort ?? "-").padEnd(8)} ${f.origen}`);
  L.push(`plan: ${plan}. Este pa no consulta reparto: sin -m se lanza lo de la tabla.`);
  L.push(`sin cupo: ${sinCupo}; excluir: ${excluir.length ? excluir.join(", ") : "nada"}; max sin --ok-dueno: ${modelos?.permitirMax ? "sí" : "no"}`);
  if (cupos === null) L.push("cupo: sin dato (no pude leer los cupos de las suscripciones).");
  else if (!cupos.length) L.push("cupo: sin suscripciones conectadas.");
  else {
    L.push("cupo (usado):");
    for (const c of cupos) L.push(`  ${c.suscripcion.padEnd(24)} ${c.ventana.padEnd(4)} ${c.pct === null ? "sin dato" : `${c.pct}%`}`);
  }
  if (locales.length) {
    L.push("locales:");
    for (const l of locales) L.push(`  ${l.id.padEnd(30)} ${l.url}  ${l.responde ? "responde" : `NO: ${l.detalle}`}`);
  }
  L.push("(-m en pa siempre le gana al archivo)");
  ctx.out(L.join("\n") + "\n");
  return 0;
}
