// Varias cuentas por proveedor, del lado de la vista: la forma de lo que dice `cuentas --json` (ya validada en el main, acá se
// vuelve a mirar porque llega de afuera), cómo se llama cada fila de la barra de cupos cuando hay más de una cuenta ("Claude ·
// trabajo") y en qué orden van. Puro: lo prueba tests/cuentas-vista.test.ts. Quien tiene una sola cuenta por proveedor no pasa por acá.
import type { SuscripcionCupo } from "./contrato";

export type ProveedorCuenta = "claude" | "google" | "chatgpt";
export const PROVEEDORES: readonly ProveedorCuenta[] = ["claude", "google", "chatgpt"];
/** Cómo se nombra el proveedor delante de la cuenta (la tarjeta de Plan y cupos lleva el nombre largo de cada plan). */
export const MARCA: Record<ProveedorCuenta, string> = { claude: "Claude", google: "Google", chatgpt: "ChatGPT" };

/** `logueado`: `null` = no se preguntó (o el CLI no lo sabe). `defecto`: la de siempre, cuyo id es el del proveedor. */
export type PerfilCuenta = { id: string; proveedor: ProveedorCuenta; nombre: string; defecto: boolean; logueado: boolean | null };
/** `error`: el comando `cuentas` está pero no se pudo leer la lista (texto del main, a traducir con `textoMain`); entonces `cuentas` va vacía. */
export type ListaCuentas = { version: 1; cuentas: PerfilCuenta[]; error?: string };
export type ResultadoCuenta = { ok: true; id?: string } | { ok: false; error: string };

const esProveedor = (x: unknown): x is ProveedorCuenta => typeof x === "string" && (PROVEEDORES as readonly string[]).includes(x);

/** Sólo la forma esperada; cualquier otra cosa es «no hay varias cuentas» (`null`), y la app se ve como siempre. Una lista con `error` y sin cuentas pasa: es el motivo por el que no hay lista. */
export function listaValida(x: unknown): ListaCuentas | null {
  const o = x as { version?: unknown; cuentas?: unknown; error?: unknown } | null;
  if (!o || o.version !== 1 || !Array.isArray(o.cuentas)) return null;
  if (typeof o.error === "string" && o.error && o.cuentas.length === 0) return { version: 1, cuentas: [], error: o.error };
  const cuentas: PerfilCuenta[] = [];
  for (const c of o.cuentas) {
    const p = (c ?? {}) as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id || !esProveedor(p.proveedor)) continue;
    cuentas.push({
      id: p.id,
      proveedor: p.proveedor,
      nombre: typeof p.nombre === "string" && p.nombre ? p.nombre : p.id,
      defecto: p.defecto === true || p.id === p.proveedor,
      logueado: typeof p.logueado === "boolean" ? p.logueado : null,
    });
  }
  return cuentas.length ? { version: 1, cuentas } : null;
}

export const resultadoValido = (x: unknown): ResultadoCuenta => {
  const o = x as { ok?: unknown; id?: unknown; error?: unknown } | null;
  if (o?.ok === true) return typeof o.id === "string" ? { ok: true, id: o.id } : { ok: true };
  return { ok: false, error: typeof o?.error === "string" && o.error ? o.error : "main.cuentasFallo" };
};

/** Las cuentas de un proveedor, la de siempre primero. */
export const deProveedor = (l: ListaCuentas | null, p: ProveedorCuenta): PerfilCuenta[] =>
  (l?.cuentas ?? []).filter((c) => c.proveedor === p).sort((a, b) => Number(b.defecto) - Number(a.defecto));

/** El proveedor de una suscripción de la barra; sin el dato de `reparto`, su id es el proveedor (así era antes de las cuentas). */
export const proveedorDe = (s: Pick<SuscripcionCupo, "id" | "proveedor">): string => s.proveedor ?? s.id;

/**
 * El nombre de una cuenta delante del proveedor cuando hay varias del mismo: "Claude · trabajo". La de siempre sin renombrar
 * (su nombre es el del proveedor) es la «principal»; si la renombraron, va con su nombre.
 */
