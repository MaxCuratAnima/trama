// Qué hay en la máquina para correr Ollama (electron/ollama-entorno.ts) con `Deps` FALSOS: nunca corre `nvidia-smi` ni
// `systemctl` de verdad, y se mira que sólo se llame a lo que lee (nombre y memoria, lista de units), jamás a algo que cargue un modelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Los imports `.js` de electron/ se llevan al `.ts`.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { comandoArrancar, comandoInstalar, familiaDe, leerEntornoOllama: leerEntorno, mejorGpu, parsearNvidia, SCRIPT_OFICIAL } = await import("../electron/ollama-entorno.ts");
// Estas pruebas simulan Linux (sysfs, /etc/os-release): la plataforma va fija, no la de quien corre el test.
const leerEntornoOllama = (d: Deps) => leerEntorno(d, "linux");
type Deps = import("../electron/locales.ts").Deps;

const ARCH = 'NAME="CachyOS Linux"\nPRETTY_NAME="CachyOS"\nID=cachyos\nID_LIKE=arch\n';
const UBUNTU = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n';

test("la distro se reconoce por ID e ID_LIKE", () => {
  assert.deepEqual(familiaDe(ARCH), { id: "cachyos", nombre: "CachyOS", familia: "arch" });
  assert.equal(familiaDe(UBUNTU).familia, "debian");
  assert.equal(familiaDe("ID=fedora\n").familia, "fedora");
  assert.equal(familiaDe('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n').familia, "suse");
  assert.equal(familiaDe("ID=void\n").familia, "otra");
  assert.equal(familiaDe("").familia, "otra");
});

test("nvidia-smi: nombre y memoria de la primera GPU", () => {
  assert.deepEqual(parsearNvidia("NVIDIA GeForce RTX 5090, 32607\n"), { nombre: "NVIDIA GeForce RTX 5090", vramMiB: 32607 });
  assert.deepEqual(parsearNvidia("Tesla T4, [N/A]"), { nombre: "Tesla T4", vramMiB: null });
  assert.equal(parsearNvidia(""), null);
});

test("la mejor GPU: NVIDIA antes que AMD antes que Intel; la de más memoria dentro del mismo fabricante", () => {
  const intel = { fabricante: "intel" as const, nombre: null, vramMiB: null };
  const amd = { fabricante: "amd" as const, nombre: null, vramMiB: 8192 };
  const nv = { fabricante: "nvidia" as const, nombre: "RTX", vramMiB: 12000 };
  assert.equal(mejorGpu([intel, amd, nv]), nv);
  assert.equal(mejorGpu([intel, amd]), amd);
  assert.equal(mejorGpu([]), null);
});

test("el comando de instalar: pacman con el paquete de la GPU en Arch, el instalador oficial en el resto", () => {
  const nv = { fabricante: "nvidia" as const, nombre: null, vramMiB: null };
  const amd = { fabricante: "amd" as const, nombre: null, vramMiB: null };
  assert.deepEqual(comandoInstalar("arch", nv), { via: "pacman", comando: "sudo pacman -S ollama-cuda" });
  assert.equal(comandoInstalar("arch", amd).comando, "sudo pacman -S ollama-rocm");
  assert.equal(comandoInstalar("arch", null).comando, "sudo pacman -S ollama");
  for (const f of ["debian", "fedora", "suse", "otra"] as const) assert.deepEqual(comandoInstalar(f, nv), { via: "script", comando: SCRIPT_OFICIAL });
});

test("el comando de arrancar: el servicio si hay systemd, `ollama serve` si no", () => {
  assert.equal(comandoArrancar(true).comando, "sudo systemctl enable --now ollama");
  assert.equal(comandoArrancar(false).comando, "ollama serve");
});

type Llamada = { bin: string; args: string[] };
function deps(o: { archivos?: Record<string, string>; ejecutables?: string[]; units?: string; nvidia?: string | Error; llamadas?: Llamada[]; env?: Record<string, string> }): Deps {
  const archivos = o.archivos ?? {};
  const hay = new Set([...(o.ejecutables ?? []), ...Object.keys(archivos)]);
  return {
    home: "/home/ana",
    env: { PATH: "/usr/bin:/bin", HILOS_NVIDIA_SMI: "/falso/nvidia-smi", ...o.env },
    ejecutar: async (bin, args) => {
      o.llamadas?.push({ bin, args });
      if (bin === "systemctl") return o.units ?? "";
      if (bin === "/falso/nvidia-smi") {
        if (o.nvidia instanceof Error || o.nvidia === undefined) throw o.nvidia ?? new Error("ENOENT");
        return o.nvidia;
      }
      throw new Error(`no se esperaba ${bin}`);
    },
    leer: async (f) => archivos[f] ?? null,
    tamano: async (f) => (hay.has(f) ? 1 : null),
    escribir: async () => {},
    borrar: async () => {},
    pedirJson: async () => null,
    dormir: async () => {},
    ahora: () => 0,
  };
}

