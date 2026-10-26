// Lo que dice una fila de worker además del título: con qué modelo corre
// (el nombre corto de la familia) y dónde (el ícono de la máquina), con la ficha
// entera en el tooltip. Sin React: lo prueban los tests.
import type { Hilo } from "../datos/contrato.ts";
import { t } from "../i18n/index.ts";
import { parsearModelo } from "../datos/modelo-id.ts";

export type Familia = "opus" | "sonnet" | "fable" | "haiku" | "google" | "otro";

/**
 * "claude-sonnet-5-5[1m]" → "sonnet". Manda el proveedor (src/datos/modelo-id.ts): todo lo que sirve Google
 * ("gemini-3.8-flash-high", "agy:claude-opus-5-5-high") es "google", nunca "opus". Lo demás (un local, etc.), "otro".
 */
export const familiaDe = (modelo: string | null | undefined): Familia => {
  const p = parsearModelo(modelo);
  if (p.proveedor === "google") return "google";
  return p.proveedor === "anthropic" && p.linea !== "otro" && p.linea !== "gemini" ? p.linea : "otro";
};

/** El nombre corto de cada familia: va en la fila tal cual (nada de letras sueltas que no se entienden). */
export const CORTO: Record<Exclude<Familia, "otro">, string> = { opus: "Opus", sonnet: "Sonnet", fable: "Fable", haiku: "Haiku", google: "Google" };

/**
 * Lo que dice el chip del modelo en la fila: el nombre de la familia o, si no
 * es de la casa, la primera palabra del id ("modelo-local-ejemplo" → "Modelo"). Lo que sirve Google
 * lo dice: "Gemini", o "Opus · Google" para un Claude que pasa por ahí. `null` sin modelo: no hay chip.
 */
export function modeloCorto(modelo: string | null | undefined): string | null {
  const p = parsearModelo(modelo);
  if (p.proveedor === "google") {
    if (p.linea === "gemini") return "Gemini";
    const base = p.linea === "otro" ? (p.nombre.split(" ")[0] || "Google") : CORTO[p.linea];
    return `${base} · Google`;
  }
  const f = familiaDe(modelo);
  if (f !== "otro") return CORTO[f];
  const x = modelo?.trim().split(/[-_:/\s.[]/).find(Boolean);
  return x ? x[0].toUpperCase() + x.slice(1, 10) : null;
}

/**
 * Dónde corre un worker. Hoy todo es "local" (esta máquina); "nube" queda
 * listo para cuando `pa` lance corridas remotas.
 */
export type Lugar = "local" | "nube";

export const lugarDe = (_h: Hilo): Lugar => "local";

/** El tooltip de la fila: proyecto, máquina, rama y modelo completo, un dato por renglón. */
export function ficha(h: Hilo, maquina: string | null): string {
  const lugar = lugarDe(h);
  const donde = lugar === "nube" ? t("ficha.nube") : maquina ? t("ficha.localEn", { maquina }) : t("ficha.local");
  return [
    t("ficha.proyecto", { v: h.proyecto }),
    t("ficha.maquina", { v: donde }),
    t("ficha.rama", { v: h.rama ?? t("comun.sinRama") }),
    t("ficha.modelo", { v: `${h.modelo || t("comun.sinDato")}${h.effort ? ` · ${h.effort}` : ""}` }),
  ].join("\n");
}
