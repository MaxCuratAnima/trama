// La lista de atajos de teclado, dentro de la app: se abre con `?` o desde Ajustes. Sale de la tabla de
// `src/atajos.ts` (la misma que usan los manejadores de teclas): nada escrito a mano acá. Es un modal:
// atrapa el foco, Esc lo cierra y el foco vuelve a lo que lo abrió.
import { Fragment, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { listaAtajos } from "../atajos";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";

// Abierto o cerrado vive afuera de React: `?` (la barra) y el botón de Ajustes no comparten un padre.
let abierto = MODO.captura === "atajos";
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());
const suscribir = (f: () => void) => (oyentes.add(f), () => void oyentes.delete(f));

export function abrirAtajos() {
  abierto = true;
  avisar();
}
export function cerrarAtajos() {
  abierto = false;
  avisar();
}

export function Atajos() {
  const vivo = useSyncExternalStore(suscribir, () => abierto);
  return vivo ? <Lista /> : null;
}

function Lista() {
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  useFoco(caja, { alCerrar: cerrarAtajos });
  return createPortal(
    <div className="at" onClick={(e) => e.target === e.currentTarget && cerrarAtajos()}>
      <div ref={caja} className="at-caja" role="dialog" aria-modal="true" aria-labelledby="at-titulo" tabIndex={-1}>
        <header className="at-h">
          <h2 id="at-titulo">{t("atajos.titulo")}</h2>
          <button type="button" className="lado" aria-label={t("atajos.cerrar")} data-tip={t("atajos.cerrar")} onClick={cerrarAtajos}>
            <X size={15} strokeWidth={1.8} />
          </button>
        </header>
        <div className="at-cuerpo">
          {listaAtajos().map((g) => (
            <section key={g.grupo}>
              <h3 className="pn-h">{t(`atajos.grupo.${g.grupo}`)}</h3>
              <dl>
                {g.items.map((a) => (
                  <Fragment key={a.id}>
                    <dt>{t(a.desc)}</dt>
                    <dd>
                      {a.teclas.map((combo, i) => (
                        <Fragment key={i}>
                          {i > 0 ? <span className="at-o">{t("atajos.o")}</span> : null}
                          {combo.map((k, j) => (
                            <Fragment key={j}>
                              {j > 0 ? "+" : null}
                              <kbd className="at-tecla">{k}</kbd>
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