export function etiquetaCuenta(proveedor: string, nombre: string, defecto: boolean, principal: string, nombresDeFabrica: readonly string[] = []): string {
  const marca = (MARCA as Record<string, string>)[proveedor] ?? nombre;
  return `${marca} · ${parteCuenta(proveedor, nombre, defecto, principal, nombresDeFabrica)}`;
}

/** Sólo la cuenta ("trabajo", "principal"): lo que cabe en la fila de la barra, donde el logo ya dice el proveedor. */
export function parteCuenta(proveedor: string, nombre: string, defecto: boolean, principal: string, nombresDeFabrica: readonly string[] = []): string {
  const marca = (MARCA as Record<string, string>)[proveedor] ?? nombre;
  const deFabrica = defecto && (!nombre.trim() || nombre === marca || nombresDeFabrica.includes(nombre));
  return deFabrica ? principal : nombre;
}

/** `primera`: abre un proveedor nuevo (lleva el separador delante); las cuentas de Claude cuelgan de su fila de siempre. */
/** `nombre`: el entero ("Claude · trabajo", para el tooltip); `corto`: lo que se escribe en la fila. */
export type FilaSusc = { s: SuscripcionCupo; nombre: string; corto: string; proveedor: string; primera: boolean };
export type FilasCupos = {
  /** Cómo se llama la fila de Claude (la de siempre): `null` = como hoy, cuando es la única de Claude. */
  claude: string | null;
  claudeCorto: string | null;
  filas: FilaSusc[];
};

/**
 * Las filas de la barra de cupos. Con una sola cuenta por proveedor queda todo como estaba (nombres de siempre, mismo orden).
 * Con más de una, las de un proveedor van juntas (la de siempre, después las agregadas) y se nombran "Claude · trabajo".
 * `claudeNombre`: cómo se llama la de siempre de Claude; `principal`: la palabra para la que no se renombró.
 */
export function filasDeCupos(subs: readonly SuscripcionCupo[] | undefined, claudeNombre: string | undefined, principal: string): FilasCupos {
  const lista = subs ?? [];
  const contar = new Map<string, number>();
  const contarDe = (p: string) => (contar.get(p) ?? 0) + (p === "claude" ? 1 : 0);
  for (const s of lista) {
    const p = proveedorDe(s);
    contar.set(p, (contar.get(p) ?? 0) + 1);
  }
  const varias = (p: string) => contarDe(p) > 1;
  const fabrica = ["Claude", "Google AI Pro", "ChatGPT"];

  // Orden: la fila de Claude va siempre primera (la arma la cabecera), sus agregadas detrás; el resto por proveedor, agrupado.
  const orden: string[] = [];
  for (const s of lista) {
    const p = proveedorDe(s);
    if (!orden.includes(p)) orden.push(p);
  }
  orden.sort((a, b) => Number(b === "claude") - Number(a === "claude"));
  const filas: FilaSusc[] = [];
  for (const p of orden) {
    const delProveedor = lista.filter((s) => proveedorDe(s) === p).sort((a, b) => Number(esDefecto(b)) - Number(esDefecto(a)));
    delProveedor.forEach((s, i) => {
      const nombre = varias(p) ? etiquetaCuenta(p, s.nombre, esDefecto(s), principal, fabrica) : s.nombre;
      const corto = varias(p) ? parteCuenta(p, s.nombre, esDefecto(s), principal, fabrica) : s.nombre;
      filas.push({ s, nombre, corto, proveedor: p, primera: i === 0 && p !== "claude" });
    });
  }
  const cNombre = claudeNombre ?? "Claude";
  return {
    claude: varias("claude") ? etiquetaCuenta("claude", cNombre, true, principal, fabrica) : null,
    claudeCorto: varias("claude") ? parteCuenta("claude", cNombre, true, principal, fabrica) : null,
    filas,
  };
}

/** La de siempre: su cuenta (o, sin ese dato, su id) es el proveedor. */
const esDefecto = (s: SuscripcionCupo): boolean => (s.cuenta ?? s.id) === proveedorDe(s);
