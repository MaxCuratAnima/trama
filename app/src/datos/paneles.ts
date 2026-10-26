// Los datos de los tres paneles del pie (Ajustes, Ramas, Estadísticas): de
// `pa` y sus archivos por el main o, en bench y capturas, de los fixtures.
import { MODO } from "../modo";
import { fraseError, t } from "../i18n";
import { ErrorPa, RC_CONFLICTO } from "./errorpa";
import { main, mensaje } from "../puente";
import { textoT } from "../../electron/errores";
import { promptPasar } from "./asistente";
import { promptActualizar, promptAnalista } from "./analista";
import { promptRetomar } from "./retomar";
import { promptArreglar } from "./arreglar";
import { salud as saludDe, type EstadoSalud } from "./salud";
import type { Hilo } from "./contrato";
import { ACCESOS_FALSOS, AJUSTES, AUTO, ENTORNO_OLLAMA, MODELOS_FIJOS, OLLAMA_FALSO, arranqueMedidoFalso, historialFalso, MEDICION, REMOTO, SALUD, URL_REMOTO_FALSA } from "./fixtures-paneles";
import type { EstadoAuto } from "../../electron/autointegrar";
import type { Consulta, PiezaConsulta } from "../../electron/historial";
import type { Arranque, Medido } from "../../electron/arranque";
import type { EstadoModelos, Sondeo } from "../../electron/modelos-config";
import type { ConfigModelos } from "../../electron/modelos-tipos";
import type { Bajada } from "../../electron/ollama-bajar";
import type { EntornoOllama } from "../../electron/ollama-entorno";

export type { Arranque, Bajada, ConfigModelos, Consulta, EntornoOllama, EstadoAuto, EstadoModelos, EstadoSalud, Medido, PiezaConsulta, Sondeo };

/** El registro histórico de los últimos 7 o 30 días (electron/historial.ts), o por qué no se pudo. */
export type Historial = Consulta | { version: number; error: string };

/** Lo que el main junta para Ajustes (electron/paneles.ts). */
export type Ajustes = {
  version: number;
  /** `pa --plan`: "pro" o "max". `null` si `pa` no lo dijo (el porqué va en `plan_error`). */
  plan: string | null;
  plan_error: string | null;
  /** `autoCompactWindow` de `~/.claude/settings.json`; `null` si no está. */
  red_seguridad: number | null;
  routing: Routing;
};

export type Rol = "codigo" | "explorar" | "diseno";

/** Una fila de worker de la tabla de routing de `~/CLAUDE.md`. `modelo === null`: lo decide el líder. */
export type FilaRouting = {
  rol: Rol;
  modelo: string | null;
  /** La primera palabra de la celda Effort, si es un effort. */
  effort: string | null;
  /** La celda Effort entera ("medium acotado, high si toca varias partes"). */
  nota: string;
};

/** Lo que dice la tabla (o por qué no se pudo leer o escribir: entonces no se escribió nada). */
export type Routing = { version: number; filas: FilaRouting[] } | { version: number; error: string };

/** Un dispositivo que entró por la tailnet (electron/celular-accesos.ts): sistema e IP si Tailscale los dijo; `visto` en epoch, milisegundos. */
export type AccesoCelular = { nombre: string; sistema: string | null; ip: string | null; visto: number };

/** El acceso desde el celular (`remoto.json`), dónde escucha ahora y quién entró hace poco; por la tailnet no se edita (`editable: false`). */
export type EstadoRemoto =
  | { version: number; editable: false }
  | { version: number; editable: true; activo: boolean; puerto: number; dispositivos: string[]; escuchando: string[]; accesos: AccesoCelular[] };

/** Lo que Ajustes cambia del plan y de la red de seguridad (electron/ajustes-editar.ts). */
export type CambioAjustes = { plan?: string; red_seguridad?: number | null };

export type CambioRouting = { rol: Rol; modelo: string | null; effort: string | null };

