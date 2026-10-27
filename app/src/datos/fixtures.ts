// Datos falsos con la forma exacta del contrato, para el bench y las capturas
// (y `HILOS_FIXTURES=1`). Todo inventado: proyectos, ids, tareas y ramas.
// Los tiempos son relativos al momento de carga para que la barra siempre se
// vea "viva" (un caché a 47 min, otro por vencer, uno trabajando hace 38 s).
import { BYTES_Q8_0, estimar, kvBytesPorToken } from "../../electron/locales-calc";
import type { EstadoLocales, LocalInfo } from "../../electron/locales";
import type { EstadoVram, ResultadoLiberar } from "../../electron/vram";
import { MODO } from "../modo";
import type { Herramienta, Hilo, Lider, Mensaje, RespuestaHilo, RespuestaHilos, RespuestaLideres, Uso } from "./contrato";

const AHORA = Math.floor(Date.now() / 1000);
const MIN = 60;
const HORA = 3600;
const DIA = 86400;
// Margen para que "47m" no cambie a "46m" a los pocos segundos de abrir.
const COLCHON = 40;

type Parcial = Pick<Hilo, "id" | "proyecto" | "tarea" | "estado" | "inicio"> & Partial<Hilo>;

// Los líderes (sesiones de Claude Code de Ana) y uno que ya cerró: sus workers quedan "sin líder".
const A3 = { id: "s-fix-a3", nombre: "ana-a3" };
const C7 = { id: "s-fix-c7", nombre: "ana-c7" };
const E9 = { id: "s-fix-e9", nombre: "cauce-e9" };
const B5 = { id: "s-fix-b5", nombre: "ana-b5" };
const MUERTO = { id: "s-fix-muerto", nombre: "ana-d2" };
const deLider = (l: { id: string; nombre: string }) => ({ jefe: l.nombre, jefe_id: l.id });

const hilo = (p: Parcial): Hilo => ({
  modelo: "claude-opus-5-5",
  effort: "medium",
  origen: "jefe",
  jefe: null,
  jefe_id: null,
  sigue_de: null,
  en_cola: false,
  duracion_s: null,
  puesto: null,
  rama: null,
  commits: 0,
  decision: null,
  decision_nada: null,
  resultado: null,
  archivado: false,
  leer: false,
  cache_ttl_s: null,
  cache_vence: null,
  cache_frio: null,
  cache_modelo: null,
  ...p,
});

const cache = (ttl: number, restan: number, frio: Hilo["cache_frio"] = null) => ({
  cache_ttl_s: ttl,
  cache_vence: AHORA + restan + COLCHON,
  cache_frio: frio,
});

/** Las capturas `arrancando` y `frenado`: lo que dice `eventos.jsonl` antes de que la lista lo traiga (src/datos/fuente.ts). */
export const ARRANCANDO = { id: "20261013-120000-70001", proyecto: "atlas" };
/** El worker de atlas que "frena" la captura `frenado`: trabaja bajo ana-c7 (el de los índices). */
export const FRENADO = { id: "20261003-103620-49377", proyecto: "atlas" };

