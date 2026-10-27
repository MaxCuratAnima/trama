// Prende trama por la tailnet (remoto.ts) y la mantiene prendida: sólo si existe `remoto.json` en el
// estado propio. Escucha en las IPs de Tailscale de esta máquina y en ninguna otra; si cambian (Tailscale
// se levantó después, `tailscale down`/`up`, otra IP), cierra lo que tenía y vuelve a escuchar.
// El cambio se detecta preguntándole a Tailscale (rápido al arrancar, después cada 5 min). Lo usan main.ts
// (todo en uno) y motor.ts.
// `remoto.json` se vuelve a leer con cada revisión y cuando Ajustes lo cambia (`recargar`, por el enlace de
// nucleo.ts): prender, apagar, otro puerto o quitar un dispositivo (se cortan sus conexiones) no piden reiniciar.
import type http from "node:http";
import path from "node:path";
import { CHANGELOG } from "./actualizacion.js";
import { accesos } from "./celular-accesos.js";
import { identidadEsta } from "./consulta.js";
import { log, silencio } from "./log.js";
import { escuchar, llamarRemoto, ponerEnlaceRemoto, soltarRemoto } from "./nucleo.js";
import { ESTADO } from "./pa.js";
import { crearRemoto, leerConfig } from "./remoto.js";
import { permitido, tailnet } from "./tailnet.js";
import { crearRemotoLocal, IP_LOCAL, modoLocal, puertoLocal } from "./modo-local.js";

/** Cada cuánto se le pregunta a Tailscale por las dudas (y se reintenta escuchar). */
const RESPALDO_MS = 5 * 60_000;

export type OpcionesArmar = {
  /** La carpeta del frontend compilado (`dist/`) y el preload compilado. */
  dist: string;
  preload: string;
  consulta(): Record<string, string>;
};

/**
 * Modo local (`TRAMA_LOCAL=1`, docs/remoto.md): el servidor en 127.0.0.1 y ya, sin Tailscale ni `remoto.json`.
 * Si el puerto está ocupado reintenta (5, 15, 60 s y después cada 5 min); no hay nada que releer.
 */
function armarLocal(o: OpcionesArmar) {
  const puerto = puertoLocal();
  const url = `http://localhost:${puerto}/`;
  let servidor: http.Server | null = null;
  let intentos = 0;
  const ESPERAS = [5, 15, 60];
  const abrir = async () => {
    const remoto = crearRemotoLocal({
      dist: o.dist,
      preload: o.preload,
      llamar: llamarRemoto,
      consulta: o.consulta,
      identidad: identidadEsta,
      seFue: soltarRemoto,
      changelog: CHANGELOG,
    });
    try {
      servidor = await remoto.escuchar(puerto);
    } catch (e) {
      const espera = ESPERAS[intentos++] ?? RESPALDO_MS / 1000;
      if (intentos === 1 || intentos === 4) console.error(`[remoto] no se pudo escuchar en ${IP_LOCAL}:${puerto} (${(e as Error).message}): se reintenta`);
      setTimeout(() => void abrir(), espera * 1000).unref();
      return;
    }
    escuchar(remoto.difundir);
    console.error(`[remoto] ${url} (modo local: sólo ${IP_LOCAL})`);
  };
  void abrir();
  ponerEnlaceRemoto({ recargar: async () => {}, escuchando: () => (servidor ? [url] : []) });
}

