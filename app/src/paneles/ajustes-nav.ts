// La estructura de Ajustes: las categorías de la barra lateral, el índice de lo que se busca (cada fila, con sus sinónimos), qué
// categoría está abierta (se recuerda en el hash de la página: `#ajustes/modelos`) y las marcas de "falta algo" de cada una.
// Puro (sin React ni puente): lo prueba tests/ajustes-nav.test.ts. Las vistas están en AjustesNav.tsx.
import type { Clave, ClaveSola } from "../i18n";
import { TIPOS } from "../../electron/modelos-tipos";

export const CATS = ["cuentas", "modelos", "cupos", "locales", "celular", "general"] as const;
export type CatId = (typeof CATS)[number];

export const esCat = (x: unknown): x is CatId => typeof x === "string" && (CATS as readonly string[]).includes(x);

/** Una fila de Ajustes que se puede buscar: `nombre` es la misma clave con que se pinta (`data-opc` de la fila). */
export type Item = { cat: CatId; nombre: ClaveSola; que: ClaveSola | null; sin: string };

const tipoDe = (tipo: (typeof TIPOS)[number]): Item => ({
  cat: "modelos",
  nombre: `mdl.t.${tipo}` as ClaveSola,
  que: `mdl.t.${tipo}Que` as ClaveSola,
  sin: `worker tipo ${tipo} task tarea modelo model`,
});

/** Los sinónimos van en los dos idiomas y sin tildes (no se ven: sólo ayudan a encontrar). */
export const ITEMS: readonly Item[] = [
  { cat: "cuentas", nombre: "ajustes.ctaClaude", que: "ajustes.ctaClaudeQue", sin: "anthropic login iniciar sesion cuenta conectar account sign in" },
  { cat: "cuentas", nombre: "ajustes.ctaGemini", que: "ajustes.ctaGeminiQue", sin: "google agy antigravity login iniciar sesion cuenta conectar account sign in" },

  { cat: "modelos", nombre: "ajustes.mdlLider", que: "ajustes.mdlLiderQue", sin: "lider leader jefe orquestador opus sonnet haiku fable esfuerzo effort" },
  { cat: "modelos", nombre: "ajustes.mdlTodo", que: "ajustes.mdlTodoQue", sin: "uno solo single un modelo todo one model suscripcion" },
  ...TIPOS.map(tipoDe),
  { cat: "modelos", nombre: "ajustes.mdlAutomatico", que: "ajustes.mdlAutomaticoQue", sin: "auto automatico reparto calidad cupo suscripcion elegir modelo hoy elegiria fijo" },
  { cat: "modelos", nombre: "ajustes.mdlExcluir", que: "ajustes.mdlExcluirQue", sin: "excluir fable opus sonnet haiku no usar prohibir dejar afuera" },
  { cat: "modelos", nombre: "ajustes.mdlDestrabar", que: "ajustes.mdlDestrabarQue", sin: "gemini repite bucle trabado destrabar loop interrumpir flash argon" },
  { cat: "modelos", nombre: "ajustes.mdlPermitirMax", que: "ajustes.mdlPermitirMaxQue", sin: "max esfuerzo effort permitir gasta cupo" },
  { cat: "modelos", nombre: "ajustes.dictado", que: "ajustes.dictadoQue", sin: "dictar dictation voz voice microfono microphone transcribir transcribe stt whisper turbo handy" },

  { cat: "cupos", nombre: "ajustes.planSus", que: "ajustes.planQue", sin: "suscripcion subscription pro max plan precio" },
  { cat: "cupos", nombre: "cu.claude", que: "cu.claudeQue", sin: "claude anthropic suscripcion subscription plan cupo quota ventana window 5h semana week conectar connect login" },
  { cat: "cupos", nombre: "cu.google", que: "cu.googleQue", sin: "google gemini agy ai pro suscripcion subscription plan cupo quota ventana window conectar connect login" },
  { cat: "cupos", nombre: "cu.chatgpt", que: "cu.chatgptQue", sin: "chatgpt openai codex gpt suscripcion subscription plan cupo quota conectar connect login" },
  { cat: "cupos", nombre: "cu.topesGoogle", que: "cu.topesQue", sin: "google gemini agy tope limite limit cupo quota llena full codigo code umbral threshold porcentaje percent" },
  { cat: "cupos", nombre: "ajustes.cuposGuardar", que: "ajustes.cuposGuardarQue", sin: "reservar reserve guardar save reserva porcentaje percent mis sesiones my sessions cupo quota claude tope cap limite limit" },
  { cat: "cupos", nombre: "ajustes.mdlTope5", que: "ajustes.mdlTope5Que", sin: "claude limite limit cupo quota reserva cinco horas 5h five hours porcentaje percent" },
  { cat: "cupos", nombre: "ajustes.mdlTope7", que: "ajustes.mdlTope7Que", sin: "claude limite limit cupo quota reserva semana semanal week weekly 7d porcentaje percent" },
  { cat: "cupos", nombre: "ajustes.cuposSinCupo", que: "ajustes.cuposSinCupoQue", sin: "sin cupo out of quota agotado usar otro use another esperar wait fallar fail reemplazo fallback proveedor provider" },

  { cat: "locales", nombre: "ajustes.mdlLocales", que: "ajustes.mdlOllamaQue", sin: "ollama local llama gpu offline detectar detect" },
  { cat: "locales", nombre: "ajustes.mdlInstalados", que: "ajustes.mdlInstaladosQue", sin: "ollama instalados installed modelos locales agregar add usar" },
  { cat: "locales", nombre: "ajustes.mdlBajar", que: "ajustes.mdlBajarQue", sin: "ollama descargar download pull bajar modelo model" },
  { cat: "locales", nombre: "ajustes.mdlLocalesAgregados", que: "ajustes.mdlLocalesQue", sin: "ollama locales agregados added direccion address url servidor server quitar remove" },

  { cat: "celular", nombre: "ajustes.celGuia", que: "ajustes.celPaso1Que", sin: "telefono movil phone mobile tailscale tailnet instalar install qr codigo code escanear scan direccion address url conectar connect guia guide" },
  { cat: "celular", nombre: "ajustes.celAcceso", que: "ajustes.celAccesoQue", sin: "telefono movil phone mobile tailscale tailnet remoto remote encender apagar on off" },
  { cat: "celular", nombre: "ajustes.celPuerto", que: "ajustes.celPuertoQue", sin: "telefono movil phone mobile tailscale tailnet remoto remote port" },
  { cat: "celular", nombre: "ajustes.celDisp", que: "ajustes.celDispQue", sin: "telefono movil phone mobile tailscale tailnet dispositivos devices permitidos allowed agregar add" },


  { cat: "general", nombre: "ajustes.idioma", que: "ajustes.idiomaQue", sin: "language english espanol ingles spanish traduccion idioma" },
  { cat: "general", nombre: "ajustes.letra", que: "ajustes.letraQue", sin: "tamano size texto text zoom font fuente grande chico letra" },
  { cat: "general", nombre: "ajustes.fuente", que: "ajustes.fuenteQue", sin: "tipografia typeface font letra inter sistema system" },
  { cat: "general", nombre: "ajustes.mono", que: "ajustes.monoQue", sin: "monoespaciada monospace codigo code fira tipografia font fuente" },
  { cat: "general", nombre: "ajustes.tiernos", que: "ajustes.tiernosQue", sin: "mensajes carinosos tiernos friendly messages gatito carita" },
  { cat: "general", nombre: "ajustes.avisarEspera", que: "ajustes.avisarEsperaQue", sin: "notificacion notification aviso te necesita te espera lider escritorio desktop alerta" },
  { cat: "general", nombre: "ajustes.compactar", que: "ajustes.compactarQue", sin: "compactacion compaction contexto context autocompact ventana window tokens" },
  { cat: "general", nombre: "ajustes.atajos", que: "ajustes.atajosQue", sin: "teclado keyboard shortcuts hotkeys teclas atajos" },
  { cat: "general", nombre: "ajustes.bienvenida", que: "ajustes.bienvenidaQue", sin: "welcome bienvenida primer arranque first start setup asistente configurar inicio" },
];