export const HILOS: RespuestaHilos = {
  version: 1,
  hilos: [
    // atlas
    hilo({
      id: "20261003-101412-48213",
      ...deLider(A3),
      proyecto: "atlas",
      tarea: "Paginado en el listado de envíos",
      estado: "listo",
      effort: "high",
      inicio: AHORA - 26 * MIN,
      duracion_s: 13 * MIN,
      puesto: "aca",
      rama: "pa/atlas/20261003-101412-48213",
      commits: 3,
      resultado: "Paginado por cursor en el listado y en la API. Tests verdes.",
      ...cache(HORA, 47 * MIN),
    }),
    hilo({
      id: "20261003-094533-47102",
      origen: "app",
      proyecto: "atlas",
      tarea: "Migrar la config de YAML a TOML",
      estado: "decision",
      inicio: AHORA - 71 * MIN,
      duracion_s: 19 * MIN,
      puesto: "1",
      rama: "pa/atlas/20261003-094533-47102",
      commits: 1,
      decision:
        "Hasta cuándo se sigue leyendo el YAML, prefiero que lo elijas vos:\n1. Un release más con las dos: nadie se entera, pero queda código para borrar después.\n2. Cortar ya: más simple, y el que tenga YAML ve un error claro con el comando para convertir.",
      resultado: "Migración hecha; falta definir compatibilidad hacia atrás.",
      ...cache(HORA, 8 * MIN),
    }),
    hilo({
      id: "20261003-103620-49377",
      ...deLider(C7),
      proyecto: "atlas",
      tarea: "Auditar los índices de la tabla de rutas",
      estado: "trabajando",
      modelo: "claude-sonnet-5-5",
      effort: "high",
      inicio: AHORA - 4 * MIN - 12,
      puesto: "2",
      ...cache(HORA, 58 * MIN),
    }),
    hilo({
      id: "20261001-162208-31045",
      ...deLider(A3),
      proyecto: "atlas",
      tarea: "Reintentos con backoff en el cliente HTTP",
      estado: "integrado",
      inicio: AHORA - 2 * DIA - 3 * HORA,
      duracion_s: 22 * MIN,
      rama: "pa/atlas/20261001-162208-31045",
      commits: 4,
      resultado: "Integrado con tests.",
    }),
    // B25: integrada, y después los tests de main dieron rojo (fixtures-paneles.ts, SALUD).
    hilo({
      id: "20261002-141530-52210",
      ...deLider(A3),
      proyecto: "atlas",
      tarea: "Migrar el parser de fechas a Temporal",
      estado: "integrado",
      inicio: AHORA - 1 * DIA - 5 * HORA,
      duracion_s: 31 * MIN,
      rama: "pa/atlas/20261002-141530-52210",
      commits: 6,
      resultado: "Integrado con tests.",
    }),
    // Terminados de un líder vivo: no ocupan la barra, van en su "+N" (B15).
    hilo({
      id: "20261003-092240-45930",
      ...deLider(A3),
      proyecto: "atlas",
      tarea: "Buscar dónde se arma la firma de los webhooks",
      estado: "entregado",
      modelo: "claude-sonnet-5-5",
      inicio: AHORA - 93 * MIN,
      duracion_s: 4 * MIN,
      leer: true,
      resultado: "La firma se arma en un solo lugar; el secreto sale de la config.",
    }),
    hilo({
      id: "20261003-085107-44518",
      ...deLider(A3),
      proyecto: "atlas",
      tarea: "Tests del parser de direcciones",
      estado: "decision",
      inicio: AHORA - 2 * HORA - 5 * MIN,
      duracion_s: 16 * MIN,
      puesto: "1",
      rama: "pa/atlas/20261003-085107-44518",
      commits: 2,
      decision: "Dos casos de direcciones sin número fallan: ¿los marco como pendientes o cambio el parser?",
      resultado: "14 tests nuevos; dos casos raros quedan en duda.",
    }),
    hilo({
      id: "20261003-103905-49650",
      ...deLider(C7),
      proyecto: "atlas",
      tarea: "Medir el plan de las consultas lentas",
      estado: "trabajando",
      inicio: AHORA - 95,
      puesto: "3",
      ...cache(HORA, 59 * MIN),
    }),

    hilo({
      id: "20261003-075012-43307",
      proyecto: "atlas",
      tarea: "Revisar los permisos del bucket de adjuntos",
      estado: "entregado",
      modelo: "claude-sonnet-5-5",
      effort: "high",
      inicio: AHORA - 2 * HORA - 40 * MIN,
      duracion_s: 9 * MIN,
      resultado: "Los permisos están bien; sólo sobra una regla vieja de lectura pública.",
      ...deLider(C7),
    }),
    // brote
    hilo({
      id: "20261003-104001-49820",
      proyecto: "brote",
      tarea: "Exportar el calendario de riego a ICS",
      estado: "trabajando",
      origen: "app",
      inicio: AHORA - 38,
      puesto: "aca",
      rama: "pa/brote/20261003-104001-49820",
      ...cache(HORA, 59 * MIN),
    }),
    hilo({
      id: "20261003-094810-47377",
      ...deLider(MUERTO),
      proyecto: "brote",
      tarea: "Tests del importador de sensores",
      estado: "colgado",
      inicio: AHORA - 52 * MIN,
      // Hasta acá avanzó: de ahí sale el "sin avance hace 22 m".
      duracion_s: 30 * MIN,
      puesto: "1",
      rama: "pa/brote/20261003-094810-47377",
      commits: 2,
      ...cache(HORA, 21 * MIN),
    }),
    hilo({
      id: "20261003-073055-42190",
      ...deLider(MUERTO),
      proyecto: "brote",
      tarea: "Resumir cómo se calcula el punto de rocío",
      estado: "entregado",
      modelo: "claude-sonnet-5-5",
      effort: "high",
      inicio: AHORA - 3 * HORA - 9 * MIN,
      duracion_s: 6 * MIN,
      resultado: "Fórmula de Magnus en `clima/rocio.py`; dos constantes sin fuente.",
      ...cache(HORA, -2 * HORA, "vencido"),
    }),
    hilo({
      id: "20260929-183340-20714",
      ...deLider(MUERTO),
      proyecto: "brote",
      tarea: "Gráfico de humedad con canvas propio",
      estado: "descartado",
      modelo: "claude-fable-5-1",
      effort: "high",
      inicio: AHORA - 4 * DIA - HORA,
      duracion_s: 31 * MIN,
      commits: 6,
    }),

    // cauce
    hilo({
      id: "20261003-100247-47951",
      origen: "app",
      proyecto: "cauce",
      tarea: "Rediseñar la pantalla de conciliación",
      estado: "decision",
      modelo: "claude-fable-5-1",
      effort: "high",
      inicio: AHORA - 44 * MIN,
      duracion_s: 27 * MIN,
      puesto: "2",
      rama: "pa/cauce/20261003-100247-47951",
      commits: 5,
      decision: "Dos variantes de la tabla: densa o con tarjetas. ¿Cuál queda?",
      ...cache(5 * MIN, 3 * MIN),
    }),
    hilo({
      id: "20261003-091530-45508",
      ...deLider(E9),
      proyecto: "cauce",
      tarea: "Redondeo bancario en los totales",
      estado: "listo",
      inicio: AHORA - 96 * MIN,
      duracion_s: 11 * MIN,
      puesto: "aca",
      rama: "pa/cauce/20261003-091530-45508",
      commits: 2,
      resultado: "Redondeo half-even en `totales.rs`, con casos borde.",
      ...cache(HORA, 31 * MIN, "modelo"),
    }),
    hilo({
      id: "20261003-084419-44012",
      ...deLider(E9),
      proyecto: "cauce",
      tarea: "Encontrar el movimiento duplicado de marzo",
      estado: "murio",
      modelo: "claude-sonnet-5-5",
      effort: "xhigh",
      inicio: AHORA - 2 * HORA - 5 * MIN,
      duracion_s: 3 * MIN,
      puesto: "1",
      rama: "pa/cauce/20261003-084419-44012",
    }),
    hilo({
      id: "20260928-112751-15233",
      ...deLider(E9),
      proyecto: "cauce",
      tarea: "Cache de cotizaciones en disco",
      estado: "revertido",
      inicio: AHORA - 5 * DIA - 2 * HORA,
      duracion_s: 17 * MIN,
      commits: 3,
    }),

    // duna
    hilo({
      id: "20261002-090116-36640",
      ...deLider(MUERTO),
      proyecto: "duna",
      tarea: "Limpiar warnings del generador de mapas",
      estado: "entregado",
      inicio: AHORA - DIA - 2 * HORA,
      duracion_s: 14 * MIN,
      puesto: "aca",
      rama: "pa/duna/20261002-090116-36640",
      commits: 4,
      resultado: "Cero warnings; dos `allow` documentados.",
    }),
    hilo({
      id: "20261003-095902-47733",
      ...deLider(MUERTO),
      proyecto: "duna",
      tarea: "Renombrar el módulo de colas",
      estado: "listo",
      modelo: "claude-haiku-5-5",
      inicio: AHORA - 55 * MIN,
      duracion_s: 4 * MIN,
      puesto: "2",
      rama: "pa/duna/20261003-095902-47733",
      commits: 1,
      resultado: "Renombrado `colas` → `turnos` en 14 archivos.",
      ...cache(HORA, 12 * MIN, "otro_dir"),
    }),
    hilo({
      id: "20260927-151003-11872",
      proyecto: "duna",
      tarea: "Comparar tres librerías de ruido Perlin",
      estado: "archivado",
      modelo: "claude-sonnet-5-5",
      effort: "high",
      inicio: AHORA - 6 * DIA,
      duracion_s: 9 * MIN,
      archivado: true,
      resultado: "Tabla comparativa en el informe.",
    }),

    // eco
    hilo({
      id: "20261003-023114-39006",
      proyecto: "eco",
      tarea: "Medir el arranque en frío del lector",
      estado: "entregado",
      modelo: "modelo-local-ejemplo",
      effort: "high",
      origen: "nightloop",
      inicio: AHORA - 8 * HORA - 10 * MIN,
      duracion_s: 2 * HORA,
      rama: "nightloop/medir-arranque-en-frio",
      commits: 2,
      resultado: "Arranque 410 ms → 290 ms sacando un import perezoso.",
    }),
  ],
};

/**
 * Las sesiones de Claude Code vivas. El proyecto lo pone el main por el cwd y
 * la barra lo corrige por su primer worker; sin workers, "general".
 */
export const LIDERES: RespuestaLideres = {
  version: 1,
  lideres: [
    {
      ...A3,
      proyecto: "atlas",
      titulo: "Opus 5.5",
      actividad: AHORA - 3 * MIN - 20,
      creado: AHORA - 5 * HORA,
      cache_ttl_s: HORA,
      cache_vence: AHORA + 43 * MIN + COLCHON,
      origen: "terminal",
      pid: 4101,
      vivo: true,
      ocupado: false,
      modelo: "claude-opus-5-5",
      effort: null,
    },
    {
      ...C7,
      proyecto: "general",
      titulo: "Opus 5.5",
      actividad: AHORA - 12 * MIN,
      creado: AHORA - 2 * HORA,
      cache_ttl_s: HORA,
      cache_vence: AHORA + 8 * MIN + COLCHON,
      origen: "app",
      pid: 4102,
      vivo: true,
      ocupado: false,
      modelo: "claude-opus-5-5",
      effort: "high",
    },
    {
      ...E9,
      proyecto: "cauce",
      titulo: "Sonnet 5.5",
      actividad: AHORA - 25 * MIN,
      creado: AHORA - 3 * HORA,
      cache_ttl_s: HORA,
      cache_vence: AHORA + 21 * MIN + COLCHON,
      origen: "terminal",
      pid: 4103,
      vivo: true,
      ocupado: true,
      modelo: "claude-sonnet-5-5",
      effort: null,
    },
    {
      ...B5,
      proyecto: "general",
      titulo: "Opus 5.5",
      actividad: AHORA - DIA - 3 * HORA,
      creado: AHORA - 2 * DIA,
      cache_ttl_s: HORA,
      cache_vence: AHORA - DIA,
      origen: "app",
      pid: null,
      vivo: false,
      ocupado: false,
      modelo: "claude-opus-5-5",
      effort: "high",
    },
  ],
};

