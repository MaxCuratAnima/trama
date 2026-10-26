// Los modelos locales (llama-server en la GPU de esta máquina): cuánto contexto (`-c`) se les da, cuánto entra en la
// VRAM (estimado: electron/locales-calc.ts) y "Probar", que los carga de verdad con ese valor para confirmarlo.
// Cuáles son: los declara el usuario en `~/.config/trama/locales.json` (electron/locales-config.ts); sin ese archivo no hay ninguno.
// Qué se escribe y adónde:
//   - `$HILOS_LOCALES_DIR/<clave>.env` (default `~/.config/trama/locales/`) con `LLAMA_CTX=<n>`: lo lee la unit
//     (`EnvironmentFile=-…` y `-c ${LLAMA_CTX}`, plantillas en `systemd/locales/`), así el valor llega al `-c` real;
//   - `contextWindow` de ese modelo en `~/.dsh/settings.yaml` (`HILOS_DSH_SETTINGS`), que tiene que ser igual al `-c`.
// Guardar NO carga nada: el valor rige en la próxima carga del modelo. Sólo Probar toca la GPU (la pide el usuario con un clic).
// Sin `electron`: lo prueba tests/locales.test.ts con `Deps` falsos; nunca corre `nvidia-smi` ni `systemctl` de verdad.
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolverBinario } from "./binario.ts";
import { errorT, textoT } from "./errores.ts";
import {
  BYTES_Q8_0,
  clasificar,
  conContextWindow,
  contextWindowDe,
  ctxDeEnv,
  ctxFijoDeUnit,
  ctxValido,
  envDe,
  estadoDeShow,
  estimar,
  kvBytesPorToken,
  libreMiB,
  MIB,
  motivoDeLog,
  nCtxDe,
  parsearApps,
  parsearMemoria,
  seCayo,
  type CuentaModelo,
  type EstadoUnit,
  type Estimacion,
} from "./locales-calc.ts";
import { escribirAtomico } from "./pa.ts";
import { leerConfigLocales, localDe, localesDeclarados, type LocalDef } from "./locales-config.ts";

export { localDe, type LocalDef } from "./locales-config.ts";
const defsDe = (d: Deps): readonly LocalDef[] => localesDeclarados(d.env, d.home);
const defDe = (id: string, d: Deps) => localDe(id, d.env, d.home);

/** El KV en q8_0 (las units pasan `--cache-type-k/v q8_0`): 4 cabezas KV de 256 de K y de V. */
const KV = { kvHeads: 4, dimK: 256, dimV: 256, bytesPorElemento: BYTES_Q8_0 } as const;

// ---------- lo que se ve desde la ventana ----------

export type LocalInfo = {
  id: string;
  /** El `-c` guardado (o el de la unit si nada se guardó). */
  ctx: number;
  /** El `contextWindow` que tiene hoy `~/.dsh/settings.yaml` (null si no hay o no se lee). */
  dsh: number | null;
  ctxMin: number;
  ctxMax: number;
  paso: number;
  /** La cuenta con la GPU de ahora (null si `nvidia-smi` no contesta). */
  est: Estimacion | null;
  /** El tamaño de los pesos usado, y si se midió en disco. */
  pesosMiB: number;
  /**
   * El `-c` fijo de la unit instalada si NO lee `LLAMA_CTX` (no es la plantilla de `systemd/locales/`): carga siempre con
   * ese, guarde trama lo que guarde. `null`: la unit lee el valor de trama (o no se pudo leer).
   */
  ctxFijo: number | null;
};
export type EstadoLocales = { modelos: LocalInfo[]; gpuMiB: number | null };
export type ResultadoProbar = {
  ok: boolean;
  /** El `n_ctx` que dijo llama-server. */
  nCtx: number | null;
  /** Lo que ocupa la GPU con el modelo cargado. */
  usadoMiB: number | null;
  total: number | null;
  /** Por qué no (clave de i18n `main.*` ya armada con `errorT`: el renderer la traduce). */
  error: string | null;
};

