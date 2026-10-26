// "Ir a la ventana" de un líder abierto en una terminal: dónde está su ventana y cómo
// llevar el foco ahí.
//
// kitty corre en instancia única (`kitty -1`): todas sus ventanas del sistema comparten un
// pid, así que "la ventana de ese pid" no dice cuál es. Lo que sí lo dice es el entorno del
// `claude`: `KITTY_WINDOW_ID` (la ventana de kitty, que vive en una pestaña) y
// `KITTY_LISTEN_ON` (el socket de control remoto). Con eso kitty cambia a esa pestaña
// (`kitten @ focus-window`), y para saber cuál de las ventanas del sistema es se le pone un
// título de marca un instante y se la busca en `hyprctl clients`.
// El entorno se hereda y puede mentir (un tmux arrancado en otra ventana): sólo vale si el
// proceso cuelga de esa ventana de kitty.
// Sin kitty (otra terminal, una por proceso): se sube por el ppid hasta un pid con una sola
// ventana. Si no se la puede ubicar, `ubicar` da `null` y la vista no ofrece el botón.
//
// Hyprland con config en Lua (0.5x) cambió `hyprctl dispatch`: ya no es `focuswindow
// address:…` sino `hl.dsp.focus({ window = "address:…" })`. Se prueba el nuevo y, si no, el viejo.
// Node puro, sin imports locales: lo prueba `tests/terminal.test.ts`.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { capacidades } from "./capacidades.ts";
import { esWindows } from "./procesos.ts";

const KITTEN = process.env.HILOS_KITTEN ?? "kitten";
const HYPRCTL = process.env.HILOS_HYPRCTL ?? "hyprctl";
const TOPE_MS = 2000;
/** Cuánto se espera a que el compositor vea el título de marca. */
const MARCA_MS = 600;

/** Dónde está la ventana: en kitty (su socket, su ventana y el pid de kitty) o, sin kitty, la del compositor. */
export type Lugar = { tipo: "kitty"; socket: string; ventana: number; kitty: number } | { tipo: "compositor"; direccion: string };

type Cliente = { address: string; pid: number; title: string };

const correr = (cmd: string, args: string[]) =>
  new Promise<string | null>((ok) => execFile(cmd, args, { timeout: TOPE_MS }, (e, out) => ok(e ? null : String(out))));

/** `KITTY_WINDOW_ID` y `KITTY_LISTEN_ON` de un `/proc/<pid>/environ`. */
export function kittyDe(environ: string): { socket: string; ventana: number } | null {
  let socket = "";
  let ventana = NaN;
  for (const l of environ.split("\0")) {
    if (l.startsWith("KITTY_LISTEN_ON=")) socket = l.slice(16);
    else if (l.startsWith("KITTY_WINDOW_ID=")) ventana = Number(l.slice(16));
  }
  return socket && Number.isInteger(ventana) && ventana > 0 ? { socket, ventana } : null;
}

/** El pid del shell de una ventana de kitty, del `kitten @ ls`; `null` si esa ventana ya no está. */
export function shellDeVentana(ls: unknown, ventana: number): number | null {
  if (!Array.isArray(ls)) return null;
  for (const o of ls)
    for (const t of Array.isArray(o?.tabs) ? o.tabs : [])
      for (const w of Array.isArray(t?.windows) ? t.windows : []) if (w?.id === ventana && typeof w.pid === "number") return w.pid;
  return null;
}

async function ppid(pid: number): Promise<number | null> {
  try {
    const st = await readFile(`/proc/${pid}/stat`, "utf8");
    const p = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(p) ? p : null;
  } catch {
    return null;
  }
}

/** `pid` y sus ancestros, de abajo hacia arriba (sin init). */
async function linaje(pid: number): Promise<number[]> {
  const r: number[] = [];
  for (let p: number | null = pid, i = 0; p !== null && p > 1 && i < 30; i++) {
    r.push(p);
    p = await ppid(p);
  }
  return r;
}

