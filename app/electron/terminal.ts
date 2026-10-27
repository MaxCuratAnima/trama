// "Ir a la ventana" de un líder abierto en una terminal. En Windows no hay forma de ubicar la ventana de un
// proceso: `ubicar` da `null` y la vista no ofrece el botón. Quedan las dos funciones porque las llaman
// lider.ts y ventana-canales.ts.

/** Dónde está la ventana del proceso `pid`: nunca se la puede ubicar. */
export async function ubicar(_pid: number): Promise<null> {
  return null;
}

/** Lleva el foco a la ventana del proceso `pid`. `false`: no se la pudo ubicar. */
export async function irA(_pid: number): Promise<boolean> {
  return false;
}