// ---------- dependencias (lo que reemplazan las pruebas) ----------

export type Deps = {
  home: string;
  env: NodeJS.ProcessEnv;
  /** Corre un programa y devuelve su stdout; si falla, rechaza. */
  ejecutar: (bin: string, args: string[], o: { timeout: number }) => Promise<string>;
  leer: (archivo: string) => Promise<string | null>;
  tamano: (archivo: string) => Promise<number | null>;
  escribir: (archivo: string, texto: string) => Promise<void>;
  /** Borra un archivo (si no existe, nada). */
  borrar: (archivo: string) => Promise<void>;
  /** GET de una URL → JSON (o null si no contesta bien). */
  pedirJson: (url: string, ms: number) => Promise<unknown | null>;
  dormir: (ms: number) => Promise<void>;
  ahora: () => number;
};

export function depsDeVerdad(env: NodeJS.ProcessEnv = process.env): Deps {
  return {
    home: os.homedir(),
    env,
    ejecutar: (bin, args, o) =>
      new Promise((ok, mal) => {
        execFile(bin, args, { timeout: o.timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }, (e, stdout) => (e ? mal(e) : ok(String(stdout))));
      }),
    leer: (f) => readFile(f, "utf8").catch(() => null),
    tamano: (f) => stat(f).then((s) => s.size, () => null),
    escribir: async (f, t) => {
      await mkdir(path.dirname(f), { recursive: true });
      await escribirAtomico(f, t);
    },
    borrar: (f) => rm(f, { force: true }),
    pedirJson: async (url, ms) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    },
    dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    ahora: () => Date.now(),
  };
}

// ---------- rutas ----------

const carpetaEnv = (d: Deps) => d.env.HILOS_LOCALES_DIR || path.join(d.home, ".config", "trama", "locales");
export const archivoEnv = (d: Deps, l: LocalDef) => path.join(carpetaEnv(d), `${l.clave}.env`);
export const archivoDsh = (d: Deps) => d.env.HILOS_DSH_SETTINGS || path.join(d.home, ".dsh", "settings.yaml");
const urlLlama = (d: Deps, l?: LocalDef) => l?.url || d.env.HILOS_LLAMA_URL || "http://127.0.0.1:8080";
/** Donde están las units de usuario (las de verdad: `~/.config/systemd/user/`). */
const carpetaUnits = (d: Deps) => d.env.HILOS_UNITS_DIR || path.join(d.env.XDG_CONFIG_HOME || path.join(d.home, ".config"), "systemd", "user");
const nvidiaSmi = (d: Deps) => resolverBinario("nvidia-smi", "HILOS_NVIDIA_SMI", d.env, d.home);
/** Espera de Probar: 300 s de carga más lo que tarda en bajar el otro modelo. */
export const PROBAR_ESPERA_MS = 330_000;
/** Cada cuánto se mira la unit mientras carga (si se cayó, si llama-server ya avisó que no entra). */
export const VIGILAR_MS = 2000;

// ---------- leer ----------

async function pesosDe(l: LocalDef, d: Deps): Promise<number> {
  let bytes = 0;
  for (const a of l.archivos) {
    const t = await d.tamano(path.join(d.home, a));
    if (t == null) return l.pesosMiB;
    bytes += t;
  }
  return Math.round(bytes / MIB);
}

async function leerGpu(d: Deps) {
  try {
    const mem = parsearMemoria(await d.ejecutar(nvidiaSmi(d), ["--query-gpu=memory.total,memory.used", "--format=csv,noheader,nounits"], { timeout: 5000 }));
    if (!mem) return null;
    let apps = "";
    try {
      apps = await d.ejecutar(nvidiaSmi(d), ["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"], { timeout: 5000 });
    } catch {
      /* sin la lista de procesos queda la cuenta sin descontar a nadie */
    }
    const lista = parsearApps(apps);
    const cmds = new Map<number, string>();
    for (const a of lista) cmds.set(a.pid, ((await d.leer(`/proc/${a.pid}/cmdline`)) ?? "").replaceAll("\0", " "));
    return { ...mem, ...clasificar(lista, (pid) => cmds.get(pid) ?? "") };
  } catch {
    return null;
  }
}

