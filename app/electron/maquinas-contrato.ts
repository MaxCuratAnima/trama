// El contrato entre motores de trama en dos máquinas (docs/estado/maquinas.md): qué se hace con cada canal y
// cada evento, y el saludo con el que se reconocen. Sin estado ni efectos: lo usan nucleo.ts, quien junta
// (maquinas.ts) y el transporte (maquina-cliente.ts), y lo prueba tests/nucleo.test.ts.
import { createHash } from "node:crypto";

/**
 * Trama en dos máquinas (docs/estado/maquinas.md): qué hace con cada canal la trama que junta a las otras.
 * "juntar": se le pide a cada máquina y se unen las respuestas (cada fila con su `maquina`).
 * "maquina": va sólo al motor de la máquina de la fila (el `maquina` del hilo o del líder, o el prefijo del id).
 * "local": lo contesta esta máquina sola (sus preferencias, su pantalla, su estado propio).
 * Todo canal que se pide (núcleo, ventana, preload) tiene que estar acá: lo comprueba tests/nucleo.test.ts.
 * Sin otra máquina configurada nadie mira esto: todo es local, como siempre.
 */
export type Ruta = "juntar" | "maquina" | "local";
export const RUTAS: Readonly<Record<string, Ruta>> = {
  // Lo que se ve en la barra: las filas de las dos máquinas.
  "statusline:leer": "juntar",
  "hilos:leer": "juntar",
  "hilos:completa": "juntar",
  "hilos:guardados": "juntar",
  "compactando:leer": "juntar",
  "subagentes:leer": "local",
  "subagentes:informe": "local",
  "lider:colas": "juntar",
  "tablero:leer": "juntar",
  "tablero:esperan": "juntar",
  // Lo que se le hace a una fila: a su máquina.
  "lider:nuevo": "maquina",
  "lider:mandar": "maquina",
  "lider:archivo": "maquina",
  "lider:parar": "maquina",
  "lider:modo": "maquina",
  "lider:permiso": "maquina",
  "lider:pendientes": "maquina",
  "lider:estilo": "maquina",
  "lider:cerrar": "maquina",
  "lider:retomar": "maquina",
  "lider:conversacion": "maquina",
  "lider:mirar": "maquina",
  "lider:visto": "maquina",
  "lider:traer": "maquina",
  "lider:encolar": "maquina",
  "lider:colaQuitar": "maquina",
  "lider:colaYa": "maquina",
  "lider:inyectar": "maquina",
  "pa:cerrar": "maquina",
  "pa:hilo": "maquina",
  "pa:parar": "maquina",
  "pa:rama": "maquina",
  "pa:lanzar": "maquina",
  "ramas:brief": "maquina",
  "hilo:retomar": "maquina",
  "hilo:pasar": "maquina",
  "salud:arreglar": "maquina",
  "tablero:responder": "maquina",
  "tablero:mover": "maquina",
  "tablero:cerrar": "maquina",
  "tablero:tirar": "maquina",
  "tablero:posponer": "maquina",
  "tablero:agregar": "maquina",
  // De esta máquina: el uso es de la misma cuenta, el consumo y el historial no se juntan.
  "maquina:saludo": "local",
  // Qué máquinas hay y cómo están, para el ícono y el "sin conexión" de la barra (M3): lo que ve esta trama.
  "maquinas:leer": "local",
  // Los modelos que agrega modelos.json (Gemini, Ollama, el líder por defecto): el archivo es de esta máquina.
  "modelos:config": "local",
  // El nombre del dueño sale del perfil de esta máquina.
  "dueno:nombre": "local",
  "statusline:sincronizar": "local",
  "salud:leer": "local",
  "auto:leer": "local",
  "auto:prender": "local",
  // Ajustes y el acceso del celular: el plan, la red de seguridad y remoto.json son de esta máquina.
  "ajustes:leer": "local",
  "ajustes:guardar": "local",
  "remoto:leer": "local",
  "remoto:guardar": "local",
  "contexto:umbral": "local",
  "medicion:leer": "local",
  "historial:consultar": "local",
  "historial:arranque": "local",
  "historial:medir": "local",
  "routing:guardar": "local",
  // La config de modelos (`~/.config/trama/modelos.json`) es de esta máquina, como el resto de Ajustes.
  "modelos:leer": "local",
  "modelos:guardar": "local",
  "modelos:sondear": "local",
  "modelos:bajar": "local",
  "modelos:cancelarBajada": "local",
  "modelos:bajadas": "local",
  "modelos:entorno": "local",
  "leidos:leer": "local",
  "leidos:marcar": "local",
  "nombres:leer": "local",
  "nombres:titulo": "local",
  "nombres:proyecto": "local",
  "nombres:oculto": "local",
  "nombres:orden": "local",
  "proyectos:carpetas": "local",
  "proyectos:nombres": "local",
  "proyectos:titulos": "local",
  "proyectos:iconos": "local",
  "preferencias:leer": "local",
  "preferencias:effort": "local",
  "preferencias:idioma": "local",
  "preferencias:apariencia": "local",
  "preferencias:tiernos": "local",
  "preferencias:avisarEspera": "local",
  "preferencias:vista": "local",
  "preferencias:consumo": "local",
  "preferencias:bienvenidaPendiente": "local",
  "preferencias:bienvenida": "local",
  "consumo:mirar": "local",
  "consumo:soltar": "local",
  // Los pasos de un worker, de su transcript: el de esta máquina (el de otra se pediría a su motor, todavía no).
  "pasos:mirar": "local",
  "pasos:soltar": "local",
  // Dictar: Handy y el micrófono de quien pide; el audio se transcribe en el motor al que está conectada la ventana.
  "dictado:transcribir": "local",
  "dictado:modelos": "local",
  "dictado:elegirModelo": "local",
  // Los modelos locales son los de la GPU de esta máquina (cada motor la suya): nunca se juntan ni se enrutan.
  "locales:leer": "local",
  "locales:guardar": "local",
  "locales:probar": "local",
  "vram:leer": "local",
  "vram:liberar": "local",
  "lider:comandos": "local",
  "lider:estilos": "local",
  "bitacora:escribir": "local",
  // La PC que el Dell prende (electron/pc-estado.ts): del Dell solo, nunca se junta ni se enruta.
  "pc:leer": "local",
  "pc:prender": "local",
  "reinicio:leer": "local",
  "reinicio:pedir": "local",
  "reinicio:cancelar": "local",
  "borradores:leer": "local",
  "borradores:guardar": "local",
  "pendientes:leer": "local",
  "pendientes:guardar": "local",
  "claude:version": "local",
  "claude:descartar": "local",
  "claude:actualizar": "local",
  "claude:reiniciar": "local",
  "agy:version": "local",
  "agy:descartar": "local",
  "agy:actualizar": "local",
  "setup:estado": "local",
  "cuentas:estado": "local",
  "cuentas:lista": "local",
  "cuentas:agregar": "local",
  "cuentas:renombrar": "local",
  "cuentas:quitar": "local",
  "cuentas:login": "local",
  "setup:descartar": "local",
  // La pantalla de la PC (ventana-canales.ts, bench.ts): no existen en un motor sin ventana.
  "app:salir": "local",
  "app:pararTodo": "local",
  "bandeja:textos": "local",
  "espera:estado": "local",
  "espera:notificar": "local",
  "portapapeles:texto": "local",
  "carpeta:elegir": "local",
  "app:recargar": "local",
  "volver:leer": "local",
  "volver:guardar": "local",
  "volver:anotar": "local",
  "reinicio:marca": "local",
  "lider:ir": "local",
  "lider:ubicable": "local",
  "claude:changelog": "local",
  "bench:modo": "local",
  "bench:listo": "local",
  "bench:cpu": "local",
  "bench:fin": "local",
};

