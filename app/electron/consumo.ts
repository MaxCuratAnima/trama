// El panel de consumo (a la derecha): cuánto consumió hoy cada modelo, en líderes y en workers, y
// cómo va cada sesión que se pide mirar (modelo, contexto, tokens, compactaciones). Todo sale del
// `usage` de los transcripts (electron/transcripts.ts): exacto, sin estimar nada. Un worker se une
// con su sesión por `$PA_STATE/<proyecto>/<id>.sid`.
//
// Sólo trabaja mientras alguien mira (`mirar` … `soltar`): con el panel oculto no hay ni un watch.
// Sin reloj: se entera por inotify de los transcripts pedidos y se pone al día con cada pedido.
// Sin Electron: lo prueba `tests/consumo.test.ts`.
import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { medianoche, Sesion, sumar, transcriptsDesde, transcriptsPlanasDesde, type Suma, type Uso } from "./transcripts.ts";
import { silencio } from "./log.ts";
import { mirarCarpeta, type Mirada } from "./mirar.ts";

/** Donde Claude Code guarda los transcripts. */
export const TRANSCRIPTS = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");

/** Lo que el panel quiere ver: los líderes (su session_id) y los workers vivos (su id de `pa`). */
export type Pedido = { lideres: string[]; workers: string[] };

export type FilaConsumo = {
  /** El último modelo que contestó y su esfuerzo, según el transcript. */
  modelo: string | null;
  effort: string | null;
  /** El `usage` del último mensaje: lo que pesa la conversación. `null`: todavía no contestó. */
  uso: Uso | null;
  /** Compactó y no volvió a contestar: lo que pesa ahora no se sabe. */
  compactada: boolean;
  compactaciones: number;
  /** Todo lo que consumió la sesión (con sus subagentes), por modelo. */
  total: Record<string, Suma>;
};

export type Consumo = {
  /** Cuál es más nueva: la respuesta a un pedido y los avisos llegan al renderer por caminos distintos, sin orden entre sí. */
  n: number;
  /** Desde cuándo cuenta el resumen: la medianoche local de hoy (epoch ms). */
  desde: number;
  /** Lo consumido desde entonces, por modelo: las sesiones que lanzó `pa`, y todas las demás. */
  lideres: Record<string, Suma>;
  workers: Record<string, Suma>;
  /** Por session_id (líder) o id de `pa` (worker). `null`: sin transcript, no hay dato. */
  filas: Record<string, FilaConsumo | null>;
};

const SID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID = /^\d{8}-\d{6}-\d+$/;
const TOPE = 500;
/** Lo que se espera a que el transcript termine de escribirse antes de leerlo. */
const ESPERA_MS = 200;

/** El pedido del renderer, validado: lo que no tiene forma se descarta (los ids arman rutas). */
export function pedidoDe(x: unknown): Pedido {
  const p = (x ?? {}) as { lideres?: unknown; workers?: unknown };
  const lista = (v: unknown, re: RegExp) => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string" && re.test(s)))].slice(0, TOPE) : []);
  return { lideres: lista(p.lideres, SID), workers: lista(p.workers, ID) };
}

/** El session_id de un worker, de su `<proyecto>/<id>.sid` en `$PA_STATE` (lectura que `pa --hilos` no da). `null`: todavía no hay. */
export async function sidDeWorker(paState: string, id: string): Promise<string | null> {
  if (!ID.test(id)) return null;
  for (const c of await readdir(paState).catch(() => [] as string[])) {
    const sid = (await readFile(path.join(paState, c, `${id}.sid`), "utf8").catch(() => "")).trim();
    if (SID.test(sid)) return sid;
  }
  return null;
}

/**
 * El transcript de una sesión, buscado en `projects/*` (donde lo guarda Claude Code por carpeta de trabajo) y,
 * en `planas`, en carpetas con `<sid>.jsonl` sueltos (los líderes de Gemini: `$HILOS_STATE/gemini`, que escribe agy-puente).
 */
export async function transcriptDe(proyectos: string, sid: string, planas: string[] = []): Promise<string | null> {
  if (!SID.test(sid)) return null;
  for (const d of planas) {
    const f = path.join(d, `${sid}.jsonl`);
    if (await access(f).then(() => true, () => false)) return f;
  }
  for (const d of await readdir(proyectos).catch(() => [] as string[])) {
    const f = path.join(proyectos, d, `${sid}.jsonl`);
    if (await access(f).then(() => true, () => false)) return f;
  }
  return null;
}