/** El líder de `MUERTO` como lo manda el main cuando lo mataron (captura `lider-muerto`): sin proceso, con Retomar. */
export const LIDER_MUERTO: Lider = {
  ...MUERTO,
  proyecto: "brote",
  titulo: "Opus 5.5",
  actividad: AHORA - 26 * MIN,
  creado: AHORA - 4 * HORA,
  cache_ttl_s: HORA,
  cache_vence: AHORA + 34 * MIN + COLCHON,
  origen: "terminal",
  pid: null,
  vivo: false,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: null,
  caido: "murio",
};

/** La captura `terminados`: un líder de terminal con tres workers vivos y ocho terminados bajo él (dos frenados), para la vista de todo. */
const T4 = { id: "s-fix-t4", nombre: "ana-t4" };
export const LIDER_TERMINADOS: Lider = {
  ...T4,
  proyecto: "atlas",
  titulo: "Opus 5.5",
  actividad: AHORA - 2 * MIN,
  creado: AHORA - 3 * HORA,
  cache_ttl_s: HORA,
  cache_vence: AHORA + 30 * MIN + COLCHON,
  origen: "terminal",
  pid: 4104,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: null,
};
const TERMINADO = (id: string, tarea: string, haceMin: number, p: Partial<Hilo> = {}) =>
  hilo({ id, ...deLider(T4), proyecto: "atlas", tarea, estado: "murio", inicio: AHORA - (haceMin + 5) * MIN, duracion_s: 5 * MIN, ...p });
const TERMINADOS_VIVOS: Hilo[] = [
  hilo({ id: "20261014-090112-61001", ...deLider(T4), proyecto: "atlas", tarea: "Paginado del listado de envíos en la API", estado: "trabajando", inicio: AHORA - 6 * MIN, puesto: "1", ...cache(HORA, 40 * MIN) }),
  hilo({ id: "20261014-090531-61002", ...deLider(T4), proyecto: "atlas", tarea: "Guía de migración de la config a TOML", estado: "trabajando", modelo: "claude-sonnet-5-5", inicio: AHORA - 9 * MIN, puesto: "2", ...cache(HORA, 55 * MIN) }),
  hilo({ id: "20261014-091044-61003", ...deLider(T4), proyecto: "atlas", tarea: "Changelog de la versión 2.4", estado: "trabajando", en_cola: true, inicio: AHORA - 3 * MIN }),
];
const TERMINADOS_MUERTOS: Hilo[] = [
  TERMINADO("20261014-070210-61004", "Reintentos del webhook de pagos", 14),
  TERMINADO("20261014-071530-61005", "Limpiar migraciones duplicadas de stock", 19, { frenado_en: AHORA - 17 * MIN }),
  TERMINADO("20261014-072005-61006", "Tests de rutas contra la API nueva", 25),
  TERMINADO("20261014-073318-61007", "Quitar el caché viejo de sesiones", 31),
  TERMINADO("20261014-074950-61008", "Traducir los errores del envío", 37, { frenado_en: AHORA - 36 * MIN }),
  TERMINADO("20261014-075512-61009", "Ordenar imports del módulo de pagos", 42),
  TERMINADO("20261014-080126-61010", "Documentar el endpoint de estados", 48),
  TERMINADO("20261014-081045-61011", "Revisar el límite de tamaño de subida", 55),
];
/** Los workers de `LIDER_TERMINADOS` (vivos y terminados), sumados a `HILOS` sólo en la captura `terminados`. */
export const TERMINADOS: Hilo[] = [...TERMINADOS_VIVOS, ...TERMINADOS_MUERTOS];
export const HILOS_TERMINADOS: RespuestaHilos = { ...HILOS, hilos: [...HILOS.hilos, ...TERMINADOS] };

/**
 * Las capturas de dos máquinas (`maquinas*`): un líder del Dell (sus ids llevan el prefijo `dell:`, como los arma
 * electron/maquinas.ts) con dos workers, sumados a `HILOS` y `LIDERES` sólo en ellas.
 */
const D1 = { id: "dell:s-fix-d1", nombre: "ana-d1" };
const deDell = { jefe: D1.nombre, jefe_id: D1.id, maquina: "dell" };
export const LIDER_DELL: Lider = {
  ...D1,
  proyecto: "atlas",
  titulo: "Opus 5.5",
  actividad: AHORA - 3 * MIN,
  creado: AHORA - 2 * HORA,
  cache_ttl_s: HORA,
  cache_vence: AHORA + 41 * MIN + COLCHON,
  origen: "app",
  pid: 5101,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: null,
  maquina: "dell",
};
export const HILOS_DELL: Hilo[] = [
  hilo({ id: "dell:20261014-100112-81001", ...deDell, proyecto: "atlas", tarea: "Índices del listado de envíos", estado: "trabajando", inicio: AHORA - 7 * MIN, ...cache(HORA, 44 * MIN) }),
  hilo({ id: "dell:20261014-100531-81002", ...deDell, proyecto: "atlas", tarea: "Pruebas de carga del webhook", estado: "listo", modelo: "claude-sonnet-5-5", inicio: AHORA - 22 * MIN, duracion_s: 9 * MIN, ...cache(HORA, 28 * MIN) }),
];

/**
 * La captura `worker-en-cola`: un worker de ana-a3 esperando puesto (con su tarea, sacada de la línea de comando de `pa`) y otro
 * que murió en la cola sin arrancar; el primero abierto. `sin_arrancar` y `cola_motivo` los pone el main (electron/cola-pa.ts).
 */
export const EN_COLA = { id: "20261013-115500-70002", proyecto: "atlas" };
export const HILOS_EN_COLA: RespuestaHilos = {
  ...HILOS,
  hilos: [
    ...HILOS.hilos,
    hilo({ ...EN_COLA, ...deLider(A3), tarea: "Índice por fecha en la tabla de envíos", estado: "trabajando", en_cola: true, cola_motivo: "tope global: 5 workers vivos", inicio: AHORA - 4 * MIN, duracion_s: 4 * MIN }),
    hilo({ id: "20261013-115200-70003", ...deLider(A3), proyecto: "atlas", tarea: "", estado: "murio", sin_arrancar: true, inicio: AHORA - 9 * MIN, murio_en: AHORA - 7 * MIN }),
  ],
};

