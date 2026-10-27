// Uso del plan y líderes: lo que `statusline-espejo.sh` deja en
// `$PA_STATE/statusline/<session_id>.json` (uno por sesión jefe). Es la única
// lectura directa del estado de `pa` que hace la app (ver "Contrato" en
// CLAUDE.md). El uso sale además del stream de los líderes de la app, que no
// tienen statusline (electron/uso.ts). Los líderes son las sesiones interactivas vivas de Claude Code
// (`~/.claude/sessions/<pid>.json`) y los de la app (lider.ts, `lideres.json`);
// el statusline les pone modelo y caché.
// Node puro: se prueba desde la terminal.
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cacheDe } from "./cache.ts";
import { textoT } from "./errores.ts";
import { ESTADO, escribirAtomico, PA_STATE } from "./pa.js";
import { lideresApp, procDe, transcriptDe, transcriptPorDefecto, usoVisto } from "./lider.js";
import { real, registro, type Proyecto } from "./registro.js";
import { sesiones, type Sesion } from "./sesiones.js";
import { creadoEn, proyectoEnTexto, recortar, temaDe, tituloEsElPrimero, tituloLider } from "./tema.js";
import { tituloAuto } from "./titulo-auto.js";
import { cuposActuales, type SuscripcionCupo } from "./cupos.js";
import { deStatusline, esCuentaDeSiempre, usoDe, type Ventana } from "./uso.ts";
import { verCaidos, type Caido } from "./vigia.js";
import { silencio } from "./log.js";

export { SESIONES } from "./sesiones.js";
export const DIR = path.join(PA_STATE, "statusline");
const VERSION = 1;
/** Para las barras de uso sólo cuentan los statusline de las últimas 6 h. */
const VIVO_S = 6 * 3600;
const GENERAL = "general";

type Uso =
  | { version: 1; ts: number; five_hour: Ventana | null; seven_day: Ventana | null; suscripciones?: SuscripcionCupo[] }
  | { version: number; error: string };
type Lider = {
  id: string;
  nombre: string;
  proyecto: string;
  titulo: string;
  actividad: number;
  /** Cuándo se creó la conversación (`creadoEn`): su lugar en la barra, que no cambia con la actividad. */
  creado: number;
  cache_ttl_s: number | null;
  /** Cuándo vence su caché (epoch s); `null`: no se sabe (nunca se lo afirma vencido sin dato). */
  cache_vence: number | null;
  origen: "terminal" | "app";
  pid: number | null;
  vivo: boolean;
  ocupado: boolean;
  /** Tiene un permiso o una pregunta sin contestar (`espera.ts` lo usa para saber que espera al usuario). */
  pide?: boolean;
  modelo: string | null;
  effort: string | null;
  /** Cuántos subagentes suyos corren (lo suma la ventana desde electron/subagentes.ts; el main no lo manda). */
  subagentes?: number;
  /** El modo de permisos de un líder de la app (los de la terminal no lo dicen). */
  modo?: string;
  /** El proyecto (slug) que nombra su primer mensaje, si nombra uno (B20). */
  inferido: string | null;
  /** Lo mataron y nadie lo retomó: sin proceso y sin caja hasta que el usuario lo retome (`lider.retomar`). */
  caido?: "murio";
  /** Por qué murió, si se supo (lo que dijo su proceso o por qué no se pudo levantar). */
  motivo?: string;
};
/**
 * `analista`: el chat de Ramas (B22), aparte para que no se mezcle con los líderes de la barra.
 * `caidos`: los líderes de terminal que murieron sin cerrar (vigia.ts). Todos van además en
 * `lideres` (con `caido`), para retomarlos; los de más de un día la barra los pliega en "Dormidos".
 */
export type Statusline = {
  uso: Uso | null;
  lideres: { version: number; lideres: Lider[]; analista?: Lider | null; caidos?: Caido[] };
};

const UNIDAD: Record<string, number> = { s: 1, m: 60, h: 3600 };

/** "1h" → 3600, "5m" → 300. */
function ttl(s: unknown): number | null {
  const m = String(s ?? "").match(/^(\d+)([smh])$/);
  return m ? Number(m[1]) * UNIDAD[m[2]] : null;
}

/** Lo que el statusline de una sesión dice de su caché (`cacheDe`). */
const cacheSl = (a: any) =>
  a ? { ttl: ttl(a.prompt_cache?.ttl), vence: typeof a.prompt_cache?.expires_at === "number" ? a.prompt_cache.expires_at : null } : null;

