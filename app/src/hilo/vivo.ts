// Lo que pasa en cada líder de la app mientras responde y todavía no está en su
// transcript: lo que el usuario le mandó, los mensajes que ya cerró y el texto que
// va llegando (deltas del stream). Vive fuera de la vista: cambiar de hilo y
// volver no pierde la respuesta a medias. Cuando el transcript ya lo tiene
// (`confirmar`), se suelta. Los avisos a la vista se juntan por frame.
// También qué está haciendo (el indicador del chat y de su fila) y los avisos
// en línea del turno (reintentos, límite, errores; src/hilo/avisos.ts).
// Y (B13) su modo de permisos, los pedidos de permiso sin contestar (el plan de
// ExitPlanMode) y los slash commands que dijo la sesión (el menú de "/").
// Y la cola (electron/cola.ts, espejada en src/hilo/cola.ts): lo que el usuario manda con el líder a
// mitad de un turno espera en el main y sale al quedar libre; acá llega lo que salió.
import type { ComandoClaude, Estilos, EventoLider, HaceLider, Mensaje } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { sinReintento, sumarAviso, type AvisoVisto } from "./avisos";
import { avanzar, type Paso } from "./actividad-datos";
import { crearEspejo, type AvisoCola, type Encolado } from "./cola";

/** El indicador: el mismo objeto mientras no cambie (la fila se suscribe sólo a esto). */
export type Indicador = {
  /** `null`: quieto. */
  hace: HaceLider | null;
  /** Desde cuándo responde (epoch s). */
  desde: number | null;
  /** Tokens de salida del turno, sumando todos sus mensajes. */
  salida: number;
  /** Desde cuándo hace esto que hace (ms): lo que tarda un razonamiento. */
  inicio: number;
  /** Los últimos pasos del turno, el más reciente primero (la tarjeta de src/hilo/Actividad.tsx muestra los dos de atrás). */
  pasos: Paso[];
  /** Cuántos pasos lleva el turno (`pasos` guarda los últimos). */
  pasosN: number;
};

export type EnCurso = {
  /** Cuántos mensajes tenía el transcript cuando empezó esta tanda. */
  base: number;
  /** Lo de esta tanda (`i` desde 0: la vista los corre después del transcript). */
  tanda: Mensaje[];
  /**
   * Dónde empieza en la tanda el turno en curso: lo de antes es de turnos que
   * ya terminaron (un mensaje de la cola salió antes de releer el transcript).
   */
  turno: number;
  /** El texto que va llegando, todavía sin mensaje entero. */
  parcial: string;
  /** El razonamiento que va llegando, todavía sin mensaje entero (se ve plegado: src/hilo/Turno.tsx). */
  pensando: string;
  /**
   * Este líder deja ver su razonamiento (llegó un `pensamiento` o un mensaje con `pensado`): Gemini lo trae, Claude no. Una vez
   * visto no se olvida: la tarjeta y el turno muestran el razonamiento y los comandos en vez de la frase tierna.
   */
  razona: boolean;
  /** Desde cuándo responde (epoch s), o `null`. */
  desde: number | null;
  ocupado: boolean | null;
  ind: Indicador;
  /** Los tokens de salida de los mensajes ya cerrados del turno y los del que corre. */
  tok: { previos: number; actual: number };
  /** Los avisos del último turno (se van al mandar otra cosa). */
  avisos: AvisoVisto[];
  /** Se pidió Parar: el error con que termina el turno no es un error. */
  parando: boolean;
  /** Sube con cada `fin`: la vista relee el transcript. */
  fines: number;
  /** El modo de permisos que dijo el stream (o el que se pidió, mientras llega); `null`: el de la lista. */
  modo: string | null;
  /** Los pedidos de permiso sin contestar, en orden. */
  pide: Pedido[];
};

export type Pedido = Omit<Extract<EventoLider, { tipo: "permiso" }>, "tipo">;

const QUIETO: Indicador = { hace: null, desde: null, salida: 0, inicio: 0, pasos: [], pasosN: 0 };
const VACIO: EnCurso = {
  base: 0,
  tanda: [],
  turno: 0,
  parcial: "",
  pensando: "",
  razona: false,
  desde: null,
  ocupado: null,
  ind: QUIETO,
  tok: { previos: 0, actual: 0 },
  avisos: [],
  parando: false,
  fines: 0,
  modo: null,
  pide: [],
};

const estados = new Map<string, EnCurso>();
const oyentes = new Map<string, Set<() => void>>();
const sucios = new Set<string>();
let cuadro = 0;

