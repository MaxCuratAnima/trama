// El nombre del dueño de la máquina, para los prompts de los líderes y los textos que lo nombran. Nunca un literal en el código.
// Contrato: `TRAMA_DUENO` (env) → `dueno` de `~/.config/trama/perfil.json` (`{"version":1,"dueno":"…"}`) → `$USER` con la
// primera en mayúscula → "el usuario". Se lee cada vez (un archivo chico): editar el perfil vale sin reiniciar.
import fs from "node:fs";
import os from "node:os";
import { rutaPerfil } from "./plataforma.ts";

export const PERFIL_JSON = () => rutaPerfil(process.platform, process.env, os.homedir());

const limpio = (x: unknown): string => (typeof x === "string" ? x.replace(/[\r\n`]+/g, " ").trim().slice(0, 40) : "");

function delPerfil(): string {
  try {
    const o = JSON.parse(fs.readFileSync(PERFIL_JSON(), "utf8")) as { version?: unknown; dueno?: unknown };
    return o && o.version === 1 ? limpio(o.dueno) : "";
  } catch {
    return "";
  }
}

function delUsuario(): string {
  let u = limpio(process.env.USER);
  if (!u) {
    try {
      u = limpio(os.userInfo().username);
    } catch {
      u = "";
    }
  }
  return u.charAt(0).toUpperCase() + u.slice(1);
}

/** El nombre del dueño, o null si no hay forma de saberlo (los helpers dicen entonces "el usuario"). */
export function nombreDueno(): string | null {
  return limpio(process.env.TRAMA_DUENO) || delPerfil() || delUsuario() || null;
}

/** "Ana" / "el usuario": para dentro de una frase. */
export const dueno = (): string => nombreDueno() ?? "el usuario";
/** Igual, para empezar una frase: "Ana" / "El usuario". */
export const Dueno = (): string => {
  const d = dueno();
  return d.charAt(0).toUpperCase() + d.slice(1);
};
/** "a Ana" / "al usuario". */
export const aDueno = (): string => (nombreDueno() ? `a ${dueno()}` : "al usuario");
/** "de Ana" / "del usuario". */
export const deDueno = (): string => (nombreDueno() ? `de ${dueno()}` : "del usuario");
