// Varias cuentas por proveedor para `pa` (`--cuenta <id>`): port de cuenta_proveedor / cuenta_preparar / cuenta_resolver de `motor/bin/pa`.
// Cada cuenta (`cuentas.json`, la maneja el CLI `cuentas`) tiene su carpeta de credenciales. El worker corre con el entorno de SU cuenta
// sólo en su proceso (quita ANTHROPIC_API_KEY, pone CLAUDE_CONFIG_DIR…) y ese entorno lo arma `cuentas env <id> --json`, que se invoca
// como proceso aparte. La cuenta de siempre tiene el id del proveedor (claude, google, chatgpt) y no toca el entorno.
// Todavía no: elegir la cuenta con más cupo (`cuenta_elegir` + `reparto --cuenta-para`): sin `--cuenta` se usa la de siempre.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { caminos, dirConfigTrama } from "../plataforma.ts";
import { comandoEjecutable } from "../procesos.ts";
import type { CtxPa } from "./contexto.ts";

export type Proveedor = "claude" | "google" | "chatgpt";
const DE_SIEMPRE = ["claude", "google", "chatgpt"];

/** El entorno de una cuenta: variables a quitar y a poner (lo que imprime `cuentas env <id> --json`). */
export type EntornoCuenta = { sacar: string[]; poner: Record<string, string> };
export type CuentaElegida = { cuenta: string; entorno: EntornoCuenta };
export type ResultadoCuenta = ({ ok: true } & CuentaElegida) | { ok: false; error: string };

/** Corre `cuentas env <id> --json` y devuelve su código y su salida (stderr incluido si falló). Se falsea en los tests. */
export type LlamarCuentas = (ctx: CtxPa, id: string) => { rc: number; out: string };

const SIN_ENTORNO: EntornoCuenta = { sacar: [], poner: {} };