/** "claude-opus-5-5[1m]" → "Opus 5.5". Lo que no reconoce queda como vino (vacío: el renderer pone "Sesión jefe"). */
export function modeloLindo(m: string): string {
  const x = m.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
}

/** La carpeta de Shark (el asistente de voz): `$SHARK_HOME` o `/srv/shark`. Su sesión jefe corre ahí. */
const SHARK_HOME = process.env.SHARK_HOME || "/srv/shark";
/** `{ shark: true }` si el cwd es el de Shark (o algo adentro); si no, nada. */
async function sharkDe(cwd: string | null | undefined): Promise<{ shark?: true }> {
  if (!cwd) return {};
  const dentro = (c: string, r: string) => c === r || c.startsWith(r + "/");
  return dentro(cwd, SHARK_HOME) || dentro(await real(cwd), await real(SHARK_HOME)) ? { shark: true } : {};
}

function proyectoDe(cwd: string, rutas: [string, string][]): string {
  for (const [r, nombre] of rutas) if (cwd === r || cwd.startsWith(r + "/")) return nombre;
  return GENERAL;
}

/**
 * Las sesiones que son líderes: las interactivas de una terminal y las de
 * la app (también `-p`, como los workers de `pa`, que entran por el SDK:
 * `entrypoint: "sdk-cli"`). `caidos`: los de terminal que murieron sin cerrar.
 */
async function lideresVivos(app: Set<string>, ahora: number): Promise<{ vivos: Sesion[]; caidos: Caido[] }> {
  const { vivas, muertas } = await sesiones();
  const vivos = vivas.filter((s) => s.kind === "interactive" && (s.entrypoint !== "sdk-cli" || app.has(s.id)));
  const terminal = muertas.filter((s) => s.kind === "interactive" && s.entrypoint !== "sdk-cli");
  return { vivos, caidos: await caidosDe(terminal, new Set(vivos.map((s) => s.id)), ahora) };
}

const CAIDOS = path.join(ESTADO, "caidos.json");
let caidos: Caido[] | null = null;

/** Los caídos de ahora (`verCaidos`), con `caidos.json` al día: el archivo de la sesión dura poco. */
async function caidosDe(muertas: Sesion[], vivas: Set<string>, ahora: number): Promise<Caido[]> {
  if (!caidos) {
    const g = await readFile(CAIDOS, "utf8").then((t) => JSON.parse(t), () => null);
    caidos =
      g?.version === VERSION && Array.isArray(g.caidos)
        ? g.caidos.filter((c: any) => typeof c?.id === "string" && typeof c.nombre === "string" && typeof c.ts === "number")
        : [];
  }
  const r = verCaidos(caidos!, muertas, vivas, ahora);
  if (r.cambio) {
    caidos = r.caidos;
    await escribirAtomico(CAIDOS, JSON.stringify({ version: VERSION, caidos })).catch(silencio("statusline"));
  }
  return caidos!;
}

/**
 * El título y el proyecto que nombra un líder, de su transcript (electron/tema.ts):
 * el de uno de la app está en el home (`null`); el de uno de la terminal, o de uno
 * que se retomó desde la app, en su `cwd`.
 */
async function deQueTrata(sid: string, cwd: string | null, sesion: string, regs: Proyecto[], home: string) {
  const archivo = cwd === null ? transcriptPorDefecto(sid) : await transcriptDe(sid, cwd).catch(() => null);
  const t = await temaDe(sid, archivo);
  // Sin título propio, el de la barra es un resumen del tema (lo genera Haiku una vez); hasta que llega, el primer mensaje recortado.
  const nombre = tituloEsElPrimero(t, sesion) ? (tituloAuto(sid, t.primero!) ?? recortar(tituloLider(t, sesion))) : tituloLider(t, sesion);
  return { nombre, inferido: t.primero ? proyectoEnTexto(t.primero, regs, home) : null, creado: t.creado };
}


/**
 * Lee los statusline (async; los viejos se descartan por mtime sin abrirlos)
 * y las sesiones vivas. Las barras salen de lo más nuevo que se sepa de cada
 * ventana, entre los statusline y el stream de los líderes de la app (`usoDe`;
 * `uso: null` si no hay ninguna fuente); los líderes son las sesiones vivas, con el modelo y el
 * caché de su statusline si lo tienen.
 */
