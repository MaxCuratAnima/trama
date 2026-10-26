// El puente `window.carcasa` de la carcasa de Windows vieja (WSL, ya borrada). El preload nativo no lo expone: `carcasa()` da `null` y Ajustes no muestra
// Cuentas ni el botón de conectar. Con `HILOS_VARIANTE=cuentas` (captura) se finge una, con Claude conectado y Gemini sin conectar.
import { MODO } from "./modo";

export type Cuenta = { instalado: boolean; logueado: boolean; cuenta?: string | null; error?: string | null };
export type CuentasOk = { claude: Cuenta; agy: Cuenta };
export type Cuentas = CuentasOk | { error: string };
export type Proveedor = "claude" | "gemini";

type Carcasa = {
  /** Qué cuentas están conectadas ahora (`trama-estado` en Ubuntu). */
  cuentas(): Promise<Cuentas>;
  /** Abre una consola de Ubuntu con el CLI del proveedor para iniciar sesión. */
  conectar(proveedor: Proveedor): Promise<{ error?: string } | undefined>;
};

const FALSA: Carcasa = {
  cuentas: async () => ({ claude: { instalado: true, logueado: true }, agy: { instalado: true, logueado: false } }),
  conectar: async () => ({}),
};

export function carcasa(): Carcasa | null {
  if ((MODO.variante ?? "").startsWith("cuentas")) return FALSA;
  const c = (window as unknown as { carcasa?: Partial<Carcasa> }).carcasa;
  return c && typeof c.cuentas === "function" && typeof c.conectar === "function" ? (c as Carcasa) : null;
}
