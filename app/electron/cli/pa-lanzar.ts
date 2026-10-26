// Lanzar un worker (`pa <proyecto> "<tarea>"`, `--leer`, `--async`, `--aca`): lo implementa la tarea 6.
import type { CtxPa } from "./contexto.ts";
import type { OpcionesProyecto } from "./args.ts";

export async function lanzar(_ctx: CtxPa, _opciones: OpcionesProyecto): Promise<number> {
  throw new Error("no implementado todavia");
}