export async function leerStatusline(): Promise<Statusline> {
  const ahora = Date.now() / 1000;
  const app = await lideresApp();
  const [{ vivos: sesiones, caidos }, nombres] = await Promise.all([
    lideresVivos(new Set(app.map((g) => g.sid)), Math.floor(ahora)),
    readdir(DIR).then(
      (ns) => ns.filter((n) => n.endsWith(".json")),
      () => [] as string[],
    ),
  ]);
  const conMtime = (
    await Promise.all(
      nombres.map(async (n) => {
        const f = path.join(DIR, n);
        return stat(f).then(
          (s) => ({ f, id: n.slice(0, -5), mtime: s.mtimeMs / 1000 }),
          () => null,
        );
      }),
    )
  ).filter((x) => x !== null);
  // El más nuevo siempre (de ahí salen las barras), los de las últimas 6 h y los de los líderes vivos o caídos.
  const vivas = new Set(sesiones.map((s) => s.id));
  const deApp = new Map(app.map((g) => [g.sid, g]));
  const mostrados = caidos.filter((c) => !vivas.has(c.id) && !deApp.has(c.id));
  for (const c of mostrados) vivas.add(c.id);
  const nuevo = conMtime.length ? conMtime.reduce((a, b) => (b.mtime > a.mtime ? b : a)) : null;
  const leer = conMtime.filter((x) => x === nuevo || x.mtime > ahora - VIVO_S || vivas.has(x.id));
  const archivos = (
    await Promise.all(leer.map(({ f }) => readFile(f, "utf8").then((t) => JSON.parse(t), () => null)))
  ).filter((a) => a !== null);

  const rara = archivos.find((a) => a.version !== VERSION);
  if (rara) {
    const error = textoT("main.statuslineVersion", { v: String(rara.version) });
    return { uso: { version: Number(rara.version), error }, lideres: { version: Number(rara.version), lideres: [] } };
  }

  archivos.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  // Para el uso, el más nuevo y los de las últimas 6 h: el de un líder vivo de hace días se lee por su caché, no por esto.
  const recientes = archivos.filter((a, i) => i === 0 || (a.ts ?? 0) > ahora - VIVO_S);
  const visto = await usoVisto();
  const cupos = cuposActuales();
  const tsCupos = cupos ? Math.round(cupos.ts / 1000) : 0;
  const lecturaCupos = cupos?.claude
    ? {
        five_hour: {
          pct: cupos.claude.cincoH,
          resets_at: cupos.claude.reseteaCincoH ? Math.round(cupos.claude.reseteaCincoH / 1000) : null,
          ts: tsCupos,
        },
        seven_day: {
          pct: cupos.claude.sieteD,
          resets_at: cupos.claude.reseteaSieteD ? Math.round(cupos.claude.reseteaSieteD / 1000) : null,
          ts: tsCupos,
        },
      }
    : null;
  const hayOtras = !!cupos?.suscripciones.length;
  const hayFuentes = recientes.length > 0 || !!visto || !!lecturaCupos || hayOtras;
  const baseUso = usoDe([...recientes.filter((a) => esCuentaDeSiempre(a, os.homedir())).map(deStatusline), visto, lecturaCupos], ahora);
  const uso: Uso | null = hayFuentes
    ? {
        version: 1,
        ...baseUso,
        ts: baseUso.ts || tsCupos || Math.floor(ahora),
        ...(hayOtras ? { suscripciones: cupos!.suscripciones } : {}),
        ...(cupos?.claudeNombre ? { claudeNombre: cupos.claudeNombre } : {}),
      }
    : null;

  const porSesion = new Map<string, any>();
  for (const a of archivos) if (typeof a.session_id === "string" && !porSesion.has(a.session_id)) porSesion.set(a.session_id, a);
  // Ruta real → nombre en `pa`, del registry. La más larga primero (proyectos anidados).
  const regs = await registro();
  const rutas = regs.map((p): [string, string] => [p.ruta, p.slug]);
  const lideres: Lider[] = [];
  const home = await real(os.homedir());
  const casa = proyectoDe(home, rutas);
  for (const s of sesiones) {
    const a = porSesion.get(s.id);
    const g = deApp.get(s.id);
    const p = procDe(s.id);
    // De la app sólo si el proceso es suyo: si no, está abierto en otro lado y se lee nomás.
    const mia = g && p?.pid != null;
    const modelo = mia ? g.modelo : a?.modelo ? String(a.modelo).replace(/\[.*\]$/, "") : null;
    const t = await deQueTrata(s.id, g ? (g.cwd ?? null) : s.cwd, s.nombre || g?.nombre || "", regs, home);
    lideres.push({
      id: s.id,
      nombre: t.nombre || modeloLindo(String(a?.modelo ?? "")),
      // La de su cwd; la barra la corrige con el proyecto de sus workers.
      proyecto: s.cwd ? proyectoDe(await real(s.cwd), rutas) : GENERAL,
      titulo: modeloLindo(modelo ?? ""),
      actividad: Math.max(s.actividad, g?.ultimo ?? 0, typeof a?.ts === "number" ? a.ts : 0),
      creado: creadoEn(t.creado, g?.creado, s.inicio, s.actividad),
      // El statusline de uno que se trajo a la app quedó viejo: vale lo último que se vio, de cualquiera de los dos.
      ...cacheDe(cacheSl(a), g ? { ultimo: g.ultimo, pedido: p?.pedido ?? 0, ttl: g.cache_ttl_s } : null),
      origen: mia ? "app" : "terminal",
      pid: s.pid,
      vivo: true,
      ocupado: mia ? p.ocupado : s.status === "busy",
      pide: mia ? p.pide : s.pide,
      modelo,
      effort: mia ? g.effort : null,
      ...(mia ? { modo: g.modo } : {}),
      inferido: t.inferido,
      ...(await sharkDe((g ? (g.cwd ?? null) : s.cwd))),
    });
    deApp.delete(s.id);
  }
  // Los de la app sin proceso (trama se reinició o salieron): se retoman con `--resume`.
  for (const g of deApp.values()) {
    const p = procDe(g.sid);
    const ultimo = Math.max(g.ultimo, g.creado);
    // Ninguno se esconde por viejo: la barra pliega los de más de un día sin proceso en "Dormidos" (`DORMIDO_S`, arbol.ts).
    const t = await deQueTrata(g.sid, g.cwd ?? null, g.nombre, regs, home);
    lideres.push({
      id: g.sid,
      nombre: t.nombre,
      proyecto: g.cwd ? proyectoDe(await real(g.cwd), rutas) : casa,
      titulo: modeloLindo(g.modelo),
      actividad: ultimo,
      creado: creadoEn(t.creado, g.creado),
      ...cacheDe(cacheSl(porSesion.get(g.sid)), { ultimo: g.ultimo, pedido: p?.pedido ?? 0, ttl: g.cache_ttl_s }),
      origen: "app",
      pid: p?.pid ?? null,
      vivo: !!p,
      ocupado: p?.ocupado ?? false,
      pide: p?.pide ?? false,
      modelo: g.modelo,
      effort: g.effort,
      modo: g.modo,
      inferido: t.inferido,
      ...(await sharkDe(g.cwd)),
      // Lo mataron (no lo cerró la app) y nadie lo retomó: Murió, con Retomar en vez de la caja.
      ...(g.murio && !p ? { caido: "murio" as const, ...(g.motivo ? { motivo: g.motivo } : {}) } : {}),
    });
  }
  // Los de terminal que mataron (OOM, kill -9): siguen en la barra para retomarlos desde acá.
  for (const c of mostrados) {
    const a = porSesion.get(c.id);
    const modelo = a?.modelo ? String(a.modelo).replace(/\[.*\]$/, "") : null;
    const t = await deQueTrata(c.id, c.cwd || home, c.nombre, regs, home);
    lideres.push({
      id: c.id,
      nombre: t.nombre || modeloLindo(String(a?.modelo ?? "")),
      proyecto: c.cwd ? proyectoDe(await real(c.cwd), rutas) : GENERAL,
      titulo: modeloLindo(modelo ?? ""),
      actividad: Math.max(c.actividad ?? 0, typeof a?.ts === "number" ? a.ts : 0) || c.ts,
      creado: creadoEn(t.creado, undefined, c.actividad, c.ts),
      ...cacheDe(cacheSl(a), null),
      origen: "terminal",
      pid: null,
      vivo: false,
      ocupado: false,
      modelo,
      effort: null,
      inferido: t.inferido,
      ...(await sharkDe(c.cwd)),
      caido: "murio",
    });
  }
  lideres.sort((a, b) => b.actividad - a.actividad);
  // El analista de Ramas: el más nuevo, fuera de la barra.
  const analistas = new Set(app.filter((g) => g.rol === "analista").map((g) => g.sid));
  const analista = lideres.find((l) => analistas.has(l.id)) ?? null;
  return { uso, lideres: { version: 1, lideres: lideres.filter((l) => !analistas.has(l.id)), analista, caidos } };
}
