// Un build más nuevo que este proceso (`npm run build` tras integrar): trama NO se reinicia sola. Lo
// avisa con un cartel (src/barra/Reinicio.tsx, también en el celular) y se reinicia cuando el usuario toca
// Reiniciar, y ni así cortando algo (electron/relanzar.ts): espera a que no haya líder respondiendo,
// mensaje de la cola saliendo, integración corriendo ni líder de la app con workers vivos.
// Lo arman main.ts (todo en uno: guarda cómo estaba la ventana y sale) y motor.ts (sale y se vuelve a lanzar).
import { respondiendo } from "./lider.js";
import { alCambiarLider, avisarReinicio, colaEnCamino, lideresEsperando, ponerReinicio, queEspera, tareasCorriendo } from "./nucleo.js";
import { log } from "./log.js";
import { empezar, type Quien } from "./reinicio-marcas.js";
import { COLGADO_MS, crearRelanzador, mirarBuild, selloDe, sinEventos } from "./relanzar.js";
import { integrando } from "./salud.js";

/**
 * `raiz`: el checkout cuyo build se mira. `irse`: ya no espera a nadie; sale (el cartel ya dice "saliendo").
 * `quien`: el proceso que se reinicia, para las marcas de tiempo (electron/reinicio-marcas.ts): el motor, o la ventana si es todo en uno.
 */
export function armarRelanzo(o: { raiz: string; quien: Extract<Quien, "motor" | "ventana">; irse(): void }) {
  // Lo que un reinicio cortaría. Lo nuevo que deba frenarlo va acá.
  const motivo = (): string | null => {
    if (respondiendo() > 0) return "un líder está respondiendo";
    if (colaEnCamino() > 0) return "un mensaje de la cola está saliendo";
    if (integrando() > 0) return "una integración está corriendo";
    // Su `pa --esperar` vive adentro de su `claude`: moriría con él y nadie cobraría el resultado.
    const n = lideresEsperando();
    if (n > 0) return `${n} líder(es) de la app con workers de pa vivos (o la lista releyéndose)`;
    return null;
  };
  let ultimo: string | null = null;
  let yendose = false;
  // Lo que espera lleva 20 min sin un evento: el cartel ofrece "Reiniciar igual" (los workers de pa siguen
  // solos; los líderes de la app se cierran con `cerrarTodos` y se retoman con `--resume`).
  const colgadoMs = Number(process.env.HILOS_COLGADO_MS) || COLGADO_MS;
  const colgado = () => {
    const q = queEspera();
    return (q.nombres.length > 0 || q.integrando) && sinEventos(q.ultima, Date.now(), colgadoMs);
  };
  // Sin polling: un solo reloj, al momento en que se cumplirían los 20 min; si hubo eventos, se corre.
  let alColgado: NodeJS.Timeout | null = null;
  const vigilarColgado = () => {
    if (alColgado) clearTimeout(alColgado);
    alColgado = null;
    if (!rel.pedido() || yendose) return;
    const q = queEspera();
    if (!q.nombres.length && !q.integrando) return;
    const falta = q.ultima + colgadoMs - Date.now();
    alColgado = setTimeout(() => {
      avisarReinicio();
      vigilarColgado();
    }, Math.max(1000, falta + 500));
    alColgado.unref();
  };
  const rel = crearRelanzador({
    sello: () => selloDe(o.raiz),
    colgado,
    ocupado() {
      const m = motivo();
      // Qué espera, una vez por motivo.
      if (m !== ultimo && m) console.error(`[relanzar] reinicio pedido, espera: ${m}`);
      ultimo = m;
      return m !== null;
    },
    relanzar() {
      console.error("[relanzar] reinicio pedido: trama se reinicia con el build nuevo");
      empezar(o.quien, o.quien);
      yendose = true;
      avisarReinicio();
      o.irse();
    },
    visto: (v) => log.escribir("info", "reinicio", `build nuevo visto: ${v.buildMs} ms desde el primer cambio, ${v.quietoMs} ms de quietud${v.conMarca ? " (.listo)" : " (sin .listo)"}`),
    avisar() {
      if (rel.hay() && !rel.pedido()) console.error("[relanzar] hay un build nuevo: se avisa, no se reinicia sola");
      avisarReinicio();
      vigilarColgado();
    },
    quietoMs: Number(process.env.HILOS_RELANZAR_MS) || undefined,
  });
  ponerReinicio({
    // Lo que espera sólo se cuenta mientras espera: sin pedido el cartel no lo dice.
    estado() {
      const q = rel.pedido() ? queEspera() : null;
      return {
        hay: rel.hay() || yendose,
        pedido: rel.pedido(),
        tareas: q ? Math.max(1, tareasCorriendo()) : 0,
        saliendo: yendose,
        espera: q?.nombres ?? [],
        integrando: q?.integrando ?? false,
        colgado: q ? colgado() : false,
      };
    },
    pedir(igual) {
      if (igual && colgado()) console.error("[relanzar] Reiniciar igual: lo que espera lleva 20 min sin eventos");
      rel.pedir(igual);
      vigilarColgado();
    },
    cancelar() {
      rel.cancelar();
      vigilarColgado();
    },
  });
  mirarBuild(o.raiz, rel.cambio);
  alCambiarLider(() => {
    rel.libre();
    // La cuenta de tareas que dice el cartel mientras espera.
    if (rel.pedido()) {
      avisarReinicio();
      vigilarColgado();
    }
  });
}
