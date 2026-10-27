// Ajustes > Extensiones: qué skills, agentes, plugins y servidores MCP tiene la carpeta de config de Claude de una cuenta
// (`~/.claude` para la de siempre; `<config de Trama>/cuentas/<id>` = su CLAUDE_CONFIG_DIR para una agregada) y "Importar a esta
// cuenta", que COPIA desde la de siempre lo que a la otra le falta. Sin `electron`: lo prueba tests/extensiones.test.ts.
// Reglas: sólo lee archivos de configuración (jamás `.credentials.json`), de los MCP muestra nombre, tipo y comando/servidor
// (nunca `env`, `headers`, argumentos ni query de la URL) y al importar no pisa nada de lo que la cuenta ya tiene.
import fs from "node:fs";
import path from "node:path";
import { idValido } from "./cuentas-varias.ts";
import { textoT } from "./errores.ts";

export type ExtItem = { nombre: string; descripcion: string; origen: string; modelo: string | null };
export type ExtPlugin = { nombre: string; mercado: string; version: string; activo: boolean | null; origen: string };
export type ExtMcp = { nombre: string; tipo: string; destino: string; origen: string };
export type Extensiones = { version: 1; cuenta: string; defecto: boolean; skills: ExtItem[]; agentes: ExtItem[]; plugins: ExtPlugin[]; mcp: ExtMcp[] };
export type ResultadoImportar = { ok: true; skills: number; agentes: number; mcp: number; omitidos: number } | { ok: false; error: string };

/** Dónde buscar: `dir` es la carpeta de config; `claudeJson` el `.claude.json` de esa cuenta (el de siempre vive en el home, el de una agregada dentro de su carpeta). */
export type Carpeta = { id: string; dir: string; claudeJson: string; defecto: boolean };
export type Raices = { home: string; dirTrama: string };

const DESC_MAX = 240;
const PELIGROSAS = new Set(["__proto__", "constructor", "prototype"]);

/** La carpeta de una cuenta por su id: vacío o `claude` = la de siempre. Una agregada tiene que existir; el id nunca arma una ruta fuera de `cuentas/`. */
export function carpetaDe(id: unknown, r: Raices): Carpeta | null {
  if (id === undefined || id === null || id === "" || id === "claude") {
    return { id: "claude", dir: path.join(r.home, ".claude"), claudeJson: path.join(r.home, ".claude.json"), defecto: true };
  }
  if (!idValido(id)) return null;
  const dir = path.join(r.dirTrama, "cuentas", id);
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  return { id, dir, claudeJson: path.join(dir, ".claude.json"), defecto: false };
}

const leerTexto = (f: string): string | null => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

function leerJson(f: string): unknown {
  const t = leerTexto(f);
  if (t === null) return undefined;
  try {
    return JSON.parse(t.replace(/^\uFEFF/, ""));
  } catch {
    return undefined;
  }
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function sinComillas(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Las claves `nombre: valor` de la cabecera `---` de un SKILL.md o de un agente (YAML simple: texto, comillas, `>` / `|` y líneas con sangría). */
export function frontmatter(txt: string): Record<string, string> {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
  const out: Record<string, string> = {};
  if (!m) return out;
  const lineas = m[1].split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const k = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lineas[i]);
    if (!k) continue;
    let v = k[2].trim();
    const bloque = /^[>|][+-]?$/.test(v);
    if (bloque || v === "" || !/^["']/.test(v)) {
      const resto: string[] = bloque || v === "" ? [] : [v];
      while (i + 1 < lineas.length && (/^\s+\S/.test(lineas[i + 1]) || (bloque && lineas[i + 1].trim() === ""))) {
        const l = lineas[++i].trim();
        // Una lista (`tools:` con `- Read`) no es texto: se descarta.
        if (!bloque && v === "" && l.startsWith("- ")) continue;
        resto.push(l);
      }
      v = resto.filter(Boolean).join(" ");
    }
    out[k[1]] = sinComillas(v.trim());
  }
  return out;
}

const corto = (s: string, max = DESC_MAX) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const porNombre = <T extends { nombre: string }>(l: T[]): T[] => l.sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { sensitivity: "base" }));

function esDir(f: string): boolean {
  try {
    return fs.statSync(f).isDirectory();
  } catch {
    return false;
  }
}