async function clientes(): Promise<Cliente[]> {
  try {
    const j = JSON.parse((await correr(HYPRCTL, ["clients", "-j"])) ?? "");
    return (Array.isArray(j) ? j : []).filter((c) => typeof c?.address === "string" && typeof c.pid === "number");
  } catch {
    return [];
  }
}

/** El `dispatch` que enfoca una ventana, en las dos sintaxis (Lua primero). */
export const enfoques = (direccion: string): string[][] =>
  /^0x[0-9a-f]+$/i.test(direccion)
    ? [
        ["dispatch", `hl.dsp.focus({ window = "address:${direccion}" })`],
        ["dispatch", "focuswindow", `address:${direccion}`],
      ]
    : [];

async function enfocar(direccion: string): Promise<boolean> {
  for (const args of enfoques(direccion)) if ((await correr(HYPRCTL, args))?.trim() === "ok") return true;
  return false;
}

const kitten = (socket: string, args: string[]) => correr(KITTEN, ["@", "--to", socket, ...args]);

/** Dónde está la ventana del proceso `pid`, o `null` si no se la puede ubicar. */
export async function ubicar(pid: number): Promise<Lugar | null> {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  // kitty y Hyprland (y `/proc`) son de Linux: en Windows no hay ventana a la que ir.
  if (esWindows()) return null;
  // Sin kitty ni Hyprland en esta máquina no hay ventana a la que ir: ni se mira (la vista no ofrece el botón).
  const cap = capacidades();
  if (!cap.kitten && !cap.hyprctl) return null;
  const arbol = await linaje(pid);
  if (!arbol.length) return null;
  const k = kittyDe(await readFile(`/proc/${pid}/environ`, "utf8").catch(() => ""));
  if (k && cap.kitten) {
    try {
      const ls = JSON.parse((await kitten(k.socket, ["ls"])) ?? "");
      const shell = shellDeVentana(ls, k.ventana);
      const en = shell === null ? -1 : arbol.indexOf(shell);
      // El padre del shell de la ventana es kitty.
      const kitty = en < 0 ? null : (arbol[en + 1] ?? (await ppid(shell!)));
      if (kitty) return { tipo: "kitty", socket: k.socket, ventana: k.ventana, kitty };
    } catch {}
  }
  // Otra terminal: el primer ancestro con ventana, si tiene una sola (con varias no se sabe cuál).
  if (!cap.hyprctl) return null;
  const cs = await clientes();
  for (const p of arbol) {
    const suyas = cs.filter((c) => c.pid === p);
    if (suyas.length) return suyas.length === 1 ? { tipo: "compositor", direccion: suyas[0].address } : null;
  }
  return null;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lleva el foco a la ventana (y pestaña) del proceso `pid`. `false`: no se la pudo ubicar.
 * En kitty, la pestaña cambia aunque el compositor no deje enfocar la ventana.
 */
export async function irA(pid: number): Promise<boolean> {
  const l = await ubicar(pid);
  if (!l) return false;
  if (l.tipo === "compositor") return enfocar(l.direccion);
  const esa = `id:${l.ventana}`;
  if ((await kitten(l.socket, ["focus-window", "--match", esa])) === null) return false;
  // Cuál de las ventanas del sistema de kitty es: la que muestre la marca en su título.
  const marca = `trama-${randomBytes(4).toString("hex")}`;
  if ((await kitten(l.socket, ["set-window-title", "--match", esa, marca])) === null) return true;
  try {
    for (const t0 = Date.now(); Date.now() - t0 < MARCA_MS; await espera(40)) {
      const c = (await clientes()).find((x) => x.pid === l.kitty && x.title === marca);
      if (c) {
        await enfocar(c.address);
        break;
      }
    }
  } finally {
    // Sin título: vuelve el que pone el programa de adentro.
    await kitten(l.socket, ["set-window-title", "--match", esa]);
  }
  return true;
}
