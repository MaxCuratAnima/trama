// El anillo de contexto (B16): un circulito hueco que se llena con lo que pesa
// la conversación abierta contra su umbral (la cuenta: src/hilo/contexto-datos.ts):
// el de autocompact (a ese tamaño Claude Code compacta solo; electron/contexto.ts),
// en un líder y en un worker. Va en la caja del líder y, de sólo lectura, en el pie de un worker. Clic (o Enter con foco) abre el detalle;
// Esc o clic afuera lo cierra. Sólo se mueve el trazo (stroke-dashoffset).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { Tokens } from "../datos/contrato";
import { Reloj } from "../barra/piezas";
import { locale, t } from "../i18n";
import { useIdioma } from "../i18n/react";
import type { Pintor } from "../reloj";
import { cuenta, umbralDe, ventanaDe, ventanaDicha } from "./contexto-datos";
import { contextoDe, escucharContexto, leerUmbral, suscribirContexto, suscribirUmbral, umbralLeido } from "./contextoVivo";
import { modeloDe, nombreModelo } from "./opciones";

// Los eventos de un líder nuevo llegan antes que su vista: se escucha desde el arranque.
escucharContexto();

type Props = {
  /** Un líder: lo que dicen su stream y su transcript (src/hilo/contextoVivo.ts). Sin `sid`, vale `usage`. */
  sid?: string;
  /** Un worker: el `usage` de `pa --hilo <id> --json`. */
  usage?: Tokens | null;
  modelo: string | null;
  /** El cache: cuándo vence (epoch s; `null`, no se sabe) y si ya no va a pegar. */
  vence?: number | null;
  frio?: boolean;
  /** Hacia qué lado abre el detalle. */
  lado?: "izq" | "der";
  /** Para las capturas: nace abierto. */
  abierto?: boolean;
};

/** "vence en 38 min" / "uncached": el estado del cache en el detalle. */
const pintorVence =
  (vence: number, frio: boolean): Pintor =>
  (a) => {
    const r = vence - a;
    if (frio || r <= 0) return { texto: t("cache.vistaUncached"), en: Infinity };
    return { texto: r < 60 ? t("contexto.venceMenos") : t("contexto.vence", { m: Math.floor(r / 60) }), en: r < 60 ? r : r % 60 || 60 };
  };

export function Contexto({ sid, usage: fijo = null, modelo, vence = null, frio = false, lado = "der", abierto: deEntrada = false }: Props) {
  useIdioma();
  const vivo = useSyncExternalStore(
    useCallback((fn: () => void) => suscribirContexto(sid ?? "", fn), [sid]),
    () => contextoDe(sid ?? ""),
  );
  const { autoCompact } = useSyncExternalStore(suscribirUmbral, umbralLeido);
  const esLider = sid !== undefined;
  const [abierto, setAbierto] = useState(deEntrada);
  const boton = useRef<HTMLButtonElement>(null);
  const detalle = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(leerUmbral, []);
  // Al abrir, el foco va al detalle (Esc lo cierra) y se relee el umbral.
  useLayoutEffect(() => {
    if (!abierto) return;
    detalle.current?.focus();
    leerUmbral();
  }, [abierto]);

  const usage = sid === undefined ? fijo : vivo.usage;
  const ventana = ventanaDicha(vivo.ventanas, modelo) ?? ventanaDe(modelo);
  const c = cuenta(usage, umbralDe(autoCompact, ventana));
  const cache = useMemo(() => (vence === null ? null : pintorVence(vence, frio)), [vence, frio]);

  const cerrar = (conFoco = true) => {
    setAbierto(false);
    if (conFoco) boton.current?.focus();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Que no llegue a la barra: este Esc sólo cierra el detalle.
      e.stopPropagation();
      cerrar();
    } else if (e.key === "Tab") cerrar();
  };

  const n = (x: number | undefined) => (usage ? (x ?? 0).toLocaleString(locale()) : "—");
  const tip = t("contexto.tip", { pct: c.pct });
  const nombre = modeloDe(modelo);

  return (
    <div className="pick ctx-w">
      <button
        ref={boton}
        type="button"
        className="ctx"
        data-nivel={c.nivel}
        data-pct={c.pct}
        data-tip={abierto ? undefined : tip}
        aria-label={tip}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        onClick={() => setAbierto((a) => !a)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle className="ctx-riel" cx="8" cy="8" r="6" />
          <circle className="ctx-arco" cx="8" cy="8" r="6" pathLength={100} style={{ strokeDashoffset: 100 - c.pct }} />
        </svg>
      </button>
      {abierto ? (
        <>
          <button type="button" className="fondo" tabIndex={-1} aria-label={t("comun.cerrarMenu")} onClick={() => cerrar(false)} />
          <div ref={detalle} id={id} className="ctx-det" data-lado={lado} role="dialog" aria-label={t("contexto.titulo")} tabIndex={-1} onKeyDown={tecla}>
            <div className="ctx-h">
              <span>{t("contexto.titulo")}</span>
              <span className="ctx-pct" data-nivel={c.nivel}>
                {c.pct}%
              </span>
            </div>
            <dl>
              <dt>{t("contexto.usado")}</dt>
              <dd>
                {n(c.usados)} / {c.umbral.toLocaleString(locale())}
              </dd>
              <dt>{t("contexto.falta")}</dt>
              <dd>{n(c.falta)}</dd>
              <dt>{nombre ? t("contexto.ventanaDe", { modelo: nombreModelo(nombre) }) : t("contexto.ventana")}</dt>
              <dd>{ventana.toLocaleString(locale())}</dd>
            </dl>
            <div className="ctx-s">{t("contexto.turno")}</div>
            <dl>
              <dt>{t("contexto.leida")}</dt>
              <dd>{n(usage?.cache_read_input_tokens)}</dd>
              <dt>{t("contexto.creada")}</dt>
              <dd>{n(usage?.cache_creation_input_tokens)}</dd>
              <dt>{t("contexto.nuevos")}</dt>
              <dd>{n(usage?.input_tokens)}</dd>
              <dt>{t("contexto.salida")}</dt>
              <dd>{n(usage?.output_tokens)}</dd>
            </dl>
            {cache || esLider ? (
              <dl className="ctx-pie">
                {cache ? (
                  <>
                    <dt>{t("contexto.cache")}</dt>
                    <dd>
                      <Reloj pintor={cache} />
                    </dd>
                  </>
                ) : null}
                {esLider ? (
                  <>
                    <dt>{t("contexto.compacto")}</dt>
                    <dd>{vivo.compactaciones.toLocaleString(locale())}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