/** Una corrida de `medicion.tsv`. `costo_usd` no cruza: El usuario paga suscripción. */
export type Corrida = {
  /** Cuándo terminó (epoch, segundos). */
  ts: number;
  proyecto: string;
  modelo: string;
  duracion_s: number;
  /** input + cache_read + output (así lo anota `pa`). */
  tokens: number;
  bien: "si" | "parcial" | "no" | null;
  /** `null` en las corridas de antes de que existiera la columna. */
  compactaciones: number | null;
  cache_read: number | null;
};

/** Una línea de `statusline/historial.jsonl`: % real de la cuota de 5 h y semanal, y cuándo se renuevan. */
export type Muestra = { ts: number; h5: number; h5_reset: number; sem: number; sem_reset: number };

/**
 * Las corridas de los últimos 60 días; `desde`, la primera fila de todo el
 * archivo; `cuota`, el historial (`null` si todavía no existe).
 */
export type Medicion =
  | { version: number; corridas: Corrida[]; desde: number | null; cuota: Muestra[] | null }
  | { version: number; error: string }
  | { version: number; vacia: true };

export type AccionRama = "integrar" | "descartar" | "revertir";

/** Un worker de rama lanzado con el modelo y el effort que eligió el usuario (el paso previo de Ramas); el tipo lo pone el main. */
export type LanzarRama = { accion: "actualizar"; id: string; proyecto: string; modelo: string; effort: string; texto?: string };

/** Con este código `pa <proy> --integrar <id> --tests` avisa que los tests dieron rojo y no tocó main. */
const RC_TESTS_ROJOS = 93;

