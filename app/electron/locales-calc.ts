// La cuenta de cuánto contexto (`-c` de llama-server) entra en la VRAM. Pura (sin `electron`, sin disco, sin
// procesos): la prueba `tests/locales-calc.test.ts`. Es una ESTIMACIÓN: lo que la confirma es "Probar", que carga el
// modelo de verdad (`electron/locales.ts`).
//
//   presupuesto = total − lo que ocupan los demás − lo que Handy/TTS piden si cargan − margen
//   entra       = pesos + fijo + KV(ctx)          con KV(ctx) = bytes por token × ctx
//
// "Los demás" es lo que dice nvidia-smi menos el propio llama-server (que se apaga para cargar otro valor).

export const MIB = 1024 * 1024;
/** Lo que se deja libre para el escritorio y lo que no se midió. */
export const MARGEN_MIB = 512;
/** llama-server redondea `n_ctx` a múltiplos de 256: los valores se normalizan a eso. */
export const MULTIPLO_CTX = 256;

/** Quién más usa la GPU y cuánto pide, con el proceso que lo delata (nombre de proceso o línea de comando). */
export const CONSUMIDORES: readonly { nombre: string; nominalMiB: number; reconoce: (proceso: string, cmd: string) => boolean }[] = [
  { nombre: "Handy", nominalMiB: Math.round(3.3 * 1024), reconoce: (p) => /(^|[\\/])handy(\.exe)?$/i.test(p.trim()) },
  { nombre: "TTS", nominalMiB: Math.round(4.9 * 1024), reconoce: (_p, cmd) => cmd.includes("asistente-tts-qwen") },
];

export type AppGpu = { pid: number; proceso: string; miB: number };
export type Consumo = { nombre: string; nominalMiB: number; actualMiB: number };
export type Gpu = {
  totalMiB: number;
  usadoMiB: number;
  /** Lo que ocupa hoy un llama-server (el que se reemplaza al cargar otro valor). */
  llamaMiB: number;
  consumidores: Consumo[];
};

/** La salida de `nvidia-smi --query-gpu=memory.total,memory.used --format=csv,noheader,nounits` (MiB). */
export function parsearMemoria(salida: string): { totalMiB: number; usadoMiB: number } | null {
  const linea = salida.trim().split("\n")[0] ?? "";
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(linea);
  return m ? { totalMiB: Number(m[1]), usadoMiB: Number(m[2]) } : null;
}

/** La salida de `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits`. */
export function parsearApps(salida: string): AppGpu[] {
  const out: AppGpu[] = [];
  for (const l of salida.split("\n")) {
    const m = /^\s*(\d+)\s*,\s*(.*?)\s*,\s*(\d+)\s*$/.exec(l);
    if (m) out.push({ pid: Number(m[1]), proceso: m[2], miB: Number(m[3]) });
  }
  return out;
}

/** De la lista de procesos con GPU, lo que es un llama-server y lo que es de cada consumidor conocido. */
export function clasificar(apps: readonly AppGpu[], cmdlineDe: (pid: number) => string): { llamaMiB: number; consumidores: Consumo[] } {
  let llamaMiB = 0;
  const actual = new Map<string, number>();
  for (const a of apps) {
    if (/llama-server(\.exe)?$/i.test(a.proceso.trim())) {
      llamaMiB += a.miB;
      continue;
    }
    const cmd = cmdlineDe(a.pid);
    const c = CONSUMIDORES.find((x) => x.reconoce(a.proceso, cmd));
    if (c) actual.set(c.nombre, (actual.get(c.nombre) ?? 0) + a.miB);
  }
  return { llamaMiB, consumidores: CONSUMIDORES.map((c) => ({ nombre: c.nombre, nominalMiB: c.nominalMiB, actualMiB: actual.get(c.nombre) ?? 0 })) };
}

/** Lo que pesa el KV por token: capas con atención × (K + V) × cabezas KV × bytes por elemento. */
export type FormaKv = { capas: number; kvHeads: number; dimK: number; dimV: number; bytesPorElemento: number };
export const kvBytesPorToken = (k: FormaKv) => Math.ceil(k.capas * k.kvHeads * (k.dimK + k.dimV) * k.bytesPorElemento);
/** q8_0 guarda 32 elementos en 34 bytes. */
export const BYTES_Q8_0 = 34 / 32;

