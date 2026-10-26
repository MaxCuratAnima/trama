// trama-motor — el motor de Trama (dist-electron/motor.js) sin ventana (port de motor/bin/trama-motor; sin systemd: suelto).
//
//   trama-motor [run]                 en primer plano
//   trama-motor start|stop|restart    lo lanza suelto (pid en <PA_STATE>/trama-motor.pid, log en trama-motor.log) / lo baja
//   trama-motor status                trama-estado en palabras
//   trama-motor logs                  el log, siguiéndolo (Ctrl+C para salir)
//
// Dónde está el motor: `TRAMA_MOTOR_JS`, si no `motor.js` junto a la carpeta cli/ compilada. Node puro (o el exe de Electron con
// ELECTRON_RUN_AS_NODE=1). TRAMA_LOCAL=1 = el motor escucha en 127.0.0.1:8791.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, watchFile, writeFileSync, createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { caminos, dirEstadoPa, entornoConLocal, type Env, type Plataforma } from "../plataforma.ts";
import { grupoPropio, matarArbol } from "../procesos.ts";
import { enPalabras, estado } from "./trama-estado.ts";

export type Entorno = { plataforma: Plataforma; env: Env; home: string };
const aqui = (): Entorno => ({ plataforma: process.platform, env: process.env as Env, home: os.homedir() });

export const rutaMotor = ({ env }: Entorno, cli = path.dirname(fileURLToPath(import.meta.url))) => env.TRAMA_MOTOR_JS || path.join(cli, "..", "motor.js");
export const rutaPid = (e: Entorno) => caminos(e.plataforma).join(dirEstadoPa(e.plataforma, e.env, e.home), "trama-motor.pid");
export const rutaLog = (e: Entorno) => caminos(e.plataforma).join(dirEstadoPa(e.plataforma, e.env, e.home), "trama-motor.log");

/** El entorno del motor: el de quien lo lanza, con `~/.local/bin` en el PATH y los tres avisos que lo ponen en modo producto. */
export function entornoMotor(e: Entorno): Env {
  const env = entornoConLocal(e.plataforma, e.env, e.home);
  return { ...env, HILOS_MOTOR: "1", TRAMA_UNIDAD: "1", TRAMA_LOCAL: "1", ELECTRON_RUN_AS_NODE: "1" };
}

export function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** El pid anotado si ese proceso sigue vivo; si el archivo quedó de un motor que ya no está, lo borra. */
export function pidVivo(e: Entorno): number | null {
  const f = rutaPid(e);
  try {
    const pid = Number.parseInt(readFileSync(f, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 1 && vivo(pid)) return pid;
  } catch {
    return null;
  }
  rmSync(f, { force: true });
  return null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lanzar(e: Entorno, stdio: "inherit" | number): ReturnType<typeof spawn> | null {
  const js = rutaMotor(e);
  if (!existsSync(js)) {
    console.error(`trama-motor: no encuentro ${js} (compilá la app: npm run build, o definí TRAMA_MOTOR_JS)`);
    return null;
  }
  const suelto = stdio !== "inherit";
  return spawn(process.execPath, [js], {
    env: entornoMotor(e) as NodeJS.ProcessEnv,
    stdio: suelto ? ["ignore", stdio, stdio] : "inherit",
    ...(suelto ? grupoPropio(e.plataforma) : { windowsHide: true }),
  });
}

export async function iniciar(e: Entorno): Promise<number> {
  const ya = pidVivo(e);
  if (ya) {
    console.log(`trama-motor: ya corre (${ya})`);
    return 0;
  }
  mkdirSync(path.dirname(rutaPid(e)), { recursive: true });
  const log = openSync(rutaLog(e), "w");
  const hijo = lanzar(e, log);
  closeSync(log);
  if (!hijo || !hijo.pid) return 2;
  hijo.unref();
  writeFileSync(rutaPid(e), `${hijo.pid}\n`);
  console.log(`trama-motor: lanzado suelto, pid ${hijo.pid}; log en ${rutaLog(e)}`);
  return 0;
}

export async function detener(e: Entorno): Promise<number> {
  const pid = pidVivo(e);
  if (!pid) return 0;
  matarArbol(pid, false);
  for (let i = 0; i < 40 && vivo(pid); i++) await dormir(250);
  if (vivo(pid)) {
    matarArbol(pid, true);
    for (let i = 0; i < 20 && vivo(pid); i++) await dormir(250);
  }
  rmSync(rutaPid(e), { force: true });
  console.log("trama-motor: detenido");
  return 0;
}

/** Las últimas líneas del log y después lo que se vaya sumando. */
function seguirLog(e: Entorno): Promise<number> {
  const f = rutaLog(e);
  if (!existsSync(f)) {
    console.error(`trama-motor: todavía no hay log (${f})`);
    return Promise.resolve(1);
  }
  const lineas = readFileSync(f, "utf8").split("\n");
  process.stdout.write(lineas.slice(-41).join("\n"));
  let leido = statSync(f).size;
  watchFile(f, { interval: 500 }, (act) => {
    if (act.size < leido) leido = 0;
    if (act.size > leido) createReadStream(f, { start: leido, end: act.size - 1 }).pipe(process.stdout, { end: false });
    leido = act.size;
  });
  return new Promise(() => {});
}

export async function main(args: string[], e: Entorno = aqui()): Promise<number> {
  switch (args[0] ?? "run") {
    case "run": {
      const hijo = lanzar(e, "inherit");
      if (!hijo) return 2;
      const salir = () => void matarArbol(hijo.pid, false);
      process.on("SIGINT", salir);
      process.on("SIGTERM", salir);
      return new Promise((r) => hijo.on("exit", (rc) => r(rc ?? 1)));
    }
    case "start":
      return iniciar(e);
    case "stop":
      return detener(e);
    case "restart":
      await detener(e);
      await dormir(1000);
      return iniciar(e);
    case "status":
      process.stdout.write(enPalabras(await estado(e)));
      return 0;
    case "logs":
      return seguirLog(e);
    default:
      console.error("uso: trama-motor [run|start|stop|restart|status|logs]");
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
