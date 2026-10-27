// Lo que los comandos de `pa` necesitan de afuera (dónde está el estado, la hora, git, qué pid vive), en un solo objeto
// inyectable: los tests arman uno con carpetas temporales y relojes fijos; `contextoReal()` es el de verdad.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirEstadoPa, rutaRegistry, type Env, type Plataforma } from "../plataforma.ts";
import { slugDe } from "./estado-archivos.ts";
import { resolver } from "./proyecto-ruta.ts";

export type CtxPa = {
  /** `PA_STATE`: `%LOCALAPPDATA%\Trama\state\pa`. */
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
  /** En Windows no hay zombis: siempre `false`. */
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
 * Slug de carpeta → ruta del tree principal, el nombre del primer
 * proyecto cuya carpeta (en minúscula) se llama así, y después `resolver` de `proyecto-ruta.ts` con ese nombre.
 */
export function rutaPorSlug(slug: string, env: Env, plataforma: Plataforma, home: string): string | null {
  try {
    const reg = JSON.parse(readFileSync(rutaRegistry(plataforma, env, home), "utf8")) as { projects?: { name?: string; path?: string }[] };
    const p = (reg.projects ?? []).find((x) => x.path && slugDe(x.path) === slug);
    if (!p?.name) return null;
    const r = resolver([p.name], env, plataforma, home);
    return r.codigo === 0 ? r.out.replace(/\n$/, "") : null;
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
    esZombi: () => false,
    rutaDeSlug: (slug) => rutaPorSlug(slug, env, plataforma, home),
    ramasPa: (ruta, slug) =>
      (git(ruta, ["for-each-ref", "--format=%(refname:short)", `refs/heads/pa/${slug}/`]) ?? "").split("\n").filter(Boolean),
    commitsSobre: (ruta, rama) => (git(ruta, ["rev-list", "--count", `HEAD..${rama}`]) ?? "").trim(),
    out: (s) => void process.stdout.write(s),
    err: (s) => void process.stderr.write(s),
  };
}
