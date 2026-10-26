// Qué ofrece el menú del clic derecho de la barra (B20) según la fila y su
// estado. Puro: lo prueba `tests/menu.test.ts`; lo dibuja `Menu.tsx`.
import { cerrable, cerrado, type Estado, type Hilo, type Lider } from "../datos/contrato.ts";

export type Accion =
  | "renombrar"
  | "mover"
  | "settle"
  | "parar"
  | "copiar"
  | "borrar"
  | "descartar"
  | "nueva"
  | "ocultar"
  | "mostrar"
  | "subir"
  | "bajar"
  | "defecto"
  | "prioridad";

/** Una opción del menú. `confirmar`: el primer Enter/clic sólo pregunta (en el mismo ítem); `peligro`: en rojo. */
export type Opcion = { a: Accion; confirmar?: boolean; peligro?: boolean };

/**
 * Lo que se puede hacer con el orden a mano desde el menú (el celular y el teclado no arrastran):
 * subir y bajar un lugar si hay adónde, y volver al orden por defecto si hay algo puesto a mano.
 */
export type LugarMenu = { sube: boolean; baja: boolean; defecto: boolean; prioridad?: boolean };

/** Con el orden por prioridad prendido no hay lugar que mover a mano: sólo la salida (`prioridad` lo apaga). */
const delOrden = (l?: LugarMenu): Opcion[] =>
  l?.prioridad
    ? [{ a: "prioridad" }]
    : [
        ...(l?.sube ? [{ a: "subir" } as const] : []),
        ...(l?.baja ? [{ a: "bajar" } as const] : []),
        ...(l?.defecto ? [{ a: "defecto" } as const] : []),
        ...(l ? [{ a: "prioridad" } as const] : []),
      ];

/**
 * Un worker: renombrar y copiar el id siempre; Settle si tiene uno propio
 * (`settleWorker`); Parar si corre; Borrar (`pa --archivar`) si terminó; y
 * Descartar si además dejó una rama con commits (confirma, como en Ramas).
 */
export function accionesWorker(h: Pick<Hilo, "rama" | "commits">, estado: Estado, settle: boolean): Opcion[] {
  const fin = cerrable(estado) && !cerrado(estado);
  return [
    { a: "renombrar" },
    ...(settle ? [{ a: "settle" } as const] : []),
    ...(estado === "trabajando" || estado === "colgado" ? [{ a: "parar" } as const] : []),
    { a: "copiar" },
    ...(fin ? [{ a: "borrar" } as const] : []),
    ...(fin && h.rama && h.commits > 0 ? [{ a: "descartar", confirmar: true, peligro: true } as const] : []),
  ];
}

/**
 * Un líder: renombrar, moverlo de carpeta y copiar el id siempre; Settle si
 * está quieto (`settleDe`: confirma si deja ramas sin integrar o si es de la app, que además se cierra). Parar y
 * Borrar sólo a uno de la app: a uno de la terminal no se le escribe. Borrar
 * lo corta si responde y lo saca de la lista: siempre confirma.
 */
export function accionesLider(l: Pick<Lider, "origen" | "ocupado">, settle: number | null, lugar?: LugarMenu): Opcion[] {
  const app = l.origen === "app";
  return [
    { a: "renombrar" },
    { a: "mover" },
    ...delOrden(lugar),
    ...(settle !== null ? [{ a: "settle", confirmar: settle > 0 || app } as const] : []),
    ...(app && l.ocupado ? [{ a: "parar" } as const] : []),
    { a: "copiar" },
    ...(app ? [{ a: "borrar", confirmar: true, peligro: true } as const] : []),
  ];
}

/** Una carpeta: un líder nuevo que ya nace en ella, esconder (o volver a mostrar) sus workers terminados y su lugar en el orden. */
export const accionesCarpeta = (oculta: boolean, lugar?: LugarMenu): Opcion[] => [{ a: "nueva" }, { a: oculta ? "mostrar" : "ocultar" }, ...delOrden(lugar)];
