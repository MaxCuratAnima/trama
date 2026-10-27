// El vigía: se entera solo de lo que murió sin avisar. A un proceso que matan
// (el administrador de tareas, taskkill /F, la consola que se cierra) no le da tiempo a nada: `pa` no
// escribe el `fin` en `eventos.jsonl` y Claude Code no borra su sesión, así que
// inotify no dice nada y la barra seguía mostrando "Trabajando" (2026-10-11: 13
// workers, casi 3 h). De la muerte de un proceso ajeno no hay aviso del kernel que
// Node pueda esperar: se pregunta (`kill 0`) cada tanto por los pids de las
// sesiones vivas, que es gratis, y recién cuando falta uno se relee de verdad.
// Sin imports locales: lo prueba `tests/vigia.test.ts`.

export type Proc = { pid: number; procStart: string | null };

/** Cada cuánto se pregunta por los procesos mirados. */
export const CADA_MS = 10_000;

/**
 * Mira un juego de procesos y avisa (una vez por tanda) cuando alguno deja de
 * vivir. El reloj corre sólo mientras hay algo que mirar y no retiene al proceso.
 */
export function crearVigia(vive: (p: Proc) => boolean | Promise<boolean>, alMorir: () => void, cadaMs = CADA_MS) {
  let mirados: Proc[] = [];
  let timer: NodeJS.Timeout | null = null;
  let mirando = false;
  const tic = async () => {
    if (mirando) return;
    mirando = true;
    try {
      const antes = mirados;
      const vivos = await Promise.all(antes.map((p) => vive(p)));
      if (vivos.every(Boolean)) return;
      // Si mientras tanto llegó otro juego, ese manda: los muertos de este ya no están en él.
      if (mirados === antes) poner(antes.filter((_, i) => vivos[i]));
      alMorir();
    } finally {
      mirando = false;
    }
  };
  const poner = (procs: Proc[]) => {
    mirados = procs;
    if (procs.length && !timer) {
      timer = setInterval(() => void tic(), cadaMs);
      timer.unref();
    } else if (!procs.length && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  return {
    /** Los procesos vivos de ahora (reemplaza a los de antes). */
    mirar: (procs: readonly Proc[]) => poner(procs.map((p) => ({ pid: p.pid, procStart: p.procStart }))),
    /** Una vuelta ya (los tests; el reloj hace lo mismo). */
    tic,
    parar: () => poner([]),
  };
}

/** Lo que `pa` da por vivo: mientras haya algo así en la lista, se la relee cada tanto por las dudas. */
export const vivoEnPa = (h: { estado?: unknown; en_cola?: unknown }) =>
  h.estado === "trabajando" || h.estado === "colgado" || h.en_cola === true;

/** id del hilo → epoch en que la app lo vio morir. */
export type Muertes = Record<string, number>;

/**
 * Cuándo murió cada worker: `pa` dice que murió pero no cuándo (sin resultado no hay
 * `duracion_s`), así que la hora es la de la lectura en que pasó de vivo a `murio`
 * (con el vigía, a segundos de la muerte). Lo que la app no vio morir no lleva hora:
 * la fila cuenta desde que arrancó. Devuelve las de ahora, o `null` si no cambió nada.
 */
export function verMuertes(
  antes: ReadonlyMap<string, string> | null,
  hilos: readonly { id: string; estado: string }[],
  muertes: Readonly<Muertes>,
  ahora: number,
): Muertes | null {
  const nuevas: Muertes = {};
  let cambio = false;
  for (const h of hilos) {
    if (h.estado !== "murio") continue;
    const e = antes?.get(h.id);
    if (typeof muertes[h.id] === "number") nuevas[h.id] = muertes[h.id];
    else if (e === "trabajando" || e === "colgado") {
      nuevas[h.id] = ahora;
      cambio = true;
    }
  }
  return cambio || Object.keys(nuevas).length !== Object.keys(muertes).length ? nuevas : null;
}

/**
 * Un líder de terminal que murió sin cerrar: su sesión quedó en `~/.claude/sessions` sin proceso.
 * `cwd` y `actividad` (de su sesión, si los dijo): dónde retomarlo y cuándo se movió por última vez.
 */
export type Caido = { id: string; nombre: string; ts: number; cwd?: string; actividad?: number };

/**
 * Los líderes caídos: los que ya se sabían más las sesiones sin proceso de ahora,
 * menos los que volvieron a vivir (retomados con `--resume`). Ninguno se olvida por viejo: se quita a mano. Se
 * guardan porque el archivo de la sesión dura poco: el próximo `claude` lo barre.
 * Devuelve los de ahora y si cambió algo (para escribir sólo entonces).
 */
export function verCaidos(
  guardados: readonly Caido[],
  muertas: readonly { id: string; nombre: string; cwd?: string; actividad?: number }[],
  vivas: ReadonlySet<string>,
  ahora: number,
): { caidos: Caido[]; cambio: boolean } {
  const por = new Map<string, Caido>();
  for (const c of guardados) if (!vivas.has(c.id)) por.set(c.id, c);
  let cambio = por.size !== guardados.length;
  for (const m of muertas) {
    if (vivas.has(m.id) || por.has(m.id)) continue;
    por.set(m.id, { id: m.id, nombre: m.nombre, ts: ahora, ...(m.cwd ? { cwd: m.cwd } : {}), ...(m.actividad ? { actividad: m.actividad } : {}) });
    cambio = true;
  }
  return { caidos: [...por.values()], cambio };
}