/** Las skills: una subcarpeta con SKILL.md por cada una. */
export function leerSkills(dir: string): ExtItem[] {
  const base = path.join(dir, "skills");
  const out: ExtItem[] = [];
  let nombres: string[] = [];
  try {
    nombres = fs.readdirSync(base);
  } catch {
    return out;
  }
  for (const n of nombres) {
    if (n.startsWith(".")) continue;
    const txt = leerTexto(path.join(base, n, "SKILL.md"));
    if (txt === null) continue;
    const fm = frontmatter(txt);
    out.push({ nombre: fm.name || n, descripcion: corto(fm.description ?? ""), origen: "skills", modelo: fm.model || null });
  }
  return porNombre(out);
}

/** Los agentes: cada `*.md` de `agents/`. */
export function leerAgentes(dir: string): ExtItem[] {
  const base = path.join(dir, "agents");
  const out: ExtItem[] = [];
  let nombres: string[] = [];
  try {
    nombres = fs.readdirSync(base);
  } catch {
    return out;
  }
  for (const n of nombres) {
    if (!n.toLowerCase().endsWith(".md") || n.startsWith(".")) continue;
    const txt = leerTexto(path.join(base, n));
    if (txt === null) continue;
    const fm = frontmatter(txt);
    out.push({ nombre: fm.name || n.replace(/\.md$/i, ""), descripcion: corto(fm.description ?? ""), origen: "agents", modelo: fm.model || null });
  }
  return porNombre(out);
}

/** Los plugins instalados (`plugins/installed_plugins.json`, versión 1 o 2) y si están prendidos (`enabledPlugins` de settings.json). */
export function leerPlugins(dir: string): ExtPlugin[] {
  const inst = leerJson(path.join(dir, "plugins", "installed_plugins.json"));
  const sett = leerJson(path.join(dir, "settings.json"));
  const prendidos = esObjeto(sett) && esObjeto(sett.enabledPlugins) ? sett.enabledPlugins : {};
  const instalados = esObjeto(inst) && esObjeto(inst.plugins) ? inst.plugins : {};
  const claves = new Set([...Object.keys(instalados), ...Object.keys(prendidos)]);
  const out: ExtPlugin[] = [];
  for (const clave of claves) {
    if (PELIGROSAS.has(clave)) continue;
    const [nombre, ...resto] = clave.split("@");
    const mercado = resto.join("@");
    const e = instalados[clave];
    const primera = Array.isArray(e) ? e[0] : e;
    const version = esObjeto(primera) && typeof primera.version === "string" ? primera.version : "";
    const activo = typeof prendidos[clave] === "boolean" ? (prendidos[clave] as boolean) : null;
    out.push({ nombre: nombre || clave, mercado, version: corto(version, 40), activo, origen: clave in instalados ? "installed_plugins.json" : "settings.json" });
  }
  return porNombre(out);
}

/** De un servidor MCP sólo lo que es seguro mostrar: el tipo y a qué se conecta (el programa, o el host de la URL). Nunca `env`, `headers` ni argumentos. */
function resumenMcp(cfg: unknown): { tipo: string; destino: string } {
  if (!esObjeto(cfg)) return { tipo: "?", destino: "" };
  const cmd = typeof cfg.command === "string" ? cfg.command : "";
  const url = typeof cfg.url === "string" ? cfg.url : "";
  const tipo = typeof cfg.type === "string" && cfg.type ? cfg.type : cmd ? "stdio" : url ? "http" : "?";
  let destino = "";
  if (cmd) destino = path.basename(cmd.replace(/\\/g, "/"));
  else if (url) {
    try {
      destino = new URL(url).host;
    } catch {
      destino = "";
    }
  }
  return { tipo: corto(tipo, 20), destino: corto(destino, 80) };
}

/** Los `mcpServers` de ese JSON (`{}` si no hay o no se entiende). */
function servidoresDe(f: string): Record<string, unknown> {
  const j = leerJson(f);
  return esObjeto(j) && esObjeto(j.mcpServers) ? j.mcpServers : {};
}

export function leerMcp(c: Carpeta): ExtMcp[] {
  const out: ExtMcp[] = [];
  const vistos = new Set<string>();
  for (const [origen, archivo] of [[".claude.json", c.claudeJson], ["settings.json", path.join(c.dir, "settings.json")]] as const) {
    for (const [nombre, cfg] of Object.entries(servidoresDe(archivo))) {
      if (PELIGROSAS.has(nombre) || vistos.has(`${origen}\0${nombre}`)) continue;
      vistos.add(`${origen}\0${nombre}`);
      out.push({ nombre, ...resumenMcp(cfg), origen });
    }
  }
  return porNombre(out);
}

