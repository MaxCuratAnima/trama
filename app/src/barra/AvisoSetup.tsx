// "Falta configurar", al pie de la barra, junto a los avisos de Claude Code y agy: una pastilla chica con un puntito
// ámbar y cuántas cosas faltan (Handy para dictar, agy, Ollama, el login de Claude). El clic abre un globito con cada una:
// "Abrir" lleva a donde se consigue (el navegador) y la ✕ la descarta para siempre. Descartada la última, la pastilla se
// va. Lo pregunta el main al abrir y con "Revisar de nuevo"; no hay reloj (electron/setup.ts). Sin faltas no se ve nada.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { fuente, type FaltaSetup } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { abrirAjustes, type CatId } from "../paneles/ajustes-nav";

/** Las claves de cada una (literales: `t` las comprueba contra el diccionario). */
const K = {
  handy: { nombre: "setup.handy", nota: "setup.handyNota" },
  agy: { nombre: "setup.agy", nota: "setup.agyNota" },
  ollama: { nombre: "setup.ollama", nota: "setup.ollamaNota" },
  login: { nombre: "setup.login", nota: "setup.loginNota" },
  claude: { nombre: "setup.claude", nota: "setup.claudeNota" },
  git: { nombre: "setup.git", nota: "setup.gitNota" },
} as const;

/** Dónde de Ajustes se arregla cada una (sin categoría: se consigue afuera y nada se configura acá). */
const categoriaDe = (id: FaltaSetup["id"]): CatId | null =>
  id === "ollama" ? "locales" : id === "agy" || id === "login" ? "cuentas" : null;

export const AvisoSetup = memo(function AvisoSetup() {
  useIdioma();
  const [faltas, setFaltas] = useState<FaltaSetup[]>([]);
  const [abierto, setAbierto] = useState(MODO.captura === "setup-abierto");
  const [revisando, setRevisando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  const revisar = useCallback(() => {
    setRevisando(true);
    return fuente.faltasSetup().then((l) => {
      setFaltas(l);
      setRevisando(false);
      if (!l.length) setAbierto(false);
    });
  }, []);
  useEffect(() => void revisar(), [revisar]);

  const alCerrar = useCallback(() => setAbierto(false), []);
  useFoco(globo, { activo: abierto, alCerrar, devolver: () => boton.current });
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    addEventListener("pointerdown", afuera, true);
    return () => removeEventListener("pointerdown", afuera, true);
  }, [abierto]);

  if (!faltas.length) return null;

  const descartar = (id: FaltaSetup["id"]) => {
    fuente.descartarSetup(id);
    const quedan = faltas.filter((f) => f.id !== id);
    setFaltas(quedan);
    if (!quedan.length) setAbierto(false);
  };

  return (
    <div className="avc avs" ref={caja}>
      <button ref={boton} type="button" className="avc-b" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <span className="avc-p" aria-hidden="true" />
        {t("setup.pastilla", { n: faltas.length })}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g" role="dialog" aria-label={t("setup.titulo")} tabIndex={-1}>
          <div className="avc-t">{t("setup.titulo")}</div>
          <ul className="avs-l">
            {faltas.map((f) => (
              <li key={f.id} className="avs-f" data-id={f.id}>
                <div className="avs-x">
                  <div className="avs-n">{t(K[f.id].nombre)}</div>
                  <div className="avc-n">{t(K[f.id].nota)}</div>
                </div>
                {categoriaDe(f.id) ? (
                  <button
                    type="button"
                    className="avs-a"
                    data-tip={t("setup.irAjustesTip", { cat: t(`aj.cat.${categoriaDe(f.id)!}` as const) })}
                    onClick={() => {
                      abrirAjustes(categoriaDe(f.id)!);
                      setAbierto(false);
                    }}
                  >
                    {t("setup.irAjustes")}
                  </button>
                ) : null}
                <a className="avs-a" href={f.url} target="_blank" rel="noopener noreferrer" data-tip={t("setup.abrirTip")}>
                  {t("setup.abrir")}
                </a>
                <button type="button" className="avs-d" aria-label={t("setup.descartar")} data-tip={t("setup.descartar")} onClick={() => descartar(f.id)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="avc-a">
            <button type="button" className="avc-l" disabled={revisando} onClick={() => void revisar()}>
              {t(revisando ? "setup.revisando" : "setup.revisar")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