const ahora = () => Math.floor(Date.now() / 1000);

function avisar(sid: string) {
  sucios.add(sid);
  if (cuadro) return;
  cuadro = requestAnimationFrame(() => {
    cuadro = 0;
    const ss = [...sucios];
    sucios.clear();
    for (const s of ss) oyentes.get(s)?.forEach((f) => f());
  });
}

function cambiar(sid: string, f: (e: EnCurso) => EnCurso) {
  estados.set(sid, f(estados.get(sid) ?? VACIO));
  avisar(sid);
}

/** El indicador con lo que cambió (el mismo objeto si no cambió nada). */
function conInd(e: EnCurso, c: Partial<Pick<Indicador, "hace" | "desde" | "salida">>): EnCurso {
  const i = { ...e.ind, ...c };
  // Lo que hace y sus pasos van juntos (src/hilo/actividad-datos.ts): un turno nuevo o uno que terminó los borra.
  if (c.hace !== undefined && c.hace !== e.ind.hace) {
    const s = avanzar({ hace: e.ind.hace, inicio: e.ind.inicio, pasos: e.ind.pasos, n: e.ind.pasosN }, c.hace, Date.now());
    i.inicio = s.inicio;
    i.pasos = s.pasos;
    i.pasosN = s.n;
  }
  if (i.hace === e.ind.hace && i.desde === e.ind.desde && i.salida === e.ind.salida && i.pasos === e.ind.pasos && i.pasosN === e.ind.pasosN) return e;
  return { ...e, ind: i.hace === null && i.desde === null && i.salida === 0 ? QUIETO : i };
}

const msj = (e: EnCurso, m: Omit<Mensaje, "i">): Mensaje => ({ ...m, i: e.tanda.length });

function alEvento(sid: string, ev: EventoLider) {
  cambiarPor(sid, ev);
}

/** Cambió la cola de un líder: lo que salió va a la tanda (como lo que se manda a mano); lo que no llegó, vuelve. */
function alCola(a: AvisoCola) {
  if (a.volvio) fallo(a.sid);
  espejo.poner(a);
  if (!a.salio) return;
  const { item, total, traido } = a.salio;
  // Venía de una terminal: ya es de la app, con el modo que tenía la caja.
  if (traido && item.modo) ponerModo(a.sid, item.modo);
  enviado(a.sid, item.texto, total ?? enCurso(a.sid).base, item.imagenes);
}

