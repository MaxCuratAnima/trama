// El parser de argumentos de `pa`, igual al de `motor/bin/pa`: primero los comandos globales (`pa --estado`, `pa --hilos`…,
// que miran sólo el primer argumento) y después `pa <proyecto> [opciones] "<tarea>"`. Puro: no toca el disco ni el entorno
// (lo que el pa original saca de variables llega por parámetro).

export const COMANDOS_GLOBALES = [
  "--estado", "--plan", "--esperar", "--esperar-todos", "--bien", "--bien-auto", "--rinde", "--cupo-gemini", "--modelos",
  "--gemini-proyectos", "--revertir", "--parar", "--archivar", "--hilos", "--hilo", "--descartar", "--traspaso", "--limpiar", "--nota",
] as const;
export type ComandoGlobal = (typeof COMANDOS_GLOBALES)[number];

export type OpcionesProyecto = {
  proyecto: string;
  tarea: string;
  modelo: string;
  esfuerzo: string;
  esfuerzoFlag: boolean;
  seguir: boolean;
  leer: boolean;
  olvidar: boolean;
  matar: boolean;
  mcp: boolean;
  async: boolean;
  /** `--sin-jefe`: vacía PA_JEFE y PA_JEFE_ID. */
  sinJefe: boolean;
  /** Tope de turnos como texto; "" = sin tope (`--max-turns 0`). */
  maxTurns: string;
  maxBudget: string;
  id: string;
  sucioMio: boolean;
  aca: boolean;
  integrar: string;
  tests: boolean;
  descartar: string;
  actualizar: string;
  ramas: boolean;
  force: boolean;
  tipo: string;
  /** `--cuenta <id>`: la cuenta de la suscripción con la que corre el worker ("" = la de siempre). */
  cuenta: string;
  /** `--archivo-tarea <ruta>` (o `-` = stdin): la tarea sale de ese archivo, entera y con sus saltos de línea. pa.ts la lee y la pone en `tarea`. */
  archivoTarea: string;
  okDueno: boolean;
  /** Las `--nota` pegadas a la llamada, en orden. */
  notas: string[];
};

export type Parseado =
  | { clase: "ayuda" }
  | { clase: "global"; comando: ComandoGlobal; args: string[] }
  | { clase: "proyecto"; opciones: OpcionesProyecto }
  | { clase: "error"; codigo: number; mensaje: string };

export type EntornoArgs = {
  /** `pa_plan` ya resuelto: cambia el tope de turnos por default (pro 100, max 150). */
  plan?: "pro" | "max";
  /** `PA_EFFORT`, `PA_TIPO`. */
  env?: Record<string, string | undefined>;
  /** `nombre_dueno` y `$USER`: para el alias `--ok-<nombre en minúscula>` del flag `--ok-dueno`. */
  nombreDueno?: string;
  usuario?: string;
};

const USO_GENERAL = 'uso: pa <proyecto> "<tarea>"  |  pa --estado  |  pa --esperar <proyecto>';
const error = (mensaje: string, codigo = 2): Parseado => ({ clase: "error", codigo, mensaje });

/** Opciones que llevan un valor y el campo donde van. */
const CON_VALOR: Record<string, string> = {
  "--max-turns": "maxTurns", "--id": "id", "--integrar": "integrar", "--descartar": "descartar", "--actualizar": "actualizar",
  "--nota": "nota", "--max-budget-usd": "maxBudget", "-m": "modelo", "--model": "modelo", "--effort": "esfuerzo", "--tipo": "tipo", "--cuenta": "cuenta",
  "--archivo-tarea": "archivoTarea",
};

export function parsearArgs(argv: readonly string[], ent: EntornoArgs = {}): Parseado {
  const env = ent.env ?? {};
  const primero = argv[0] ?? "";
  if (primero === "-h" || primero === "--help" || primero === "--ayuda") return { clase: "ayuda" };
  if ((COMANDOS_GLOBALES as readonly string[]).includes(primero)) {
    const args = argv.slice(1);
    if (primero === "--nota" && !args[0]) return error(`uso: pa --nota "<texto>"  (pedido de ${ent.nombreDueno || "el usuario"}, decisión, qué sigue)`);
    return { clase: "global", comando: primero as ComandoGlobal, args };
  }
  if (argv.length < 1) return error(USO_GENERAL);

  const o: OpcionesProyecto = {
    proyecto: argv[0], tarea: "", modelo: "", esfuerzo: env.PA_EFFORT ?? "", esfuerzoFlag: false, seguir: false, leer: false,
    olvidar: false, matar: false, mcp: false, async: false, sinJefe: false, maxTurns: ent.plan === "max" ? "150" : ent.plan === "pro" ? "100" : "150",
    maxBudget: "", id: "", sucioMio: false, aca: false, integrar: "", tests: false, descartar: "", actualizar: "", ramas: false,
    force: false, tipo: env.PA_TIPO ?? "", cuenta: "", archivoTarea: "", okDueno: false, notas: [],
  };
  const dueno = (ent.nombreDueno ?? "").toLowerCase();
  const a = argv.slice(1);
  for (let i = 0; i < a.length; ) {
    const x = a[i];
    switch (x) {
      case "--seguir": o.seguir = true; i++; continue;
      case "--nuevo": i++; continue; // ya es el default; se acepta para no romper scripts viejos
      case "--leer": o.leer = true; i++; continue;
      case "--olvidar": o.olvidar = true; i++; continue;
      case "--matar": o.matar = true; i++; continue;
      case "--mcp": o.mcp = true; i++; continue;
      case "--async": o.async = true; i++; continue;
      case "--sin-jefe": o.sinJefe = true; i++; continue;
      case "--sucio-mio": o.sucioMio = true; o.aca = true; i++; continue;
      case "--aca": o.aca = true; i++; continue;
      case "--tests": o.tests = true; i++; continue;
      case "--ramas": o.ramas = true; i++; continue;
      case "--force": o.force = true; i++; continue;
      case "--ok-dueno": o.okDueno = true; i++; continue;
      case "--":
        o.tarea = a.slice(i + 1).join(" ");
        i = a.length;
        continue;
    }
    if (Object.hasOwn(CON_VALOR, x)) {
      if (i + 1 >= a.length) return error(`pa: ${x} necesita un valor.`);
      const v = a[i + 1];
      switch (CON_VALOR[x]) {
        case "maxTurns": o.maxTurns = v === "0" ? "" : v; break;
        case "nota": o.notas.push(v); break;
        case "esfuerzo": o.esfuerzo = v; o.esfuerzoFlag = true; break;
        default: (o as unknown as Record<string, string>)[CON_VALOR[x]] = v;
      }
      i += 2;
      continue;
    }
    if (x.startsWith("-")) {
      // alias: --ok-<nombre del dueño en minúscula> (el nombre viejo del flag)
      if ((dueno && x === `--ok-${dueno}`) || (ent.usuario && x === `--ok-${ent.usuario}`)) {
        o.okDueno = true;
        i++;
        continue;
      }
      return error(`pa: opción desconocida: ${x}`);
    }
    o.tarea = a.slice(i).join(" ");
    break;
  }
  if (o.tests && !o.integrar) return error("pa: --tests va con --integrar: pa <proy> --integrar <id> --tests");
  return { clase: "proyecto", opciones: o };
}