export const llamarCuentasEnv: LlamarCuentas = (ctx, id) => {
  const fijo = ctx.env.PA_CUENTAS_BIN;
  let bin: string;
  let args: string[];
  const propio = (b: string) => /\.(ts|js|mjs)$/.test(b);
  if (fijo && !propio(fijo)) {
    bin = fijo;
    args = ["env", id, "--json"];
  } else {
    const script = fijo ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./cuentas.ts" : "./cuentas.js", import.meta.url));
    bin = process.execPath;
    args = [script, "env", id, "--json"];
  }
  const c = comandoEjecutable(bin, args, ctx.plataforma, ctx.env as NodeJS.ProcessEnv);
  const r = spawnSync(c.file, c.args, {
    encoding: "utf8", windowsHide: true, timeout: 30000, stdio: ["ignore", "pipe", "pipe"], ...c.opciones,
    env: { ...process.env, ...ctx.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } as NodeJS.ProcessEnv,
  });
  if (r.error || r.status === null) return { rc: 1, out: r.error ? String(r.error.message) : "" };
  return { rc: r.status, out: r.status === 0 ? (r.stdout ?? "") : `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

/** Cómo se llama la función que corre el CLI `cuentas`: un objeto para poder cambiarla en los tests. */
export const dependenciasCuenta: { llamar: LlamarCuentas } = { llamar: llamarCuentasEnv };

/** `cuentas.json` (`TRAMA_CUENTAS`; si no, el de la carpeta de config de Trama). */
export const rutaCuentas = (ctx: CtxPa) =>
  ctx.env.TRAMA_CUENTAS ?? caminos(ctx.plataforma).join(dirConfigTrama(ctx.plataforma, ctx.env, ctx.env.TRAMA_CUENTAS_HOME || ctx.home), "cuentas.json");

/** `proveedor_de_modelo`: de qué suscripción es un modelo ("" = local o de ChatGPT por codex: no lleva cuenta de pa). */
export function proveedorDeModelo(modelo: string): Proveedor | "" {
  const m = modelo.toLowerCase();
  if (m.startsWith("ollama:") || m.startsWith("codex:")) return "";
  if (m.startsWith("gemini") || m.startsWith("agy:")) return "google";
  return "claude";
}

/** `cuenta_proveedor`: el proveedor de esa cuenta ("" si no existe). */
export function proveedorDeCuenta(ctx: CtxPa, id: string): string {
  if (DE_SIEMPRE.includes(id)) return id;
  try {
    const j = JSON.parse(readFileSync(rutaCuentas(ctx), "utf8")) as { cuentas?: { id?: unknown; proveedor?: unknown }[] };
    const c = (j.cuentas ?? []).find((x) => x && x.id === id);
    return typeof c?.proveedor === "string" ? c.proveedor : "";
  } catch {
    return "";
  }
}

/** `cuenta_preparar`: deja lista la cuenta `id` para un modelo de `prov`, o dice por qué no va. */
export function prepararCuenta(ctx: CtxPa, id: string, prov: string, modelo: string): ResultadoCuenta {
  if (DE_SIEMPRE.includes(id)) {
    if (id !== prov) return { ok: false, error: `pa: la cuenta '${id}' es de ${id} y el modelo '${modelo}' es de ${prov}.` };
    return { ok: true, cuenta: id, entorno: SIN_ENTORNO };
  }
  const { rc, out } = dependenciasCuenta.llamar(ctx, id);
  if (rc !== 0) return { ok: false, error: `pa: ${out.trim() || `no pude leer la cuenta ${id}`}` };
  let j: { proveedor?: unknown; sacar?: unknown; poner?: unknown };
  try {
    j = JSON.parse(out);
  } catch {
    j = {};
  }
  const p = typeof j.proveedor === "string" ? j.proveedor : "";
  if (p !== prov) return { ok: false, error: `pa: la cuenta '${id}' es de ${p || "?"} y el modelo '${modelo}' es de ${prov}.` };
  const sacar = Array.isArray(j.sacar) ? j.sacar.filter((x): x is string => typeof x === "string") : [];
  const poner: Record<string, string> = {};
  if (j.poner && typeof j.poner === "object" && !Array.isArray(j.poner)) {
    for (const [k, v] of Object.entries(j.poner)) if (v !== null && v !== undefined) poner[k] = String(v);
  }
  return { ok: true, cuenta: id, entorno: { sacar, poner } };
}

/**
 * `cuenta_resolver`: la cuenta con la que corre el worker. `--cuenta` que no va, o un modelo local con `--cuenta`: error (rc 2).
 * Sin `--cuenta`: la de la retomada (`cuentaSeguir`, del `.hilo`) si es del mismo proveedor y sigue existiendo; si no, la de siempre.
 */
export function resolverCuenta(
  ctx: CtxPa, p: { modelo: string; flag: string; seguir?: string },
): ResultadoCuenta {
  const prov = proveedorDeModelo(p.modelo);
  if (!prov) {
    if (p.flag) return { ok: false, error: `pa: --cuenta no va con '${p.modelo}': un modelo local no usa ninguna suscripción.` };
    return { ok: true, cuenta: "", entorno: SIN_ENTORNO };
  }
  if (p.flag) return prepararCuenta(ctx, p.flag, prov, p.modelo);
  if (p.seguir && proveedorDeCuenta(ctx, p.seguir) === prov) {
    const r = prepararCuenta(ctx, p.seguir, prov, p.modelo);
    if (r.ok) return r;
  }
  return prepararCuenta(ctx, prov, prov, p.modelo);
}

/** El entorno del worker con las variables de su cuenta aplicadas (sin tocar el de `pa`). */
export function entornoConCuenta(base: NodeJS.ProcessEnv, e: EntornoCuenta): NodeJS.ProcessEnv {
  const r: NodeJS.ProcessEnv = { ...base };
  for (const k of e.sacar) delete r[k];
  return Object.assign(r, e.poner);
}