function cambiarPor(sid: string, ev: EventoLider) {
  cambiar(sid, (e) => {
    switch (ev.tipo) {
      case "parcial":
        return { ...e, parcial: e.parcial + ev.texto };
      case "pensamiento":
        return { ...e, pensando: e.pensando + ev.texto, razona: true };
      case "mensaje": {
        // El razonamiento entero reemplaza al que venía llegando (si el mensaje no lo trae, se queda el que llegó).
        const pensado = ev.pensado || e.pensando;
        const razona = e.razona || !!pensado;
        const ult = e.tanda[e.tanda.length - 1];
        // Los bloques del mismo mensaje van juntos, como en el transcript.
        if (ult?.rol === "assistant" && ev.mid && (ult as Mensaje & { mid?: string }).mid === ev.mid) {
          const junto = {
            ...ult,
            texto: [ult.texto, ev.texto].filter(Boolean).join("\n"),
            ...(pensado || ult.pensado ? { pensado: [ult.pensado, pensado].filter(Boolean).join("\n\n") } : {}),
            herramientas: [...ult.herramientas, ...ev.herramientas],
            ...(ult.det || ev.det?.length ? { det: [...(ult.det ?? []), ...(ev.det ?? [])] } : {}),
          };
          return { ...e, parcial: "", pensando: "", razona, tanda: [...e.tanda.slice(0, -1), junto], avisos: sinReintento(e.avisos) };
        }
        const m = { ...msj(e, { rol: "assistant", texto: ev.texto, herramientas: ev.herramientas, ts: new Date().toISOString(), modelo: ev.modelo, ...(ev.det?.length ? { det: ev.det } : {}), ...(pensado ? { pensado } : {}) }), mid: ev.mid };
        return { ...e, parcial: "", pensando: "", razona, tanda: [...e.tanda, m], avisos: sinReintento(e.avisos) };
      }
      case "resultado": {
        // El final de lo que devolvió una herramienta: a su llamada, por id (B19).
        let k = e.tanda.length - 1;
        while (k >= 0 && !e.tanda[k].det?.some((d) => d.id === ev.id)) k--;
        if (k < 0) return e;
        const m = e.tanda[k];
        const det = m.det!.map((d) => (d.id === ev.id ? { ...d, resultado: { texto: ev.texto, error: ev.error } } : d));
        return { ...e, tanda: e.tanda.map((x, j) => (j === k ? { ...m, det } : x)) };
      }
      case "hace":
        return conInd(e, { hace: ev.hace });
      case "tokens": {
        // `nuevo`: empezó otro mensaje; si no, es el total (acumulado) del que corre.
        const tok = ev.nuevo ? { previos: e.tok.previos + e.tok.actual, actual: ev.salida } : { ...e.tok, actual: ev.salida };
        return conInd({ ...e, tok }, { salida: tok.previos + tok.actual });
      }
      case "aviso":
        return { ...e, avisos: sumarAviso(e.avisos, ev.aviso) };
      case "modo":
        return e.modo === ev.modo ? e : { ...e, modo: ev.modo };
      case "permiso": {
        const { tipo: _, ...p } = ev;
        return { ...e, pide: [...e.pide.filter((x) => x.id !== p.id), p] };
      }
      case "permisoFuera":
        return e.pide.some((x) => x.id === ev.id) ? { ...e, pide: e.pide.filter((x) => x.id !== ev.id) } : e;
      case "comandos":
        if (ev.lista.length) (ev.agy ? ponerComandosAgy : ponerComandos)(ev.lista);
        return e;
      case "estilos":
        ponerEstilos(ev.actual, ev.lista);
        return e;
      case "fin": {
        // Parar termina el turno con un error que no es error.
        let avisos = sinReintento(e.avisos);
        if (ev.error && !e.parando) avisos = sumarAviso(avisos, { clase: "error", texto: ev.error, codigo: null });
        return conInd({ ...e, parcial: "", pensando: "", avisos, parando: false, fines: e.fines + 1, pide: [] }, { hace: null });
      }
      case "estado": {
        const desde = ev.ocupado ? (e.desde ?? ahora()) : null;
        const x = { ...e, ocupado: ev.ocupado, desde, parando: ev.ocupado && e.parando };
        return conInd(x, ev.ocupado ? { desde } : { hace: null, desde: null });
      }
      case "salio": {
        let avisos = sinReintento(e.avisos);
        if (ev.error !== null) avisos = sumarAviso(avisos, { clase: "salio", codigo: ev.codigo, texto: ev.error || null });
        return conInd({ ...e, ocupado: false, desde: null, parcial: "", pensando: "", avisos, fines: e.fines + 1, pide: [] }, { hace: null, desde: null });
      }
      default:
        return e;
    }
  });
}

/**
 * Lo que se ve de la conversación: lo del transcript y, detrás, lo que llegó por el stream y
 * todavía no está en él. El texto que va llegando (`parcial`) es un mensaje más del asistente, al
 * final y con el `i` que va a tener el entero: cuando ése llega lo reemplaza en su lugar (mismo
 * turno, misma key), así nunca se ve dos veces ni salta.
 */
export function mensajesVistos(pag: { mensajes: Mensaje[]; total: number } | null, v: Pick<EnCurso, "ocupado" | "base" | "tanda" | "parcial" | "pensando">): Mensaje[] {
  const ms = pag?.mensajes ?? [];
  const total = pag?.total ?? 0;
  const cubierto = !v.ocupado && total >= v.base + v.tanda.length;
  if (cubierto && !v.parcial && !v.pensando) return ms;
  // Respondiendo, del transcript sólo lo de antes de la tanda: lo demás ya está en ella (si un
  // mensaje de la cola salió antes de releerlo, el transcript puede traer el turno anterior y el nuevo).
  const desde = v.ocupado ? v.base : total;
  const previos = v.ocupado ? ms.filter((m) => m.i < desde) : ms;
  const extra: Mensaje[] = cubierto ? [] : v.tanda.map((m) => ({ ...m, i: desde + m.i }));
  if (v.parcial || v.pensando)
    extra.push({ i: desde + extra.length, rol: "assistant", texto: v.parcial, herramientas: [], ts: null, modelo: null, ...(v.pensando ? { pensado: v.pensando } : {}) });
  return [...previos, ...extra];
}

let suscripto = false;
/** Los líderes a los que ya se les pidieron los pedidos pendientes (la vista recargada no los vio llegar). */
const rehidratados = new Set<string>();

/** Lo que hay de un líder (siempre el mismo objeto mientras no cambie). */
export const enCurso = (sid: string): EnCurso => estados.get(sid) ?? VACIO;