/** La charla de un líder con fixtures: un pedido, el trabajo y la respuesta. */
export function charlaLider(sid: string): Mensaje[] {
  const l = [...LIDERES.lideres, LIDER_MUERTO, LIDER_DELL].find((x) => x.id === sid);
  if (!l) return [];
  const ts = (s: number) => new Date((l.actividad - s) * 1000).toISOString();
  const m = l.modelo;
  return [
    { i: 0, rol: "user", texto: "¿Qué quedó pendiente de ayer?", herramientas: [], ts: ts(9 * MIN), modelo: null },
    {
      i: 1,
      rol: "assistant",
      texto: "",
      herramientas: ["Bash: nightloop revisar --json", "Read: ~/Proyectos/ESTADO.md"],
      det: [
        {
          nombre: "Bash",
          entrada: { command: "nightloop revisar --json | jq -r '.pendientes[] | \"\\(.proyecto): \\(.estado)\"'", description: "Lo pendiente de la noche" },
          id: "toolu_fix_1",
          resultado: { texto: "atlas: tests verdes, sin integrar\ncauce: trabado en test_indice_migra", error: false },
        },
        { nombre: "Read", entrada: { file_path: "/Users/ana/Proyectos/ESTADO.md" }, id: "toolu_fix_2", resultado: null },
      ],
      ts: ts(8 * MIN),
      modelo: m,
    },
    {
      i: 2,
      rol: "assistant",
      texto:
        "Quedan dos cosas:\n\n- **atlas**: el buscador nuevo terminó con tests verdes; falta integrarlo.\n- **cauce**: la migración del índice sigue trabada en el mismo test.\n\n¿Integro atlas y le paso cauce a un worker con más esfuerzo?",
      herramientas: [],
      ts: ts(8 * MIN - 40),
      modelo: m,
    },
    { i: 3, rol: "user", texto: "Dale, las dos.", herramientas: [], ts: ts(6 * MIN), modelo: null },
    { i: 4, rol: "assistant", texto: "", herramientas: ["Bash: pa atlas --integrar 20261003-091500-41001 --tests", "Bash: pa cauce --async -- …"], ts: ts(5 * MIN), modelo: m },
    { i: 5, rol: "assistant", texto: "Listo: atlas integrado (tests verdes) y cauce lanzado con xhigh. Te aviso cuando termine.", herramientas: [], ts: ts(4 * MIN), modelo: m },
  ];
}

/** El razonamiento de muestra (captura `lider-pensando`, y lo que llega en vivo con `HILOS_VARIANTE=vivo`). */
export const PENSANDO_FIJO = [
  "Ana pide mirar por qué falla el índice de cauce. ",
  "Antes de tocar nada conviene ver el test que se cae: ",
  "si es el orden de las claves, el arreglo es chico; ",
  "si es la migración, hay que revisar la versión del esquema. ",
  "\n\nPrimero leo el log del último intento y después lanzo un worker con la rama limpia.",
];

/** El chat de un líder con el razonamiento de cada paso, plegado (captura `lider-pensando`; `abierto` deja el último desplegado). */
export function charlaPensando(sid: string): Mensaje[] {
  const l = LIDERES.lideres.find((x) => x.id === sid);
  if (!l) return [];
  const ts = (s: number) => new Date((l.actividad - s) * 1000).toISOString();
  const m = l.modelo;
  return [
    { i: 0, rol: "user", texto: "¿Qué quedó pendiente de ayer?", herramientas: [], ts: ts(9 * MIN), modelo: null },
    {
      i: 1,
      rol: "assistant",
      texto: "",
      herramientas: ["Bash: nightloop revisar --json"],
      pensado: "Ana pregunta por lo de ayer. Lo más barato es el resumen de la noche: lo pido en JSON y de ahí armo la lista.",
      ts: ts(8 * MIN),
      modelo: m,
    },
    {
      i: 2,
      rol: "assistant",
      texto: "Quedan dos cosas:\n\n- **atlas**: el buscador nuevo terminó con tests verdes; falta integrarlo.\n- **cauce**: la migración del índice sigue trabada en el mismo test.\n\n¿Integro atlas y le paso cauce a un worker con más esfuerzo?",
      herramientas: [],
      pensado: PENSANDO_FIJO.join(""),
      ts: ts(8 * MIN - 40),
      modelo: m,
    },
  ];
}

/** El chat de un líder que contesta con tablas (captura `lider-tabla`): alineación, formato en las celdas, `\|` y una que no entra. */
export function charlaTabla(sid: string): Mensaje[] {
  const l = LIDERES.lideres.find((x) => x.id === sid);
  if (!l) return [];
  const ts = (s: number) => new Date((l.actividad - s) * 1000).toISOString();
  const texto = [
    "Medí el compositor en reposo, antes y después de sacar los extras:",
    "",
    "| | Antes | Sin extras |",
    "|---|---|---|",
    "| CPU del compositor en reposo | 13,4 % | **5,3 %** |",
    "| Memoria residente | 412 MB | 388 MB |",
    "| Cuadros perdidos por minuto | 9 | **0** |",
    "",
    "Por proyecto, con la alineación de cada columna:",
    "",
    "| Proyecto | Estado | Tests | Costo |",
    "|:---|:---:|---:|---:|",
    "| **atlas** | listo | 212 | 1,8 |",
    "| cauce | trabado en `test_indice_migra` | 87 | 12,4 |",
    "| faro | [changelog](https://example.com/faro/changelog) | 1 030 | 0,6 |",
    "| trama | `a \\| b` es un o lógico | 5 | 3 |",
    "",
    "Y una que no entra en la columna:",
    "",
    "| Worker | Proyecto | Modelo | Esfuerzo | Rama | Empezó | Terminó | Entrada | Salida | Caché | Resultado |",
    "|---|---|---|---|---|---|---|---:|---:|---:|---|",
    "| 20261003-091500-41001 | atlas | opus | xhigh | pa/atlas/20261003-091500-41001 | 09:15 | 09:42 | 182 400 | 9 120 | 96 % | Buscador nuevo con tests verdes |",
    "| 20261003-101200-41007 | cauce | sonnet | high | pa/cauce/20261003-101200-41007 | 10:12 | 10:31 | 96 300 | 4 870 | 91 % | Migración del índice trabada |",
    "",
    "¿Sigo con cauce?",
  ].join("\n");
  return [
    { i: 0, rol: "user", texto: "¿Cuánto bajó el consumo sin los extras?", herramientas: [], ts: ts(5 * MIN), modelo: null },
    { i: 1, rol: "assistant", texto, herramientas: [], ts: ts(4 * MIN), modelo: l.modelo },
  ];
}

// Una URL inventada de unas 400 letras sin un espacio: lo que no se tiene que salir de un mensaje.
const URL_LARGA =
  "https://auth.example.com/oauth/authorize?response_type=code&client_id=atlas-cli-9f3b2c71d4e8&redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcallback&scope=openid+profile+offline_access+repos%3Aread+repos%3Awrite&state=Zk3vQ9xT1mB7rL2pW8nY4cH6dJ0sF5gA&code_challenge=u7Hq2Lw9XcVb4Nn1Rt6Yp3Ks8Dj5Fg0Zm2Qa7We4Sx1&code_challenge_method=S256&prompt=consent&access_type=offline&device_name=notebook-de-pruebas&nonce=b1946ac92492d2347c6235b4d2611184";

