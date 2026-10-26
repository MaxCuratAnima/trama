// `pa` en TypeScript: el despacho. Hoy resuelve `--estado`, `--hilos`, `--hilo`, `--parar`, `--plan`, `--modelos`, `--descartar` y `--archivar`, y `pa <proyecto> --integrar|--descartar <id>`; el resto
// (lanzar un worker, `--esperar`) lo traen pa-lanzar.ts y pa-esperar.ts. Salidas y códigos iguales a `motor/bin/pa`.
import { pathToFileURL } from "node:url";
import { parsearArgs } from "./args.ts";
import { contextoReal, type CtxPa } from "./contexto.ts";
import { escribirAtomico, planDe } from "./estado-archivos.ts";
import { cmdEstado } from "./estado-texto.ts";
import { cmdHilo } from "./hilo-mensajes.ts";
import { calcularHilos, hilosEnJson, hilosEnTsv } from "./hilos.ts";
import { cmdParar, type DepsParar } from "./parar.ts";
import { esperar, esperarTodos } from "./pa-esperar.ts";
import { cmdArchivar, cmdDescartar, gestionDeProyecto } from "./pa-integrar.ts";
import { lanzar } from "./pa-lanzar.ts";
import { cmdRinde } from "./medicion.ts";
import { AYUDA } from "./pa-ayuda.ts";
import { cmdModelos } from "./pa-modelos.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * La tarea de `--archivo-tarea <ruta>` (`-` = stdin), sin BOM ni salto final. Existe porque cmd.exe corta la línea de comandos en el
 * primer salto de línea: una tarea de varias líneas pasada por `pa.cmd` llega sólo hasta ahí (y pierde lo que sigue). Por archivo llega entera.
 */
export function tareaDeArchivo(ruta: string): string {
  const txt = readFileSync(ruta === "-" ? 0 : ruta, "utf8");
  return txt.replace(/^\uFEFF/, "").replace(/(\r?\n)+$/, "");
}

const modeloLocal = (env: CtxPa["env"]) =>
  env.CLAUDE_LOCAL === "1" || /^([a-zA-Z]+:\/\/)?(localhost|127\.[0-9.]+|\[::1\]|::1)([:/]|$)/.test(env.ANTHROPIC_BASE_URL ?? "");

async function cmdPlan(ctx: CtxPa, arg: string | undefined): Promise<number> {
  const { plan } = await planDe(ctx.estado, ctx.env);
  if (!arg) return ctx.out(`plan: ${plan}\n`), 0;
  const nuevo = arg.toLowerCase();
  if (nuevo !== "pro" && nuevo !== "max") return ctx.err("uso: pa --plan [pro|max]\n"), 2;
  const ruta = path.join(ctx.estado, "plan");
  await escribirAtomico(ruta, nuevo + "\n");
  ctx.out(
    `pa: plan ${nuevo} guardado en ${ruta}` +
      (nuevo === "pro" ? " (modo ahorro: tope 100 turnos, sin subagentes; opus, si se pide con -m, con effort medium)." : " (tope 150 turnos; opus con el effort de settings).") + "\n",
  );
  const pa = ctx.env.PA_PLAN;
  if (pa && pa.toLowerCase() !== nuevo) ctx.err(`pa: ojo, PA_PLAN=${pa} en este entorno le gana al archivo.\n`);
  return 0;
}

function cmdHilos(ctx: CtxPa, args: string[]): number {
  let json = false;
  let todo = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (a === "--todo") todo = true;
    else return ctx.err("uso: pa --hilos [--json] [--todo]\n"), 2;
  }
  const s = calcularHilos(ctx, { todo });
  ctx.out(json ? hilosEnJson(s) : hilosEnTsv(s));
  return 0;
}

/** Corre `pa` con esos argumentos y devuelve el código de salida. `ctx` y `deps` se inyectan en los tests. */
export async function main(argv: string[], ctx: CtxPa = contextoReal(), deps?: DepsParar): Promise<number> {
  const env = ctx.env;
  if (env.PA_WORKER) return ctx.err("pa: sos un worker delegado, no podés delegar de nuevo. Hacé la tarea vos.\n"), 1;
  const p = argv[0] ?? "";
  if (modeloLocal(env)) {
    const pasa = ["--estado", "--hilos", "--hilo", "--modelos", "-h", "--help", "--ayuda"].includes(p) ||
      (p === "--plan" && !argv[1]) || (argv.length === 2 && argv[1] === "--ramas");
    if (!pasa) {
      ctx.err(`pa: esta sesión corre contra un modelo LOCAL (CLAUDE_LOCAL=${env.CLAUDE_LOCAL ?? ""} ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL ?? ""}); no delego. La GPU no entra dos modelos locales a la vez, y el worker heredaría el BASE_URL local o pediría otro modelo. Delegá desde una sesión normal de claude. (Pasan sólo pa --estado, pa --plan, pa --hilos/--hilo, pa <proy> --ramas.)\n`);
      return 88;
    }
  }
  const { plan } = await planDe(ctx.estado, env);
  const r = parsearArgs(argv, { plan, env, nombreDueno: env.TRAMA_DUENO, usuario: env.USER });
  if (r.clase === "error") return ctx.err(r.mensaje + "\n"), r.codigo;
  if (r.clase === "ayuda") return ctx.out(AYUDA), 0;
  if (r.clase === "proyecto") {
    if (r.opciones.archivoTarea) {
      try {
        r.opciones.tarea = tareaDeArchivo(r.opciones.archivoTarea);
      } catch (e) {
        return ctx.err(`pa: no pude leer --archivo-tarea ${r.opciones.archivoTarea}: ${(e as Error).message}\n`), 2;
      }
    }
    const g = await gestionDeProyecto(ctx, r.opciones);
    return g ?? lanzar(ctx, r.opciones);
  }
  switch (r.comando) {
    case "--estado": return cmdEstado(ctx);
    case "--plan": return cmdPlan(ctx, r.args[0]);
    case "--hilos": return cmdHilos(ctx, r.args);
    case "--hilo": return cmdHilo(ctx, r.args);
    case "--parar": return cmdParar(ctx, r.args, deps);
    case "--descartar": return cmdDescartar(ctx, r.args);
    case "--archivar": return cmdArchivar(ctx, r.args);
    case "--modelos": return cmdModelos(ctx, r.args);
    case "--rinde": return cmdRinde(ctx, r.args);
    case "--esperar": return esperar(ctx, r.args);
    case "--esperar-todos": return esperarTodos(ctx, r.args);
    default: throw new Error("no implementado todavia");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (rc) => process.exit(rc),
    (e: Error) => {
      process.stderr.write(`pa: ${e.message}\n`);
      process.exit(1);
    },
  );
}
