// "PC apagada · Prender" en la trama del Dell (etapa 7, paso 8; docs/estado/maquinas.md): si la PC contesta, y el
// botón que la prende con `prender-pc` (Wake-on-LAN). Sin Electron. La confianza va en un solo sentido: el Dell
// nunca se conecta al motor de la PC, sólo mira si su puerto acepta una conexión TCP (lo mismo que hace
// `prender-pc --esperar`) y la ventana ofrece abrirla. Sin polling en reposo: se mira cuando alguien lo pide y,
// mientras "Prendiendo…", cada pocos segundos hasta que contesta o se acaba el plazo.
import { execFileCmd } from "./procesos.js";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { textoT } from "./errores.ts";
import type { Maquina } from "./maquinas-config.ts";

/** `apagada`: no contesta; `prendiendo`: el paquete salió y se espera; `prendida`: contesta. `error`: por qué no (texto del comando o clave `main.*`). */
export type EstadoPc = { id: string; nombre: string; url: string; estado: "apagada" | "prendiendo" | "prendida"; error: string | null };

/** El plazo de `prender-pc --esperar`: tras prender, la sesión gráfica (y trama) tarda en subir. */
export const PLAZO_PRENDER_MS = 300_000;
export const SONDEO_PRENDER_MS = 3_000;
const TOPE_SONDEO_MS = 3_000;
const TOPE_COMANDO_MS = 30_000;

/** ¿Acepta una conexión TCP `host:puerto`? Cierra al instante: no manda nada. */
export function sondearTcp(host: string, puerto: number, tope = TOPE_SONDEO_MS): Promise<boolean> {
  return new Promise((resolver) => {
    const s = net.connect({ host, port: puerto });
    const fin = (ok: boolean) => {
      s.destroy();
      resolver(ok);
    };
    s.setTimeout(tope, () => fin(false));
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
  });
}

/** `~/…` → la ruta de verdad. */
export const rutaDe = (r: string) => (r.startsWith("~/") ? path.join(os.homedir(), r.slice(2)) : r);

/** La primera línea de lo que dijo el comando al fallar, recortada. */
const motivo = (e: unknown, stderr: string) => {
  const l = (stderr.trim().split("\n")[0] ?? "").trim() || (e as Error)?.message || "";
  return l.length > 300 ? `${l.slice(0, 299)}…` : l;
};

export type OpcionesPc = {
  /** La máquina con `prender` (maquinas.json). */
  maquina: Maquina;
  /** Cada cambio de estado (el núcleo lo difunde como `pc:cambio`). */
  alCambio(e: EstadoPc): void;
  /** Cómo se mira si contesta (test: sin red de verdad). */
  sondear?: (host: string, puerto: number) => Promise<boolean>;
  /** Corre el comando; rechaza con el motivo si sale ≠ 0. */
  correr?: (comando: string) => Promise<void>;
  plazoMs?: number;
  cadaMs?: number;
};

const correrComando = (comando: string) =>
  new Promise<void>((resolver, rechazar) => {
    execFileCmd(rutaDe(comando), [], { timeout: TOPE_COMANDO_MS }, (e, _out, err) => {
      if (e) rechazar(new Error(motivo(e, String(err))));
      else resolver();
    });
  });

export function crearPc(o: OpcionesPc) {
  const { maquina: m } = o;
  const u = new URL(m.url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const puerto = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  const sondear = o.sondear ?? sondearTcp;
  const correr = o.correr ?? correrComando;
  const plazo = o.plazoMs ?? PLAZO_PRENDER_MS;
  const cada = o.cadaMs ?? SONDEO_PRENDER_MS;

  let e: EstadoPc = { id: m.id, nombre: m.nombre, url: m.url, estado: "apagada", error: null };
  let temporizador: NodeJS.Timeout | null = null;
  let hasta = 0;
  let cerrado = false;
  // Una sola mirada a la vez: dos pedidos juntos comparten el sondeo.
  let mirando: Promise<EstadoPc> | null = null;

  const poner = (x: Partial<EstadoPc>) => {
    const n = { ...e, ...x };
    if (n.estado === e.estado && n.error === e.error) return;
    e = n;
    if (!cerrado) o.alCambio(e);
  };

  const parar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
  };

  /** Mira ahora. Prendiendo no se pisa con "apagada": sigue hasta que contesta o vence el plazo. */
  function mirar(): Promise<EstadoPc> {
    if (cerrado) return Promise.resolve(e);
    return (mirando ??= sondear(host, puerto)
      .catch(() => false)
      .then((ok) => {
        if (ok) {
          parar();
          poner({ estado: "prendida", error: null });
        } else if (e.estado === "prendida") poner({ estado: "apagada", error: null });
        return e;
      })
      .finally(() => {
        mirando = null;
      }));
  }

  function esperar() {
    parar();
    if (cerrado || e.estado !== "prendiendo") return;
    temporizador = setTimeout(() => {
      temporizador = null;
      void mirar().then(() => {
        if (e.estado !== "prendiendo") return;
        if (Date.now() >= hasta) poner({ estado: "apagada", error: textoT("main.pcNoContesto") });
        else esperar();
      });
    }, cada);
    temporizador.unref();
  }

  return {
    /** Cómo está la PC: la mira (lo que se ve al abrir la ventana o volver a ella). */
    leer: (): Promise<EstadoPc> => (e.estado === "prendiendo" ? Promise.resolve(e) : mirar()),
    /** El último estado sabido, sin mirar. */
    ultimo: () => e,
    /**
     * Manda el paquete. Ya prendida o prendiendo: nada (no se manda dos veces). Si el comando falla vuelve a "apagada"
     * con el motivo; si sale bien queda "Prendiendo…" hasta que el puerto conteste o pase el plazo.
     */
    async prender(): Promise<EstadoPc> {
      if (cerrado || e.estado === "prendiendo") return e;
      if ((await mirar()).estado === "prendida") return e;
      // Otro pedido pudo haber ganado mientras se miraba.
      if ((e as EstadoPc).estado === "prendiendo") return e;
      hasta = Date.now() + plazo;
      poner({ estado: "prendiendo", error: null });
      try {
        await correr(m.prender!);
      } catch (x) {
        parar();
        poner({ estado: "apagada", error: (x as Error).message || textoT("main.pcNoSalio") });
        return e;
      }
      esperar();
      return e;
    },
    cerrar() {
      cerrado = true;
      parar();
    },
  };
}

export type Pc = ReturnType<typeof crearPc>;