/**
 * El chat de un líder con una muestra de cada forma de un mensaje (captura `lider-formato`): títulos, listas, tabla,
 * enlace, código en línea, rutas, bloques con resaltado, cita y tareas. `pegado` (`HILOS_VARIANTE=pegado`): lo que
 * no tiene espacios, en un mensaje propio, en lo pegado de una terminal, en código en línea y en una tabla.
 */
export function charlaFormato(sid: string, pegado = false): Mensaje[] {
  const l = LIDERES.lideres.find((x) => x.id === sid);
  if (!l) return [];
  const ts = (s: number) => new Date((l.actividad - s) * 1000).toISOString();
  const m = l.modelo;
  if (pegado) {
    const terminal = [
      "Lo corrí desde la notebook y se queda ahí:",
      "",
      "❯ ssh -t faro-casa 'atlas login'",
      "",
      "Abrí este enlace en el navegador para autorizar:",
      "",
      URL_LARGA,
      "",
      "Esperando la autorización… (Ctrl+C para cancelar)",
      "error: el código venció, pedí uno nuevo",
      "",
      "❯ ssh -t faro-casa 'atlas estado'",
      "",
      "sin sesión",
      "",
      "❯",
    ].join("\n");
    const respuesta = [
      "El enlace vence a los **dos minutos**: cuando lo abriste ya no servía. Lo que cambia es el `state`:",
      "",
      "| Parámetro | Valor |",
      "|---|---|",
      "| `state` | `Zk3vQ9xT1mB7rL2pW8nY4cH6dJ0sF5gA` |",
      "| destino | " + URL_LARGA.slice(0, 150) + " |",
      "",
      "Pedí uno nuevo con `atlas login --dispositivo notebook-de-pruebas --sin-navegador --esperar=600 --callback=http://localhost:53682/callback` y abrilo enseguida.",
    ].join("\n");
    return [
      { i: 0, rol: "user", texto: `¿Por qué no entra? El enlace que me da es ${URL_LARGA}`, herramientas: [], ts: ts(7 * MIN), modelo: null },
      { i: 1, rol: "assistant", texto: "Pasame lo que sale en la terminal cuando lo corrés.", herramientas: [], ts: ts(6 * MIN), modelo: m },
      { i: 2, rol: "user", texto: terminal, herramientas: [], ts: ts(5 * MIN), modelo: null },
      { i: 3, rol: "assistant", texto: "", herramientas: [`Bash: curl -sI '${URL_LARGA}'`, "Read: docs/login.md"], ts: ts(5 * MIN - 20), modelo: m },
      { i: 4, rol: "assistant", texto: respuesta, herramientas: [], ts: ts(4 * MIN), modelo: m },
    ];
  }
  const texto = [
    "## El buscador de atlas quedó andando",
    "",
    "Lo que fallaba era el **orden de los resultados**: `ordenar()` comparaba fechas como texto. El arreglo está en `src/buscar/orden.ts:42` y sigue la [guía de fechas](https://example.com/atlas/guia/fechas) del proyecto.",
    "",
    "### Qué cambió",
    "",
    "1. El índice guarda la fecha como número, no como texto.",
    "   - La migración corre sola al abrir.",
    "   - Los índices viejos se leen igual.",
    "2. `ordenar()` desempata por *relevancia* y después por fecha.",
    "3. Tests nuevos en `tests/orden.test.ts`.",
    "",
    "| Caso | Antes | Ahora |",
    "|:---|---:|---:|",
    "| 1 000 resultados | 84 ms | **11 ms** |",
    "| 50 000 resultados | 4 200 ms | **310 ms** |",
    "",
    "```ts",
    "// Más nuevo primero; a igual fecha, el más relevante.",
    "export function ordenar(a: Resultado, b: Resultado): number {",
    "  if (a.fecha !== b.fecha) return b.fecha - a.fecha;",
    '  return b.puntos - a.puntos || a.titulo.localeCompare(b.titulo, "es");',
    "}",
    "```",
    "",
    "Para probarlo:",
    "",
    "```powershell",
    "npm test -- --grep orden",
    '$env:ATLAS_INDICE = "$env:TEMP\\indice"; npm run buscar -- "informe de marzo" | Select-Object -First 5',
    "```",
    "",
    "```powershell",
    '$env:ATLAS_INDICE = "C:\\atlas\\indice"; Get-ChildItem -Path "C:\\atlas\\informes" -Recurse -Filter "*.md" | Where-Object { $_.Length -gt 1KB } | ForEach-Object { npm run buscar -- $_.BaseName } | Select-Object -First 5',
    "```",
    "",
    "> Ojo: la migración no vuelve atrás. Antes de integrar conviene una copia del índice.",
    "",
    "---",
    "",
    "#### Falta",
    "",
    "- [x] Migración del índice",
    "- [x] Tests del orden",
    "- [ ] Medirlo con el índice real",
    "",
    "¿Lo integro?",
  ].join("\n");
  return [
    { i: 0, rol: "user", texto: "¿Cómo quedó el buscador de atlas?", herramientas: [], ts: ts(6 * MIN), modelo: null },
    { i: 1, rol: "assistant", texto: "", herramientas: ["Read: src/buscar/orden.ts", "Bash: npm test -- --grep orden"], ts: ts(5 * MIN), modelo: m },
    { i: 2, rol: "assistant", texto, herramientas: [], ts: ts(4 * MIN), modelo: m },
  ];
}

/**
 * El chat de un líder con tablas y bloques de código adentro de listas (captura `lider-listas`): una lista numerada con una
 * tabla y con código en sus ítems, y una de viñetas anidada con código en el ítem de adentro.
 */
export function charlaListas(sid: string): Mensaje[] {
  const l = LIDERES.lideres.find((x) => x.id === sid);
  if (!l) return [];
  const ts = (s: number) => new Date((l.actividad - s) * 1000).toISOString();
  const texto = [
    "Para migrar el índice hacen falta tres pasos:",
    "",
    "1. Hacé una copia, por si hay que volver:",
    "",
    "   ```powershell",
    "   Copy-Item -Recurse $env:LOCALAPPDATA\\atlas\\indice $env:TEMP\\indice.bak",
    "   ```",
    "",
    "2. Corré la migración y mirá el resultado por colección:",
    "",
    "   ```powershell",
    "   atlas migrar --indice $env:LOCALAPPDATA\\atlas\\indice",
    "   ```",
    "",
    "   | Colección | Antes | Después |",
    "   |:---|---:|---:|",
    "   | informes | 4 200 ms | **310 ms** |",
    "   | notas | 880 ms | **95 ms** |",
    "",
    "3. Probá que ordene bien.",
    "",
    "Si algo falla:",
    "",
    "- Revisá el log:",
    "  - Si dice `índice viejo`, volvé a correr el paso 2.",
    "  - Si dice `sin espacio`, liberá disco y pegá esto:",
    "",
    "    ```ts",
    "    await migrar({ indice, intentos: 3 });",
    "    ```",
    "",
    "- Si nada anda, restaurá la copia.",
    "",
    "¿Lo corro yo?",
  ].join("\n");
  return [
    { i: 0, rol: "user", texto: "¿Cómo migro el índice de atlas?", herramientas: [], ts: ts(5 * MIN), modelo: null },
    { i: 1, rol: "assistant", texto, herramientas: [], ts: ts(4 * MIN), modelo: l.modelo },
  ];
}

