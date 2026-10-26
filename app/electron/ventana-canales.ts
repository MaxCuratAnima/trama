// Los canales que son de la pantalla de la PC y se resuelven en el proceso de la ventana, sea todo en uno
// (ipc.ts) o cliente del motor (ventana-cliente.ts): salir y recargar, volver como estaba, ir a la ventana
// de un líder, abrir el changelog y los íconos achicados con `nativeImage`. Sin el núcleo: en modo cliente
// la ventana no lo carga.
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, shell } from "electron";
import { CHANGELOG } from "./actualizacion.js";
import { pedidoDeSalida } from "./cierre.js";
import { iconosDe } from "./iconos.js";
import { log } from "./log.js";
import { textoDelPortapapeles } from "./portapapeles.js";
import { marcar } from "./reinicio-marcas.js";
import { registro } from "./registro.js";
import { irA, ubicar } from "./terminal.js";
import { textosValidos, type Textos } from "./bandeja.js";
import { anunciar, avisoValido, estadoValido, type AvisoEspera, type EstadoEspera } from "./espera-aviso.js";

let recargarVentana: () => void = () => {};
/** Lo que hace "Recargar" del cartel de error (src/ErrorBoundary.ts): main.ts vuelve a cargar la ventana. */
export function ponerRecarga(fn: () => void) {
  recargarVentana = fn;
}

export const ventanas = () => BrowserWindow.getAllWindows();
export const ocultar = () => {
  for (const v of ventanas()) v.hide();
};

/** Cuánto se espera a que la ventana diga qué tenía abierto y escrito antes de reiniciar. */
const VISTA_MS = 1500;
/** Lo que cada vista tenía al reiniciar la trama anterior (electron/volver.ts): se entrega una vez. */
let vistasDeAntes: Record<string, unknown> = {};
export function ponerVistas(v: Record<string, unknown>) {
  vistasDeAntes = v;
}
let alGuardarVista: ((vista: unknown) => void) | null = null;
/** Quien mantiene `volver.json` al día (main.ts): la ventana le avisa con cada cambio de lo que tiene abierto. */
let alAnotarVista: ((vista: unknown) => void) | null = null;
export function ponerAnotadorDeVista(fn: (vista: unknown) => void) {
  alAnotarVista = fn;
}
/** Le pide a la ventana lo que hay que devolverle al volver. `null` si no contesta a tiempo. */
export function pedirVista(): Promise<unknown> {
  return new Promise((ok) => {
    const t = setTimeout(() => fin(null), VISTA_MS);
    const fin = (v: unknown) => {
      clearTimeout(t);
      alGuardarVista = null;
      ok(v);
    };
    alGuardarVista = fin;
    for (const v of ventanas()) v.webContents.send("volver:pedir", null);
  });
}

/** Los logos de las carpetas: archivos locales, achicados acá (36 px alcanzan para 18 px a 2×). */
export async function iconosVentana() {
  return iconosDe(await registro(), (crudo) => {
    const img = nativeImage.createFromBuffer(crudo);
    return img.isEmpty() ? null : img.resize({ width: 36, height: 36, quality: "best" }).toDataURL();
  });
}

/** Quien tiene la bandeja (main.ts): el renderer le manda los textos del menú ya traducidos. */
let alTextosBandeja: ((t: Textos) => void) | null = null;
export function ponerTextosBandeja(fn: (t: Textos) => void) {
  alTextosBandeja = fn;
}

/** Quien tiene la bandeja: cuántos líderes esperan al usuario (el tooltip y el punto del ícono). */
let alEstadoEspera: ((e: EstadoEspera) => void) | null = null;
/** Lo último que dijo la ventana: la bandeja se arma después de la primera lectura. */
let ultimoEstadoEspera: EstadoEspera | null = null;
export function ponerEstadoEspera(fn: (e: EstadoEspera) => void) {
  alEstadoEspera = fn;
  if (ultimoEstadoEspera) fn(ultimoEstadoEspera);
}

/** Las notificaciones vivas: sin una referencia el recolector las suelta antes de que se toquen. */
const avisos = new Set<Notification>();
/** La notificación de "te espera": al tocarla vuelve la ventana y el renderer abre esa conversación. Sin sonido. */
function mostrarAviso(a: AvisoEspera) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: a.titulo, body: a.cuerpo, silent: true });
  avisos.add(n);
  const soltar = () => void avisos.delete(n);
  n.on("close", soltar);
  n.on("failed", soltar);
  n.on("click", () => {
    soltar();
    const v = ventanas()[0];
    if (!v || v.isDestroyed()) return;
    v.show();
    v.focus();
    v.webContents.send("espera:abrir", a.sid);
  });
  n.show();
}

