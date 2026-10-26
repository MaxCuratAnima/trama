// Lo que los comandos de `pa` necesitan de afuera (dónde está el estado, la hora, git, qué pid vive), en un solo objeto
// inyectable: los tests arman uno con carpetas temporales y relojes fijos; `contextoReal()` es el de verdad.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deStat, esWindows } from "../procesos.ts";
import { dirEstadoPa, rutaRegistry, type Env } from "../plataforma.ts";
import { slugDe } from "./estado-archivos.ts";

export type CtxPa = {
  /** `PA_STATE`: `~/.local/state/pa` · `%LOCALAPPDATA%\Trama\state\pa`. */
  estado: string;
  /** `PA_PROJ`: `~/.claude/projects` (los transcripts de Claude). */
  proyectos: string;
  env: Env;
  home: string;
  plataforma: NodeJS.Platform;
  /** Epoch en segundos. */
  ahora: () => number;
  /** Segundos de diferencia con UTC de la hora local (`date +%z`). */
  offsetSeg: () => number;
  /** `kill -0`: ¿existe ese pid? */
  existePid: (pid: number) => boolean;
  /** Un zombi contesta `kill -0` y no es un vivo. */
  esZombi: (pid: number) => boolean;
  /** La ruta del tree principal del proyecto con ese slug (registry), o `null`. */
  rutaDeSlug: (slug: string) => string | null;
  /** Las ramas `pa/<slug>/*` del repo. */
  ramasPa: (ruta: string, slug: string) => string[];
  /** `git rev-list --count HEAD..<rama>` ("" si falla). */
  commitsSobre: (ruta: string, rama: string) => string;
  /** Salida. */
  out: (s: string) => void;
  err: (s: string) => void;
};

const git = (ruta: string, args: string[]): string | null => {
  try {
    return execFileSync("git", ["-C", ruta, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 15000 });
  } catch {
    return null;
  }
};

/**
 * Registry de proyectos → ruta del tree principal, igual que `nombre_registry` + `proyecto-ruta` del bash para un slug:
 * el nombre del primer proyecto cuya carpeta (en minúscula) se llama así, su ruta con `~` expandido, la carpeta si
 * apunta a un archivo, y la ruta real. (Cuando exista `cli/proyecto-ruta.ts`, esto se apoya en él.)
 */
export function rutaPorSlug(slug: string, registry: string, home: string): string | null {
  try {
    const reg = JSON.parse(readFileSync(registry, "utf8")) as { projects?: { name?: string; path?: string }[] };
    const p = (reg.projects ?? []).find((x) => x.path && slugDe(x.path) === slug);
    if (!p?.path) return null;
    let r = p.path.replace(/^~(?=$|[\\/])/, home);
    if (statSync(r).isFile()) r = path.dirname(r);
    r = realpathSync(r);
    return statSync(r).isDirectory() ? r : null;
  } catch {
    return null;
  }
}

export function contextoReal(env: Env = process.env as Env, plataforma: NodeJS.Platform = process.platform): CtxPa {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return {
    estado: dirEstadoPa(plataforma, env, home),
    proyectos: env.PA_PROJ ?? path.join(home, ".claude", "projects"),
    env,
    home,
    plataforma,
    ahora: () => Math.floor(Date.now() / 1000),
    offsetSeg: () => -new Date().getTimezoneOffset() * 60,
    existePid: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    esZombi: (pid) => {
      if (esWindows(plataforma)) return false;
      try {
        return deStat(readFileSync(`/proc/${pid}/stat`, "utf8")).estado.startsWith("Z");
      } catch {
        return false;
      }
    },
    rutaDeSlug: (slug) => rutaPorSlug(slug, rutaRegistry(plataforma, env, home), home),
    ramasPa: (ruta, slug) =>
      (git(ruta, ["for-each-ref", "--format=%(refname:short)", `refs/heads/pa/${slug}/`]) ?? "").split("\n").filter(Boolean),
    commitsSobre: (ruta, rama) => (git(ruta, ["rev-list", "--count", `HEAD..${rama}`]) ?? "").trim(),
    out: (s) => void process.stdout.write(s),
    err: (s) => void process.stderr.write(s),
  };
}