/**
 * Una conversación larga (captura `lider-formato`, `HILOS_VARIANTE=larga`): `n` mensajes en ciclos de tres (un pedido de
 * Ana, un paso con herramientas y la respuesta, con listas y código de vez en cuando). Para ver y medir que 3000 no tironeen
 * (`scripts/medir-larga.mjs`); el texto es inventado y cada mensaje distinto, para que ninguno salga de un caché.
 */
export function charlaLarga(sid: string, n = 3000): Mensaje[] {
  const l = LIDERES.lideres.find((x) => x.id === sid);
  if (!l) return [];
  const m = l.modelo;
  const ts = (k: number) => new Date((l.actividad - (n - k) * 20) * 1000).toISOString();
  const out: Mensaje[] = [];
  for (let k = 0; k < n; k++) {
    const c = Math.floor(k / 3);
    if (k % 3 === 0) {
      out.push({ i: k, rol: "user", texto: `Pedido ${c + 1}: revisá el módulo ${c % 17} y decime si el caso ${c} sigue andando.${c % 5 === 0 ? "\n\nSi no, arreglalo y corré los tests." : ""}`, herramientas: [], ts: ts(k), modelo: null });
    } else if (k % 3 === 1) {
      out.push({ i: k, rol: "assistant", texto: "", herramientas: [`Read: src/modulo${c % 17}/caso${c}.ts`, `Bash: npm test -- --grep caso${c}`], ts: ts(k), modelo: m });
    } else {
      const texto = [
        `El caso ${c} **sigue andando**: \`modulo${c % 17}\` no cambió desde la última vez.`,
        "",
        ...(c % 4 === 0 ? ["- La entrada se valida antes de usarla.", `- El resultado vuelve en ${10 + (c % 90)} ms.`, "- Los tests de ese módulo pasan.", ""] : []),
        ...(c % 7 === 0 ? ["```ts", `export const caso${c} = (x: number) => x * ${c % 13} + ${c % 5};`, "```", ""] : []),
        c % 3 === 0 ? "No hace falta tocar nada. ¿Sigo con el siguiente?" : "Sigo con el siguiente.",
      ].join("\n");
      out.push({ i: k, rol: "assistant", texto, herramientas: [], ts: ts(k), modelo: m });
    }
  }
  return out;
}

// Lo de sistema en una conversación (B18, src/hilo/sistema-datos.ts): lo que inyecta Claude Code
// como si fuera del usuario y lo que dice él mismo. Inventado, con la forma de los reales.
const SKILL = "Base directory for this skill: /Users/ana/.claude/skills/orquestar\n\n# Orquestar\n\nCómo lanzar un worker con `pa`, esperar su resultado y pasárselo a Ana.\n\n1. Elegí el modelo por la tabla de routing.\n2. Lanzalo con `pa <proyecto> --async`.\n3. Esperá la notificación y leé su RESULTADO.";
const TAREA = (que: string) =>
  `<task-notification>\n<task-id>b7x2k9q</task-id>\n<status>completed</status>\n<summary>Agent "${que}" completed</summary>\n<result>RESULTADO: tests verdes.</result>\n</task-notification>`;
const LIMITE = "You've hit your session limit · resets 4:50pm (America/Argentina/Buenos_Aires)";