/** Minúsculas y sin tildes: "Sesión" se encuentra con "sesion". */
export const normalizar = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export type Resultado = { item: Item; titulo: string; desc: string; cat: string };

/**
 * Lo que responde el buscador: cada palabra de la consulta tiene que estar en el título, la descripción, los sinónimos o el
 * nombre de la categoría (en el idioma de ahora, `traducir`); primero lo que la tiene en el título, y a igual puntaje el orden
 * de Ajustes. `disponible` deja afuera lo que no existe en esta máquina (cuentas fuera de Windows).
 */
export function buscar(consulta: string, traducir: (k: ClaveSola) => string, nombreCat: (c: CatId) => string, disponible: (c: CatId) => boolean = () => true, tope = 8): Resultado[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  const llenos: { r: Resultado; punto: number; i: number }[] = [];
  ITEMS.forEach((item, i) => {
    if (!disponible(item.cat)) return;
    const titulo = traducir(item.nombre);
    const desc = item.que ? traducir(item.que) : "";
    const cat = nombreCat(item.cat);
    const nt = normalizar(titulo);
    const resto = normalizar(`${desc} ${item.sin} ${cat}`);
    if (!palabras.every((p) => nt.includes(p) || resto.includes(p))) return;
    const punto = nt.includes(palabras.join(" ")) ? 0 : palabras.every((p) => nt.includes(p)) ? 1 : 2;
    llenos.push({ r: { item, titulo, desc, cat }, punto, i });
  });
  return llenos
    .sort((a, b) => a.punto - b.punto || a.i - b.i)
    .slice(0, tope)
    .map((x) => x.r);
}

