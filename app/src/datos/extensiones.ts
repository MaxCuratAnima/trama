// Ajustes > Extensiones, del lado de la vista: la forma de lo que dice el main (electron/extensiones.ts), que acá se vuelve a mirar
// porque llega de afuera. Puro: sin React ni puente.

export type ExtItem = { nombre: string; descripcion: string; origen: string; modelo: string | null };
export type ExtPlugin = { nombre: string; mercado: string; version: string; activo: boolean | null; origen: string };
export type ExtMcp = { nombre: string; tipo: string; destino: string; origen: string };
export type Extensiones = { version: 1; cuenta: string; defecto: boolean; skills: ExtItem[]; agentes: ExtItem[]; plugins: ExtPlugin[]; mcp: ExtMcp[] };
export type ResultadoImportar = { ok: true; skills: number; agentes: number; mcp: number; omitidos: number } | { ok: false; error: string };

const texto = (x: unknown, max = 300): string => (typeof x === "string" ? x.slice(0, max) : "");
const lista = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null) : []);

/** Sólo la forma esperada; cualquier otra cosa es `null` (la carpeta no existe o el main no contestó). */
export function extensionesValidas(x: unknown): Extensiones | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.version !== 1) return null;
  const item = (f: Record<string, unknown>): ExtItem => ({ nombre: texto(f.nombre, 120), descripcion: texto(f.descripcion), origen: texto(f.origen, 60), modelo: typeof f.modelo === "string" && f.modelo ? f.modelo.slice(0, 40) : null });
  return {
    version: 1,
    cuenta: texto(o.cuenta, 80),
    defecto: o.defecto === true,
    skills: lista(o.skills).map(item).filter((i) => i.nombre),
    agentes: lista(o.agentes).map(item).filter((i) => i.nombre),
    plugins: lista(o.plugins)
      .map((f) => ({ nombre: texto(f.nombre, 120), mercado: texto(f.mercado, 120), version: texto(f.version, 40), activo: typeof f.activo === "boolean" ? f.activo : null, origen: texto(f.origen, 60) }))
      .filter((p) => p.nombre),
    mcp: lista(o.mcp)
      .map((f) => ({ nombre: texto(f.nombre, 120), tipo: texto(f.tipo, 20), destino: texto(f.destino, 80), origen: texto(f.origen, 60) }))
      .filter((m) => m.nombre),
  };
}

const cuenta = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

export function importarValido(x: unknown): ResultadoImportar {
  const o = x as { ok?: unknown; skills?: unknown; agentes?: unknown; mcp?: unknown; omitidos?: unknown; error?: unknown } | null;
  if (o?.ok === true) return { ok: true, skills: cuenta(o.skills), agentes: cuenta(o.agentes), mcp: cuenta(o.mcp), omitidos: cuenta(o.omitidos) };
  return { ok: false, error: typeof o?.error === "string" && o.error ? o.error : "main.cuentasFallo" };
}