/** El chat de un líder con una muestra de cada cosa de sistema (captura `lider-sistema`): con los campos del transcript. */
export function charlaSistema(sid: string): Mensaje[] {
  const l = LIDERES.lideres.find((x) => x.id === sid);
  if (!l) return [];
  const ts = (s: number) => new Date((l.actividad - s) * 1000).toISOString();
  const m = l.modelo;
  const crudos: Omit<Mensaje, "i" | "ts">[] = [
    { rol: "user", texto: "/orquestar revisá los tests de atlas con un worker", herramientas: [], modelo: null, origen: "human" },
    { rol: "user", texto: SKILL, herramientas: [], modelo: null, meta: true },
    { rol: "assistant", texto: "", herramientas: ["Bash: pa atlas --async -- Revisar los tests del buscador"], modelo: m },
    { rol: "user", texto: TAREA("Esperar el worker de atlas"), herramientas: [], modelo: null, origen: "task-notification" },
    { rol: "assistant", texto: "El worker de atlas terminó con los tests verdes.", herramientas: [], modelo: m },
    {
      rol: "user",
      texto: 'Another Claude session sent a message:\n<cross-session-message from="9c1e" from-name="pa/cauce">\nLa migración del índice pasa; falta integrar.\n</cross-session-message>',
      herramientas: [],
      modelo: null,
      origen: "peer",
    },
    { rol: "user", texto: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>", herramientas: [], modelo: null },
    { rol: "user", texto: "<local-command-stdout>Set model to Sonnet 5.5</local-command-stdout>", herramientas: [], modelo: null },
    { rol: "user", texto: "Seguí con cauce; si ves un <system-reminder> en el log, ignoralo.", herramientas: [], modelo: null, origen: "human" },
    { rol: "user", texto: "[Request interrupted by user]", herramientas: [], modelo: null },
    { rol: "assistant", texto: "", herramientas: [], modelo: null, compacto: { auto: true, antes: 167_000 } },
    { rol: "user", texto: "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Atlas integrado, cauce en revisión.", herramientas: [], modelo: null, resumen: true },
    { rol: "assistant", texto: "", herramientas: [], modelo: null, destrabo: { que: "Bash: curl -s localhost:9/progreso", agotado: false } },
    { rol: "assistant", texto: "", herramientas: [], modelo: null, destrabo: { que: "Bash: curl -s localhost:9/progreso", agotado: true } },
    { rol: "assistant", texto: "API Error: Repeated 529 Overloaded errors", herramientas: [], modelo: "<synthetic>", error: "unknown" },
    { rol: "assistant", texto: LIMITE, herramientas: [], modelo: "<synthetic>", error: "rate_limit" },
  ];
  return crudos.map((x, i) => ({ ...x, i, ts: ts((crudos.length - i) * MIN) }));
}

/** Lo mismo en un worker (captura `sistema`): `pa --hilo` no trae los campos, sólo el texto y el modelo. */
export function conversacionSistema(h: Hilo): RespuestaHilo {
  const crudos: Omit<Mensaje, "i" | "ts">[] = [
    { rol: "user", texto: `${h.tarea}. Listo cuando los tests pasen.`, herramientas: [], modelo: null },
    { rol: "user", texto: SKILL, herramientas: [], modelo: null },
    { rol: "assistant", texto: "Leo el CLAUDE.md y lanzo los tests.", herramientas: ["Read", "Bash"], modelo: h.modelo },
    { rol: "user", texto: TAREA("Correr la suite entera"), herramientas: [], modelo: null },
    { rol: "user", texto: "[Request interrupted by user for tool use]", herramientas: [], modelo: null },
    { rol: "assistant", texto: LIMITE, herramientas: [], modelo: "<synthetic>" },
  ];
  const todos = crudos.map((x, i) => ({ ...x, i, ts: new Date((AHORA - (crudos.length - i) * MIN) * 1000).toISOString() }));
  return {
    version: 1,
    id: h.id,
    proyecto: h.proyecto,
    transcript: "/inventado.jsonl",
    total: todos.length,
    desde: 0,
    hasta: todos.length,
    mensajes: todos,
    usage: { input_tokens: 3, cache_creation_input_tokens: 1240, cache_read_input_tokens: 61872, output_tokens: 410 },
    modelo: h.modelo,
  };
}

// Lo que hace un worker entre el pedido y la respuesta: texto suelto y herramientas,
// con su entrada como la pasa `pa --hilo` (B19; las rutas, dentro del proyecto).
// `resultados` (captura `herramientas-resultados`): cada llamada trae el final de lo que devolvió, como lo pega el main leyendo el transcript.
const PASOS = (raiz: string, resultados = false): [string, Herramienta[]][] => {
  const h = (nombre: string, entrada: Record<string, unknown>, devolvio?: string, error = false): Herramienta =>
    resultados && devolvio !== undefined ? { nombre, entrada, id: `toolu_${nombre.toLowerCase()}_${Object.keys(entrada).length}`, resultado: { texto: devolvio, error } } : { nombre, entrada };
  return [
    [
      "Leo el CLAUDE.md del proyecto y los archivos que toca la tarea.",
      [
        h("Read", { file_path: `${raiz}/CLAUDE.md` }, "# Proyecto\n\nLa config vive en `src/config.ts`.\nTests: `npm test`."),
        h("Read", { file_path: `${raiz}/src/config.ts` }, "…\nexport function leerConfig(ruta: string) {\n  const texto = readFileSync(ruta, \"utf8\");\n  return parse(texto);\n}"),
        h("Grep", { pattern: "leerConfig\\(", path: raiz }, "src/config.ts\nsrc/arranque.ts\ntests/config.test.ts"),
      ],
    ],
    [
      "",
      [
        h("Bash", {
          command: "npm test -- --reporter dot 2>&1 | tail -20",
          description: "Corre los tests antes de tocar nada",
        }, "…\n  ✓ lee el YAML (3 ms)\n  ✗ lee el TOML\n    ReferenceError: smol-toml is not defined\n\n1 failing", true),
      ],
    ],
    [
      "Escribo el cambio y lo commiteo por bloque.",
      [
        h("Edit", {
          file_path: `${raiz}/src/config.ts`,
          old_string: 'import { parse } from "yaml";\n\nexport function leerConfig(ruta: string) {\n  const texto = readFileSync(ruta, "utf8");\n  return parse(texto);\n}',
          new_string:
            'import { parse } from "smol-toml";\nimport { desdeYaml } from "./migrar";\n\nexport function leerConfig(ruta: string) {\n  if (ruta.endsWith(".yaml")) return desdeYaml(ruta);\n  const texto = readFileSync(ruta, "utf8");\n  return parse(texto);\n}',
        }),
        h("Write", {
          file_path: `${raiz}/src/migrar.ts`,
          content:
            '// Lee el YAML viejo y deja el TOML al lado.\nimport { parse } from "yaml";\nimport { stringify } from "smol-toml";\n\nexport function desdeYaml(ruta: string) {\n  const datos = parse(readFileSync(ruta, "utf8"));\n  writeFileSync(ruta.replace(/\\.yaml$/, ".toml"), stringify(datos));\n  return datos;\n}',
        }),
        h("Bash", { command: 'git add src/config.ts src/migrar.ts && git commit -m "config: TOML, y el YAML viejo se convierte"', description: "Commitea el cambio" }),
      ],
    ],
    ["", [h("Read", { file_path: `${raiz}/tests/config.test.ts` }), h("Edit", { file_path: `${raiz}/tests/config.test.ts`, old_string: 'const ruta = "x.yaml";', new_string: 'const ruta = "x.toml";\nconst vieja = "x.yaml";' })]],
    ["Corro los tests.", [h("Bash", { command: "npm test", description: "Corre los tests" })]],
  ];
};

/** El transcript inventado de un worker: su carpeta en `~/.claude/projects` da la raíz del proyecto (`relativa`). */
const raizDe = (h: Hilo) => `/Users/ana/Proyectos/${h.proyecto}`;
const transcriptDe = (h: Hilo) => `/Users/ana/.claude/projects/${raizDe(h).replace(/[^A-Za-z0-9]/g, "-")}/${h.id}.jsonl`;

// La conversación que se parece a la de la maqueta: una decisión con dos caminos.
const A_MANO: Record<string, { pedido: string; respuesta: string }> = {
  "20261003-094533-47102": {
    pedido:
      "Migrá la config de YAML a TOML sin romperle nada a quien ya tiene la app instalada. Listo cuando arranque con las dos y los tests pasen.",
    respuesta:
      "La config nueva ya se lee de TOML y los tests pasan (1 commit en la rama). Si encuentra el YAML viejo lo convierte al arrancar y deja un aviso en el log.\n\nLo que no quise decidir solo es hasta cuándo se sigue leyendo el YAML.",
  },
};

/** `pa --hilo <id> --json` inventado a partir de la fila, con la misma forma. */
export function conversacion(h: Hilo, antes: number | null, n = 50, resultados = false): RespuestaHilo {
  const corre = h.estado === "trabajando" || h.estado === "colgado";
  const dura = corre ? AHORA - h.inicio : (h.duracion_s ?? 5 * MIN);
  const mano = A_MANO[h.id];
  const crudos: Omit<Mensaje, "i" | "ts">[] = [
    { rol: "user", texto: mano?.pedido ?? `${h.tarea}. Listo cuando los tests pasen.`, herramientas: [], modelo: null },
    ...(corre ? PASOS(raizDe(h), resultados).slice(0, 3) : PASOS(raizDe(h), resultados)).map(([texto, det]) => ({
      rol: "assistant" as const,
      texto,
      herramientas: det.map((d) => d.nombre),
      det,
      modelo: h.modelo,
    })),
  ];
  if (!corre && (mano || h.resultado))
    crudos.push({ rol: "assistant", texto: mano?.respuesta ?? h.resultado!, herramientas: [], modelo: h.modelo });
  const todos = crudos.map((m, i) => ({
    ...m,
    i,
    ts: new Date((h.inicio + (dura * i) / Math.max(1, crudos.length - 1)) * 1000).toISOString(),
  }));
  const hasta = Math.min(todos.length, antes ?? todos.length);
  const desde = Math.max(0, hasta - n);
  return {
    version: 1,
    id: h.id,
    proyecto: h.proyecto,
    transcript: transcriptDe(h),
    total: todos.length,
    desde,
    hasta,
    mensajes: todos.slice(desde, hasta),
    usage: { input_tokens: 3, cache_creation_input_tokens: 1240, cache_read_input_tokens: 61872, output_tokens: 410 },
    modelo: h.modelo,
  };
}

/** Respaldo de las barras de arriba cuando no hay statusline real. */
/** El logo inventado de un proyecto (los demás muestran su monograma). */
export const ICONOS: Record<string, string> = {
  cauce: `data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='#0c3a4d'/><path d='M5 13c3.7-5 7.3-5 11 0s7.300 5 11 0M5 21c3.700-5 7.300-5 11 0s7.300 5 11 0' fill='none' stroke='#8fdcf0' stroke-width='3' stroke-linecap='round'/></svg>",
  )}`,
};

/** El `titulo` inventado de un proyecto en el registry: la carpeta se ve así. */
export const TITULOS: Record<string, string> = { duna: "Duna Studio" };

export const USO: Uso = {
  version: 1,
  ts: AHORA - 20,
  five_hour: { pct: 34, resets_at: AHORA + 2 * HORA + 14 * MIN + COLCHON },
  seven_day: { pct: 61, resets_at: AHORA + 3 * DIA + 5 * HORA },
};

/** La captura `uso-sin-hora`: el 5 h tiene porcentaje y no se sabe cuándo se reinicia; la semana, completa. */
export const USO_SIN_HORA: Uso = {
  version: 1,
  ts: AHORA - 20,
  five_hour: { pct: 34, resets_at: null },
  seven_day: { pct: 61, resets_at: AHORA + 3 * DIA + 5 * HORA },
};

/** La variante `cupos-cuentas`: dos cuentas de Claude (la de siempre y «Trabajo»), cada una con su 5 h y su semana. */
export const USO_CUENTAS: Uso = {
  ...USO,
  claudeNombre: "Claude",
  suscripciones: [
    {
      id: "trabajo",
      nombre: "Trabajo",
      proveedor: "claude",
      cuenta: "trabajo",
      ts: AHORA - 20,
      ventanas: [
        { id: "5h", pct: 12, vuelve: AHORA + 4 * HORA + 9 * MIN },
        { id: "7d", pct: 27, vuelve: AHORA + 5 * DIA + 2 * HORA },
      ],
    },
  ],
};

/** La variante `cupos-google`: las barras de Claude más Google AI Pro con sus 3 grupos (`reparto --cupos`), plegados en un renglón. */
export const USO_GOOGLE: Uso = {
  ...USO,
  suscripciones: [
    {
      id: "google",
      nombre: "Google AI Pro",
      ts: AHORA - 20,
      grupos: [
        {
          id: "gemini",
          nombre: "Gemini",
          ventanas: [
            { id: "5h", pct: 3, vuelve: AHORA + 2 * HORA },
            { id: "7d", pct: 8, vuelve: AHORA + 2 * DIA + 4 * HORA },
          ],
        },
        {
          id: "claude-gpt",
          nombre: "Claude y GPT por Google",
          ventanas: [
            { id: "5h", pct: 15, vuelve: AHORA + 3 * HORA },
            { id: "7d", pct: 24, vuelve: AHORA + 2 * DIA + 7 * HORA },
          ],
          hasta: "2026-11-02",
        },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", pct: 41, vuelve: AHORA + 2 * DIA + 19 * HORA }] },
      ],
    },
  ],
};

/**
 * Una "captura de pantalla" inventada para la captura `lider-imagenes` (B26): se
 * dibuja en un canvas (sólo en el renderer; nada de archivos ni datos reales).
 */
export function imagenFija(ancho: number, alto: number, tono: number): { tipo: string; datos: string } {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111";
  g.fillRect(0, 0, ancho, alto);
  g.fillStyle = `hsl(${tono} 40% 22%)`;
  g.fillRect(0, 0, ancho, alto * 0.12);
  g.fillStyle = "#1c1c1c";
  g.fillRect(0, alto * 0.12, ancho * 0.26, alto * 0.88);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i === 2 ? `hsl(${tono} 70% 60%)` : "#333";
    g.fillRect(ancho * 0.03, alto * (0.18 + i * 0.1), ancho * (0.12 + ((i * 37) % 9) / 100), alto * 0.035);
  }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 4 === 3 ? `hsl(${tono} 60% 55%)` : "#2a2a2a";
    g.fillRect(ancho * 0.31, alto * (0.2 + i * 0.08), ancho * (0.3 + ((i * 53) % 30) / 100), alto * 0.03);
  }
  return { tipo: "image/png", datos: c.toDataURL("image/png").split(",")[1] };
}

