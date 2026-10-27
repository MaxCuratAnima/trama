// `pa --hilos [--json] [--todo]`: el contrato JSON que lee la app (version 1). Lectura pura, sin locks. Un "hilo" es una
// corrida: su `.hilo` (o, en las de antes del `.hilo`, lo que quede de `.corrida`/`.json`) más su estado de ahora.
// Es el port de `cmd_hilos` de `motor/bin/pa`: mismos campos, mismas reglas; ahí está la referencia.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { CtxPa } from "./contexto.ts";
import { camposDe, campoDe } from "./estado-archivos.ts";

export const HILO_ID_RE = /^[0-9]{8}-[0-9]{6}-[0-9]+$/;
const VENTANA_DIAS = 7;

type Json = Record<string, unknown>;
type Campos = Record<string, string>;
const esObjeto = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// --- helpers de jq ---

const nonempty = <T>(v: T | null | undefined): T | null => (v === null || v === undefined || (v as unknown) === "" ? null : v);
/** `num`: un número escrito en texto, o null. */
const num = (v: string | null | undefined): number | null => (v !== null && v !== undefined && /^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/.test(v) ? Number(v) : null);
const trim = (s: string) => s.replace(/^\s+/, "").replace(/\s+$/, "");
/** `.[0:n]` cuenta caracteres (no unidades UTF-16). */
const corta = (s: string, n: number) => (s.length <= n ? s : Array.from(s).slice(0, n).join(""));
/** `tostring` de `.result // ""`. */
const tostr = (v: unknown): string => (v === null || v === undefined || v === false ? "" : typeof v === "string" ? v : JSON.stringify(v));

// --- DECISION (port de JQ_DECISION) ---

