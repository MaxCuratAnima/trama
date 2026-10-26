#!/usr/bin/env node
// Registra `scripts/hook-compactando.sh` en `~/.claude/settings.json` (PreCompact y PostCompact, con el mismo
// comando): sin eso trama no ve quién compacta (electron/compactando.ts). Lo llama `scripts/instalar.sh`; también
// se puede correr a mano. Idempotente: el hook queda una sola vez por evento, con la ruta de este checkout (si
// había otra, de un checkout viejo, la reemplaza). Los otros hooks y el resto del settings no se tocan. Si el
// archivo no es JSON válido no se lo toca y sale con 1. Si no cambia nada, no lo reescribe.
// En Windows el comando es el shim `motor/bin-win/hook-compactando.cmd` (ruta con / y entre comillas) en vez del .sh, y
// además se registra `statusLine` con `motor/bin-win/hook-statusline.cmd`: sólo si no hay uno (uno ajeno no se pisa: se
// avisa y queda como estaba) o si el que hay ya es el nuestro (se actualiza la ruta).
// uso: node scripts/registrar-hook.mjs [settings.json]   (default: $CLAUDE_CONFIG_DIR o ~/.claude, settings.json)
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENTOS = ["PreCompact", "PostCompact"];
const MARCA = /hook-compactando\.(sh|cmd)/;
const MARCA_STATUSLINE = /hook-statusline\.cmd/;

// Comillas simples si la ruta tiene algo que el shell de Claude Code podría partir (espacios, etc.).
const shq = (s) => (/^[\w./@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
/** Qué se registra en esta plataforma: archivo a comprobar, comando del hook y (sólo Windows) el de statusLine. En Windows
 *  el shim va entre comillas y con `/`: así lo entienden bash, cmd y PowerShell. */
function hookDe(plataforma) {
  if (plataforma === "win32") {
    const bin = path.resolve(raiz, "..", "motor", "bin-win");
    const q = (f) => `"${path.join(bin, f).replace(/\\/g, "/")}"`;
    return { ruta: path.join(bin, "hook-compactando.cmd"), command: q("hook-compactando.cmd"), statusline: q("hook-statusline.cmd") };
  }
  const ruta = path.join(raiz, "scripts", "hook-compactando.sh");
  return { ruta, command: shq(ruta), statusline: null };
}

const esNuestro = (h) => !!h && typeof h === "object" && typeof h.command === "string" && MARCA.test(h.command);

/** Deja nuestro hook una sola vez en la lista de grupos de un evento. Devuelve la lista y si cambió. */
function registrarEvento(grupos, command) {
  let cambio = false;
  let puesto = false;
  const salida = [];
  for (const grupo of grupos) {
    if (!grupo || typeof grupo !== "object" || !Array.isArray(grupo.hooks) || !grupo.hooks.some(esNuestro)) {
      salida.push(grupo);
      continue;
    }
    const hooks = [];
    for (const h of grupo.hooks) {
      if (!esNuestro(h)) {
        hooks.push(h);
        continue;
      }
      if (puesto) {
        cambio = true; // duplicado: sale
        continue;
      }
      puesto = true;
      if (h.command !== command) {
        h.command = command;
        cambio = true;
      }
      hooks.push(h);
    }
    if (hooks.length) salida.push({ ...grupo, hooks });
  }
  if (!puesto) {
    salida.push({ hooks: [{ type: "command", command }] });
    cambio = true;
  }
  return { grupos: salida, cambio };
}

/** Pone `statusLine` si no hay, o actualiza el nuestro. Uno ajeno no se toca. Devuelve "cambio" | "igual" | "ajeno". */
function registrarStatusline(ajustes, command) {
  const actual = ajustes.statusLine;
  if (actual === undefined || actual === null) {
    ajustes.statusLine = { type: "command", command };
    return "cambio";
  }
  const propio = typeof actual === "object" && typeof actual.command === "string" && MARCA_STATUSLINE.test(actual.command);
  if (!propio) return "ajeno";
  if (actual.command === command) return "igual";
  actual.command = command;
  return "cambio";
}

/** Aplica el registro al objeto de settings (lo muta). Devuelve true si cambió algo. */
function registrar(ajustes, command) {
  if (ajustes.hooks === undefined) ajustes.hooks = {};
  if (!ajustes.hooks || typeof ajustes.hooks !== "object" || Array.isArray(ajustes.hooks)) {
    throw new Error("hooks no es un objeto");
  }
  let cambio = false;
  for (const evento of EVENTOS) {
    const actual = ajustes.hooks[evento];
    if (actual !== undefined && !Array.isArray(actual)) throw new Error(`hooks.${evento} no es una lista`);
    const r = registrarEvento(actual ?? [], command);
    if (r.cambio) {
      ajustes.hooks[evento] = r.grupos;
      cambio = true;
    }
  }
  return cambio;
}

function main() {
  const destino =
    process.argv[2] ?? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "settings.json");
  const hook = hookDe(process.platform);
  if (!existsSync(hook.ruta)) fail(`no existe ${hook.ruta}`);

  // Si el settings es un enlace (dotfiles), se escribe el archivo real: no se reemplaza el enlace.
  const real = existsSync(destino) ? realpathSync(destino) : destino;
  const existe = existsSync(real);
  let ajustes = {};
  if (existe) {
    const texto = readFileSync(real, "utf8");
    if (texto.trim() !== "") {
      try {
        ajustes = JSON.parse(texto);
      } catch {
        fail(`${destino} no es JSON válido; no lo toqué`);
      }
    }
    if (!ajustes || typeof ajustes !== "object" || Array.isArray(ajustes)) fail(`${destino} no es un objeto JSON`);
  }

  let cambio;
  let estado = "igual";
  try {
    cambio = registrar(ajustes, hook.command);
    if (hook.statusline) {
      estado = registrarStatusline(ajustes, hook.statusline);
      if (estado === "cambio") cambio = true;
    }
  } catch (e) {
    fail(`${destino}: ${e.message}; no lo toqué`);
  }
  if (estado === "ajeno") console.log(`statusLine: ya hay uno propio en ${destino}; no lo toqué (hook-statusline no está activo)`);
  if (!cambio) {
    console.log(`hook de compactando ya registrado en ${destino}`);
    return;
  }

  // Escritura atómica, con el modo del archivo de antes (el settings puede tener secretos: no se abre más amplio).
  mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.${process.pid}.tmp`;
  const modo = existe ? statSync(real).mode & 0o777 : 0o600;
  writeFileSync(tmp, `${JSON.stringify(ajustes, null, 2)}\n`, { mode: modo });
  renameSync(tmp, real);
  console.log(`hook de compactando registrado en ${destino} (${EVENTOS.join(", ")}${estado === "cambio" ? " y statusLine" : ""})`);
}

function fail(msg) {
  console.error(`registrar-hook: ${msg}`);
  process.exit(1);
}

main();
