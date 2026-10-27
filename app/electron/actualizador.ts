// El aviso de "hay una versión nueva" de un CLI (Claude Code, Antigravity): la instalada sale de
// `<bin> --version` y la última de lo que diga `cfg.ultima` (npm, el actualizador de agy…); el
// binario por execFile (sin shell) con timeout corto. Se chequea cuando el frontend lo pide por
// primera vez (al abrir) y después cada 6 h; a la fuente de la última no se le vuelve a preguntar
// si contestó hace menos de 6 h (el archivo `cfg.archivo` en el estado de la app). Si algo falla
// (sin red), silencio: queda lo último que se supo. Actualizar es un botón: `<bin> <args>` (execFile, sin
// shell). `enTerminal` abre una consola que se espera hasta que el comando termina, para lo que pide
// contraseña o un login. Los usos: electron/actualizacion.ts (claude) y electron/actualizacion-agy.ts (agy).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { escribirAtomico } from "./pa.js";
import { textoT } from "./errores.js";
import { avisoDe, CADA_MS, comparar, desdeArchivo, hayQueConsultar, normal, type Aviso, type Chequeo } from "./version.js";
import { silencio } from "./log.js";
import { carpetasPath, caminos, separadorPath } from "./plataforma.js";
import { execFileCmd, guionTerminalWindows } from "./procesos.js";

/** Abierta desde el menú de apps la sesión gráfica puede no traer estas carpetas en el PATH (ver binario.ts). */
export function entorno(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const c = caminos(process.platform);
  const extra = [c.join(home, ".local", "bin"), c.join(home, ".npm-global", "bin")];
  const resto = carpetasPath(process.platform, process.env).filter((d) => !extra.includes(d));
  const clave = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "Path";
  return { ...process.env, [clave]: [...extra, ...resto].join(separadorPath(process.platform)) };
}

/** Lo que imprime el comando, normalizado a "x.y.z"; null si falló o no se entiende. */
export const versionDe = (bin: string, args: string[], timeout: number) =>
  new Promise<string | null>((listo) => {
    execFileCmd(bin, args, { timeout, env: entorno(), maxBuffer: 64 * 1024 }, (err, stdout) => listo(err ? null : normal(String(stdout))));
  });

/** Lo que pasó al apretar Actualizar: la versión que quedó, o el error (corto y entero). */
export type Actualizado = { ok: true; version: string } | { ok: false; error: string };

/** Lo que dio la corrida: `err` si no corrió (no hay terminal), `dijo` lo que contó (o null). */
type Corrida = { err: string | null; dijo: string | null };

/**
 * Abre una consola nueva (`start /wait`) que corre un .cmd con `argv` y espera a que el comando termine (marca con su rc): con
 * rc distinto de 0 la ventana queda esperando una tecla, así se ve el error. Sin consola (ENOENT) no corre nada y lo dice. Texto como clave de `main.*` (electron/errores.ts).
 */
export function enTerminal(argv: string[], env: NodeJS.ProcessEnv): Promise<Corrida> {
  const term = process.env.ComSpec || "cmd.exe";
  // Se espera el FIN DEL COMANDO, no el de la ventana: el guion anota su rc en una marca. Con rc 0 la
  // ventana se cierra sola; con rc distinto de 0 espera una tecla (y igual se resuelve ya). Sin marca al salir: la cerraron a mano.
  const dir = mkdtempSync(path.join(os.tmpdir(), "trama-act-"));
  const marca = path.join(dir, "rc");
  const guion = path.join(dir, "correr.cmd");
  return new Promise((listo) => {
    let fin = false;
    let reloj: NodeJS.Timeout | undefined;
    const rcDe = (): number | null => {
      try {
        const n = parseInt(readFileSync(marca, "utf8"), 10);
        return Number.isNaN(n) ? null : n;
      } catch {
        return null;
      }
    };
    const cerrar = (r: Corrida) => {
      if (fin) return;
      fin = true;
      clearInterval(reloj);
      rmSync(dir, { recursive: true, force: true });
      listo(r);
    };
    const mirar = (): boolean => {
      const rc = rcDe();
      if (rc === null) return false;
      const falla = rc === 0 ? null : textoT("main.terminalFallo", { rc: String(rc) });
      cerrar({ err: falla, dijo: falla });
      return true;
    };
    writeFileSync(guion, guionTerminalWindows(argv, marca));
    const p = spawn(term, ["/d", "/c", "start", "", "/wait", guion], { env, stdio: "ignore" });
    p.on("error", () => cerrar({ err: textoT("main.terminalNo", { t: term }), dijo: null }));
    p.on("exit", () => {
      if (!mirar()) cerrar({ err: null, dijo: textoT("main.terminalCerro") });
    });
    reloj = setInterval(mirar, 250);
  });
}

export type Config = {
  /** Dónde se guarda lo último que se supo. */
  archivo: string;
  /** El binario (`claude`, `agy`). */
  bin: string;
  /** Cómo se llama el módulo en el log. */
  nombre: string;
  /** La última versión (x.y.z) o null si no se pudo saber. Sólo se llama si toca (cada 6 h). */
  ultima: () => Promise<string | null>;
  /**
   * Cómo se actualiza: `{ args }` corre `<bin> <args>` (execFile, sin shell, hasta 5 min); `{ terminal }` abre esa
   * orden en una consola y espera a que la cierren.
   */
  actualizar: { args: string[] } | { terminal: string[] };
  /** El entorno de Actualizar. */
  entornoActualizar: () => NodeJS.ProcessEnv;
  /** Sin binario no hay aviso (ni se consulta la última): lo que se supo de antes se olvida. */
  olvidarSiFalta?: boolean;
};

