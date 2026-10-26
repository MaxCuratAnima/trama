// Preload sandboxeado (CommonJS a la fuerza): lo único que ve el frontend del
// proceso main es `window.hilos`.
import { contextBridge, ipcRenderer } from "electron";

/** Suscribirse a un canal del main; devuelve cómo desuscribirse. */
const oir = (canal: string) => (fn: (dato: unknown) => void) => {
  const f = (_e: unknown, dato: unknown) => fn(dato);
  ipcRenderer.on(canal, f);
  return () => {
    ipcRenderer.off(canal, f);
  };
};

contextBridge.exposeInMainWorld("hilos", {
  bench: {
    modo: (): Promise<boolean> => ipcRenderer.invoke("bench:modo"),
    listo: (): Promise<number> => ipcRenderer.invoke("bench:listo"),
    cpu: (): Promise<unknown> => ipcRenderer.invoke("bench:cpu"),
    fin: (reporte: unknown): Promise<void> => ipcRenderer.invoke("bench:fin", reporte),
  },
  statusline: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("statusline:leer"),
    sincronizar: (): Promise<unknown> => ipcRenderer.invoke("statusline:sincronizar"),
    alCambiar: oir("statusline:cambio"),
  },
  hilos: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("hilos:leer"),
    /** La última lista entera (si se perdió el hilo de las diferencias de `alCambiar`). */
    completa: (): Promise<unknown> => ipcRenderer.invoke("hilos:completa"),
    guardados: (): Promise<unknown> => ipcRenderer.invoke("hilos:guardados"),
    alCambiar: oir("hilos:cambio"),
    /** Los ids que nombró cada tanda nueva de `eventos.jsonl`. */
    alEvento: oir("eventos:ids"),
    /** Cada línea nueva: un worker que arranca o se frena (`EventoPa`). */
    alEventoPa: oir("eventos:pa"),
  },
  leidos: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("leidos:leer"),
    marcar: (id: string, ts: number): Promise<void> => ipcRenderer.invoke("leidos:marcar", id, ts),
  },
  nombres: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("nombres:leer"),
    titulo: (id: string, titulo: string): Promise<void> => ipcRenderer.invoke("nombres:titulo", id, titulo),
    proyecto: (sid: string, slug: string | null): Promise<void> => ipcRenderer.invoke("nombres:proyecto", sid, slug),
    oculto: (slug: string, si: boolean): Promise<void> => ipcRenderer.invoke("nombres:oculto", slug, si),
    orden: (orden: unknown): Promise<void> => ipcRenderer.invoke("nombres:orden", orden),
    alOrden: oir("nombres:orden"),
  },
  /** Los slugs del registry (Mover a proyecto…). */
  carpetas: (): Promise<unknown> => ipcRenderer.invoke("proyectos:carpetas"),
  /** Cada nombre del registry con el slug de su carpeta (Iniciar una tarea del tablero). */
  slugsPorNombre: (): Promise<unknown> => ipcRenderer.invoke("proyectos:nombres"),
  preferencias: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("preferencias:leer"),
    effort: (modelo: string, effort: string): Promise<void> => ipcRenderer.invoke("preferencias:effort", modelo, effort),
    idioma: (idioma: string): Promise<void> => ipcRenderer.invoke("preferencias:idioma", idioma),
    apariencia: (a: unknown): Promise<void> => ipcRenderer.invoke("preferencias:apariencia", a),
    tiernos: (si: boolean): Promise<void> => ipcRenderer.invoke("preferencias:tiernos", si),
    avisarEspera: (si: boolean): Promise<void> => ipcRenderer.invoke("preferencias:avisarEspera", si),
    vista: (vista: string): Promise<void> => ipcRenderer.invoke("preferencias:vista", vista),
    consumo: (si: boolean): Promise<void> => ipcRenderer.invoke("preferencias:consumo", si),
    bienvenidaPendiente: (): Promise<boolean> => ipcRenderer.invoke("preferencias:bienvenidaPendiente"),
    bienvenida: (si: boolean): Promise<void> => ipcRenderer.invoke("preferencias:bienvenida", si),
  },
  /** El panel de consumo (a la derecha): lo que consumió cada modelo y cómo va cada sesión. */
  consumo: {
    mirar: (pedido: unknown): Promise<unknown> => ipcRenderer.invoke("consumo:mirar", pedido),
    soltar: (): Promise<void> => ipcRenderer.invoke("consumo:soltar"),
    alCambiar: oir("consumo:cambio"),
  },
  /** Los pasos de un worker (la vista de worker): `mirar` contesta la vista entera, después llegan los cambios por lotes. */
  pasos: {
    mirar: (id: string): Promise<unknown> => ipcRenderer.invoke("pasos:mirar", id),
    soltar: (): Promise<void> => ipcRenderer.invoke("pasos:soltar"),
    alCambiar: oir("pasos:cambio"),
  },
  pa: {
    cerrar: (h: unknown): Promise<void> => ipcRenderer.invoke("pa:cerrar", h),
    hilo: (x: unknown): Promise<unknown> => ipcRenderer.invoke("pa:hilo", x),
    parar: (id: string): Promise<void> => ipcRenderer.invoke("pa:parar", id),
  },
  /** slug → `titulo` del registry de cada proyecto que tiene uno. */
  titulos: (): Promise<unknown> => ipcRenderer.invoke("proyectos:titulos"),
  /** slug → data URL del logo de cada proyecto que tiene uno (electron/iconos.ts). */
  iconos: (): Promise<unknown> => ipcRenderer.invoke("proyectos:iconos"),
  dictado: {
    transcribir: (x: unknown): Promise<string> => ipcRenderer.invoke("dictado:transcribir", x),
    modelos: (): Promise<unknown> => ipcRenderer.invoke("dictado:modelos"),
    elegirModelo: (id: string): Promise<unknown> => ipcRenderer.invoke("dictado:elegirModelo", id),
  },
  /** Los modelos locales (electron/locales.ts): su contexto, la cuenta de la VRAM y Probar. */
  locales: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("locales:leer"),
    guardar: (x: unknown): Promise<unknown> => ipcRenderer.invoke("locales:guardar", x),
    probar: (x: unknown): Promise<unknown> => ipcRenderer.invoke("locales:probar", x),
  },
  /** Quién tiene la GPU y cómo liberarla (electron/vram.ts). */
  vram: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("vram:leer"),
    liberar: (x: unknown): Promise<unknown> => ipcRenderer.invoke("vram:liberar", x),
  },
  lider: {
    nuevo: (x: unknown): Promise<string> => ipcRenderer.invoke("lider:nuevo", x),
    mandar: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:mandar", x),
    inyectar: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:inyectar", x),
    archivo: (x: unknown): Promise<string> => ipcRenderer.invoke("lider:archivo", x),
    parar: (sid: string): Promise<void> => ipcRenderer.invoke("lider:parar", sid),
    modo: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:modo", x),
    permiso: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:permiso", x),
    pendientes: (sid: string): Promise<unknown> => ipcRenderer.invoke("lider:pendientes", sid),
    comandos: (): Promise<unknown> => ipcRenderer.invoke("lider:comandos"),
    estilos: (): Promise<unknown> => ipcRenderer.invoke("lider:estilos"),
    estilo: (x: unknown): Promise<unknown> => ipcRenderer.invoke("lider:estilo", x),
    cerrar: (sid: string, motivo?: string): Promise<void> => ipcRenderer.invoke("lider:cerrar", sid, motivo),
    retomar: (x: unknown): Promise<unknown> => ipcRenderer.invoke("lider:retomar", x),
    conversacion: (x: unknown): Promise<unknown> => ipcRenderer.invoke("lider:conversacion", x),
    mirar: (sid: string | null): Promise<void> => ipcRenderer.invoke("lider:mirar", sid),
    visto: (sid: string): Promise<void> => ipcRenderer.invoke("lider:visto", sid),
    traer: (x: unknown): Promise<unknown> => ipcRenderer.invoke("lider:traer", x),
    ir: (pid: number): Promise<boolean> => ipcRenderer.invoke("lider:ir", pid),
    ubicable: (pid: number): Promise<boolean> => ipcRenderer.invoke("lider:ubicable", pid),
    encolar: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:encolar", x),
    colaQuitar: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:colaQuitar", x),
    colas: (): Promise<unknown> => ipcRenderer.invoke("lider:colas"),
    colaYa: (x: unknown): Promise<void> => ipcRenderer.invoke("lider:colaYa", x),
    alCola: oir("lider:cola"),
    /** Lo que sale del stream de un líder de la app: `{ sid, e }`. */
    alEvento: oir("lider:evento"),
    /** Cambió el transcript del líder mirado (su sid). */
    alTranscript: oir("lider:transcript"),
  },
  paneles: {
    ajustes: (): Promise<unknown> => ipcRenderer.invoke("ajustes:leer"),
    umbralContexto: (): Promise<unknown> => ipcRenderer.invoke("contexto:umbral"),
    medicion: (): Promise<unknown> => ipcRenderer.invoke("medicion:leer"),
    historial: (dias: number, rol: string | null): Promise<unknown> => ipcRenderer.invoke("historial:consultar", dias, rol),
    arranqueMedido: (): Promise<unknown> => ipcRenderer.invoke("historial:arranque"),
    medirArranque: (): Promise<unknown> => ipcRenderer.invoke("historial:medir"),
    rama: (accion: string, h: unknown): Promise<unknown> => ipcRenderer.invoke("pa:rama", accion, h),
    lanzar: (x: unknown): Promise<unknown> => ipcRenderer.invoke("pa:lanzar", x),
    routing: (cambios: unknown): Promise<unknown> => ipcRenderer.invoke("routing:guardar", cambios),
    modelos: (): Promise<unknown> => ipcRenderer.invoke("modelos:leer"),
    guardarModelos: (config: unknown): Promise<unknown> => ipcRenderer.invoke("modelos:guardar", config),
    sondearOllama: (url: string): Promise<unknown> => ipcRenderer.invoke("modelos:sondear", url),
    bajarModelo: (url: string, modelo: string): Promise<unknown> => ipcRenderer.invoke("modelos:bajar", url, modelo),
    cancelarBajada: (url: string, modelo: string): Promise<void> => ipcRenderer.invoke("modelos:cancelarBajada", url, modelo),
    bajadas: (): Promise<unknown> => ipcRenderer.invoke("modelos:bajadas"),
    entornoOllama: (): Promise<unknown> => ipcRenderer.invoke("modelos:entorno"),
    alBajar: oir("modelos:bajando"),
    guardarAjustes: (cambio: unknown): Promise<unknown> => ipcRenderer.invoke("ajustes:guardar", cambio),
    remoto: (): Promise<unknown> => ipcRenderer.invoke("remoto:leer"),
    guardarRemoto: (config: unknown): Promise<unknown> => ipcRenderer.invoke("remoto:guardar", config),
    brief: (hs: unknown): Promise<unknown> => ipcRenderer.invoke("ramas:brief", hs),
    retomar: (h: unknown): Promise<unknown> => ipcRenderer.invoke("hilo:retomar", h),
    pasar: (h: unknown): Promise<string> => ipcRenderer.invoke("hilo:pasar", h),
  },
  /** Qué máquinas hay y cómo están (el ícono del líder y el "sin conexión" de la barra). */
  maquinas: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("maquinas:leer"),
    alCambiar: oir("maquinas:cambio"),
  },
  /** Los modelos que agrega `~/.config/trama/modelos.json` (Gemini, Ollama, el líder por defecto); `null` sin el archivo. */
  modelos: {
    config: (): Promise<unknown> => ipcRenderer.invoke("modelos:config"),
  },
  /** El nombre del dueño de la máquina (electron/dueno.ts). */
  dueno: {
    nombre: (): Promise<string | null> => ipcRenderer.invoke("dueno:nombre"),
  },
  /** La salud de lo integrado (B25, electron/salud.ts). */
  salud: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("salud:leer"),
    arreglar: (h: unknown): Promise<unknown> => ipcRenderer.invoke("salud:arreglar", h),
    alCambiar: oir("salud:cambio"),
  },
  /** "Integrar solo lo seguro" de Ramas (electron/autointegrar.ts). */
  auto: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("auto:leer"),
    prender: (si: boolean): Promise<void> => ipcRenderer.invoke("auto:prender", si),
    alCambiar: oir("auto:cambio"),
  },
  /** El aviso de Claude Code nuevo del pie (electron/actualizacion.ts). */
  claude: {
    version: (): Promise<unknown> => ipcRenderer.invoke("claude:version"),
    descartar: (): Promise<void> => ipcRenderer.invoke("claude:descartar"),
    actualizar: (): Promise<unknown> => ipcRenderer.invoke("claude:actualizar"),
    reiniciar: (): Promise<unknown> => ipcRenderer.invoke("claude:reiniciar"),
    changelog: (): Promise<void> => ipcRenderer.invoke("claude:changelog"),
    alCambiar: oir("claude:version"),
  },
  /** El aviso de Antigravity CLI (`agy`) nuevo del pie (electron/actualizacion-agy.ts). */
  agy: {
    version: (): Promise<unknown> => ipcRenderer.invoke("agy:version"),
    descartar: (): Promise<void> => ipcRenderer.invoke("agy:descartar"),
    actualizar: (): Promise<unknown> => ipcRenderer.invoke("agy:actualizar"),
    alCambiar: oir("agy:version"),
  },
  /** Lo que falta del setup (electron/setup.ts). */
  setup: {
    estado: (): Promise<unknown> => ipcRenderer.invoke("setup:estado"),
    descartar: (id: string): Promise<void> => ipcRenderer.invoke("setup:descartar", id),
  },
  /** Si Claude y Gemini (agy) están conectados (electron/cuentas.ts). */
  cuentas: {
    estado: (): Promise<unknown> => ipcRenderer.invoke("cuentas:estado"),
    lista: (verificar: boolean): Promise<unknown> => ipcRenderer.invoke("cuentas:lista", verificar),
    agregar: (proveedor: string, nombre: string): Promise<unknown> => ipcRenderer.invoke("cuentas:agregar", proveedor, nombre),
    renombrar: (id: string, nombre: string): Promise<unknown> => ipcRenderer.invoke("cuentas:renombrar", id, nombre),
    quitar: (id: string, borrarCredenciales: boolean): Promise<unknown> => ipcRenderer.invoke("cuentas:quitar", id, borrarCredenciales),
    login: (id: string): Promise<unknown> => ipcRenderer.invoke("cuentas:login", id),
  },
  /** Skills, agentes, plugins y servidores MCP de la carpeta de config de una cuenta de Claude (electron/extensiones.ts). */
  extensiones: {
    leer: (cuenta: string): Promise<unknown> => ipcRenderer.invoke("extensiones:leer", cuenta),
    importar: (cuenta: string): Promise<unknown> => ipcRenderer.invoke("extensiones:importar", cuenta),
  },
  /** Sólo por la tailnet (lo arma electron/remoto-cliente.ts; en la ventana no llega nunca): `false` = se cayó la conexión con la PC. */
  conexion: {
    alCambiar: oir("remoto:conexion"),
  },
  /** El tablero de pendientes (electron/tablero.ts): lo lee de `vista.json`, lo escribe el CLI `tablero`. */
  tablero: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("tablero:leer"),
    mover: (id: number, columna: string): Promise<void> => ipcRenderer.invoke("tablero:mover", id, columna),
    cerrar: (id: number): Promise<void> => ipcRenderer.invoke("tablero:cerrar", id),
    tirar: (id: number): Promise<void> => ipcRenderer.invoke("tablero:tirar", id),
    posponer: (id: number, hasta: string): Promise<void> => ipcRenderer.invoke("tablero:posponer", id, hasta),
    agregar: (texto: string, proyecto: string | null, maquina?: string): Promise<unknown> => ipcRenderer.invoke("tablero:agregar", texto, proyecto, maquina),
    responder: (id: number, r: unknown): Promise<void> => ipcRenderer.invoke("tablero:responder", id, r),
    esperan: (): Promise<unknown> => ipcRenderer.invoke("tablero:esperan"),
    /** El CLI reescribió la vista. */
    alCambiar: oir("tablero:cambio"),
  },
  /** Lo que el usuario tocó en el tablero nuevo y todavía no mandó (electron/pendientes.ts). */
  pendientes: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("pendientes:leer"),
    guardar: (x: unknown): Promise<void> => ipcRenderer.invoke("pendientes:guardar", x),
  },
  /** Quién está compactando su contexto (electron/compactando.ts): id → desde cuándo. */
  compactando: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("compactando:leer"),
    alCambiar: oir("compactando:cambio"),
  },
  /** Los subagentes de cada sesión con proceso (electron/subagentes.ts): sesión → lista, sin validar; y el informe entero de uno. */
  subagentes: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("subagentes:leer"),
    informe: (sid: string, id: string): Promise<string | null> => ipcRenderer.invoke("subagentes:informe", sid, id),
    alCambiar: oir("subagentes:cambio"),
  },
  /** Para la captura offscreen: avisa que los datos ya están pintados. */
  pintado: (): void => ipcRenderer.send("captura:pintado"),
  salir: (x: { modo: "seguir" | "parar"; forzar: boolean }): Promise<number> => ipcRenderer.invoke("app:salir", x),
  /** La bandeja del sistema (sólo la ventana de la PC): los textos de su menú ya traducidos, y el pedido de "Cerrar del todo" desde ahí. */
  bandeja: {
    textos: (t: { abrir: string; cerrar: string }): Promise<void> => ipcRenderer.invoke("bandeja:textos", t),
    alPedirSalida: oir("app:pedirSalida"),
  },
  /** "Te espera" en la pantalla de la PC (sólo la ventana): el número en la bandeja, la notificación y el toque a la notificación. */
  espera: {
    estado: (x: { n: number; texto: string }): Promise<void> => ipcRenderer.invoke("espera:estado", x),
    notificar: (x: { sid: string; titulo: string; cuerpo: string }): Promise<void> => ipcRenderer.invoke("espera:notificar", x),
    alAbrir: oir("espera:abrir"),
  },
  /** El texto del portapapeles leído por el main, por si el Ctrl+V del navegador no lo trae (sólo la ventana). */
  portapapeles: { texto: (): Promise<string> => ipcRenderer.invoke("portapapeles:texto") },
  /** El selector nativo de carpetas (el campo "Carpeta" de un líder nuevo); sólo la ventana de la PC. */
  carpeta: { elegir: (): Promise<string | null> => ipcRenderer.invoke("carpeta:elegir") },
  /** Vuelve a cargar la ventana (el cartel de error); sólo en la ventana de la PC. */
  recargar: (): Promise<void> => ipcRenderer.invoke("app:recargar"),
  /** Un error del renderer, al log del main (electron/log.ts). */
  bitacora: (x: { donde: string; detalle: string }): Promise<void> => ipcRenderer.invoke("bitacora:escribir", x),
  /** El cartel "Hay una actualización disponible" (un build de trama más nuevo que el que corre). */
  /** "PC apagada · Prender" (sólo con una PC configurada en maquinas.json: el Dell). */
  pc: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("pc:leer"),
    prender: (): Promise<unknown> => ipcRenderer.invoke("pc:prender"),
    alCambiar: oir("pc:cambio"),
  },
  reinicio: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("reinicio:leer"),
    pedir: (igual?: boolean): Promise<void> => ipcRenderer.invoke("reinicio:pedir", igual === true),
    cancelar: (): Promise<void> => ipcRenderer.invoke("reinicio:cancelar"),
    marca: (paso: string): Promise<void> => ipcRenderer.invoke("reinicio:marca", paso),
    alCambiar: oir("reinicio:cambio"),
  },
  /** Volver como estaba tras ese reinicio: lo que la ventana tenía abierto y escrito. */
  volver: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("volver:leer"),
    guardar: (vista: unknown): Promise<void> => ipcRenderer.invoke("volver:guardar", vista),
    alPedir: oir("volver:pedir"),
    anotar: (vista: unknown): Promise<void> => ipcRenderer.invoke("volver:anotar", vista),
  },
  /** Lo escrito sin mandar, en disco (electron/borradores.ts): lo de la vez anterior, y la foto entera con cada cambio. */
  borradores: {
    leer: (): Promise<unknown> => ipcRenderer.invoke("borradores:leer"),
    guardar: (foto: unknown): Promise<void> => ipcRenderer.invoke("borradores:guardar", foto),
  },
  /** Controles de ventana en Windows (minimizar, maximizar, cerrar). */
  ventana: {
    minimizar: (): Promise<void> => ipcRenderer.invoke("ventana:minimizar"),
    maximizar: (): Promise<boolean> => ipcRenderer.invoke("ventana:maximizar"),
    cerrar: (): Promise<void> => ipcRenderer.invoke("ventana:cerrar"),
    esMaximizada: (): Promise<boolean> => ipcRenderer.invoke("ventana:esMaximizada"),
  },
});
