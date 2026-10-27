// ¿Hay un Claude Code más nuevo que el instalado? Las cuentas, sin IO: comparar
// versiones (semver propio, sin dependencias), cuándo volver a preguntarle a npm
// y si corresponde el aviso del pie. El IO está en ./actualizacion.ts. Puro (sin
// `electron` ni imports locales): lo prueba `tests/version.test.ts` con `node --test`.

/** Cada cuánto se le pregunta a npm (y se relee la instalada con la app residente). */
export const CADA_MS = 6 * 60 * 60 * 1000;

const VERSION_RE = /(?:^|[^\d.])v?(\d+)\.(\d+)\.(\d+)(?![\d.]*\d)/;

/**
 * "2.1.287 (Claude Code)" → [2, 1, 287]. Toma la primera versión x.y.z que
 * aparezca; un pre-release ("-beta.1") o build ("+abc") se ignora. Sin versión: null.
 */
export function parsear(s: unknown): [number, number, number] | null {
  if (typeof s !== "string") return null;
  const m = ` ${s.trim()}`.match(VERSION_RE);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0 si a es más vieja, 0 si son iguales, >0 si es más nueva. Una que no se entiende es la más vieja. */
export function comparar(a: string | null, b: string | null): number {
  const x = parsear(a);
  const y = parsear(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** La versión normalizada ("2.1.287"), o null. */
export const normal = (s: unknown) => parsear(s)?.join(".") ?? null;

/** Lo que se guarda en `~/.local/state/hilos/claude-version.json`. */
export type Chequeo = {
  /** Cuándo contestó npm por última vez (ms); 0: nunca. */
  chequeado: number;
  instalada: string | null;
  ultima: string | null;
  /** La que el usuario descartó con Dismiss: no se avisa de nuevo hasta que salga otra. */
  descartada: string | null;
};

export const VACIO: Chequeo = { chequeado: 0, instalada: null, ultima: null, descartada: null };

/** ¿Toca preguntarle a npm? Sí si nunca contestó, si pasaron 6 h o si el reloj volvió para atrás. */
export const hayQueConsultar = (chequeado: number, ahora: number) => !chequeado || ahora - chequeado >= CADA_MS || ahora < chequeado;

export type Aviso = { instalada: string; ultima: string };

/** El aviso del pie: sólo si la última es más nueva que la instalada y que la descartada. */
export function avisoDe(c: Chequeo): Aviso | null {
  const instalada = normal(c.instalada);
  const ultima = normal(c.ultima);
  if (!instalada || !ultima) return null;
  if (comparar(ultima, instalada) <= 0) return null;
  if (c.descartada && comparar(ultima, c.descartada) <= 0) return null;
  return { instalada, ultima };
}

/** Lo leído del archivo, validado campo por campo (lo que no sirve queda en blanco). */
export function desdeArchivo(j: unknown, version: number): Chequeo {
  if (!j || typeof j !== "object" || (j as { version?: unknown }).version !== version) return { ...VACIO };
  const o = j as Record<string, unknown>;
  return {
    chequeado: typeof o.chequeado === "number" && Number.isFinite(o.chequeado) ? o.chequeado : 0,
    instalada: normal(o.instalada),
    ultima: normal(o.ultima),
    descartada: normal(o.descartada),
  };
}

/** "Antigravity CLI auto updater is running! Stable Version: 1.4.2. Rolled out to 100%" → "1.4.2". */
export function ultimaDeActualizador(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const m = texto.match(/Stable Version:\s*v?(\d+\.\d+\.\d+)/i);
  return m ? m[1] : null;
}