// --- Qué categoría está abierta, qué se pidió mostrar y las marcas ---

export type Salto = { opc: string; n: number };

const oyentes = new Set<() => void>();
let abierta: CatId | null = null;
let salto: Salto | null = null;
let marcas: Partial<Record<CatId, Clave | null>> = {};
let marcasVars: Partial<Record<CatId, Record<string, string>>> = {};
let nSalto = 0;

const avisar = () => {
  for (const f of [...oyentes]) f();
};

/** El hash recuerda la categoría entre recargas (el celular) sin otro archivo ni `localStorage`. */
const HASH = "#ajustes/";
function deHash(): CatId | null {
  const h = typeof location === "undefined" ? "" : location.hash;
  const c = h.startsWith(HASH) ? h.slice(HASH.length) : "";
  return esCat(c) ? c : null;
}
function aHash(c: CatId) {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  try {
    history.replaceState(history.state, "", `${HASH}${c}`);
  } catch {
    /* un contexto sin historial (una captura offscreen): no se recuerda y listo */
  }
}

/** La categoría que se recuerda (la del hash, o la última a la que se fue), o `null` si nunca se eligió una. */
export const categoria = (): CatId | null => abierta ?? (abierta = deHash());

/** Va a una categoría y, con `opc`, a esa fila (que se resalta cuando está a la vista). */
export function irA(cat: CatId, opc?: string) {
  const cambia = abierta !== cat;
  abierta = cat;
  aHash(cat);
  if (opc) salto = { opc, n: ++nSalto };
  if (cambia || opc) avisar();
}

export const pendienteDeMostrar = (): Salto | null => salto;

/** La marca de una categoría: la clave del texto corto que dice qué falta (o `null`: ya está). */
export function marcar(cat: CatId, clave: Clave | null, vars?: Record<string, string>) {
  const mismoVars = JSON.stringify(marcasVars[cat] ?? null) === JSON.stringify(vars ?? null);
  if ((marcas[cat] ?? null) === clave && mismoVars) return;
  marcas = { ...marcas, [cat]: clave };
  marcasVars = { ...marcasVars, [cat]: vars };
  avisar();
}
export const marcasDe = () => marcas;
export const varsDe = (cat: CatId): Record<string, string> | undefined => marcasVars[cat];

export function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}

/** La categoría que se ve: la recordada si existe en esta máquina; si no, la primera que haya. */
export function efectiva(hay: (c: CatId) => boolean): CatId {
  const c = categoria();
  if (c && hay(c)) return c;
  return CATS.find(hay) ?? "general";
}

/** Sin avisar a nadie: la categoría con que nace Ajustes si todavía no se eligió ninguna (las capturas). */
export function inicial(cat: CatId) {
  if (categoria() === null) abierta = cat;
}

/** Qué categoría muestra cada variante de captura de Ajustes (`HILOS_VARIANTE`), para que la foto caiga donde está lo que se quiere ver. */
export function deVariante(v: string | null | undefined): CatId | null {
  if (!v) return null;
  if (v.startsWith("cuentas")) return "cuentas";
  if (v === "mdl-agregar" || v === "mdl-bajando" || v === "mdl-sinollama" || v === "mdl-apagado" || v === "mdl-sugeridos") return "locales";
  if (v === "mdl-tope" || v.startsWith("cupos") || v === "editando" || v === "editando-mal") return "cupos";
  if (v === "celular") return "celular";
  if (v.startsWith("mdl") || v === "sinmdl" || v === "modelo" || v === "dictado") return "modelos";
  if (v === "fuente" || v === "mono" || v === "compactar" || v === "general") return "general";
  return null;
}

// --- Qué categorías existen en esta máquina: sólo Celular depende de algo (que el acceso sea editable). Cuentas siempre está: sin el comando `cuentas` la sección lo dice. ---
let presentes: Partial<Record<CatId, boolean>> = {};
export const presentesDe = () => presentes;
/** Una sección dice si existe en esta máquina (llega tarde: se pregunta al main). */
export function declarar(cat: CatId, hay: boolean) {
  if (presentes[cat] === hay) return;
  presentes = { ...presentes, [cat]: hay };
  avisar();
}

// --- Abrir Ajustes desde afuera (la pastilla "Falta configurar") ---
let alAbrir: (() => void) | null = null;
/** La barra dice cómo se abre el panel de Ajustes. */
export function alPedirAjustes(f: () => void) {
  alAbrir = f;
  return () => {
    if (alAbrir === f) alAbrir = null;
  };
}
/** Abre Ajustes en una categoría. */
export function abrirAjustes(cat: CatId) {
  irA(cat);
  alAbrir?.();
}

/** Para los tests: todo como al arrancar. */
export function reiniciar() {
  oyentes.clear();
  abierta = null;
  salto = null;
  marcas = {};
  marcasVars = {};
  presentes = {};
  nSalto = 0;
  alAbrir = null;
}