const RE_DEC = /^[*#> \t-]*DECISI(?:O|Ó)N[*]*:/;
const RE_SIGUE = /^[*#> \t-]*SIGUE[*]*:/;

export function decisionDe(res: string): string {
  const l = res.split("\n");
  let a = -1;
  for (let i = 0; i < l.length; i++) if (RE_DEC.test(l[i])) a = i;
  let t: string;
  if (a >= 0) {
    const pri = l[a].replace(/^[*#> \t-]*DECISI(?:O|Ó)N[*]*:[*]*/, "");
    if (/^[ \t]*$/.test(pri)) {
      let acc = "";
      for (const x of l.slice(a + 1)) {
        if (RE_SIGUE.test(x)) break;
        if (/^[ \t]*$/.test(x)) {
          if (acc !== "") break;
          continue;
        }
        acc = acc === "" ? x : `${acc} ${x}`;
      }
      t = acc;
    } else t = pri;
  } else {
    const m = l.filter((x) => /DECISI(?:O|Ó)N[*]*:/.test(x)).pop();
    t = m === undefined ? "" : (m.split(/DECISI(?:O|Ó)N[*]*:[*]*/).pop() ?? "");
  }
  return corta(t.replace(/[*#> \t-]*SIGUE[*]*:[^\n]*$/, "").replace(/^[ \t]+/, "").replace(/[ \t]+$/, ""), 400);
}

export const decisionEsNada = (d: string) => trim(d.replace(/[*]/g, "")).replace(/[.]$/, "").replace(/[A-Z]/g, (c) => c.toLowerCase()) === "nada";

// --- archivos ---

/** `read -r -d ''`: el texto hasta el primer NUL; "" si no hay o está vacío. */
function leerArchivo(ruta: string): string {
  try {
    const t = readFileSync(ruta, "utf8");
    const nul = t.indexOf("\0");
    return nul >= 0 ? t.slice(0, nul) : t;
  } catch {
    return "";
  }
}
const primeraLinea = (ruta: string): string | null => {
  try {
    return readFileSync(ruta, "utf8").split("\n")[0];
  } catch {
    return null;
  }
};
const campoRapido = (ruta: string, campo: string): string => {
  try {
    return campoDe(readFileSync(ruta, "utf8"), campo);
  } catch {
    return "";
  }
};

/** Las primeras `n` líneas de un archivo grande sin leerlo entero. */
export function primerasLineas(ruta: string, n: number): string[] {
  let fd: number;
  try {
    fd = openSync(ruta, "r");
  } catch {
    return [];
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    let resto = "";
    for (;;) {
      const k = readSync(fd, buf, 0, buf.length, null);
      if (k <= 0) break;
      resto += buf.toString("utf8", 0, k);
      if (resto.split("\n").length > n) break;
    }
    return resto.split("\n").slice(0, n);
  } finally {
    closeSync(fd);
  }
}

/** `tail -n n`: las últimas `n` líneas leyendo desde el final. */
export function ultimasLineas(ruta: string, n: number): string[] {
  let fd: number;
  try {
    fd = openSync(ruta, "r");
  } catch {
    return [];
  }
  try {
    const tam = fstatSync(fd).size;
    const bloque = 256 * 1024;
    let desde = tam;
    let bytes = Buffer.alloc(0);
    while (desde > 0) {
      const k = Math.min(bloque, desde);
      desde -= k;
      const b = Buffer.alloc(k);
      readSync(fd, b, 0, k, desde);
      bytes = Buffer.concat([b, bytes]);
      if (bytes.toString("utf8").split("\n").length > n + 1) break;
    }
    const lineas = bytes.toString("utf8").split("\n");
    if (lineas[lineas.length - 1] === "") lineas.pop();
    // si no se leyó desde el principio, la primera línea puede estar cortada
    return (desde > 0 ? lineas.slice(1) : lineas).slice(-n);
  } finally {
    closeSync(fd);
  }
}

const listar = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};
const esDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// --- fechas ---

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** `date -d @t +%Y%m%d-%H%M%S` en hora local. */
export const marcaLocal = (epochSeg: number): string => {
  const d = new Date(epochSeg * 1000);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};
/** `strptime("%Y%m%d-%H%M%S") | mktime` (leyendo la hora como UTC), o null. */
function epochDeId(id: string): number | null {
  const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/.exec(id);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}
const isoUtcAEpoch = (ts: unknown): number | null => {
  if (typeof ts !== "string") return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z$/.exec(ts.replace(/\.[0-9]+Z$/, "Z"));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : null;
};

// --- el JSON ---

export type HiloJson = {
  id: string; proyecto: string; tarea: string | null; modelo: string | null; effort: string | null; cuenta: string | null; origen: string; sigue_de: string | null;
  jefe: string | null; jefe_id: string | null; estado: string; en_cola: boolean; murio_en: number | null; murio_en_exacta: boolean | null;
  inicio: number | null; duracion_s: number | null; puesto: string | null; rama: string | null; commits: number | null; decision: string | null;
  decision_nada: boolean | null; sigue: string | null; resultado: string | null; archivado: string | null; leer: boolean;
  cache_ttl_s: number | null; cache_vence: number | null; cache_frio: string | null; cache_modelo: string | null;
};
export type SalidaHilos = { version: 1; hilos: HiloJson[] };

type Hecho = {
  id: string; slug: string; dir: string; vivo: string; enCola: boolean; iniRun: string; tareaRun: string; acc: string; listo: boolean;
  leer: boolean; commits: string; ppal: string; trans: string; sid: string; cache: string[]; mtimes: Record<string, number>;
};

/** Las filas de `integradas.tsv`: id → acción de la última fila de ese id (columnas 2 y 10). */
export function accionesIntegradas(estado: string): Map<string, string> {
  const m = new Map<string, string>();
  const t = leerArchivo(path.join(estado, "integradas.tsv"));
  t.split("\n").slice(1).forEach((l) => {
    const c = l.split("\t");
    if (c[1]) m.set(c[1], c[9] ?? "");
  });
  return m;
}

export type OpcionesHilos = { todo?: boolean };

export function calcularHilos(ctx: CtxPa, op: OpcionesHilos = {}): SalidaHilos {
  const ahora = ctx.ahora();
  const corte = marcaLocal(ahora - VENTANA_DIAS * 86400);
  const offs = ctx.offsetSeg();
  const estado = ctx.estado;

  const vivoArchivo = (f: string) => {
    const t = (() => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })();
    const pid = campoDe(t, "pid") || campoDe(t, "pa_pid");
    return /^\d+$/.test(pid) && ctx.existePid(Number(pid));
  };
  // corridas corriendo: id -> .running
  const runDe = new Map<string, string>();
  for (const n of listar(estado)) {
    if (!n.endsWith(".running")) continue;
    const f = path.join(estado, n);
    const k = campoDe(leerArchivo(f), "id");
    if (k && vivoArchivo(f)) runDe.set(k, f);
  }
  const accDe = accionesIntegradas(estado);

  const rutaCache = new Map<string, string>();
  const refsDe = new Set<string>();
  const rutaPpal = (slug: string): string => {
    if (!rutaCache.has(slug)) {
      const r = ctx.rutaDeSlug(slug) ?? "";
      rutaCache.set(slug, r);
      if (r) for (const ref of ctx.ramasPa(r, slug)) refsDe.add(`${slug}/${ref}`);
    }
    return rutaCache.get(slug)!;
  };
  const pidEnCola = (d: string, id: string) => {
    // Terminada (.listo/.entregado, o con `in=` en el .hilo): su .pid puede haber quedado con un pid que Windows reasignó.
    if (existsSync(path.join(d, `${id}.listo`)) || existsSync(path.join(d, `${id}.entregado`)) || campoRapido(path.join(d, `${id}.hilo`), "in")) return false;
    const l = primeraLinea(path.join(d, `${id}.pid`));
    return l !== null && /^[0-9]+$/.test(l) && ctx.existePid(Number(l)) && !ctx.esZombi(Number(l));
  };
  const enVentana = (slug: string, d: string, id: string): boolean => {
    if (!(id < corte) || runDe.has(id)) return true;
    if (pidEnCola(d, id)) return true;
    if (!existsSync(path.join(d, `${id}.corrida`)) || accDe.get(id)) return false;
    const rama = campoRapido(path.join(d, `${id}.corrida`), "rama");
    if (!rama) return false;
    if (campoRapido(path.join(d, `${id}.hilo`), "archivado")) return false;
    rutaPpal(slug);
    return refsDe.has(`${slug}/${rama}`);
  };

  const hechoDe = (slug: string, d: string, id: string): Hecho => {
    const r = runDe.get(id) ?? "";
    let vivo = "";
    let enCola = false;
    let iniRun = "";
    let tareaRun = "";
    if (r) {
      vivo = "trabajando";
      const epoch = campoRapido(r.replace(/\.running$/, ".heartbeat"), "epoch");
      if (/^[0-9]+$/.test(epoch) && ahora - Number(epoch) > 600) vivo = "colgado";
      iniRun = campoRapido(r, "inicio");
      tareaRun = campoRapido(r, "tarea").replace(/\x1f/g, " ");
    } else if (pidEnCola(d, id)) {
      vivo = "trabajando";
      enCola = true;
    }
    let rama = campoRapido(path.join(d, `${id}.corrida`), "rama");
    if (!rama) rama = campoRapido(path.join(d, `${id}.hilo`), "rama");
    const ppal = rutaPpal(slug);
    let commits = "";
    if (rama && ppal && refsDe.has(`${slug}/${rama}`)) commits = ctx.commitsSobre(ppal, rama);
    let sid = primeraLinea(path.join(d, `${id}.sid`)) ?? "";
    if (!sid) {
      const x = leerArchivo(path.join(d, `${id}.json`));
      const m = /"session_id":"([A-Za-z0-9._-]+)"/.exec(x);
      if (m) sid = m[1];
    }
    let trans = "";
    const cache: string[] = [];
    if (/^[A-Za-z0-9._-]+$/.test(sid)) {
      for (const p of listar(ctx.proyectos)) {
        const t = path.join(ctx.proyectos, p, `${sid}.jsonl`);
        if (!existsSync(t) || !statSync(t).isFile()) continue;
        // el primer mensaje del usuario (la tarea, para las corridas viejas sin `.hilo`) y los del asistente del final
        const pu = primerasLineas(t, 30).find((l) => l.includes('"type":"user"'));
        if (pu !== undefined) cache.push(pu);
        cache.push(...ultimasLineas(t, 200).filter((l) => l.includes('"type":"assistant"')));
        trans = t;
        break;
      }
    }
    const mtimes: Record<string, number> = {};
    if (!vivo && !accDe.get(id)) {
      for (const t of [path.join(d, `${id}.log`), path.join(d, `${id}.json`), path.join(d, `${id}.err`), trans]) {
        if (!t) continue;
        try {
          mtimes[t] = Math.floor(statSync(t).mtimeMs / 1000);
        } catch {
          // una ruta que se borró en el medio no importa
        }
      }
    }
    return {
      id, slug, dir: d, vivo, enCola, iniRun, tareaRun, acc: accDe.get(id) ?? "", listo: existsSync(path.join(d, `${id}.listo`)),
      leer: existsSync(path.join(d, `${id}.leer`)), commits, ppal, trans, sid, cache, mtimes,
    };
  };

  const hechos: Hecho[] = [];
  const visto = new Set<string>();
  for (const s of listar(estado)) {
    const d = path.join(estado, s);
    if (s === "worktrees" || s === "lock" || s === "jefe" || !esDir(d)) continue;
    const nombres = listar(d);
    for (const ext of ["hilo", "corrida", "json", "pid", "cola"]) {
      for (const n of nombres) {
        if (!n.endsWith(`.${ext}`)) continue;
        const id = n.slice(0, n.lastIndexOf("."));
        if (!HILO_ID_RE.test(id) || visto.has(`${s}/${id}`)) continue;
        visto.add(`${s}/${id}`);
        if (!op.todo && !enVentana(s, d, id)) continue;
        hechos.push(hechoDe(s, d, id));
      }
    }
  }

  // la última corrida de cada sesión: un --seguir escribe en el MISMO transcript que la que retoma
  const ultSid = new Map<string, string>();
  for (const h of hechos) if (h.sid && (ultSid.get(h.sid) ?? "") < h.id) ultSid.set(h.sid, h.id);

  const salida = hechos.map((h): HiloJson => {
    const ref = (ext: string) => {
      const t = leerArchivo(path.join(h.dir, `${h.id}.${ext}`));
      return t === "" ? null : t;
    };
    const tH = ref("hilo");
    const tC = ref("corrida");
    const tJ = ref("json");
    const hh: Campos = tH === null ? {} : camposDe(tH);
    const c: Campos = tC === null ? {} : camposDe(tC);
    let j: Json | null = null;
    if (tJ !== null) {
      try {
        const v: unknown = JSON.parse(tJ);
        j = esObjeto(v) ? v : null;
      } catch {
        j = null;
      }
    }
    const dec: string | null = hh.decision ?? (j === null ? null : decisionDe(tostr(j.result)));
    const dnada: string | null = hh.decision_nada ?? (hh.decision === undefined && dec !== null ? (decisionEsNada(dec) ? "1" : "0") : null);
    const ini: number | null = num(hh.inicio) ?? num(h.iniRun) ?? (() => { const e = epochDeId(h.id.slice(0, 15)); return e === null ? null : e - offs; })();
    const esleer = (hh.leer ?? c.leer) === "1" || h.leer;
    let modeloUso: string | null = null;
    if (j !== null && esObjeto(j.modelUsage)) {
      let mejor = -Infinity;
      for (const [k, v] of Object.entries(j.modelUsage)) {
        const t = esObjeto(v) && typeof v.outputTokens === "number" ? v.outputTokens : 0;
        if (t >= mejor) {
          mejor = t;
          modeloUso = k;
        }
      }
    }
    const modelo = nonempty(hh.modelo) ?? modeloUso;
    // caché: el último mensaje del asistente (no sidechain) que creó caché da el TTL y la hora
    const msgs = h.cache.flatMap((l): Json[] => {
      try {
        const v: unknown = JSON.parse(l);
        return esObjeto(v) ? [v] : [];
      } catch {
        return [];
      }
    });
    const uso = (m: Json, k: string): number => {
      const msg = esObjeto(m.message) ? m.message : {};
      const u = esObjeto(msg.usage) ? msg.usage : {};
      const cc = esObjeto(u.cache_creation) ? u.cache_creation : {};
      const v = cc[k];
      return typeof v === "number" ? v : 0;
    };
    const as = msgs.filter((m) => m.type === "assistant" && m.isSidechain !== true);
    const cc = [...as].reverse().find((m) => uso(m, "ephemeral_1h_input_tokens") > 0 || uso(m, "ephemeral_5m_input_tokens") > 0) ?? null;
    const ttl0 = cc === null ? null : uso(cc, "ephemeral_1h_input_tokens") > 0 ? 3600 : 300;
    const ts0 = cc === null ? null : isoUtcAEpoch(cc.timestamp);
    const vence = ttl0 === null || ts0 === null ? null : Math.floor(ts0 + ttl0);
    const ttl = vence === null ? null : ttl0;
    const tareaT = (() => {
      const u = msgs.find((m) => m.type === "user");
      if (!u) return null;
      const cont = esObjeto(u.message) ? u.message.content : undefined;
      const txt = typeof cont === "string" ? cont : Array.isArray(cont) ? cont.filter((x) => esObjeto(x) && x.type === "text").map((x) => String((x as Json).text)).join(" ") : "";
      return nonempty(corta(trim(txt.replace(/\s+/g, " ")), 500));
    })();
    const ult: Json = as.length ? as[as.length - 1] : {};
    const msgU = esObjeto(ult.message) ? ult.message : {};
    const cmod = ttl === null ? null : nonempty(typeof msgU.model === "string" ? msgU.model : null);
    const esperado = (nonempty(c.ruta_trabajo) ?? h.ppal).replace(/\/+$/, "");
    const cwdU = typeof ult.cwd === "string" ? ult.cwd : "";
    const frio =
      ttl === null ? null
      : vence !== null && ahora >= vence ? "vencido"
      : modelo !== null && cmod !== null && cmod !== modelo ? "modelo"
      : cwdU !== "" && esperado !== "" && cwdU.replace(/\/+$/, "") !== esperado ? "otro_dir"
      : null;
    const lanzo = nonempty(hh.lanzo) ?? "jefe";
    const reciente = h.listo && ini !== null && ahora - ini < 86400;
    const estadoH =
      h.vivo !== "" ? h.vivo
      : nonempty(hh.archivado) !== null ? "archivado"
      : h.acc === "integrada" ? "integrado"
      : h.acc === "revertida" ? "revertido"
      : h.acc === "descartada" ? "descartado"
      : j === null ? "murio"
      : nonempty(dec) !== null && dnada !== "1" && (reciente || lanzo !== "jefe") ? "decision"
      : reciente ? "listo"
      : "entregado";
    const fin = num(hh.fin);
    const murioEn =
      estadoH !== "murio" ? null
      : fin !== null ? fin
      : (() => {
          const cand = [".log", ".json", ".err"].map((e) => h.mtimes[path.join(h.dir, `${h.id}${e}`)]);
          if (h.trans !== "" && ultSid.get(h.sid) === h.id) cand.push(h.mtimes[h.trans]);
          const ok = cand.filter((x): x is number => x !== undefined);
          return ok.length ? Math.max(...ok) : ini;
        })();
    const res = tostr(j?.result);
    const resultado = /RESULTADO:/.test(res)
      ? nonempty(corta(trim((/RESULTADO:[*]*\s*([\s\S]*)/.exec(res)?.[1] ?? "").split("ARCHIVOS:")[0].split("DECISI")[0].replace(/\s+/g, " ")), 200))
      : null;
    const dur = j?.duration_ms;
    return {
      id: h.id,
      proyecto: h.slug,
      tarea: nonempty(hh.tarea) ?? nonempty(h.tareaRun) ?? tareaT,
      modelo,
      effort: nonempty(hh.effort),
      cuenta: nonempty(hh.cuenta),
      origen: lanzo,
      sigue_de: nonempty(hh.origen) ?? nonempty(c.origen),
      jefe: nonempty(hh.jefe) ?? nonempty(c.jefe),
      jefe_id: nonempty(hh.jefe_id) ?? nonempty(c.jefe_id),
      estado: estadoH,
      en_cola: h.enCola,
      murio_en: murioEn,
      murio_en_exacta: estadoH === "murio" ? fin !== null : null,
      inicio: ini,
      duracion_s: h.vivo !== "" && ini !== null ? Math.floor(ahora - ini) : typeof dur === "number" ? Math.floor(dur / 1000) : null,
      puesto: esleer ? null : (nonempty(hh.puesto) ?? nonempty(c.puesto)),
      rama: nonempty(c.rama) ?? nonempty(hh.rama),
      commits: num(h.commits),
      decision: nonempty(dec),
      decision_nada: dnada === null ? null : dnada === "1",
      sigue: nonempty(hh.sigue),
      resultado,
      archivado: nonempty(hh.archivado),
      leer: esleer,
      cache_ttl_s: ttl,
      cache_vence: vence,
      cache_frio: frio,
      cache_modelo: cmod,
    };
  });
  // sort_by(.id) | reverse
  const hilos = salida.map((x, i) => [x, i] as const).sort((a, b) => (a[0].id < b[0].id ? -1 : a[0].id > b[0].id ? 1 : a[1] - b[1])).map((p) => p[0]).reverse();
  return { version: 1, hilos };
}

/** `@tsv` de jq: `\t`, `\n`, `\r` y `\` escapados. */
const tsv = (s: string) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

/** La salida sin `--json`: id, estado, proyecto y los primeros 70 caracteres de la tarea (o del resultado). */
export const hilosEnTsv = (s: SalidaHilos): string =>
  s.hilos.map((h) => [h.id, h.estado, h.proyecto, corta(h.tarea ?? h.resultado ?? "", 70)].map(tsv).join("\t") + "\n").join("");

/** Como imprime jq: 2 espacios. */
export const hilosEnJson = (s: SalidaHilos): string => JSON.stringify(s, null, 2) + "\n";