/**
 * Los modelos locales de muestra (electron/locales.ts): una GPU inventada de 24 GB con 1,5 GB en uso y ni Handy ni el TTS cargados;
 * el `-c` guardado se cambia llamando con `(id, ctx)`. La cuenta es la de verdad (`estimar`), sin tocar la GPU.
 */
export const LLAMA_FIJOS = [
  { id: "modelo-local-ejemplo", nombre: "Modelo local de ejemplo", empresa: "Empresa de ejemplo" },
  { id: "modelo-local-chico", nombre: "Modelo local chico", empresa: "Otra empresa de ejemplo" },
];
const LOCALES_CTX: Record<string, number> = { "modelo-local-ejemplo": 32768, "modelo-local-chico": 65536 };
export function localesFalsos(id?: string, ctx?: number): EstadoLocales {
  if (id && ctx) LOCALES_CTX[id] = ctx;
  // `HILOS_VARIANTE=vram`: la GPU casi llena con los servicios de `vramFalsa` (el modelo grande no entra: el aviso con qué liberar).
  const conVram = MODO.variante === "vram";
  const gpu = {
    totalMiB: 24576,
    usadoMiB: conVram ? 500 + VRAM_LISTA.reduce((s, c) => s + c.miB, 0) : 1500,
    llamaMiB: 0,
    consumidores: [
      { nombre: "Handy", nominalMiB: 3379, actualMiB: conVram && VRAM_LISTA.some((c) => c.id === "handy.service") ? 3379 : 0 },
      { nombre: "TTS", nominalMiB: 5017, actualMiB: 0 },
    ],
  };
  const forma = { kvHeads: 4, dimK: 256, dimV: 256, bytesPorElemento: BYTES_Q8_0 };
  const fila = (id: string, pesosMiB: number, capas: number): LocalInfo => ({
    id,
    ctx: LOCALES_CTX[id],
    dsh: LOCALES_CTX[id],
    ctxMin: 4096,
    ctxMax: 262144,
    paso: 1024,
    pesosMiB,
    ctxFijo: null,
    est: estimar(gpu, { pesosMiB, fijoMiB: 2048, kvBytesPorToken: kvBytesPorToken({ capas, ...forma }), ctxMin: 4096, ctxMax: 262144, paso: 1024 }),
  });
  return { gpuMiB: gpu.totalMiB, modelos: [fila("modelo-local-ejemplo", 17955, 17), fila("modelo-local-chico", 6873, 16)] };
}

/** Lo que se puede liberar de la GPU de muestra (`vram --json` de ~/Proyectos/modos): inventado; liberar sólo lo quita de esta lista. */
const VRAM_LISTA: EstadoVram["consumidores"] = [
  { id: "comfyui.service", nombre: "ComfyUI", miB: 6144, tipo: "servicio", accion: "stop" },
  { id: "handy.service", nombre: "Handy", miB: 3379, tipo: "servicio", accion: "stop" },
];
export const vramFalsa = (): EstadoVram => {
  const usado = 500 + VRAM_LISTA.reduce((s, c) => s + c.miB, 0);
  return { totalMiB: 24576, libreMiB: 24576 - usado, consumidores: VRAM_LISTA.map((c) => ({ ...c })) };
};
export function vramLiberarFalso(id: string): ResultadoLiberar {
  const i = VRAM_LISTA.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, id, nombre: id, liberadoMiB: null, libreMiB: null, error: "no es un consumidor de la GPU" };
  const [c] = VRAM_LISTA.splice(i, 1);
  return { ok: true, id, nombre: c.nombre, liberadoMiB: c.miB, libreMiB: vramFalsa().libreMiB, error: null };
}