export type CuentaModelo = {
  /** Los archivos que van a la GPU (modelo y borrador, sin el mmproj que corre en CPU). */
  pesosMiB: number;
  /** Buffers de cómputo, el estado recurrente y el contexto CUDA: lo que no crece con `-c`. */
  fijoMiB: number;
  kvBytesPorToken: number;
  ctxMin: number;
  ctxMax: number;
  /** De cuánto en cuánto sube el control. */
  paso: number;
};

export type Estimacion = {
  totalMiB: number;
  /** Lo que ocupan los demás ahora (sin el llama-server que se reemplaza). */
  otrosMiB: number;
  /** Lo que Handy / TTS piden de más si cargan y hoy no están (o están a medias). */
  reservas: { nombre: string; miB: number }[];
  reservaMiB: number;
  margenMiB: number;
  /** Lo que le queda al modelo (pesos + fijo + KV). Puede ser negativo. */
  presupuestoMiB: number;
  /** Pesos + fijo: lo que cuesta cargarlo antes del primer token. */
  modeloMiB: number;
  /** MiB de KV cada 1000 tokens. */
  kvMiBPorK: number;
  /** El mayor `-c` que entra (múltiplo de `paso`, entre `ctxMin` y `ctxMax`); 0 si ni el mínimo entra. */
  maxCtx: number;
  /** Lo mismo sin guardar lugar para Handy / TTS: lo que entra si no cargan. */
  maxCtxSinReservas: number;
};

/** Cuántos MiB pide un `-c` (pesos, fijo y KV). */
export const necesitaMiB = (m: Pick<CuentaModelo, "pesosMiB" | "fijoMiB" | "kvBytesPorToken">, ctx: number) =>
  m.pesosMiB + m.fijoMiB + (m.kvBytesPorToken * ctx) / MIB;

/** El mayor múltiplo de `paso` que entra en `sobraMiB` de KV, acotado; 0 si no llega al mínimo. */
export function ctxQueEntra(sobraMiB: number, m: CuentaModelo): number {
  if (!(sobraMiB > 0) || m.kvBytesPorToken <= 0) return 0;
  const tokens = Math.floor((sobraMiB * MIB) / m.kvBytesPorToken);
  const c = Math.min(m.ctxMax, Math.floor(tokens / m.paso) * m.paso);
  return c >= m.ctxMin ? c : 0;
}

export function estimar(g: Gpu, m: CuentaModelo, margenMiB = MARGEN_MIB): Estimacion {
  const otrosMiB = Math.max(0, g.usadoMiB - g.llamaMiB);
  const reservas = g.consumidores.map((c) => ({ nombre: c.nombre, miB: Math.max(0, c.nominalMiB - c.actualMiB) })).filter((r) => r.miB > 0);
  const reservaMiB = reservas.reduce((s, r) => s + r.miB, 0);
  const libreMiB = g.totalMiB - otrosMiB - margenMiB;
  const modeloMiB = m.pesosMiB + m.fijoMiB;
  return {
    totalMiB: g.totalMiB,
    otrosMiB,
    reservas,
    reservaMiB,
    margenMiB,
    presupuestoMiB: libreMiB - reservaMiB,
    modeloMiB,
    kvMiBPorK: (m.kvBytesPorToken * 1000) / MIB,
    maxCtx: ctxQueEntra(libreMiB - reservaMiB - modeloMiB, m),
    maxCtxSinReservas: ctxQueEntra(libreMiB - modeloMiB, m),
  };
}

/**
 * El `-c` pedido, validado: un entero entre el mínimo y el máximo del modelo, llevado al múltiplo de 256 de abajo
 * (llama-server lo redondea: así `n_ctx` que contesta es el mismo número que se escribió). `null` si no vale.
 */
export function ctxValido(v: unknown, ctxMin: number, ctxMax: number): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  const c = Math.floor(n / MULTIPLO_CTX) * MULTIPLO_CTX;
  return c >= ctxMin && c <= ctxMax ? c : null;
}

