// El socket local del motor (electron/motor.ts): `$XDG_RUNTIME_DIR/trama/motor.sock`, en una carpeta
// 0700 de este usuario. Los mismos pedidos y eventos que trama por red (`crearCanal`, remoto.ts), sin
// los chequeos de Host, Origin ni Tailscale: llegar al socket ya dice que es esta máquina y este usuario.
// Nunca TCP (ni loopback): cualquier proceso de la máquina podría conectarse.
// El socket es también el candado: si conectar anda, ya hay un motor y el nuevo no arranca.
// Sin `electron`: lo prueba tests/local.test.ts.
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { inicioDeProcesoSync } from "./procesos.js";
import { crearCanal, negar, type OpcionesCanal } from "./remoto.js";

/** Algo estable de este usuario para el nombre de la carpeta: el uid; en Windows `uid` es -1 y se usa el nombre. */
function idUsuario(): string {
  const u = os.userInfo();
  if (process.platform !== "win32" && u.uid >= 0) return String(u.uid);
  return u.username.replace(/[^A-Za-z0-9._-]/g, "_") || "usuario";
}

/**
 * La carpeta del socket: la de `XDG_RUNTIME_DIR` (de este usuario, se borra al apagar); sin ella, una en el tmp.
 * `HILOS_LOCAL` la cambia (las pruebas: el motor y la ventana de prueba no ven al motor del usuario).
 */
export function carpetaLocal(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HILOS_LOCAL) return env.HILOS_LOCAL;
  const base = env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `trama-${idUsuario()}`);
  return path.join(base, "trama");
}
export const socketDe = (carpeta: string) => path.join(carpeta, "motor.sock");

/** La carpeta, 0700 y de este usuario; si es de otro o es un enlace, no se usa. */
export function prepararCarpeta(carpeta: string) {
  mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  const st = lstatSync(carpeta);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`${carpeta} no es una carpeta`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`${carpeta} es de otro usuario`);
  if ((st.mode & 0o777) !== 0o700) chmodSync(carpeta, 0o700);
}

/** ¿Hay alguien escuchando en ese socket? Un archivo que quedó de un motor que murió no contesta. */
export function hayMotor(sock: string, ms = 1000): Promise<boolean> {
  return new Promise((ok) => {
    const c = net.connect(sock);
    const fin = (si: boolean) => {
      clearTimeout(t);
      c.destroy();
      ok(si);
    };
    // Un socket que acepta y no contesta igual es de alguien: mejor no pisarlo.
    const t = setTimeout(() => fin(true), ms);
    c.once("connect", () => fin(true));
    c.once("error", () => fin(false));
  });
}

/** El arranque de un proceso (procesos.ts): con el pid, dice que es éste y no otro que reusó el número. */
export const arranqueDe = (pid: number): string | null => inicioDeProcesoSync(pid);

/**
 * ¿Hay un motor de verdad? `dueno` (`$HILOS_STATE/dueno`, lo escribe motor.ts) nombra un proceso vivo (el
 * mismo pid y el mismo arranque) y el socket contesta. Sin las dos cosas, la ventana corre todo en uno:
 * un socket de otro `HILOS_STATE` (la trama del usuario, vista desde una prueba) no cuenta.
 */
export async function motorVivo(dueno: string, sock: string): Promise<boolean> {
  let j: { version?: unknown; pid?: unknown; procStart?: unknown };
  try {
    j = JSON.parse(readFileSync(dueno, "utf8"));
  } catch {
    return false;
  }
  if (j?.version !== 1 || typeof j.pid !== "number" || !Number.isInteger(j.pid) || j.pid <= 0) return false;
  const arranque = arranqueDe(j.pid);
  if (arranque === null || (j.procStart !== null && j.procStart !== arranque)) return false;
  return hayMotor(sock);
}

export type Local = {
  ruta: string;
  difundir(canal: string, dato: unknown): void;
  cerrar(): Promise<void>;
};

/**
 * Abre el socket. `null`: ya hay un motor escuchando (quien llama sale con 3). Si quedó el archivo de
 * uno que murió (SIGKILL no lo borra), se lo quita y se escucha.
 */
export async function abrirLocal(o: Omit<OpcionesCanal, "conOrigen"> & { carpeta?: string }): Promise<Local | null> {
  const carpeta = o.carpeta ?? carpetaLocal();
  prepararCarpeta(carpeta);
  const ruta = socketDe(carpeta);
  const canal = crearCanal({ ...o, conOrigen: false });
  const servidor = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://motor");
    } catch {
      return negar(res, 400);
    }
    if (url.pathname === "/rpc") return void canal.rpc(req, res).catch(() => negar(res, 500));
    if (url.pathname === "/eventos" && req.method === "GET") return canal.eventos(req, res, url);
    negar(res, 404);
  });
  const escuchar = () =>
    new Promise<void>((ok, mal) => {
      servidor.once("error", mal);
      servidor.listen(ruta, () => {
        servidor.off("error", mal);
        ok();
      });
    });
  try {
    await escuchar();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    if (await hayMotor(ruta)) return null;
    rmSync(ruta, { force: true });
    await escuchar();
  }
  // La carpeta ya es 0700; el socket, por las dudas, también sólo del dueño.
  chmodSync(ruta, 0o600);
  return {
    ruta,
    difundir: canal.difundir,
    // Los `write` de http quedan "corked" hasta el próximo tick: sin esta pausa, lo último que se difundió (el "saliendo"
    // del cartel del build nuevo) se perdía al cerrar las conexiones, y la ventana no se enteraba de que el motor se iba.
    cerrar: async () => {
      await new Promise((ok) => setTimeout(ok, 50));
      await new Promise<void>((ok) => {
        servidor.close(() => ok());
        servidor.closeAllConnections();
        rmSync(ruta, { force: true });
      });
    },
  };
}
