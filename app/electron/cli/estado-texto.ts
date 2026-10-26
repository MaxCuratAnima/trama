// `pa --estado`: qué corre ahora (CORRIENDO / HUÉRFANO), qué espera puesto (EN COLA / MURIÓ), las sesiones guardadas, el límite
// de sesión y el plan. Port de `cmd_estado` de `motor/bin/pa`. Diferencia a propósito: la línea de RAM no mide `MemAvailable`
// (no hay en Windows) y el tope cuenta los `.running` vivos, no los flocks de lugares.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { CtxPa } from "./contexto.ts";
import { leerCampo, leerTexto, planDe } from "./estado-archivos.ts";

export function transcurrido(seg: number): string {
  if (seg < 60) return `${seg}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)}m${String(seg % 60).padStart(2, "0")}s`;
  return `${Math.floor(seg / 3600)}h${String(Math.floor((seg % 3600) / 60)).padStart(2, "0")}m`;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const fechaHora = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

const ls = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};
const esArchivo = (ruta: string) => {
  try {
    return statSync(ruta).isFile();
  } catch {
    return false;
  }
};

export async function topeDe(ctx: CtxPa): Promise<number> {
  let t = ctx.env.PA_TOPE ?? "";
  if (!t) t = ((await leerTexto(path.join(ctx.estado, "tope"))) ?? "").split("\n")[0].replace(/\s/g, "");
  return /^[1-9][0-9]*$/.test(t || "10") ? Number(t || "10") : 10;
}

export async function cmdEstado(ctx: CtxPa): Promise<number> {
  const lineas: string[] = [];
  let hubo = false;
  let vivos = 0;
  const e = ctx.estado;
  for (const n of ls(e).filter((x) => x.endsWith(".running"))) {
    const f = path.join(e, n);
    if (!esArchivo(f)) continue;
    hubo = true;
    const slug = await leerCampo(f, "proyecto");
    const pid = (await leerCampo(f, "pid")) || (await leerCampo(f, "pa_pid"));
    const leer = (await leerCampo(f, "leer")) === "1";
    if (pid && ctx.existePid(Number(pid))) {
      vivos++;
      const hb = f.replace(/\.running$/, ".heartbeat");
      let l = `CORRIENDO  ${slug.padEnd(20)} hace ${transcurrido(ctx.ahora() - Number((await leerCampo(f, "inicio")) || 0))}`;
      if (leer) l += `  · lectura (id: ${await leerCampo(f, "id")})`;
      else {
        const pst = await leerCampo(f, "puesto");
        l += `  · ${pst === "aca" ? "tree principal" : `puesto ${pst || 1}`} (id: ${await leerCampo(f, "id")})`;
      }
      if (esArchivo(hb)) {
        l += `  · ${(await leerCampo(hb, "envuelo")) === "1" ? "en" : "último"} ${await leerCampo(hb, "tool")} hace ${transcurrido(ctx.ahora() - Number((await leerCampo(hb, "epoch")) || 0))}`;
      }
      lineas.push(l);
    } else {
      lineas.push(`HUÉRFANO   ${slug.padEnd(20)} (el claude murió; se limpia solo en el próximo pa${leer ? " --leer" : ""}, o: rm ${f})`);
    }
  }
  // Corridas --async encoladas: tienen `$id.pid` pero todavía no `.puesto`/`.corrida`.
  for (const slug of ls(e)) {
    if (slug === "worktrees" || slug === "lock") continue;
    const dslug = path.join(e, slug);
    for (const n of ls(dslug).filter((x) => x.endsWith(".pid"))) {
      const tsid = n.slice(0, -4);
      const tiene = (ext: string) => esArchivo(path.join(dslug, `${tsid}.${ext}`));
      if (tiene("puesto") || tiene("corrida") || tiene("listo") || tiene("entregado")) continue;
      const pid = ((await leerTexto(path.join(dslug, n))) ?? "").trim();
      const vive = !!pid && ctx.existePid(Number(pid));
      const cola = ((await leerTexto(path.join(dslug, `${tsid}.cola`))) ?? "").replace(/\n+$/, "");
      if (tiene("leer")) {
        if (vive) {
          if (esArchivo(path.join(e, `${slug}.leer-${tsid}.running`)) || !tiene("cola")) continue;
          hubo = true;
          lineas.push(`EN COLA    ${slug.padEnd(20)} (--leer id: ${tsid}, ${cola})`);
          continue;
        }
        hubo = true;
        lineas.push(`MURIÓ      ${slug.padEnd(20)} (--leer id: ${tsid}, murió antes de arrancar; mirá ${path.join(dslug, `${tsid}.log`)})`);
        continue;
      }
      hubo = true;
      lineas.push(
        vive
          ? `EN COLA    ${slug.padEnd(20)} (id: ${tsid}, ${cola || "esperando un puesto libre"})`
          : `MURIÓ EN COLA ${slug.padEnd(17)} (id: ${tsid}, nunca tomó puesto; mirá ${path.join(dslug, `${tsid}.log`)})`,
      );
    }
  }
  if (!hubo) lineas.push("no hay workers corriendo.");

  const tope = await topeDe(ctx);
  lineas.push("", `RAM        no se mide en esta versión · ${vivos} vivos de ${tope} (tope)`);
  lineas.push(vivos >= tope ? `           un worker nuevo haría cola: tope global (${tope} vivos)` : "           un worker nuevo entra ahora.");

  lineas.push("");
  let hayS = false;
  for (const n of ls(e).filter((x) => x.endsWith(".session"))) {
    const f = path.join(e, n);
    hayS = true;
    lineas.push(`sesión     ${n.slice(0, -8).padEnd(20)} ${((await leerTexto(f)) ?? "").replace(/\n+$/, "")}  (guardada ${fechaHora(statSync(f).mtimeMs)})`);
  }
  if (!hayS) lineas.push("no hay sesiones guardadas.");

  const limite = Number(((await leerTexto(path.join(e, "limite.hasta"))) ?? "").trim());
  if (limite > ctx.ahora()) {
    const d = new Date(limite * 1000);
    lineas.push("", `LÍMITE de sesión hasta las ${p2(d.getHours())}:${p2(d.getMinutes())}: los workers no van a arrancar hasta entonces.`);
  }
  const { plan } = await planDe(e, ctx.env);
  lineas.push(
    "",
    plan === "pro" ? "plan pro (modo ahorro): opus con effort medium por default, tope 100 turnos, sin subagentes, resultado por --esperar." : "plan max.",
  );
  ctx.out(lineas.join("\n") + "\n");
  return 0;
}