/** Le pide a la ventana la pregunta de cómo cerrar (el diálogo de Cerrar del todo): la bandeja la trae a la vista y la dispara. */
export function pedirSalida() {
  for (const v of ventanas()) v.webContents.send("app:pedirSalida", null);
}

/**
 * Anota en el IPC los canales que son sólo de la ventana; `salir` es Cerrar del todo (Ctrl+Q, la bandeja) con lo que
 * eligió el usuario en el diálogo: devuelve cuántos líderes responden (y no hizo nada), o 0 y el proceso se va.
 */
export function armarCanalesVentana(salir: (x: { modo: "seguir" | "parar"; forzar: boolean }) => Promise<number>) {
  ipcMain.handle("ventana:minimizar", (e) => {
    const v = BrowserWindow.fromWebContents(e.sender);
    v?.minimize();
  });
  ipcMain.handle("ventana:maximizar", (e) => {
    const v = BrowserWindow.fromWebContents(e.sender);
    if (!v) return false;
    if (v.isMaximized()) {
      v.unmaximize();
      return false;
    } else {
      v.maximize();
      return true;
    }
  });
  ipcMain.handle("ventana:cerrar", (e) => {
    const v = BrowserWindow.fromWebContents(e.sender);
    v?.close();
  });
  ipcMain.handle("ventana:esMaximizada", (e) => {
    const v = BrowserWindow.fromWebContents(e.sender);
    return v?.isMaximized() ?? false;
  });
  ipcMain.handle("app:salir", (_e, x: unknown) => salir(pedidoDeSalida(x)));
  ipcMain.handle("bandeja:textos", (_e, x: unknown) => {
    const t = textosValidos(x);
    if (t) alTextosBandeja?.(t);
  });
  ipcMain.handle("espera:estado", (_e, x: unknown) => {
    const e = estadoValido(x);
    if (!e) return;
    ultimoEstadoEspera = e;
    alEstadoEspera?.(e);
  });
  ipcMain.handle("espera:notificar", (_e, x: unknown) => {
    const a = avisoValido(x);
    if (a) anunciar(a, mostrarAviso);
  });
  // Respaldo del Ctrl+V de la caja cuando el navegador no recibe el texto (electron/portapapeles.ts).
  ipcMain.handle("portapapeles:texto", () =>
    textoDelPortapapeles(clipboard, (tipos) => log.escribir("aviso", "portapapeles", `sin texto; tipos: ${tipos.join(", ") || "ninguno"}`)),
  );
  // El selector nativo de carpetas del campo "Carpeta" de un líder nuevo: la ruta elegida o `null` si se canceló. Por la tailnet no existe (se escribe la ruta).
  ipcMain.handle("carpeta:elegir", async (e) => {
    const v = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const r = await (v ? dialog.showOpenDialog(v, { properties: ["openDirectory"] }) : dialog.showOpenDialog({ properties: ["openDirectory"] }));
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle("app:recargar", () => recargarVentana());
  // Volver como estaba: sólo la ventana pasa por acá (el navegador se guarda lo suyo, src/volver.ts).
  ipcMain.handle("volver:leer", () => {
    const v = vistasDeAntes.ventana ?? null;
    delete vistasDeAntes.ventana;
    return v;
  });
  ipcMain.handle("volver:guardar", (_e, vista: unknown) => void alGuardarVista?.(vista));
  // Una marca del reinicio que anota la página (electron/reinicio-marcas.ts): sin reinicio en marcha no hace nada.
  ipcMain.handle("reinicio:marca", (_e, paso: unknown) => void (typeof paso === "string" && /^[a-z-]{1,30}$/.test(paso) && marcar("pagina", paso)));
  ipcMain.handle("volver:anotar", (_e, vista: unknown) => void alAnotarVista?.(vista));
  // "Ir a la ventana" de un líder de la terminal (electron/terminal.ts), y si se la puede ubicar.
  ipcMain.handle("lider:ir", (_e, pid: number) => irA(Number(pid)));
  ipcMain.handle("lider:ubicable", async (_e, pid: number) => (await ubicar(Number(pid))) !== null);
  // La URL es fija: el frontend no elige qué se abre.
  ipcMain.handle("claude:changelog", () => shell.openExternal(CHANGELOG));
}