export function armarRemoto(o: OpcionesArmar) {
  if (modoLocal()) return armarLocal(o);
  const archivo = path.join(ESTADO, "remoto.json");
  let cfg = leerConfig(archivo);
  const red = tailnet();
  let actual: { firma: string; urls: string[]; servidores: http.Server[]; quitar: () => void } | null = null;
  let intentos = 0;

  function desarmar() {
    if (!actual) return;
    actual.quitar();
    for (const s of actual.servidores) {
      s.close();
      s.closeAllConnections();
    }
    actual = null;
  }

  /** Se pone al día con lo que dice Tailscale. `true` si quedó escuchando. */
  async function armar(): Promise<boolean> {
    const c = (cfg = leerConfig(archivo));
    if (!c) {
      desarmar();
      return true;
    }
    const yo = await red.yo();
    const firma = yo ? JSON.stringify([yo.nombre, [...yo.ips].sort(), c.puerto, c.dispositivos]) : "";
    if (actual?.firma === firma) return true;
    if (actual) {
      log.escribir("info", "remoto", `cambió la dirección de Tailscale: se vuelve a escuchar (${yo ? yo.ips.join(", ") : "sin Tailscale"})`);
      desarmar();
    }
    if (!yo) return false;
    const remoto = crearRemoto({
      dist: o.dist,
      preload: o.preload,
      nombres: [yo.nombre, yo.nombre.split(".")[0], ...yo.ips.map((ip) => (ip.includes(":") ? `[${ip}]` : ip))],
      propias: yo.ips,
      entra: async (ip) => {
        const nodo = await red.quien(ip);
        const ok = permitido(yo, nodo, c.dispositivos);
        // Quien entró queda anotado para la lista de Ajustes > Celular (sólo nombre, sistema, IP y hora).
        if (ok && nodo) void accesos.anotar(nodo.nombre.slice(0, -(yo.sufijo.length + 1)), nodo.sistema ?? null, nodo.ip ?? null).catch(silencio("remoto"));
        return ok;
      },
      llamar: llamarRemoto,
      consulta: o.consulta,
      identidad: identidadEsta,
      seFue: soltarRemoto,
      changelog: CHANGELOG,
    });
    const abiertos = await Promise.allSettled(yo.ips.map((ip) => remoto.escuchar(ip, c.puerto)));
    const servidores = abiertos.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
    if (!servidores.length) return false;
    const url = `http://${yo.nombre}:${c.puerto}/`;
    actual = { firma, urls: [url], servidores, quitar: escuchar(remoto.difundir) };
    console.error(`[remoto] ${url} (sólo tailnet; dispositivos: ${c.dispositivos.join(", ")})`);
    return true;
  }

  // De a una revisión por vez; lo que llega mientras tanto pide otra al terminar, y quien la pidió espera a esa.
  let vuelta: Promise<void> | null = null;
  let otra = false;
  function revisar(): Promise<void> {
    if (vuelta) {
      otra = true;
      return vuelta;
    }
    vuelta = (async () => {
      try {
        do {
          otra = false;
          const ok = await armar().catch((e) => {
            silencio("remoto")(e);
            return false;
          });
          if (!ok && ++intentos === 4) console.error("[remoto] todavía no se puede escuchar en la IP de Tailscale: se reintenta cada 5 min");
          if (ok) intentos = 0;
        } while (otra);
      } finally {
        vuelta = null;
      }
    })();
    return vuelta;
  }

  // Al arrancar, Tailscale puede no estar listo: se insiste rápido; después, el respaldo cada 5 min.
  const ESPERAS = [0, 5, 15, 60];
  let proximo: NodeJS.Timeout | null = null;
  const ciclo = async () => {
    if (proximo) clearTimeout(proximo);
    proximo = null;
    await revisar();
    // Apagado: ni reloj; vuelve cuando Ajustes lo prenda (`recargar`).
    if (!cfg) return;
    const espera = actual ? RESPALDO_MS : (ESPERAS[intentos] ?? RESPALDO_MS / 1000) * 1000;
    proximo = setTimeout(() => void ciclo(), espera);
    proximo.unref();
  };
  void ciclo();

  // Ajustes cambió `remoto.json`: se lee de nuevo y el servidor queda como dice (o se cierra, si ahora está apagado).
  ponerEnlaceRemoto({
    async recargar() {
      intentos = 0;
      await ciclo();
    },
    escuchando: () => actual?.urls ?? [],
  });
}
