// Lo que Estadísticas saca de una `Consulta` del registro histórico (electron/historial.ts): tokens por
// rol y por modelo (exactos) y qué parte del arranque se lleva cada categoría (estimada).
import type { Consulta, PiezaConsulta } from "../datos/paneles";
import { total, type Cuenta } from "../datos/tokens";
import { familia, FAMILIAS, type Familia } from "./resumen.ts";

// La cuenta de tokens (entrada + caché leído + salida) está en src/datos/tokens.ts: la misma que el panel de consumo.
export { total };

type Suma = Cuenta & { cacheCreado: number };

export type PorFamilia = Record<Familia, number>;

/** Los modelos juntados en familias (Opus, Sonnet, Fable, otro), con el total de todas. */
export function porFamilia(modelos: Record<string, Suma>): { total: number; familias: PorFamilia } {
  const familias = Object.fromEntries(FAMILIAS.map((f) => [f, 0])) as PorFamilia;
  for (const [id, s] of Object.entries(modelos)) familias[familia(id)] += total(s);
  return { total: FAMILIAS.reduce((n, f) => n + familias[f], 0), familias };
}

export type Categoria = "sistema" | "claudemd" | "skills" | "plugins" | "mcp" | "otros";
export const CATEGORIAS: Categoria[] = ["sistema", "claudemd", "skills", "plugins", "mcp", "otros"];

/**
 * Qué parte del arranque es de cada categoría, en tokens **estimados**. Una skill de un plugin pesa
 * también en el `plugin` de la consulta (para verlo por plugin): acá se descuenta, así que las
 * categorías no se pisan. `sinDesglosar` es lo que del arranque exacto ninguna pieza explica.
 */
export function arranque(c: Consulta): { exacto: number; sesiones: number; partes: Record<Categoria, number>; sinDesglosar: number } {
  const partes = Object.fromEntries(CATEGORIAS.map((k) => [k, 0])) as Record<Categoria, number>;
  const deSkills = new Map<string, number>();
  for (const p of c.piezas) {
    if (p.clase !== "skill") continue;
    const corte = p.nombre.indexOf(":");
    if (corte > 0) deSkills.set(p.nombre.slice(0, corte), (deSkills.get(p.nombre.slice(0, corte)) ?? 0) + p.peso);
  }
  for (const p of c.piezas) {
    if (p.clase === "sistema" || p.clase === "herramientas") partes.sistema += p.peso;
    else if (p.clase === "claudemd") partes.claudemd += p.peso;
    else if (p.clase === "skill") partes.skills += p.peso;
    else if (p.clase === "plugin") partes.plugins += Math.max(0, p.peso - (deSkills.get(p.nombre) ?? 0));
    else if (p.clase === "hook") partes.plugins += p.peso;
    else if (p.clase === "mcp") partes.mcp += p.peso;
    else partes.otros += p.peso;
  }
  const explicado = CATEGORIAS.reduce((n, k) => n + partes[k], 0);
  return { exacto: c.arranque.tokens, sesiones: c.arranque.sesiones, partes, sinDesglosar: Math.max(0, c.arranque.tokens - explicado) };
}

const SE_ELIGEN: PiezaConsulta["clase"][] = ["skill", "plugin", "mcp", "claudemd"];

/**
 * Lo que se cargó (skill, plugin, MCP, CLAUDE.md) ordenado por lo que costó: primero lo que se cargó y
 * nunca se usó (`usos` 0; un CLAUDE.md no se "usa", `usos` null, y no cuenta como sin usar), y dentro de
 * cada grupo, de mayor a menor peso (estimado). Un plugin cuyos hooks corrieron (`ganchos`) actúa por
 * ganchos: no es sin usar aunque sus skills no se hayan invocado. Lo usado sin estar en ningún listado
 * (`sesiones` 0) no entra.
 */
export function cargadas(c: Consulta): { pieza: PiezaConsulta; sinUsar: boolean }[] {
  return c.piezas
    .filter((p) => SE_ELIGEN.includes(p.clase) && p.sesiones > 0)
    .map((pieza) => ({ pieza, sinUsar: pieza.usos === 0 && pieza.ganchos === 0 }))
    .sort((a, b) => Number(b.sinUsar) - Number(a.sinUsar) || b.pieza.peso - a.pieza.peso);
}

/** Lo que sí se usó, con su conteo, de mayor a menor: skills, servidores MCP y subagentes. Exacto. */
export function usadas(c: Consulta): { skills: [string, number][]; mcp: [string, number][]; subagentes: [string, number][] } {
  const de = (clase: PiezaConsulta["clase"]) =>
    c.piezas.filter((p) => p.clase === clase && (p.usos ?? 0) > 0).map((p): [string, number] => [p.nombre, p.usos ?? 0]);
  const orden = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
  return {
    skills: de("skill").sort(orden),
    mcp: de("mcp").sort(orden),
    subagentes: Object.entries(c.subagentes).filter(([, n]) => n > 0).sort(orden),
  };
}
