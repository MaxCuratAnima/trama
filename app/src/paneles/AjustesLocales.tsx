// Ajustes > Locales: la guía de Ollama (no instalado / instalado y apagado / andando, con el comando que corresponde a esta distro y
// esta GPU) y los modelos sugeridos con su tamaño frente a la VRAM. Todo se copia y se pega: acá no se instala ni se arranca nada, y
// «Descargar» sólo baja el archivo a disco (`POST /api/pull`): ningún modelo se carga ni toca la GPU hasta que alguien lo usa.
// Sin estado propio salvo el «Copiado»: el sondeo, las bajadas y el borrador viven en AjustesModelos.tsx.
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Bajada, EntornoOllama, Sondeo } from "../datos/paneles";
import { copiar } from "../copiar";
import { Boton, Chip, FilaAjuste, Tarjeta } from "../ui/componentes";
import { idioma, t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { porcentaje } from "./modelos-borrador";
import { cabe, sinInstalar, tamanoCorto, vramGb, type Sugerido, type Veredicto } from "./ollama-sugeridos";

type Estado = Sondeo | "comprobando";

export function textoBajada(b: Bajada): string {
  const pct = porcentaje(b);
  if (pct !== null) return t("ajustes.mdlBajarPct", { pct });
  return /verif|writing|removing|success/i.test(b.texto) ? t("ajustes.mdlBajarVerif") : t("ajustes.mdlBajarPrep");
}

/** Un comando para copiar: el texto en letra de código y un botón que lo lleva al portapapeles (el ícono pasa a un tilde 1,5 s). */
function Comando({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  useIdioma();
  const [hecho, setHecho] = useState(false);
  const reloj = useRef(0);
  useEffect(() => () => clearTimeout(reloj.current), []);
  const alCopiar = () =>
    void copiar(texto).then((ok) => {
      if (!ok) return;
      setHecho(true);
      clearTimeout(reloj.current);
      reloj.current = window.setTimeout(() => setHecho(false), 1500);
    });
  return (
    <div className="ol-cmd">
      <code className="ol-cmd-t" tabIndex={0} aria-label={etiqueta}>
        {texto}
      </code>
      <Boton className="ol-cmd-c" aria-label={t(hecho ? "ajustes.olCopiado" : "ajustes.olCopiar")} onClick={alCopiar}>
        {hecho ? <Check size={14} strokeWidth={2.2} aria-hidden /> : <Copy size={14} strokeWidth={2} aria-hidden />}
        {t(hecho ? "ajustes.olCopiado" : "ajustes.olCopiar")}
      </Boton>
    </div>
  );
}

/** «GeForce RTX 4070 · 12 GB» (o sólo lo que se sabe). */
function textoGpu(g: NonNullable<EntornoOllama["gpu"]>): string {
  const marca = g.nombre ?? { nvidia: "NVIDIA", amd: "AMD", intel: "Intel" }[g.fabricante];
  return g.vramMiB !== null ? `${marca} · ${vramGb(g.vramMiB)} GB` : marca;
}

/**
 * La tarjeta de estado de Ollama. `estado` es el sondeo a su puerto (¿contesta?); `entorno` lo que hay en la máquina (¿está el
 * programa?, ¿qué distro y qué GPU?). Con las dos cosas se distinguen los tres casos y se dice qué hacer en cada uno.
 */
export function GuiaOllama({ estado, entorno, alMirar }: { estado: Estado; entorno: EntornoOllama | null; alMirar: () => void }) {
  useIdioma();
  const anda = typeof estado === "object" && estado.ok;
  const mirando = estado === "comprobando";
  const caso = mirando ? "..." : anda ? "ok" : entorno === null ? "no" : entorno.instalado ? "apagado" : "no-instalado";
  const titulo = mirando ? t("ajustes.mdlComprobando") : anda ? t("ajustes.mdlOllamaAnda") : caso === "apagado" ? t("ajustes.olApagado") : t("ajustes.olNoInstalado");
  const gpu = entorno?.gpu ?? null;
  return (
    <div className="mdl-ollama ol-guia" data-opc="ajustes.mdlLocales" data-estado={caso === "ok" ? "ok" : caso === "..." ? "..." : "no"} data-caso={caso}>
      <div className="mdl-ollama-cab">
        <span className="mdl-ollama-t">{titulo}</span>
        <Boton onClick={alMirar} disabled={mirando}>
          {t("ajustes.mdlOllamaMirar")}
        </Boton>
      </div>
      <p className="ol-nota">{t("ajustes.mdlOllamaQue")}</p>
      {entorno ? (
        <div className="ol-chips">
          <Chip>{entorno.distro.nombre}</Chip>
          <Chip tono={gpu ? undefined : "aviso"}>{gpu ? textoGpu(gpu) : t("ajustes.olSinGpu")}</Chip>
        </div>
      ) : null}
      {caso === "no-instalado" && entorno ? (
        <>
          <div className="ol-paso">
            <span className="ol-paso-n">1</span>
            <div className="ol-paso-c">
              <div className="ol-paso-t">{t("ajustes.olPasoInstalar")}</div>
              <p className="ol-nota">{t(entorno.instalar.via === "winget" ? "ajustes.olInstalaWinget" : entorno.instalar.via === "pacman" ? (gpu?.fabricante === "nvidia" ? "ajustes.olInstalaCuda" : gpu?.fabricante === "amd" ? "ajustes.olInstalaRocm" : "ajustes.olInstalaPacman") : "ajustes.olInstalaScript")}</p>
              <Comando texto={entorno.instalar.comando} etiqueta={t("ajustes.olPasoInstalar")} />
            </div>
          </div>
          <div className="ol-paso">
            <span className="ol-paso-n">2</span>
            <div className="ol-paso-c">
              <div className="ol-paso-t">{t("ajustes.olPasoArrancar")}</div>
              <p className="ol-nota">{t(entorno.arrancar.via === "systemd" ? "ajustes.olArrancaSystemd" : "ajustes.olArrancaServe")}</p>
              <Comando texto={entorno.arrancar.comando} etiqueta={t("ajustes.olPasoArrancar")} />
            </div>
          </div>
          <p className="ol-nota">{t("ajustes.olLuegoMirar")}</p>
        </>
      ) : null}
      {caso === "apagado" && entorno ? (
        <div className="ol-paso">
          <span className="ol-paso-n">1</span>
          <div className="ol-paso-c">
            <div className="ol-paso-t">{t("ajustes.olPasoArrancar")}</div>
            <p className="ol-nota">{t(entorno.arrancar.via === "systemd" ? "ajustes.olArrancaSystemd" : "ajustes.olArrancaServe")}</p>
            <Comando texto={entorno.arrancar.comando} etiqueta={t("ajustes.olPasoArrancar")} />
            <p className="ol-nota">{t("ajustes.olLuegoMirar")}</p>
          </div>
        </div>
      ) : null}
      {caso === "no" ? (
        <a className="ui-btn mdl-enlace" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">
          {t("ajustes.mdlOllamaInstalar")}
        </a>
      ) : null}
    </div>
  );
}

const TONO: Record<Veredicto, "ok" | "aviso" | "critico" | undefined> = { entra: "ok", justo: "aviso", no_entra: "critico", sin_dato: undefined };

const PARA: Record<Sugerido["para"], ClaveSola> = { chico: "ajustes.olPara_chico", codigo: "ajustes.olPara_codigo", general: "ajustes.olPara_general", grande: "ajustes.olPara_grande" };
const CABE: Record<Veredicto, ClaveSola> = { entra: "ajustes.olCabe_entra", justo: "ajustes.olCabe_justo", no_entra: "ajustes.olCabe_no_entra", sin_dato: "ajustes.olCabe_sin_dato" };

/** Cuánto pesa y si entra, en una frase corta: «≈ 4,7 GB · entra en tu GPU». */
function detalle(s: Sugerido): string {
  return `≈ ${tamanoCorto(s.bytes, idioma() === "es" ? "," : ".")} · ${t(PARA[s.para])}`;
}

/** Los modelos sugeridos que faltan, con su tamaño frente a la VRAM detectada y «Descargar» (sólo baja a disco). */
export function SugeridosOllama({
  vramMiB,
  instalados,
  bajando,
  alBajar,
  alCancelar,
}: {
  vramMiB: number | null;
  instalados: string[];
  bajando: Record<string, Bajada>;
  alBajar: (modelo: string) => void;
  alCancelar: (b: Bajada) => void;
}) {
  useIdioma();
  const lista = sinInstalar(instalados);
  if (lista.length === 0) return null;
  return (
    <Tarjeta titulo={vramMiB !== null ? t("ajustes.olSugeridosVram", { gb: vramGb(vramMiB) }) : t("ajustes.olSugeridos")}>
      <div className="ol-sug" role="list" aria-label={t("ajustes.olSugeridos")}>
        {lista.map((s) => {
          const v = cabe(vramMiB, s.bytes);
          const b = bajando[s.modelo];
          const pct = b ? porcentaje(b) : null;
          return (
            <div role="listitem" key={s.modelo} className="ol-sug-f" data-bajando={b ? "" : undefined}>
              <FilaAjuste titulo={<span className="ol-sug-nom">{s.modelo}</span>} detalle={b ? textoBajada(b) : detalle(s)}>
                {b ? null : <Chip tono={TONO[v]}>{t(CABE[v])}</Chip>}
                {b ? (
                  <Boton aria-label={t("ajustes.mdlBajarCancelarModelo", { nombre: s.modelo })} onClick={() => alCancelar(b)}>
                    {t("ajustes.mdlBajarCancelar")}
                  </Boton>
                ) : (
                  <Boton primario={v === "entra"} aria-label={t("ajustes.olDescargarModelo", { nombre: s.modelo })} onClick={() => alBajar(s.modelo)}>
                    {t("ajustes.olDescargar")}
                  </Boton>
                )}
              </FilaAjuste>
              {b ? (
                <div className="mdl-barra ol-sug-barra" role="progressbar" aria-label={t("ajustes.mdlBajando", { nombre: s.modelo })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
                  <div className="mdl-barra-r" data-indef={pct === null ? "" : undefined} style={pct === null ? undefined : { transform: `scaleX(${pct / 100})` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="ol-nota ol-sug-pie">{t("ajustes.olSugeridosPie")}</p>
    </Tarjeta>
  );
}
