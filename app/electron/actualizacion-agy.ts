// El aviso de Antigravity CLI (`agy`) nuevo, hermano del de Claude Code (electron/actualizador.ts): la
// instalada sale de `agy --version` y la última del mismo servicio que usa `agy update` (la raíz del
// actualizador dice "Stable Version: x.y.z"). Sin `agy` instalado no se muestra nada ni se consulta nada.
// Actualizar corre `agy update`; el aviso se va cuando la versión sube.
//   HILOS_AGY             el `agy` que se pregunta (en la prueba, uno falso o uno que no existe).
//   HILOS_AGY_ACTUALIZADOR  la URL del actualizador (en la prueba, un servidor local).
import path from "node:path";
import { ESTADO } from "./pa.js";
import { crearActualizador, entorno } from "./actualizador.js";
import { ultimaDeActualizador } from "./version.js";

const AGY = process.env.HILOS_AGY ?? "agy";
const ACTUALIZADOR = process.env.HILOS_AGY_ACTUALIZADOR ?? "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app";

type Traer = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** La última de agy, la que dice el actualizador. null si no contesta. */
export async function ultimaAgy(traer: Traer = fetch): Promise<string | null> {
  const r = await traer(ACTUALIZADOR, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return r?.ok ? ultimaDeActualizador(await r.text().catch(() => "")) : null;
}

const agy = crearActualizador({
  archivo: path.join(ESTADO, "agy-version.json"),
  bin: AGY,
  nombre: "actualizacion-agy",
  ultima: () => ultimaAgy(),
  actualizar: { args: ["update"] },
  entornoActualizar: entorno,
  olvidarSiFalta: true,
});

export const { leerAviso: leerAvisoAgy, descartar: descartarAgy, alCambiarAviso: alCambiarAvisoAgy, actualizar: actualizarAgy } = agy;
