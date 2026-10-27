// Dictar en Windows: acá se decide con qué se transcribe: el `handy.exe` (si está instalado) o, si no hay Handy, el
// reconocedor que Windows trae (System.Speech, por `powershell.exe`: sin instalar nada, sin red, sin GPU).
// Sin `electron`: lo prueba tests/dictado-windows.test.ts con un sistema de archivos y un `Ejecutar` falsos.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverBinario } from "./binario.ts";

type Env = Record<string, string | undefined>;

/** Cómo se corre un programa (el mismo molde que `Ejecutar` de dictado.ts, sin importarlo: dictado.ts importa éste). */
type Correr = (bin: string, args: string[], o: { timeout: number }) => Promise<string>;

/** Con qué se transcribe y cómo se le pasa el WAV. */
export type Motor = {
  nombre: "handy" | "handy-windows" | "windows";
  bin: string;
  /** Los argumentos para un WAV (`archivo` es una ruta de Windows). */
  args: (archivo: string) => Promise<string[]>;
};

/** Dónde se baja Handy. */
export const URL_HANDY = "https://handy.computer";

type Disco = { hay: (f: string) => boolean };
const discoReal: Disco = { hay: existsSync };

/** Busca handy.exe en las rutas habituales. */
export function handyExeEnWindows(env: Env = process.env, home = os.homedir(), disco: Disco = discoReal): string | null {
  if (env.HILOS_HANDY_EXE) return disco.hay(env.HILOS_HANDY_EXE) ? env.HILOS_HANDY_EXE : null;
  const local = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const pf = env.ProgramFiles ?? "C:\\Program Files";
  const pfx86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const candidatas = [
    path.join(local, "Handy", "handy.exe"),
    path.join(local, "Programs", "Handy", "handy.exe"),
    path.join(local, "Programs", "handy", "handy.exe"),
    path.join(pf, "Handy", "handy.exe"),
    path.join(pfx86, "Handy", "handy.exe"),
  ];
  for (const c of candidatas) {
    if (disco.hay(c)) return c;
  }
  return null;
}

/**
 * El script de PowerShell que transcribe un WAV con System.Speech (viene con Windows). La salida va en UTF-8 para que
 * lleguen las tildes; la ruta entra como argumento, no pegada al texto del script.
 */
export const GUION_SPEECH = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Speech",
  "$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine",
  "$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
  "$r.SetInputToWaveFile($args[0])",
  "while ($true) { $x = $r.Recognize(); if ($null -eq $x) { break }; $x.Text }",
].join("; ");

/** Los argumentos de `powershell.exe` para correr `GUION_SPEECH` sobre una ruta de Windows. */
export const argsSpeech = (rutaWindows: string) => [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  `& { ${GUION_SPEECH} } '${rutaWindows.replace(/'/g, "''")}'`,
];

type Opciones = {
  env?: Env;
  home?: string;
  correr: Correr;
  disco?: Disco;
  /** ¿Es un ejecutable? (para el PATH; las pruebas lo reemplazan). */
  esEjecutable?: (f: string) => boolean;
};

/**
 * Los motores disponibles, en el orden en que se prueban: el `handy.exe` si está y, detrás, System.Speech
 * (`HILOS_SPEECH=0` lo apaga).
 */
export async function motoresDictado(o: Opciones): Promise<Motor[]> {
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const disco = o.disco ?? discoReal;

  const motores: Motor[] = [];
  const winExe = handyExeEnWindows(env, home, disco);
  if (winExe) {
    motores.push({ nombre: "handy-windows", bin: winExe, args: async (a) => ["--transcribe-file", a] });
  }
  const ps = resolverBinario("powershell.exe", "HILOS_POWERSHELL", env, home, o.esEjecutable);
  if (env.HILOS_SPEECH !== "0" && (ps !== "powershell.exe" || env.HILOS_POWERSHELL)) {
    motores.push({ nombre: "windows", bin: ps, args: async (a) => argsSpeech(a) });
  }
  return motores;
}

/** ¿Hay un Handy? Es lo que mira el aviso de setup: System.Speech no cuenta como Handy. */
export const hayHandy = async (o: Opciones) => (await motoresDictado(o)).some((m) => m.nombre !== "windows");
