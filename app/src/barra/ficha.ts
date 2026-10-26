// Lo que dice una fila de worker además del título: con qué modelo corre
// (el nombre corto de la familia) y dónde (el ícono de la máquina), con la ficha
// entera en el tooltip. Sin React: lo prueban los tests.
import type { Hilo } from "../datos/contrato.ts";
import { t } from "../i18n/index.ts";

export type Familia = "opus" | "sonnet" | "fable" | "haiku" | "otro";

const FAMILIAS: Exclude<Familia, "otro">[] = ["opus", "sonnet", "fable", "haiku"];

/** "claude-sonnet-5-5[1m]" → "sonnet". Lo que no es de la casa (un local, etc.), "otro". */
export const familiaDe = (modelo: string | null | undefined): Familia =>
  FAMILIAS.find((f) => modelo?.toLowerCase().includes(f)) ?? "otro";

/** El nombre corto de cada familia: va en la fila tal cual (nada de letras sueltas que no se entienden). */
export const CORTO: Record<Exclude<Familia, "otro">, string> = { opus: "Opus", sonnet: "Sonnet", fable: "Fable", haiku: "Haiku" };

/**
 * Lo que dice el chip del modelo en la fila: el nombre de la familia o, si no
 * es de la casa, la primera palabra del id ("modelo-local-ejemplo" → "Modelo"). `null`
 * sin modelo: no hay chip.
 */
export function modeloCorto(modelo: string | null | undefined): string | null {
  const f = familiaDe(modelo);
  if (f !== "otro") return CORTO[f];
  const p = modelo?.trim().split(/[-_:/\s.[]/).find(Boolean);
  return p ? p[0].toUpperCase() + p.slice(1, 10) : null;
}

/**
 * Dónde corre un worker. Hoy todo es "local" (esta máquina); "nube" queda
 * listo para cuando `pa` lance corridas remotas.
 */
export type Lugar = "local" | "nube";

export const lugarDe = (_h: Hilo): Lugar => "local";

/** El tooltip de la fila: proyecto, máquina, rama y modelo completo, un dato por renglón. */
export function ficha(h: Hilo, maquina: string | null, ruta?: string | null): string {
  const lugar = lugarDe(h);
  const donde = lugar === "nube" ? t("ficha.nube") : maquina ? t("ficha.localEn", { maquina }) : t("ficha.local");
  return [
    t("ficha.proyecto", { v: h.proyecto }),
    ...(ruta ? [t("ficha.ruta", { v: ruta })] : []),
    t("ficha.maquina", { v: donde }),
    t("ficha.rama", { v: h.rama ?? t("comun.sinRama") }),
    t("ficha.modelo", { v: `${h.modelo || t("comun.sinDato")}${h.effort ? ` · ${h.effort}` : ""}` }),
  ].join("\n");
}
