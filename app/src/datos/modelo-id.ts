// UNA sola forma de entender el id de un modelo ("claude-sonnet-5-5[1m]", "agy:claude-opus-5-5-high",
// "gemini-3.8-flash-high", "ollama:qwen3"). Antes había tres clasificadores por subcadena que se
// contradecían (un `agy:claude-opus-…` —Claude servido por Google— caía en la fila Opus de Claude).
// Orden fijo: primero el PROVEEDOR por prefijo (`agy:` y `gemini-` son de Google, `ollama:` es local) y
// recién después la familia y la versión. El proveedor gana: lo que sirve Google nunca es "de Anthropic".
// Sin imports: lo usan la barra, los paneles y los tests.

export type Proveedor = "anthropic" | "google" | "local" | "otro";
export type Linea = "opus" | "sonnet" | "fable" | "haiku" | "gemini" | "otro";

export type ModeloId = {
  proveedor: Proveedor;
  /** La familia: opus, sonnet, fable, haiku, gemini; lo demás, "otro". */
  linea: Linea;
  /** "5.5", "3.8"; `null` si el id no la dice. */
  version: string | null;
  /** El nivel de razonamiento que los ids de Google traen pegado al final (`-high`). */
  nivel: string | null;
  /** El id sin lo que no cambia el modelo (`[1m]`, la fecha de Claude, el `-high` de Google): sirve para juntar. */
  id: string;
  /** Cómo se llama, sin decir quién lo sirve: "Opus 5.5", "Claude Opus 5.5", "Gemini 3.8 Flash". */
  nombre: string;
  /** Lo que se muestra: igual que `nombre`, más "· por Google" si lo sirve Google. */
  etiqueta: string;
};

const FAMILIAS_CLAUDE = "opus|sonnet|fable|haiku";
const NUEVO = new RegExp(`^(?:claude-)?(${FAMILIAS_CLAUDE})(?:-(\\d+)(?:-(\\d{1,2}))?)?(?:-\\d{6,})?$`);
const VIEJO = new RegExp(`^claude-(\\d+)(?:-(\\d{1,2}))?-(${FAMILIAS_CLAUDE})(?:-\\d{6,})?$`);
const CUALQUIERA = /^(?:claude-)?([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?$/;
const NIVEL = /-(low|medium|high)$/;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const version = (a: string | undefined, b: string | undefined) => (a ? (b ? `${a}.${b}` : a) : null);
/** "gpt-oss-120b" → "Gpt Oss 120b": para lo que ninguna tabla nombra. */
const bonito = (s: string) => s.split("-").filter(Boolean).map(cap).join(" ");

/** Claude por su id (con o sin `claude-`): familia, versión y el id sin fecha. `null`: no es de una familia conocida. */
function claude(s: string): { linea: Linea; version: string | null; id: string } | null {
  const n = NUEVO.exec(s);
  if (n) return { linea: n[1] as Linea, version: version(n[2], n[3]), id: `claude-${n[1]}${n[2] ? `-${n[2]}${n[3] ? `-${n[3]}` : ""}` : ""}` };
  const v = VIEJO.exec(s);
  if (v) return { linea: v[3] as Linea, version: version(v[1], v[2]), id: s.replace(/-\d{6,}$/, "") };
  return null;
}

const vacio: ModeloId = { proveedor: "otro", linea: "otro", version: null, nivel: null, id: "", nombre: "", etiqueta: "" };

/** Lee un id de modelo. Nunca falla: lo que no reconoce queda como `otro`, con su id tal cual. */
export function parsearModelo(modelo: string | null | undefined): ModeloId {
  const crudo = (modelo ?? "").trim();
  if (!crudo) return vacio;
  const limpio = crudo.replace(/\[[^\]]*\]$/, "");
  const l = limpio.toLowerCase();

  // 1. El proveedor, por prefijo.
  if (l.startsWith("ollama:")) {
    const nombre = limpio.slice(7);
    return { proveedor: "local", linea: "otro", version: null, nivel: null, id: limpio, nombre, etiqueta: nombre };
  }
  if (l.startsWith("agy:") || l.startsWith("gemini-")) {
    const agy = l.startsWith("agy:");
    const cuerpo = (agy ? l.slice(4) : l).replace(NIVEL, "");
    const nivel = NIVEL.exec(agy ? l.slice(4) : l)?.[1] ?? null;
    const c = agy ? claude(cuerpo.replace(/^.*[/.:](?=claude-)/, "")) : null;
    let r: Pick<ModeloId, "linea" | "version" | "id" | "nombre">;
    if (c) r = { linea: c.linea, version: c.version, id: `agy:${c.id}`, nombre: `Claude ${cap(c.linea)}${c.version ? ` ${c.version}` : ""}` };
    else if (agy) r = { linea: "otro", version: null, id: `agy:${cuerpo}`, nombre: bonito(cuerpo) };
    else r = { linea: "gemini", version: /(?:^|-)(\d+(?:\.\d+)*)(?=-|$)/.exec(cuerpo)?.[1] ?? null, id: cuerpo, nombre: bonito(cuerpo) };
    return { proveedor: "google", nivel, etiqueta: `${r.nombre} · por Google`, ...r };
  }

  // 2. Claude (Anthropic). Un prefijo de ruta ("anthropic/claude-…") no cambia quién es.
  const c = claude(l.replace(/^.*[/.:](?=claude-)/, ""));
  if (c) {
    const nombre = `${cap(c.linea)}${c.version ? ` ${c.version}` : ""}`;
    return { proveedor: "anthropic", linea: c.linea, version: c.version, nivel: null, id: c.id, nombre, etiqueta: nombre };
  }
  const o = CUALQUIERA.exec(l);
  if (o) {
    const nombre = `${cap(o[1])} ${version(o[2], o[3])}`;
    return { proveedor: l.startsWith("claude-") ? "anthropic" : "otro", linea: "otro", version: version(o[2], o[3]), nivel: null, id: limpio, nombre, etiqueta: nombre };
  }
  return { proveedor: l.startsWith("claude-") ? "anthropic" : "otro", linea: "otro", version: null, nivel: null, id: limpio, nombre: limpio, etiqueta: limpio };
}

/** ¿Lo sirve Google (`agy:*` o `gemini-*`)? Aunque el modelo sea un Claude. */
export const esDeGoogle = (modelo: string | null | undefined): boolean => parsearModelo(modelo).proveedor === "google";