async function infoDe(l: LocalDef, d: Deps, gpu: Awaited<ReturnType<typeof leerGpu>>): Promise<LocalInfo> {
  const guardado = ctxDeEnv((await d.leer(archivoEnv(d, l))) ?? "");
  const ctx = guardado != null ? (ctxValido(guardado, l.ctxMin, l.ctxMax) ?? l.ctxDefecto) : l.ctxDefecto;
  const yaml = await d.leer(archivoDsh(d));
  const pesosMiB = await pesosDe(l, d);
  const cuenta: CuentaModelo = { pesosMiB, fijoMiB: l.fijoMiB, kvBytesPorToken: kvBytesPorToken({ capas: l.capasKv, ...KV }), ctxMin: l.ctxMin, ctxMax: l.ctxMax, paso: l.paso };
  return {
    id: l.id,
    ctx,
    dsh: yaml == null ? null : contextWindowDe(yaml, l.dshId),
    ctxMin: l.ctxMin,
    ctxMax: l.ctxMax,
    paso: l.paso,
    est: gpu ? estimar({ totalMiB: gpu.totalMiB, usadoMiB: gpu.usadoMiB, llamaMiB: gpu.llamaMiB, consumidores: gpu.consumidores }, cuenta) : null,
    pesosMiB,
    ctxFijo: await ctxFijo(l, d),
  };
}

/** El `-c` fijo de la unit instalada si no lee `LLAMA_CTX` (`ctxFijoDeUnit`); `null` si lo lee o no se encuentra. */
async function ctxFijo(l: LocalDef, d: Deps): Promise<number | null> {
  const texto = await d.leer(path.join(carpetaUnits(d), l.unit));
  return texto == null ? null : ctxFijoDeUnit(texto);
}

export async function leerLocales(d: Deps = depsDeVerdad()): Promise<EstadoLocales> {
  const gpu = await leerGpu(d);
  const modelos: LocalInfo[] = [];
  for (const l of defsDe(d)) modelos.push(await infoDe(l, d, gpu));
  return { modelos, gpuMiB: gpu?.totalMiB ?? null };
}

// ---------- guardar ----------

function pedido(x: unknown, d: Deps): { l: LocalDef; ctx: number } {
  const { id, ctx } = (x ?? {}) as { id?: unknown; ctx?: unknown };
  const l = typeof id === "string" ? defDe(id, d) : undefined;
  if (!l) throw errorT("main.localDesconocido");
  const c = ctxValido(ctx, l.ctxMin, l.ctxMax);
  if (c == null) throw errorT("main.localCtxInvalido", { min: l.ctxMin, max: l.ctxMax });
  return { l, ctx: c };
}

/** Escribe el `-c` en el env de la unit y el `contextWindow` en dsh. Lo segundo no es obligatorio: sin dsh sólo se salta. */
async function escribirCtx(l: LocalDef, ctx: number, d: Deps): Promise<void> {
  await d.escribir(archivoEnv(d, l), envDe(ctx));
  const yaml = await d.leer(archivoDsh(d));
  if (yaml == null) return;
  const nuevo = conContextWindow(yaml, l.dshId, ctx);
  if (nuevo != null && nuevo !== yaml) await d.escribir(archivoDsh(d), nuevo);
}

/** Guarda el `-c` elegido (rige en la próxima carga; no carga nada). Devuelve el estado ya al día. */
export async function guardarLocal(x: unknown, d: Deps = depsDeVerdad()): Promise<EstadoLocales> {
  const { l, ctx } = pedido(x, d);
  await escribirCtx(l, ctx, d);
  return leerLocales(d);
}