export function leerExtensiones(c: Carpeta): Extensiones {
  return { version: 1, cuenta: c.id, defecto: c.defecto, skills: leerSkills(c.dir), agentes: leerAgentes(c.dir), plugins: leerPlugins(c.dir), mcp: leerMcp(c) };
}

/** Escribe sin dejar el archivo a medias: a un temporal y se renombra encima. */
function escribirAtomico(f: string, texto: string) {
  const tmp = `${f}.trama-${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, texto, "utf8");
    fs.renameSync(tmp, f);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Copia de la cuenta de siempre a `destino`: las skills y los agentes que a la otra le faltan (un nombre que ya tiene se deja como está) y
 * los servidores MCP cuyo nombre no tiene en su `.claude.json`. Nunca toca `.credentials.json` ni nada más de ese archivo. Si el
 * `.claude.json` de destino no se puede leer como JSON no se escribe nada en él.
 */
export function importarExtensiones(origen: Carpeta, destino: Carpeta): ResultadoImportar {
  if (destino.defecto || origen.dir === destino.dir) return { ok: false, error: textoT("main.extMisma") };
  if (!esDir(destino.dir)) return { ok: false, error: textoT("main.extSinCarpeta") };
  let skills = 0;
  let agentes = 0;
  let mcp = 0;
  let omitidos = 0;
  try {
    const baseS = path.join(origen.dir, "skills");
    const hayS = fs.existsSync(baseS) ? fs.readdirSync(baseS) : [];
    for (const n of hayS) {
      if (n.startsWith(".") || !fs.existsSync(path.join(baseS, n, "SKILL.md"))) continue;
      const dst = path.join(destino.dir, "skills", n);
      if (fs.existsSync(dst)) {
        omitidos++;
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try {
        fs.cpSync(path.join(baseS, n), dst, {
          recursive: true,
          force: false,
          errorOnExist: true,
          filter: (src) => !/^(\.credentials\.json|\.git)$/i.test(path.basename(src)),
        });
      } catch (e) {
        fs.rmSync(dst, { recursive: true, force: true });
        throw e;
      }
      skills++;
    }

    const baseA = path.join(origen.dir, "agents");
    const hayA = fs.existsSync(baseA) ? fs.readdirSync(baseA) : [];
    for (const n of hayA) {
      if (!n.toLowerCase().endsWith(".md") || n.startsWith(".")) continue;
      const dst = path.join(destino.dir, "agents", n);
      if (fs.existsSync(dst)) {
        omitidos++;
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(baseA, n), dst, fs.constants.COPYFILE_EXCL);
      agentes++;
    }

    // Los MCP de la de siempre (`.claude.json` primero, después los de settings.json) que la otra no tiene por nombre.
    const quiere: Record<string, unknown> = {};
    for (const archivo of [path.join(origen.dir, "settings.json"), origen.claudeJson]) {
      for (const [nombre, cfg] of Object.entries(servidoresDe(archivo))) if (!PELIGROSAS.has(nombre) && esObjeto(cfg)) quiere[nombre] = cfg;
    }
    if (Object.keys(quiere).length) {
      const txt = leerTexto(destino.claudeJson);
      let json: Record<string, unknown> = {};
      if (txt !== null) {
        let leido: unknown;
        try {
          leido = JSON.parse(txt.replace(/^\uFEFF/, ""));
        } catch {
          return { ok: false, error: textoT("main.extJsonRoto") };
        }
        if (!esObjeto(leido) || (leido.mcpServers !== undefined && !esObjeto(leido.mcpServers))) return { ok: false, error: textoT("main.extJsonRoto") };
        json = leido;
      }
      const propios = esObjeto(json.mcpServers) ? json.mcpServers : {};
      const nuevos: Record<string, unknown> = { ...propios };
      let agregados = 0;
      for (const [nombre, cfg] of Object.entries(quiere)) {
        if (Object.hasOwn(propios, nombre)) {
          omitidos++;
          continue;
        }
        nuevos[nombre] = cfg;
        agregados++;
      }
      if (agregados) {
        json.mcpServers = nuevos;
        escribirAtomico(destino.claudeJson, `${JSON.stringify(json, null, 2)}\n`);
        mcp = agregados;
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, skills, agentes, mcp, omitidos };
}