/** ¿Este líder deja ver su razonamiento? (ya llegó alguno). */
export const razona = (sid: string): boolean => enCurso(sid).razona;

/** El razonamiento del turno en curso, entero: lo de sus mensajes cerrados y, detrás, lo que sigue llegando. */
export function razonDelTurno(sid: string): string {
  const e = enCurso(sid);
  return [...e.tanda.slice(e.turno).map((m) => m.pensado), e.pensando].filter(Boolean).join("\n\n");
}

/** Sólo el indicador (para la fila: no repinta con cada delta del texto). */
export const indicador = (sid: string): Indicador => enCurso(sid).ind;

/** Para `useSyncExternalStore`. */
export function suscribir(sid: string, fn: () => void) {
  if (!suscripto) {
    suscripto = true;
    fuente.alEventoLider(alEvento);
    fuente.alColaLider(alCola);
    void fuente.liderColas().then((cs) => cs.forEach((a) => espejo.poner(a)));
  }
  if (sid && !rehidratados.has(sid)) {
    rehidratados.add(sid);
    void fuente.liderPendientes(sid).then((ps) => ps.forEach((p) => cambiarPor(sid, p)));
  }
  let s = oyentes.get(sid);
  if (!s) oyentes.set(sid, (s = new Set()));
  s.add(fn);
  return () => void s.delete(fn);
}

/** Empezar a escuchar antes de abrir un chat: los eventos de un líder nuevo llegan antes que su sid. */
export const escuchar = () => suscribir("", () => {});

/**
 * El usuario mandó algo: va a la tanda. `base` es el total del transcript que
 * tiene la vista. Un líder nuevo lo recibe después de sus primeros eventos:
 * va primero.
 */
export function enviado(sid: string, texto: string, base: number, imagenes?: Mensaje["imagenes"]) {
  cambiar(sid, (e) => {
    const yo: Mensaje = { i: 0, rol: "user", texto, herramientas: [], ts: new Date().toISOString(), modelo: null, ...(imagenes?.length ? { imagenes } : {}) };
    const primero = e.tanda.length === 0 || !e.tanda.some((m) => m.rol === "user");
    const tanda = (primero ? [yo, ...e.tanda] : [...e.tanda, yo]).map((m, i) => ({ ...m, i }));
    const turno = primero ? 0 : tanda.length - 1;
    const desde = e.desde ?? ahora();
    const x = { ...e, base: primero ? base : e.base, tanda, turno, avisos: [], tok: { previos: 0, actual: 0 }, ocupado: true, desde };
    return conInd(x, { hace: { que: "pidiendo", nombre: null, detalle: null }, desde, salida: 0 });
  });
}

/**
 * Un mensaje forzado a mitad de un turno (el líder lo lee en su próximo paso): entra a la tanda como lo propio, sin tocar
 * el contador de tokens ni lo que está haciendo el líder. El turno sigue siendo el mismo, y cuenta desde este mensaje.
 */
export function inyectado(sid: string, texto: string, imagenes?: Mensaje["imagenes"]) {
  cambiar(sid, (e) => {
    const yo: Mensaje = { i: 0, rol: "user", texto, herramientas: [], ts: new Date().toISOString(), modelo: null, ...(imagenes?.length ? { imagenes } : {}) };
    const tanda = [...e.tanda, yo].map((m, i) => ({ ...m, i }));
    return { ...e, tanda, turno: tanda.length - 1, ocupado: true };
  });
}

/** El envío falló: se saca lo último que mandó el usuario. */
export function fallo(sid: string) {
  cambiar(sid, (e) => {
    const k = e.tanda.map((m) => m.rol).lastIndexOf("user");
    return conInd({ ...e, tanda: k < 0 ? e.tanda : e.tanda.slice(0, k), turno: 0, ocupado: false, desde: null }, { hace: null, desde: null });
  });
}

export const parando = (sid: string) => cambiar(sid, (e) => ({ ...e, parando: true }));

/**
 * El transcript ya tiene `total` mensajes: si cubre toda la tanda (o `forzar`)
 * y no está respondiendo, se suelta. Respondiendo, se suelta lo de los turnos
 * que ya terminaron (si el transcript lo cubre, o `forzar`); el turno en curso queda.
 */