// ---------- probar ----------

let probando = false;

const gb = (miB: number) => (miB / 1024).toFixed(1);

// systemd es de Linux: en Windows no hay unit que mirar, ni journal, ni a quién parar.
const sinSystemd = process.platform === "win32";

async function estadoUnit(l: LocalDef, d: Deps): Promise<EstadoUnit | null> {
  if (sinSystemd) return null;
  try {
    return estadoDeShow(await d.ejecutar("systemctl", ["--user", "show", l.unit, "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts"], { timeout: 5000 }));
  } catch {
    return null;
  }
}

/** Lo que dejó la unit en el journal desde `desde` (ms); "" si no se puede leer. */
const journal = (l: LocalDef, d: Deps, desde: number) =>
  sinSystemd ? Promise.resolve("") : d.ejecutar("journalctl", ["--user", "-u", l.unit, "-o", "cat", "--no-pager", "-n", "80", "--since", `@${Math.floor(desde / 1000)}`], { timeout: 5000 }).catch(() => "");

const parar = (l: LocalDef, d: Deps) => (sinSystemd ? Promise.resolve("") : d.ejecutar("systemctl", ["--user", "stop", l.unit], { timeout: 60_000 }).catch(() => ""));

/** Sin conmutador: arranca la unit y espera a que llama-server conteste `/health` sirviendo a este modelo. Rechaza si no llega a tiempo. */
async function arrancarUnit(l: LocalDef, d: Deps): Promise<string> {
  await d.ejecutar("systemctl", ["--user", "start", l.unit], { timeout: 60_000 });
  const url = urlLlama(d, l);
  const fin = d.ahora() + PROBAR_ESPERA_MS;
  while (d.ahora() < fin) {
    if ((await d.pedirJson(`${url}/health`, 3000)) != null && aliasDe(await d.pedirJson(`${url}/v1/models`, 3000)).includes(l.dshId)) return "";
    await d.dormir(VIGILAR_MS);
    const s = await estadoUnit(l, d);
    if (s && (s.activo === "failed" || s.activo === "inactive")) throw new Error(`${l.unit}: ${s.activo}`);
  }
  throw new Error(`${l.unit}: no contestó en ${PROBAR_ESPERA_MS / 1000} s`);
}

/**
 * Arranca la unit con el conmutador del usuario (`conmutador` de locales.json: para la que esté en el puerto), o sin él con
 * `systemctl --user start`, y la vigila mientras carga: si se cae (con
 * `Restart=on-failure` systemd la relanzaría hasta 3 veces, ~45 s cada una, y el conmutador lo toma como "sigue
 * cargando"), la para y contesta enseguida. `null`: cargó; si no, por qué (texto `main.*`). Usa la GPU.
 */
async function cargar(l: LocalDef, d: Deps): Promise<string | null> {
  const conmutador = leerConfigLocales(d.env, d.home).conmutador;
  const conmutar = conmutador ? resolverBinario(conmutador, "HILOS_CONMUTADOR", d.env, d.home) : null;
  const antes = (await estadoUnit(l, d))?.reinicios ?? 0;
  const desde = d.ahora();
  let termino = false;
  const carga = Promise.resolve()
    .then(() => (conmutar ? d.ejecutar(conmutar, [l.clave], { timeout: PROBAR_ESPERA_MS }) : arrancarUnit(l, d)))
    .then(
      () => null,
      (e: unknown) => e,
    )
    .finally(() => (termino = true));
  let cayo = false;
  while (!termino) {
    await Promise.race([carga, d.dormir(VIGILAR_MS)]);
    if (termino) break;
    const s = await estadoUnit(l, d);
    // No se corta por el "failed to fit params" del primer segundo: llama.cpp lo dice si no le quedan 1024 MiB de margen
    // (`--fit-target`), y en el borde el modelo igual carga. Se corta cuando la unit se cae de verdad (~45 s).
    if (s && seCayo(s, antes)) {
      cayo = true;
      // Parada, el conmutador la ve inactive y sale solo (en ≤ 2 s).
      await parar(l, d);
      break;
    }
  }
  const err = await carga;
  if (!cayo && err == null) return null;
  await parar(l, d);
  const stderr = err == null ? "" : String((err as { stderr?: string }).stderr ?? (err as Error).message ?? err);
  const m = motivoDeLog(`${stderr}\n${await journal(l, d, desde)}`);
  return m.sinMemoria ? textoT("main.localSinMemoria") : textoT("main.localNoCargo", { motivo: m.linea ?? "?" });
}