export interface FuentePaneles {
  ajustes(): Promise<Ajustes>;
  medicion(): Promise<Medicion>;
  /** En qué se fueron los tokens (y qué pesó el arranque) en los últimos 7 o 30 días, de todos o de un rol. */
  historial(dias: 7 | 30, rol?: "lider" | "worker" | "subagente"): Promise<Historial>;
  /** Lo último que se midió del peso de arrancar ("Medir exacto"), o `null` si nunca. */
  arranqueMedido(): Promise<Medido | null>;
  /** Mide ahora el peso exacto de arrancar (cuatro pedidos cortos a `claude`); nunca rechaza. */
  medirArranque(): Promise<Arranque>;
  /**
   * Integrar: `pa <proy> --integrar <id> --tests`. Descartar: `pa --descartar <id>`.
   * Deshacer: `pa --revertir <id>`. Rechaza con lo que dijo `pa`.
   */
  rama(accion: AccionRama, h: Hilo): Promise<void>;
  /** Lanza ese worker (`pa <proy> --actualizar <id> --async -m … --effort … --tipo …`). Rechaza con lo que dijo `pa`. */
  lanzar(x: LanzarRama): Promise<void>;
  /** Reescribe esas filas de la tabla de routing; devuelve cómo quedó o el error. */
  guardarRouting(cambios: CambioRouting[]): Promise<Routing>;
  /** La config de modelos (`~/.config/trama/modelos.json`): lo que hay, o lo de hoy si no hay archivo. */
  modelos(): Promise<EstadoModelos>;
  /** Guarda esa config (y las filas de `~/CLAUDE.md` que salen de ella); rechaza con el motivo sin haber escrito nada. */
  guardarModelos(config: ConfigModelos): Promise<EstadoModelos>;
  /** Qué modelos tiene instalados el Ollama de esa dirección, o por qué no contesta. */
  sondearOllama(url: string): Promise<Sondeo>;
  /** Empieza a bajar un modelo de Ollama por su nombre (`ollama pull`); el progreso llega por `alBajar`. Rechaza con el motivo. */
  bajarModelo(url: string, modelo: string): Promise<Bajada>;
  cancelarBajada(url: string, modelo: string): Promise<void>;
  /** Las bajadas en curso o terminadas (para una página recién cargada). */
  bajadas(): Promise<Bajada[]>;
  alBajar(fn: (b: Bajada) => void): () => void;
  /** Qué hay en esta máquina para Ollama (instalado, distro, GPU y VRAM, comandos de instalar y arrancar); sólo lee. */
  entornoOllama(): Promise<EntornoOllama>;
  /** Guarda el plan (`pa --plan`) y/o la red de seguridad (`autoCompactWindow`); devuelve Ajustes como quedó o rechaza con el motivo. */
  guardarAjustes(cambio: CambioAjustes): Promise<Ajustes>;
  /** El acceso desde el celular: cómo está y dónde escucha. */
  remoto(): Promise<EstadoRemoto>;
  /** Guarda el acceso desde el celular (el servidor queda como dice); rechaza con el motivo sin haber escrito nada. */
  guardarRemoto(config: { activo: boolean; puerto: number; dispositivos: string[] }): Promise<EstadoRemoto>;
  /** El primer mensaje del analista de Ramas (B22) o, con `actualizar`, el que le repasa la lista. */
  brief(hs: Hilo[], actualizar: boolean): Promise<string>;
  /** El primer mensaje del líder que retoma una corrida caída (B22). */
  retomar(h: Hilo): Promise<string>;
  /** "Integrar solo lo seguro" (B22). */
  auto: {
    leer(): Promise<EstadoAuto>;
    prender(si: boolean): Promise<void>;
    alCambiar(fn: (e: EstadoAuto) => void): () => void;
  };
  /** La salud de lo integrado (B25): revertidas, `bien=no` y los tests sobre main. */
  salud: {
    leer(): Promise<EstadoSalud>;
    alCambiar(fn: (e: EstadoSalud) => void): () => void;
  };
  /** El primer mensaje del líder de "Mandar a verificar y arreglar" (B25). */
  arreglar(h: Hilo, estado: string): Promise<string>;
  /** El primer mensaje de "Pasárselo a un líder" (un worker sin líder que espera una decisión). */
  pasar(h: Hilo): Promise<string>;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

const commitsFijos = (n: number) =>
  Array.from({ length: Math.min(n, 3) }, (_, i) => `${(0xa1b2c3 + i * 4099).toString(16)} step ${i + 1} of the task`);

const fallar = (e: unknown): never => {
  throw new Error(mensaje(e));
};

/** Lo que dicen los paneles cuando no cargan (fixtures): uno conocido, uno que no, otro de red. */
const FALLAS_PANEL = {
  ajustes: "pa: límite de sesión de la suscripción hasta las 15:00. No lanzo.",
  medicion: "fetch failed",
  historial: "EACCES: permission denied, open 'historial/indice.json'",
} as const;
/** Lo que dice "Medir exacto" cuando `claude` falla (fixtures, variante `error-medir`). */
const FALLA_MEDIR = "claude: not logged in";
const pedidos = new Map<string, number>();
/** Los Guardar que ya fallaron una vez en las fixtures (`ajustes-guardar`, `remoto-guardar`). */
const FALLO = new Set<string>();

/**
 * Fixtures de un panel que no carga: `?falla=paneles` (todos, siempre), `?falla=paneles-una` (el primer pedido
 * de cada uno; después anda, para probar Reintentar) y, en las capturas, las variantes `error` (Ajustes y
 * Estadísticas) y `error-historial` (sólo el registro histórico, adentro de Estadísticas).
 */
function cae(que: keyof typeof FALLAS_PANEL): boolean {
  const n = (pedidos.get(que) ?? 0) + 1;
  pedidos.set(que, n);
  if (MODO.falla === "paneles-una") return n === 1;
  if (MODO.falla === "paneles") return true;
  return MODO.variante === "error" ? que !== "historial" : MODO.variante === "error-historial" && que === "historial";
}

/** La config de modelos de los fixtures: se arma al primer pedido y vive mientras la página. */
let modelosFijos: EstadoModelos | undefined;

const FALLA_CONFLICTO = "pa: conflicts merging into main. A worker can resolve it: pa atlas --actualizar 20261003-100000-11111";

/** Las bajadas de las fixtures: un "ollama pull" falso que sube solo (`mdl-bajando` deja una a mitad). */
const bajadasFalsas = new Map<string, Bajada>(
  MODO.variante === "mdl-bajando"
    ? [["qwen3:8b", { url: "http://localhost:11434", modelo: "qwen3:8b", estado: "bajando", texto: "pulling 7a4b3c2d1e0f", completado: 2_100_000_000, total: 5_000_000_000, motivo: null }]]
    : [],
);
const bajadosFalsos: { nombre: string; bytes: number | null }[] = [];
const cortesFalsos = new Map<string, () => void>();
const oyentesBajada = new Set<(b: Bajada) => void>();
function avisarBajada(b: Bajada) {
  bajadasFalsas.set(b.modelo, b);
  for (const fn of oyentesBajada) fn({ ...b });
}

const fija: FuentePaneles = {
  async ajustes() {
    if (cae("ajustes")) throw new Error(FALLAS_PANEL.ajustes);
    // `?falla=routing`: un CLAUDE.md sin los marcadores (ni se lee ni se guarda).
    if (MODO.falla === "routing") return { ...AJUSTES, routing: await this.guardarRouting([]) };
    return AJUSTES;
  },
  async guardarAjustes(cambio) {
    await espera(150);
    // `?falla=ajustes-guardar`: el primer Guardar falla con un `pa --plan` que no acepta (el error queda en línea y nada cambia); el siguiente anda.
    if (MODO.falla === "ajustes-guardar" && !FALLO.has("ajustes")) {
      FALLO.add("ajustes");
      throw new Error(FALLAS_PANEL.ajustes);
    }
    if (cambio.plan !== undefined) AJUSTES.plan = cambio.plan;
    if (cambio.red_seguridad !== undefined) AJUSTES.red_seguridad = cambio.red_seguridad;
    return AJUSTES;
  },
  async modelos() {
    modelosFijos ??= MODELOS_FIJOS(MODO.variante?.startsWith("mdl") === true, MODO.variante === "mdl-auto");
    return structuredClone(modelosFijos);
  },
  async guardarModelos(config) {
    await espera(150);
    // `?falla=modelos-guardar`: el primer Guardar falla (el archivo de ahora no se puede leer); el siguiente anda.
    if (MODO.falla === "modelos-guardar" && !FALLO.has("modelos")) {
      FALLO.add("modelos");
      throw new Error(textoT("main.modelosRoto", { ruta: "%APPDATA%\\Trama\\modelos.json", e: "Unexpected token } in JSON at position 41" }));
    }
    modelosFijos = { ...(modelosFijos ?? MODELOS_FIJOS(false)), existe: true, config: structuredClone(config) };
    return structuredClone(modelosFijos);
  },
  async sondearOllama(url) {
    await espera(250);
    // `mdl-sinollama`: la dirección de siempre no contesta (hasta que se "instala").
    if (/caido|apagado/.test(url) || ((MODO.variante === "mdl-sinollama" || MODO.variante === "mdl-apagado") && /localhost:11434/.test(url))) return { ok: false, motivo: textoT("main.ollamaNoContesta") };
    return { ok: true, modelos: [...OLLAMA_FALSO, ...bajadosFalsos] };
  },
  async entornoOllama() {
    await espera(120);
    return structuredClone(ENTORNO_OLLAMA(MODO.variante));
  },
  async bajarModelo(url, modelo) {
    const nombre = modelo.trim();
    if (!/^[A-Za-z0-9][\w.:/-]{0,120}$/.test(nombre)) throw new Error(textoT("main.ollamaNombre"));
    if (/^(no-existe|nada)/.test(nombre)) {
      const b: Bajada = { url, modelo: nombre, estado: "error", texto: "", completado: null, total: null, motivo: "pull model manifest: file does not exist" };
      setTimeout(() => avisarBajada(b), 300);
      return { ...b, estado: "bajando", motivo: null };
    }
    const total = 4_700_000_000;
    let hecho = 0;
    const b: Bajada = { url, modelo: nombre, estado: "bajando", texto: "pulling manifest", completado: null, total: null, motivo: null };
    bajadasFalsas.set(nombre, b);
    // Cada 350 ms sube un 7 %: unos 5 s en total.
    const paso = setInterval(() => {
      hecho += total * 0.07;
      const act = bajadasFalsas.get(nombre);
      if (!act || act.estado !== "bajando") return clearInterval(paso);
      if (hecho >= total) {
        clearInterval(paso);
        bajadosFalsos.push({ nombre, bytes: total });
        return avisarBajada({ ...act, estado: "listo", texto: "success", completado: total, total, motivo: null });
      }
      avisarBajada({ ...act, texto: "pulling 7a4b3c2d1e0f", completado: Math.round(hecho), total });
    }, 350);
    cortesFalsos.set(nombre, () => {
      clearInterval(paso);
      avisarBajada({ ...b, estado: "error", motivo: textoT("main.ollamaCancelada") });
    });
    return { ...b };
  },
  async cancelarBajada(_url, modelo) {
    cortesFalsos.get(modelo.trim())?.();
  },
  async bajadas() {
    return [...bajadasFalsas.values()].map((b) => ({ ...b }));
  },
  alBajar(fn) {
    oyentesBajada.add(fn);
    return () => void oyentesBajada.delete(fn);
  },
  async remoto() {
    return { version: 1, editable: true, ...REMOTO, escuchando: REMOTO.activo ? [URL_REMOTO_FALSA(REMOTO.puerto)] : [], accesos: ACCESOS_FALSOS().filter((a) => REMOTO.dispositivos.includes(a.nombre)) };
  },
  async guardarRemoto(config) {
    await espera(150);
    // `?falla=remoto-guardar`: sólo el primero falla (no se pudo escribir `remoto.json`); el siguiente anda.
    if (MODO.falla === "remoto-guardar" && !FALLO.has("remoto")) {
      FALLO.add("remoto");
      throw new Error("EACCES: permission denied, open 'remoto.json'");
    }
    Object.assign(REMOTO, config);
    return this.remoto();
  },
  async medicion() {
    if (cae("medicion")) return { version: 1, error: FALLAS_PANEL.medicion };
    if (MODO.captura === "estadisticas-vacia") return { version: 1, vacia: true };
    return MEDICION;
  },
  async historial(dias, rol) {
    if (cae("historial")) return { version: 1, error: FALLAS_PANEL.historial };
    // Para ver el período nuevo llegando (scripts/prueba-historial.mjs): la prueba le pone una demora desde la página.
    const demora = (globalThis as { __historialDemora?: number }).__historialDemora;
    if (demora) await espera(demora);
    return historialFalso(dias, rol);
  },
  async arranqueMedido() {
    return MODO.captura === "estadisticas-medido" ? arranqueMedidoFalso : null;
  },
  async medirArranque() {
    await espera(600);
    return MODO.variante === "error-medir" ? { version: 1, error: FALLA_MEDIR } : arranqueMedidoFalso;
  },
  async rama(accion) {
    await espera(350);
    // Para probar el camino del error: `?falla=integrar` (tests rojos), `descartar` o `revertir`.
    // `?falla=conflicto`: Integrar choca con main (80) y la fila ofrece Actualizar.
    if (MODO.falla === "conflicto" && accion === "integrar") throw new ErrorPa(FALLA_CONFLICTO, RC_CONFLICTO);
    if (MODO.falla !== accion) return;
    throw new Error(accion === "integrar" ? t("error.testsRojos") : `pa --${accion} failed`);
  },
  async lanzar() {
    await espera(350);
    // Para probar el camino del error: `?falla=lanzar`.
    if (MODO.falla === "lanzar") throw new Error("pa: effort 'max' with 'claude-opus-5-5' needs --ok-dueno");
  },
  async guardarRouting(cambios) {
    await espera(150);
    if (MODO.falla === "routing")
      return { version: 1, error: textoT("main.routingSinMarcas") };
    const r = AJUSTES.routing;
    if ("error" in r) return r;
    const filas = r.filas.map((f) => {
      const c = cambios.find((x) => x.rol === f.rol);
      if (!c || (c.modelo === f.modelo && c.effort === f.effort)) return f;
      return { ...c, nota: c.modelo === null ? "—" : c.modelo !== f.modelo && c.effort === f.effort ? f.nota : (c.effort ?? "") };
    });
    AJUSTES.routing = { version: 1, filas };
    return AJUSTES.routing;
  },
  async brief(hs, actualizar) {
    const ahora = Math.floor(Date.now() / 1000);
    const ramas = hs.map((h) => ({
      id: h.id,
      proyecto: h.proyecto,
      ruta: `~/Proyectos/${h.proyecto}`,
      rama: h.rama ?? "",
      estado: h.estado,
      tarea: h.tarea,
      resultado: h.resultado,
      decision: h.decision,
      commits: commitsFijos(h.commits),
      archivos: ["src/index.ts", "tests/index.test.ts"],
      edad_s: ahora - h.inicio - (h.duracion_s ?? 0),
      lider_vivo: h.jefe_id ? false : null,
    }));
    return (actualizar ? promptActualizar : promptAnalista)(ramas);
  },
  async retomar(h) {
    return promptRetomar({
      id: h.id,
      proyecto: h.proyecto,
      ruta: `~/Proyectos/${h.proyecto}`,
      rama: h.rama,
      commits: commitsFijos(h.commits),
      tope: 20,
      tarea: h.tarea,
      resultado: h.resultado,
      decision: h.decision,
      estado: h.estado,
      tests: true,
    });
  },
  auto: {
    async leer() {
      return AUTO;
    },
    async prender(si) {
      AUTO.prendido = si;
    },
    alCambiar() {
      return () => {};
    },
  },
  salud: {
    async leer() {
      return SALUD;
    },
    alCambiar() {
      return () => {};
    },
  },
  async arreglar(h, estado) {
    const f = SALUD.integradas[h.id];
    const s = saludDe(h.id, estado, SALUD);
    return promptArreglar({
      id: h.id,
      proyecto: h.proyecto,
      ruta: `~/Proyectos/${h.proyecto}`,
      rama: h.rama,
      head_antes: f?.head_antes ?? null,
      head_despues: f?.head_despues ?? null,
      commits: commitsFijos(h.commits),
      tope: 30,
      motivo: s.rojo ? s.motivo : "tests",
      tests: "npm test",
      cola: s.rojo ? s.cola : null,
      rc: s.rojo ? s.rc : null,
    });
  },
  async pasar(h) {
    return promptPasar({
      id: h.id,
      proyecto: h.proyecto,
      ruta: `~/Proyectos/${h.proyecto}`,
      rama: h.rama,
      commits: commitsFijos(h.commits),
      tope: 20,
      tarea: h.tarea,
      resultado: h.resultado,
      decision: h.decision,
    });
  },
};

const conPa = (m: NonNullable<typeof main>): FuentePaneles => ({
  async ajustes() {
    return (await m.paneles.ajustes()) as Ajustes;
  },
  async medicion() {
    return (await m.paneles.medicion()) as Medicion;
  },
  async historial(dias, rol) {
    return (await m.paneles.historial(dias, rol ?? null)) as Historial;
  },
  async arranqueMedido() {
    return (await m.paneles.arranqueMedido()) as Medido | null;
  },
  async medirArranque() {
    return (await m.paneles.medirArranque()) as Arranque;
  },
  async rama(accion, h) {
    const r = await m.paneles.rama(accion, { id: h.id, proyecto: h.proyecto }).catch((e) => {
      throw new Error(mensaje(e));
    });
    if (r.rc === 0) return;
    throw new ErrorPa(
      accion === "integrar" && r.rc === RC_TESTS_ROJOS
        ? t("error.testsRojos")
        : r.dijo || fraseError(t("error.paSalio", { accion, rc: r.rc }), r.rc),
      r.rc,
    );
  },
  async lanzar(x) {
    const r = await m.paneles.lanzar(x).catch((e) => {
      throw new Error(mensaje(e));
    });
    if (r.rc === 0) return;
    throw new ErrorPa(r.dijo || fraseError(t("error.paSalio", { accion: x.accion, rc: r.rc }), r.rc), r.rc);
  },
  async guardarRouting(cambios) {
    return (await m.paneles.routing(cambios).catch((e) => ({ version: 1, error: mensaje(e) }))) as Routing;
  },
  async modelos() {
    return (await m.paneles.modelos().catch(fallar)) as EstadoModelos;
  },
  async guardarModelos(config) {
    return (await m.paneles.guardarModelos(config).catch(fallar)) as EstadoModelos;
  },
  async sondearOllama(url) {
    return (await m.paneles.sondearOllama(url).catch(fallar)) as Sondeo;
  },
  async bajarModelo(url, modelo) {
    return (await m.paneles.bajarModelo(url, modelo).catch(fallar)) as Bajada;
  },
  async cancelarBajada(url, modelo) {
    await m.paneles.cancelarBajada(url, modelo).catch(fallar);
  },
  async bajadas() {
    return ((await m.paneles.bajadas().catch(() => [])) as Bajada[]) ?? [];
  },
  async entornoOllama() {
    return (await m.paneles.entornoOllama().catch(fallar)) as EntornoOllama;
  },
  alBajar(fn) {
    return m.paneles.alBajar((b) => {
      if (b && typeof b === "object" && typeof (b as Bajada).modelo === "string") fn(b as Bajada);
    });
  },
  async guardarAjustes(cambio) {
    return (await m.paneles.guardarAjustes(cambio).catch(fallar)) as Ajustes;
  },
  async remoto() {
    return (await m.paneles.remoto().catch(fallar)) as EstadoRemoto;
  },
  async guardarRemoto(config) {
    return (await m.paneles.guardarRemoto(config).catch(fallar)) as EstadoRemoto;
  },
  async brief(hs, actualizar) {
    const ramas = await m.paneles
      .brief(
        hs.map((h) => ({
          id: h.id,
          proyecto: h.proyecto,
          rama: h.rama ?? "",
          estado: h.estado,
          commits: h.commits,
          tarea: h.tarea,
          resultado: h.resultado,
          decision: h.decision,
          fin: h.inicio + (h.duracion_s ?? 0),
          jefe_id: h.jefe_id ?? null,
        })),
      )
      .catch(fallar);
    return (actualizar ? promptActualizar : promptAnalista)(ramas);
  },
  async retomar(h) {
    const d = await m.paneles
      .retomar({
        id: h.id,
        proyecto: h.proyecto,
        rama: h.rama,
        commits: h.commits,
        tarea: h.tarea,
        resultado: h.resultado,
        decision: h.decision,
        estado: h.estado,
      })
      .catch(fallar);
    return promptRetomar(d);
  },
  auto: {
    async leer() {
      return (await m.auto.leer()) as EstadoAuto;
    },
    async prender(si) {
      await m.auto.prender(si).catch(fallar);
    },
    alCambiar(fn) {
      return m.auto.alCambiar((e) => fn(e as EstadoAuto));
    },
  },
  salud: {
    async leer() {
      return (await m.salud.leer()) as EstadoSalud;
    },
    alCambiar(fn) {
      return m.salud.alCambiar((e) => fn(e as EstadoSalud));
    },
  },
  async arreglar(h, estado) {
    const d = (await m.salud.arreglar({ id: h.id, proyecto: h.proyecto, rama: h.rama }).catch(fallar)) as {
      id: string;
      proyecto: string;
      ruta: string | null;
      rama: string | null;
      fila: { head_antes: string; head_despues: string; accion: string } | null;
      chequeo: { head: string; rc: number; cola: string; ts: number } | null;
      bienNo: boolean;
      commits: string[] | null;
      tope: number;
      tests: string | null;
    };
    const s = saludDe(h.id, estado, {
      version: 1,
      integradas: d.fila ? { [h.id]: d.fila as EstadoSalud["integradas"][string] } : {},
      bienNo: d.bienNo ? [h.id] : [],
      chequeos: d.chequeo ? { [h.id]: d.chequeo } : {},
      corriendo: [],
    });
    return promptArreglar({
      id: d.id,
      proyecto: d.proyecto,
      ruta: d.ruta,
      rama: d.rama,
      head_antes: d.fila?.head_antes || null,
      head_despues: d.fila?.head_despues || null,
      commits: d.commits,
      tope: d.tope,
      motivo: s.rojo ? s.motivo : "tests",
      tests: d.tests,
      cola: s.rojo ? s.cola : null,
      rc: s.rojo ? s.rc : null,
    });
  },
  async pasar(h) {
    return m.paneles
      .pasar({
        id: h.id,
        proyecto: h.proyecto,
        rama: h.rama,
        commits: h.commits,
        tarea: h.tarea,
        resultado: h.resultado,
        decision: h.decision,
      })
      .then(promptPasar, (e) => {
        throw new Error(mensaje(e));
      });
  },
});

export const fuentePaneles: FuentePaneles = MODO.fixtures || !main ? fija : conPa(main);