export function confirmar(sid: string, total: number, forzar = false) {
  const e = estados.get(sid);
  if (!e || !e.tanda.length) return;
  if (e.ocupado) {
    const k = e.turno;
    if (!k || (!forzar && total < e.base + k)) return;
    cambiar(sid, (x) => ({ ...x, tanda: x.tanda.slice(k).map((m, i) => ({ ...m, i })), turno: 0, base: x.base + k }));
    return;
  }
  if (!forzar && total < e.base + e.tanda.length) return;
  cambiar(sid, (x) => ({ ...x, tanda: [], turno: 0, parcial: "", pensando: "", base: total }));
}

const espejo = crearEspejo();
/**
 * La cola de cada líder: vive en el main (la ven la ventana y el celular, y un reinicio no la
 * pierde); acá se la lee y se le pide. Rechaza si el envío no sirve.
 */
export const cola = {
  lista: espejo.lista,
  error: espejo.error,
  suscribir: espejo.suscribir,
  encolar: (sid: string, x: Omit<Encolado, "id">) => fuente.liderEncolar(sid, x),
  quitar: (sid: string, id: number) => fuente.liderColaQuitar(sid, id),
  /** Forzar: lo que espera en la cola sale ya, y el líder lo lee en su próximo paso. */
  inyectar: (sid: string, x: Omit<Encolado, "id">) => fuente.liderInyectar(sid, { texto: x.texto, modelo: x.modelo, effort: x.effort, ...(x.imagenes ? { imagenes: x.imagenes } : {}) }),
  /** Ahora: reintenta lo que no salió y, con `cortar`, corta lo que hace el de la terminal. */
  ya: (sid: string, cortar: boolean) => fuente.liderColaYa(sid, cortar),
};

/** El modo que se pidió (Shift+Tab, /plan): se ve al toque; el stream lo confirma. */
export const ponerModo = (sid: string, modo: string) => cambiar(sid, (e) => (e.modo === modo ? e : { ...e, modo }));

/** Se contestó un pedido: sale de la vista sin esperar al main. */
export const contestado = (sid: string, id: string) => cambiar(sid, (e) => ({ ...e, pide: e.pide.filter((x) => x.id !== id) }));

// Los slash commands de Claude Code (de la última sesión que los dijo; al
// arrancar, los que recordó el main en comandos.json).
let comandos: ComandoClaude[] = [];
let comandosDeAgy: ComandoClaude[] = [];
let pedidos = false;
const oyentesComandos = new Set<() => void>();

function ponerComandos(lista: ComandoClaude[]) {
  // El init trae sólo nombres: las descripciones que ya se saben se quedan.
  const antes = new Map(comandos.map((c) => [c.nombre, c]));
  comandos = lista.map((c) => (c.descripcion || !antes.get(c.nombre) ? c : antes.get(c.nombre)!));
  oyentesComandos.forEach((f) => f());
}

function ponerComandosAgy(lista: ComandoClaude[]) {
  comandosDeAgy = lista;
  oyentesComandos.forEach((f) => f());
}

export const comandosClaude = () => comandos;
export const comandosAgy = () => comandosDeAgy;

export function suscribirComandos(fn: () => void) {
  if (!pedidos) {
    pedidos = true;
    void fuente.liderComandos().then((l) => {
      const claude = l.filter((c) => !c.agy);
      const agy = l.filter((c) => c.agy);
      if (claude.length && !comandos.length) ponerComandos(claude);
      if (agy.length && !comandosDeAgy.length) ponerComandosAgy(agy);
    });
  }
  oyentesComandos.add(fn);
  return () => void oyentesComandos.delete(fn);
}

// Los output styles (`/output-style`): son de la config de `~`, los mismos para todos
// los líderes. Al arrancar, los que recordó el main; después, lo que dice cada sesión.
let estilos: Estilos = { actual: null, lista: [] };
let pedidosEstilos = false;
const oyentesEstilos = new Set<() => void>();

/** El estilo en uso y, si se sabe, la lista; `null` deja lo que había. */
export function ponerEstilos(actual: string | null, lista: string[] | null) {
  const sigue = { actual: actual ?? estilos.actual, lista: lista?.length ? lista : estilos.lista };
  if (sigue.actual === estilos.actual && sigue.lista === estilos.lista) return;
  estilos = sigue;
  oyentesEstilos.forEach((f) => f());
}

export const estilosClaude = () => estilos;

export function suscribirEstilos(fn: () => void) {
  if (!pedidosEstilos) {
    pedidosEstilos = true;
    void fuente.liderEstilos().then((e) => {
      if (!estilos.lista.length) ponerEstilos(estilos.actual ?? e.actual, e.lista);
    });
  }
  oyentesEstilos.add(fn);
  return () => void oyentesEstilos.delete(fn);
}
