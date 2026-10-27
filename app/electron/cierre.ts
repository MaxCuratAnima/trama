// Cerrar trama sin Electron (para probarlo con fakes): qué pasa al cerrar la ventana, qué hace cada opción de
// "Cerrar del todo" (Ctrl+Q y la bandeja) y cómo se va el proceso. main.ts, ipc.ts y ventana-cliente.ts lo cablean.

/** Las dos salidas del diálogo "¿Cerrar Trama y dejar que los workers sigan?". */
export type Modo = "seguir" | "parar";
export const esModo = (x: unknown): x is Modo => x === "seguir" || x === "parar";

/** Lo que llega por `app:salir`: `{ modo, forzar }`; cualquier otra cosa es una salida normal sin forzar. */
export function pedidoDeSalida(x: unknown): { modo: Modo; forzar: boolean } {
  const o = (x && typeof x === "object" ? x : {}) as { modo?: unknown; forzar?: unknown };
  return { modo: esModo(o.modo) ? o.modo : "seguir", forzar: o.forzar === true };
}

/** El `close` de la ventana (el ✕, Alt+F4): sólo se esconde; trama sigue viva. Si ya se está saliendo, no se interpone. */
export function esconderAlCerrar(ventana: { hide(): void }, saliendo: () => boolean) {
  return (e: { preventDefault(): void }) => {
    if (saliendo()) return;
    e.preventDefault();
    ventana.hide();
  };
}

/**
 * "Cerrar del todo" con la opción elegida. `hacer` es lo del núcleo (todo en uno) o lo que le pide la ventana al motor: devuelve
 * cuántos líderes siguen respondiendo (y no se tocó nada) o 0. Con 0 se va el proceso; si no, la pregunta lo muestra y se vuelve a pedir `forzar`.
 */
export async function cerrarDelTodo(x: { modo: Modo; forzar: boolean }, d: { hacer(modo: Modo, forzar: boolean): Promise<number>; irse(): void }): Promise<number> {
  const n = await d.hacer(x.modo, x.forzar);
  if (n === 0) d.irse();
  return n;
}

/** La bandeja (o cualquier otro pedido de afuera) pregunta cómo cerrar: la ventana se trae a la vista y se le manda la pregunta. */
export function preguntarSalida(d: { mostrar(): void; preguntar(): void }) {
  d.mostrar();
  d.preguntar();
}