test("Arch con NVIDIA, sin Ollama: ollama-cuda, la GPU a la vista y sólo se lee", async () => {
  const llamadas: Llamada[] = [];
  const e = await leerEntornoOllama(
    deps({
      llamadas,
      archivos: { "/etc/os-release": ARCH, "/sys/class/drm/card0/device/vendor": "0x10de\n", "/sys/class/drm/card1/device/vendor": "0x8086\n", "/run/systemd/system": "" },
      nvidia: "NVIDIA GeForce RTX 5090, 32607\n",
    }),
  );
  assert.equal(e.instalado, false);
  assert.equal(e.distro.familia, "arch");
  assert.deepEqual(e.gpu, { fabricante: "nvidia", nombre: "NVIDIA GeForce RTX 5090", vramMiB: 32607 });
  assert.equal(e.instalar.comando, "sudo pacman -S ollama-cuda");
  assert.equal(e.arrancar.via, "systemd");
  // lo único que corrió: nvidia-smi para el nombre y la memoria, y la lista de units
  for (const l of llamadas) assert.ok(l.bin === "/falso/nvidia-smi" || l.bin === "systemctl");
  assert.deepEqual(llamadas.find((l) => l.bin !== "systemctl")?.args, ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
});

test("Ubuntu con Ollama instalado y su servicio, GPU AMD con memoria de sysfs", async () => {
  const e = await leerEntornoOllama(
    deps({
      ejecutables: ["/usr/bin/ollama"],
      units: "ollama.service enabled enabled\n",
      archivos: { "/etc/os-release": UBUNTU, "/sys/class/drm/card0/device/vendor": "0x1002\n", "/sys/class/drm/card0/device/mem_info_vram_total": String(16 * 1024 * 1024 * 1024), "/run/systemd/system": "" },
    }),
  );
  assert.equal(e.instalado, true);
  assert.deepEqual(e.gpu, { fabricante: "amd", nombre: null, vramMiB: 16384 });
  assert.equal(e.instalar.comando, SCRIPT_OFICIAL);
  assert.deepEqual(e.arrancar, { via: "systemd", comando: "sudo systemctl enable --now ollama" });
});

test("instalado pero sin unit de systemd (a mano en ~/.local/bin): se arranca con ollama serve", async () => {
  const e = await leerEntornoOllama(deps({ ejecutables: ["/home/ana/.local/bin/ollama"], units: "", archivos: { "/etc/os-release": UBUNTU, "/run/systemd/system": "" } }));
  assert.equal(e.instalado, true);
  assert.equal(e.arrancar.via, "serve");
});

test("sin GPU ni systemd (un contenedor): gpu null, ollama serve, nvidia-smi sin contestar no rompe", async () => {
  const e = await leerEntornoOllama(deps({ archivos: { "/etc/os-release": UBUNTU } }));
  assert.equal(e.gpu, null);
  assert.equal(e.arrancar.via, "serve");
});

test("WSL: sin /sys/class/drm, nvidia-smi igual dice la tarjeta", async () => {
  const e = await leerEntornoOllama(deps({ archivos: { "/etc/os-release": UBUNTU }, nvidia: "NVIDIA GeForce RTX 4070, 12282\n" }));
  assert.equal(e.gpu?.vramMiB, 12282);
});

test("HILOS_OLLAMA manda: apuntando a un archivo que no está, no hay Ollama aunque esté en el PATH", async () => {
  const e = await leerEntornoOllama(deps({ ejecutables: ["/usr/bin/ollama"], env: { HILOS_OLLAMA: "/no/esta" }, archivos: { "/etc/os-release": ARCH } }));
  assert.equal(e.instalado, false);
});

test("una tarjeta NVIDIA vista pero sin nvidia-smi sigue figurando, sin nombre ni memoria", async () => {
  const e = await leerEntornoOllama(deps({ archivos: { "/etc/os-release": ARCH, "/sys/class/drm/card0/device/vendor": "0x10de\n" } }));
  assert.deepEqual(e.gpu, { fabricante: "nvidia", nombre: null, vramMiB: null });
});

test("Windows: se instala con winget, se arranca con ollama serve y no se mira systemd ni la distro", async () => {
  const e = await leerEntorno(deps({ archivos: { "/etc/os-release": UBUNTU } }), "win32");
  assert.equal(e.distro.id, "windows");
  assert.equal(e.instalar.via, "winget");
  assert.equal(e.arrancar.via, "serve");
  assert.equal(e.instalado, false);
});