export const VERSION_ARCHIVO = 1;

export function crearActualizador(cfg: Config) {
  let estado: Chequeo | null = null;
  let enCurso: Promise<Aviso | null> | null = null;
  let armado = false;
  let actualizando: Promise<Actualizado> | null = null;
  const oyentes = new Set<(a: Aviso | null) => void>();

  async function cargar(): Promise<Chequeo> {
    if (estado) return estado;
    try {
      estado = desdeArchivo(JSON.parse(await readFile(cfg.archivo, "utf8")), VERSION_ARCHIVO);
    } catch {
      estado = desdeArchivo(null, VERSION_ARCHIVO);
    }
    return estado;
  }

  const guardar = (c: Chequeo) => escribirAtomico(cfg.archivo, JSON.stringify({ version: VERSION_ARCHIVO, ...c })).catch(silencio(cfg.nombre));
  const mismoAviso = (a: Aviso | null, b: Aviso | null) => a?.instalada === b?.instalada && a?.ultima === b?.ultima;

  /** Un chequeo: la instalada siempre (es local y barata), la última sólo si toca. Nunca rechaza. */
  function chequear(): Promise<Aviso | null> {
    enCurso ??= (async () => {
      const c = await cargar();
      const antes = avisoDe(c);
      const sigue: Chequeo = { ...c };
      const leida = await versionDe(cfg.bin, ["--version"], 5_000);
      sigue.instalada = leida ?? (cfg.olvidarSiFalta ? null : c.instalada);
      const ahora = Date.now();
      if ((leida || !cfg.olvidarSiFalta) && hayQueConsultar(c.chequeado, ahora)) {
        const ultima = await cfg.ultima().catch(() => null);
        if (ultima) {
          sigue.ultima = ultima;
          sigue.chequeado = ahora;
        }
      }
      // Un Dismiss mientras se esperaba a la fuente no se pisa.
      sigue.descartada = estado?.descartada ?? sigue.descartada;
      if (JSON.stringify(sigue) !== JSON.stringify(estado)) {
        estado = sigue;
        await guardar(sigue);
      }
      const aviso = avisoDe(sigue);
      if (!mismoAviso(antes, aviso)) for (const f of oyentes) f(aviso);
      return aviso;
    })().finally(() => (enCurso = null));
    return enCurso;
  }

  /** El aviso de ahora (o null). La primera vez arma el chequeo cada 6 h (la app residente). */
  function leerAviso(): Promise<Aviso | null> {
    if (!armado) {
      armado = true;
      // Un minuto de más: que a las 6 h el último chequeo ya haya vencido.
      setInterval(() => void chequear(), CADA_MS + 60_000).unref();
    }
    return chequear();
  }

  /** Dismiss: no avisar de esta versión (sí de la próxima). */
  async function descartar(): Promise<void> {
    const c = await cargar();
    if (!c.ultima || c.descartada === c.ultima) return;
    estado = { ...c, descartada: c.ultima };
    await guardar(estado);
    for (const f of oyentes) f(null);
  }

  const alCambiarAviso = (f: (a: Aviso | null) => void) => void oyentes.add(f);

  /** Las últimas líneas con algo de lo que dijo el comando (o `null`). */
  const ultimas = (s: string) => s.trim().split("\n").map((l) => l.trim()).filter(Boolean).slice(-6).join("\n") || null;

  /** Corre Actualizar: `{ args }` (execFile) o `{ terminal }` (una ventana que se espera). */
  function correr(): Promise<Corrida> {
    const a = cfg.actualizar;
    if ("terminal" in a) return enTerminal(a.terminal, cfg.entornoActualizar());
    return new Promise((listo) =>
      execFileCmd(cfg.bin, a.args, { timeout: 5 * 60_000, env: cfg.entornoActualizar(), maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
        listo({ err: err ? err.message : null, dijo: ultimas(`${String(stderr ?? "")}\n${String(stdout ?? "")}`) }),
      ),
    );
  }

  /**
   * Corre Actualizar y espera. Después relee `--version`: si no subió a la última conocida, es un error (con lo que
   * dijo el updater, o la terminal). Si subió, el aviso se va.
   */
  function actualizar(): Promise<Actualizado> {
    actualizando ??= (async (): Promise<Actualizado> => {
      const { err, dijo } = await correr();
      const version = await versionDe(cfg.bin, ["--version"], 5_000);
      const c = await cargar();
      if (version) {
        estado = { ...c, instalada: version };
        await guardar(estado);
        for (const f of oyentes) f(avisoDe(estado));
      }
      if (err) return { ok: false, error: dijo ?? err };
      if (!version) return { ok: false, error: dijo ?? `${path.basename(cfg.bin)} --version` };
      if (c.ultima && comparar(version, c.ultima) < 0) return { ok: false, error: dijo ?? version };
      return { ok: true, version };
    })().finally(() => (actualizando = null));
    return actualizando;
  }

  return { leerAviso, descartar, alCambiarAviso, actualizar };
}