/**
 * Lo que se difunde (`enviar`): "reenviar" sale también del motor de la otra máquina hacia quien junta,
 * con su `maquina`; "local" es de esta máquina sola. Lo comprueba tests/nucleo.test.ts contra el código.
 */
export const EVENTOS: Readonly<Record<string, "reenviar" | "local">> = {
  "hilos:cambio": "reenviar",
  "eventos:pa": "reenviar",
  "eventos:ids": "reenviar",
  "statusline:cambio": "reenviar",
  "compactando:cambio": "reenviar",
  "subagentes:cambio": "local",
  "lider:evento": "reenviar",
  "lider:transcript": "reenviar",
  "lider:cola": "reenviar",
  "tablero:cambio": "reenviar",
  "maquinas:cambio": "local",
  "auto:cambio": "local",
  "salud:cambio": "local",
  "claude:version": "local",
  "agy:version": "local",
  "consumo:cambio": "local",
  "pasos:cambio": "local",
  "modelos:bajando": "local",
  "nombres:orden": "local",
  "reinicio:cambio": "local",
  "pc:cambio": "local",
};

/**
 * La versión del contrato entre motores: subirla al cambiar la forma de un canal que se junta o se enruta.
 * Además el saludo lleva la huella de las tablas: si alguien agrega o mueve un canal sin subirla, igual se nota.
 */
export const PROTOCOLO = 2;
export type Saludo = { version: number; protocolo: number; huella: string; maquina: string };
/** El canal del saludo: la primera pregunta de quien junta a otra máquina. */
export const CANAL_SALUDO = "maquina:saludo";
/** Qué se le puede hacer a otra máquina según su saludo (`compatible`). */
export type Acceso = "si" | "leer" | "no";
/** 12 hex del sha256 de las dos tablas: va en el saludo. */
export const HUELLA = createHash("sha256")
  .update(JSON.stringify([Object.entries(RUTAS).sort(), Object.entries(EVENTOS).sort()]))
  .digest("hex")
  .slice(0, 12);
/**
 * Qué se puede con la otra máquina según su saludo: "si", todo; "leer", sólo mirarla (otro build: sus filas
 * se ven pero nada se le manda); "no", no es un motor de trama o no se entiende lo que dice.
 */
export function compatible(otro: unknown): Acceso {
  const o = otro as Partial<Saludo> | null;
  if (!o || typeof o !== "object" || o.version !== 1 || typeof o.protocolo !== "number" || typeof o.huella !== "string") return "no";
  return o.protocolo === PROTOCOLO && o.huella === HUELLA ? "si" : "leer";
}