/** Si los pesos solos no entran en lo libre de la GPU (sin contar al llama-server que se va a reemplazar): el aviso; si entran (o no se sabe), `null`. */
async function noEntra(l: LocalDef, d: Deps): Promise<string | null> {
  const gpu = await leerGpu(d);
  if (!gpu) return null;
  const info = await infoDe(l, d, gpu);
  const libre = info.est ? libreMiB(info.est) : Infinity;
  return info.pesosMiB > libre ? textoT("main.localNoEntra", { pesos: gb(info.pesosMiB), libre: gb(Math.max(0, libre)), otros: gb(info.est!.otrosMiB) }) : null;
}

/**
 * Carga el modelo con ese `-c` (para el que esté cargado y arranca el suyo con el conmutador), espera `/health`,
 * lee el `n_ctx` de `/props` y la memoria de la GPU. Si carga, queda guardado; si no, vuelve lo que había y se dice por qué.
 * SÓLO se llama con el clic del usuario: usa la GPU.
 * Falla rápido, sin cargar nada, si la unit instalada no lee el `-c` de trama o si sólo los pesos ya no entran en la VRAM
 * libre. Mientras carga mira la unit: si se cae (con `Restart=on-failure` systemd la relanzaría hasta 3 veces, ~45 s cada
 * una, y el conmutador lo toma como "sigue cargando") o llama-server avisa que no entra, la para y contesta enseguida.
 */
export async function probarLocal(x: unknown, d: Deps = depsDeVerdad()): Promise<ResultadoProbar> {
  const { l, ctx } = pedido(x, d);
  if (probando) throw errorT("main.localOcupado");
  probando = true;
  const fallo = (error: string, nCtx: number | null = null): ResultadoProbar => ({ ok: false, nCtx, usadoMiB: null, total: null, error });
  try {
    // Una unit que no lee LLAMA_CTX carga siempre con su `-c`: probar otro sería cargar 45 s para nada.
    const fijo = await ctxFijo(l, d);
    if (fijo != null && fijo !== ctx) return fallo(textoT("main.localUnitFija", { unit: l.unit, c: fijo }));
    // Si los pesos solos ya no entran en lo libre (sin contar al llama-server que se va a parar), no carga seguro.
    const lleno = await noEntra(l, d);
    if (lleno) return fallo(lleno);

    const previo = await d.leer(archivoEnv(d, l));
    const yamlAntes = await d.leer(archivoDsh(d));
    const dshAntes = yamlAntes == null ? null : contextWindowDe(yamlAntes, l.dshId);
    await escribirCtx(l, ctx, d);
    // Si ya está activa, el conmutador no la reinicia: se la para para que la próxima carga lea el `-c` nuevo.
    await parar(l, d);
    const caida = await cargar(l, d);

    let error: string | null = null;
    let nCtx: number | null = null;
    if (caida != null) error = caida;
    else {
      nCtx = nCtxDe(await d.pedirJson(`${urlLlama(d, l)}/props`, 5000));
      if (nCtx === ctx) {
        const gpu = await leerGpu(d);
        return { ok: true, nCtx, usadoMiB: gpu?.usadoMiB ?? null, total: gpu?.totalMiB ?? null, error: null };
      }
      error = textoT("main.localOtroCtx", { pedido: ctx, real: nCtx ?? 0 });
    }
    // No cargó (o cargó con otro valor): vuelve lo de antes, en el env (o sin env, si no había) y en dsh.
    if (previo != null) await d.escribir(archivoEnv(d, l), previo);
    else await d.borrar(archivoEnv(d, l));
    const yaml = await d.leer(archivoDsh(d));
    if (dshAntes != null && yaml != null) {
      const nuevo = conContextWindow(yaml, l.dshId, dshAntes);
      if (nuevo != null && nuevo !== yaml) await d.escribir(archivoDsh(d), nuevo);
    }
    return fallo(error, nCtx);
  } finally {
    probando = false;
  }
}