export function crearConsumo(o: { proyectos: string; planas?: string[]; paState: string; alCambiar: (c: Consumo) => void; ahora?: () => number }) {
  const ahora = o.ahora ?? Date.now;
  let desde = medianoche(ahora());
  let pedido: Pedido | null = null;
  /** Por ruta del transcript. Se guardan entre un `mirar` y el siguiente: releer es sólo un stat. */
  const sesiones = new Map<string, Sesion>();
  const porSid = new Map<string, Sesion>();
  /** id de worker → session_id, de los `.sid` de `pa`. */
  const sidDe = new Map<string, string>();
  const sidLeido = new Set<string>();
  /** Algo de lo pedido no tiene transcript todavía (un worker recién lanzado). */
  let faltan = false;
  const watches = new Map<string, Mirada>();
  const sucias = new Set<Sesion>();
  let reloj: NodeJS.Timeout | null = null;
  let cola: Promise<unknown> = Promise.resolve();
  let orden = 0;

  const enFila = <T>(f: () => Promise<T>): Promise<T> => {
    const r = cola.then(f, f);
    cola = r.catch(silencio("consumo"));
    return r;
  };

  function agregar(ruta: string): Sesion {
    let s = sesiones.get(ruta);
    if (!s) {
      s = new Sesion(ruta, desde);
      sesiones.set(ruta, s);
      porSid.set(s.sid, s);
    }
    return s;
  }

  /** Los `.sid` de `pa`: uno por worker, con el session_id de su `claude`. Cada archivo se lee una vez. */
  async function leerSids(otraVez: string[]): Promise<void> {
    const de = new Set(otraVez);
    let carpetas: string[] = [];
    try {
      carpetas = (await readdir(o.paState, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return;
    }
    await Promise.all(
      carpetas.map(async (c) => {
        let nombres: string[] = [];
        try {
          nombres = await readdir(path.join(o.paState, c));
        } catch {
          return;
        }
        for (const n of nombres) {
          if (!n.endsWith(".sid")) continue;
          const id = n.slice(0, -4);
          const archivo = path.join(o.paState, c, n);
          // Los de los workers pedidos se releen: `pa` lo escribe cuando el `claude` ya arrancó.
          if (!ID.test(id) || (sidLeido.has(archivo) && !de.has(id))) continue;
          try {
            const sid = (await readFile(archivo, "utf8")).trim();
            if (SID.test(sid)) {
              sidDe.set(id, sid);
              sidLeido.add(archivo);
            }
          } catch {}
        }
      }),
    );
  }

  /** El transcript de una sesión que no se tocó hoy (un líder quieto desde ayer): se busca en `projects/`. */
  async function buscar(sid: string): Promise<void> {
    if (porSid.has(sid)) return;
    const f = await transcriptDe(o.proyectos, sid, o.planas);
    if (f) agregar(f);
  }

  /** Los workers vivos pedidos que todavía no tienen `.sid` leído: se relee antes de decidir quién es líder y quién worker. */
  async function sidsFaltantes(): Promise<void> {
    const sin = (pedido?.workers ?? []).filter((id) => !sidDe.has(id));
    if (sin.length) await leerSids(sin);
  }

  const sidsPedidos = (): string[] => (pedido ? [...pedido.lideres, ...pedido.workers.map((id) => sidDe.get(id)).filter((s): s is string => !!s)] : []);

  function soltarWatches(): void {
    for (const w of watches.values()) w.cerrar();
    watches.clear();
  }

  /** Un watch por carpeta de los transcripts pedidos (y la de sus subagentes, si la hay). */
  function mirarCarpetas(): void {
    const quiero = new Map<string, Sesion | null>();
    for (const sid of sidsPedidos()) {
      const s = porSid.get(sid);
      if (!s) continue;
      quiero.set(path.dirname(s.ruta), null);
      quiero.set(s.carpetaSubagentes, s);
    }
    for (const [dir, w] of watches) {
      if (quiero.has(dir)) continue;
      w.cerrar();
      watches.delete(dir);
    }
    for (const [dir, dueno] of quiero) {
      if (watches.has(dir)) continue;
      const sucia = (s: Sesion) => {
        sucias.add(s);
        reloj ??= setTimeout(() => {
          reloj = null;
          void enFila(leerSucias);
        }, ESPERA_MS);
      };
      // Si no existe todavía (sin subagentes), `null`: se reintenta cuando cambie su transcript. Si el
      // watcher cae, se rearma solo y se relee lo que pudo pasar mientras estuvo ciego.
      const w = mirarCarpeta(
        dir,
        (_ev, nombre) => {
          const n = nombre ? String(nombre) : "";
          // En la carpeta de subagentes todo es de esa sesión; en la del proyecto, el `<sid>.jsonl`
          // (y `<sid>`: apareció su carpeta de subagentes).
          const s = dueno ?? porSid.get(n.endsWith(".jsonl") ? n.slice(0, -6) : n);
          if (!s || (!dueno && s.ruta !== path.join(dir, `${s.sid}.jsonl`))) return;
          sucia(s);
        },
        {
          donde: "consumo",
          alRearmar: () => {
            for (const s of porSid.values()) if (dueno ? s === dueno : path.dirname(s.ruta) === dir) sucia(s);
          },
        },
      );
      if (w) watches.set(dir, w);
    }
  }

  async function leerSucias(): Promise<void> {
    if (!pedido) return;
    const lote = [...sucias];
    sucias.clear();
    let cambio = false;
    for (const s of lote) if (await s.leer()) cambio = true;
    // Si un worker nuevo todavía no tenía `.sid`, su transcript contaba como líder: se relee antes de armar.
    const antes = sidDe.size;
    await sidsFaltantes();
    if (sidDe.size !== antes) {
      for (const sid of sidsPedidos()) await buscar(sid);
      cambio = true;
    }
    mirarCarpetas();
    if (cambio) o.alCambiar(armar());
  }

  function armar(): Consumo {
    const deWorker = new Set(sidDe.values());
    const c: Consumo = { n: ++orden, desde, lideres: {}, workers: {}, filas: {} };
    for (const s of sesiones.values()) sumar(deWorker.has(s.sid) ? c.workers : c.lideres, s.reciente());
    const fila = (sid: string | undefined): FilaConsumo | null => {
      const s = sid ? porSid.get(sid) : undefined;
      if (!s) return null;
      const l = s.principal.lectura;
      return { modelo: l.modelo, effort: l.effort, uso: l.uso, compactada: l.compactada, compactaciones: l.compactaciones, total: s.total() };
    };
    for (const sid of pedido?.lideres ?? []) c.filas[sid] = fila(sid);
    for (const id of pedido?.workers ?? []) c.filas[id] = fila(sidDe.get(id));
    faltan = Object.values(c.filas).some((f) => f === null);
    return c;
  }

  /** Todo al día: los `.sid`, los transcripts de hoy, los pedidos. Lo que no creció cuesta un stat. */
  async function repasar(): Promise<Consumo> {
    const hoy = medianoche(ahora());
    if (hoy !== desde) {
      // Cambió el día: lo de ayer deja de contar.
      desde = hoy;
      sesiones.clear();
      porSid.clear();
      soltarWatches();
    }
    await leerSids(pedido?.workers ?? []);
    for (const ruta of await transcriptsDesde(o.proyectos, desde)) agregar(ruta);
    // Los líderes de Gemini no escriben en `projects/`: sus transcripts están sueltos en las carpetas planas.
    for (const d of o.planas ?? []) for (const ruta of await transcriptsPlanasDesde(d, desde)) agregar(ruta);
    for (const sid of sidsPedidos()) await buscar(sid);
    await Promise.all([...sesiones.values()].map((s) => s.leer()));
    // Un worker recién lanzado puede escribir su `.sid` mientras se leía: se relee antes de clasificar.
    await sidsFaltantes();
    if (pedido) mirarCarpetas();
    return armar();
  }

  return {
    /** Empieza a mirar (o cambia lo que se mira) y contesta cómo está todo. */
    mirar(x: unknown): Promise<Consumo> {
      return enFila(async () => {
        pedido = pedidoDe(x);
        return repasar();
      });
    },
    /** Hay una lista nueva de workers, o un líder nuevo: si alguien mira, se repasa y se avisa. */
    repasar(): void {
      if (!pedido) return;
      void enFila(async () => {
        if (pedido) o.alCambiar(await repasar());
      });
    },
    /** Algo se movió (un statusline): si falta el transcript de alguno, se lo busca de nuevo. */
    faltantes(): void {
      if (!pedido || !faltan) return;
      void enFila(async () => {
        if (!pedido || !faltan) return;
        await leerSids(pedido.workers);
        for (const sid of sidsPedidos()) await buscar(sid);
        let cambio = false;
        for (const sid of sidsPedidos()) if (await porSid.get(sid)?.leer()) cambio = true;
        mirarCarpetas();
        const c = armar();
        if (cambio || !faltan) o.alCambiar(c);
      });
    },
    /** Nadie mira: ni un watch ni un reloj. Lo leído queda (son números), por si se vuelve a abrir. */
    soltar(): void {
      pedido = null;
      soltarWatches();
      sucias.clear();
      if (reloj) clearTimeout(reloj);
      reloj = null;
    },
    mirando: () => pedido !== null,
  };
}