/**
 * Cambia el `contextWindow` de un modelo en un `settings.yaml` de dsh sin tocar nada más (comentarios, orden, el resto
 * de los modelos). `null` si no hay una entrada con ese id o no tiene `contextWindow`.
 */
export function conContextWindow(yaml: string, dshId: string, ctx: number): string | null {
  const lineas = yaml.split("\n");
  const inicio = lineas.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*${dshId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(#.*)?$`).test(l));
  if (inicio < 0) return null;
  const sangria = (lineas[inicio].match(/^\s*/) ?? [""])[0].length;
  for (let i = inicio + 1; i < lineas.length; i++) {
    const l = lineas[i];
    const s = (l.match(/^\s*/) ?? [""])[0].length;
    // La siguiente entrada de la lista (o salir de ella) cierra el bloque de este modelo.
    if (l.trim() !== "" && !l.trim().startsWith("#") && s <= sangria) return null;
    const m = /^(\s*contextWindow:\s*)\d+(.*)$/.exec(l);
    if (m) {
      lineas[i] = `${m[1]}${ctx}${m[2]}`;
      return lineas.join("\n");
    }
  }
  return null;
}

/** El `contextWindow` que tiene hoy un modelo en ese yaml (o `null`). */
export function contextWindowDe(yaml: string, dshId: string): number | null {
  const lineas = yaml.split("\n");
  const inicio = lineas.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*${dshId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(#.*)?$`).test(l));
  if (inicio < 0) return null;
  const sangria = (lineas[inicio].match(/^\s*/) ?? [""])[0].length;
  for (let i = inicio + 1; i < lineas.length; i++) {
    const l = lineas[i];
    const s = (l.match(/^\s*/) ?? [""])[0].length;
    if (l.trim() !== "" && !l.trim().startsWith("#") && s <= sangria) return null;
    const m = /^\s*contextWindow:\s*(\d+)/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

/** El valor de `LLAMA_CTX` de un env file (o `null`). */
export function ctxDeEnv(texto: string): number | null {
  const m = /^LLAMA_CTX=(\d+)\s*$/m.exec(texto);
  return m ? Number(m[1]) : null;
}

export const envDe = (ctx: number) => `# Lo escribe trama (Contexto del modelo local): lo lee el conmutador.\nLLAMA_CTX=${ctx}\n`;

/** El `n_ctx` que dice `/props` de llama-server (o `null` si no se entiende). */
export function nCtxDe(props: unknown): number | null {
  const p = props as { default_generation_settings?: { n_ctx?: unknown }; n_ctx?: unknown } | null;
  const n = p?.default_generation_settings?.n_ctx ?? p?.n_ctx;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Lo libre para el modelo con lo que corre ahora (sin contar a Handy/TTS por si cargan): total − los demás − margen. */
export const libreMiB = (e: Pick<Estimacion, "presupuestoMiB" | "reservaMiB">) => e.presupuestoMiB + e.reservaMiB;

/** Lo que dice llama-server (o CUDA) cuando no le alcanza la VRAM. */
const SIN_MEMORIA = /out of memory|cudaMalloc failed|failed to allocate|unable to allocate|alloc(?:ate)?_buffer.*failed|\bOOM\b/i;
/** Una línea que explica un fallo. */
const ERROR = /error|failed|fallo|cannot|unable|abort/i;

/** Por qué no cargó, de lo que dejó el conmutador (stderr): `sinMemoria` si fue la VRAM; si no, la última línea que suena a error, cortada. */
export function motivoDeLog(texto: string): { sinMemoria: boolean; linea: string | null } {
  const lineas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lineas.some((l) => SIN_MEMORIA.test(l))) return { sinMemoria: true, linea: lineas.find((l) => SIN_MEMORIA.test(l))!.slice(0, 200) };
  const linea = [...lineas].reverse().find((l) => ERROR.test(l)) ?? lineas.at(-1) ?? null;
  return { sinMemoria: false, linea: linea ? linea.slice(0, 200) : null };
}