// ---------- servir a un líder ----------

/** Lo que necesita un líder local para hablarle a llama-server: adónde y cuánto contexto tiene cargado. */
export type Servido = { url: string; ctx: number };

/** Los alias que sirve llama-server ahora (`/v1/models`; el `--alias` de la unit es el id de dsh). */
function aliasDe(j: unknown): string[] {
  const o = j as { data?: { id?: unknown }[]; models?: { name?: unknown; model?: unknown }[] } | null;
  return [...(o?.data ?? []).map((m) => m?.id), ...(o?.models ?? []).flatMap((m) => [m?.name, m?.model])].filter((x): x is string => typeof x === "string");
}

const cargando = new Map<string, Promise<Servido>>();

/**
 * Que llama-server (127.0.0.1:8080) esté sirviendo a este modelo antes de que un líder le escriba. Si ya está, no toca nada
 * (un `GET /v1/models`); si no, lo carga con el conmutador (baja al modelo que estuviera: hay uno a la vez), con el
 * mismo aviso que Probar si no entra en la VRAM y la misma vigilancia si se cae. Lo llama un líder local con cada mensaje
 * (nunca una prueba: los tests le pasan `Deps` falsos). Dos líderes del mismo modelo a la vez esperan la misma carga.
 */
export function asegurarLocal(id: string, d: Deps = depsDeVerdad()): Promise<Servido> {
  const l = defDe(id, d);
  if (!l) return Promise.reject(errorT("main.localDesconocido"));
  const ya = cargando.get(l.id);
  if (ya) return ya;
  const p = asegurarYa(l, d).finally(() => cargando.delete(l.id));
  cargando.set(l.id, p);
  return p;
}

async function asegurarYa(l: LocalDef, d: Deps): Promise<Servido> {
  const url = urlLlama(d, l);
  const servido = async () => {
    if (!aliasDe(await d.pedirJson(`${url}/v1/models`, 3000)).includes(l.dshId)) return null;
    const props = await d.pedirJson(`${url}/props`, 3000);
    return { url, ctx: nCtxDe(props) ?? (await infoDe(l, d, null)).ctx };
  };
  const ahora = await servido();
  if (ahora) return ahora;
  if (probando) throw errorT("main.localOcupado");
  probando = true;
  try {
    const lleno = await noEntra(l, d);
    if (lleno) throw new Error(lleno);
    const caida = await cargar(l, d);
    if (caida) throw new Error(caida);
    const listo = await servido();
    if (!listo) throw errorT("main.localOtroModelo", { alias: l.dshId });
    return listo;
  } finally {
    probando = false;
  }
}

/** Adónde y con qué contexto hablaría un líder local, sin cargar nada (el `-c` guardado): para levantar su `claude` ocioso. */
export async function destinoLocal(id: string, d: Deps = depsDeVerdad()): Promise<Servido> {
  const l = defDe(id, d);
  if (!l) throw errorT("main.localDesconocido");
  return { url: urlLlama(d, l), ctx: (await infoDe(l, d, null)).ctx };
}
