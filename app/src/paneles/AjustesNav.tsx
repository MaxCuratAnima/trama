// El marco de Ajustes: el buscador de arriba, la barra lateral con las categorías (en angosto, un selector) y el contenido de la
// categoría elegida. Cada categoría (`<Cat>`) queda montada aunque no se vea: los bloques que se guardan con la barra de abajo
// conservan su borrador. Qué hay en cada una y cómo se busca: ajustes-nav.ts.
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Cpu, Gauge, HardDrive, Search, Smartphone, SlidersHorizontal, UserRound, X, type LucideIcon } from "lucide-react";
import { carcasa } from "../carcasa";
import { Selector, type Opcion } from "../hilo/Selector";
import { t, type Clave, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import {
  buscar,
  CATS,
  categoria,
  deVariante,
  efectiva,
  inicial,
  irA,
  marcasDe,
  pendienteDeMostrar,
  presentesDe,
  suscribir,
  varsDe,
  type CatId,
  type Resultado,
} from "./ajustes-nav";

const TEXTOS: Record<CatId, { nombre: ClaveSola; que: ClaveSola; icono: LucideIcon }> = {
  cuentas: { nombre: "aj.cat.cuentas", que: "aj.cat.cuentasQue", icono: UserRound },
  modelos: { nombre: "aj.cat.modelos", que: "aj.cat.modelosQue", icono: Cpu },
  cupos: { nombre: "aj.cat.cupos", que: "aj.cat.cuposQue", icono: Gauge },
  locales: { nombre: "aj.cat.locales", que: "aj.cat.localesQue", icono: HardDrive },
  celular: { nombre: "aj.cat.celular", que: "aj.cat.celularQue", icono: Smartphone },
  general: { nombre: "aj.cat.general", que: "aj.cat.generalQue", icono: SlidersHorizontal },
};

const CatCtx = createContext<CatId>("general");

/** Existe en esta máquina: Cuentas sólo donde está el puente de la carcasa; Celular, cuando el acceso es editable (lo dice su sección). */
export function hay(c: CatId, presentes = presentesDe()): boolean {
  if (c === "cuentas") return carcasa() !== null;
  if (c === "celular") return presentes.celular === true;
  return true;
}

/** Una categoría: se esconde (sin desmontarse) si no es la elegida. `orden` reparte, dentro de ella, lo que viene de componentes distintos. */
export function Cat({ id, orden, children }: { id: CatId; orden?: number; children: ReactNode }) {
  const activa = useContext(CatCtx);
  return (
    <div className="aj-cat" data-cat={id} hidden={activa !== id} style={orden ? { order: orden } : undefined}>
      {children}
    </div>
  );
}

const textoMarca = (c: CatId, clave: Clave | null | undefined): string | null => {
  if (!clave) return null;
  const v = varsDe(c);
  return v ? (t as (k: Clave, v: Record<string, string>) => string)(clave, v) : (t as (k: Clave) => string)(clave);
};

/** El buscador: cada palabra tiene que estar en el título, la explicación, los sinónimos o la categoría; elegir un resultado salta a su fila. */
function Buscador({ presentes }: { presentes: ReturnType<typeof presentesDe> }) {
  const [q, setQ] = useState("");
  const [foco, setFoco] = useState(false);
  const [cursor, setCursor] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useId();
  const res: Resultado[] = q.trim() ? buscar(q, t as (k: ClaveSola) => string, (c) => t(TEXTOS[c].nombre), (c) => hay(c, presentes)) : [];
  const abierto = foco && q.trim() !== "";
  const actual = Math.min(cursor, Math.max(res.length - 1, 0));

  const elegir = (r: Resultado) => {
    irA(r.item.cat, r.item.nombre);
    setQ("");
    setCursor(0);
    campo.current?.blur();
  };
  const tecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && res.length) {
      e.preventDefault();
      setCursor((actual + 1) % res.length);
    } else if (e.key === "ArrowUp" && res.length) {
      e.preventDefault();
      setCursor((actual - 1 + res.length) % res.length);
    } else if (e.key === "Enter" && res[actual]) {
      e.preventDefault();
      elegir(res[actual]);
    } else if (e.key === "Escape") {
      // Con algo escrito, Esc lo borra; sin nada, suelta el campo. El panel se cierra con el próximo Esc.
      e.preventDefault();
      e.stopPropagation();
      if (q) setQ("");
      else campo.current?.blur();
    }
  };

  return (
    <div className="aj-busca" role="search">
      <Search size={16} aria-hidden="true" className="aj-busca-i" />
      <input
        ref={campo}
        className="aj-busca-c"
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={lista}
        aria-autocomplete="list"
        aria-activedescendant={abierto && res[actual] ? `${lista}-${actual}` : undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={q}
        placeholder={t("aj.buscarPh")}
        aria-label={t("aj.buscar")}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
        onKeyDown={tecla}
      />
      {q ? (
        <button type="button" className="aj-busca-x" aria-label={t("aj.limpiar")} data-tip={t("aj.limpiar")} onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(""); campo.current?.focus(); }}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
      {abierto ? (
        <ul id={lista} className="aj-res" role="listbox" aria-label={t("aj.resultados")}>
          {res.length ? (
            res.map((r, i) => (
              <li
                key={r.item.nombre}
                id={`${lista}-${i}`}
                role="option"
                aria-selected={i === actual}
                className="aj-res-f"
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== actual && setCursor(i)}
                onClick={() => elegir(r)}
              >
                <span className="aj-res-t">
                  <span className="aj-res-n">{r.titulo}</span>
                  <span className="aj-res-c">{r.cat}</span>
                </span>
                {r.desc ? <span className="aj-res-d">{r.desc}</span> : null}
              </li>
            ))
          ) : (
            <li className="aj-res-vacio" role="status">
              {t("aj.sinResultados", { q: q.trim() })}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Al saltar desde el buscador: la fila (`data-opc`) se trae a la vista y se resalta un instante (opacidad, una vez). */
function useResaltar(activa: CatId, salto: { opc: string; n: number } | null, cont: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!salto) return;
    const raiz = cont.current;
    if (!raiz) return;
    const el = [...raiz.querySelectorAll<HTMLElement>("[data-opc]")].find((x) => x.dataset.opc === salto.opc && x.offsetParent !== null);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.setAttribute("data-resalta", "");
    const id = setTimeout(() => el.removeAttribute("data-resalta"), 1400);
    return () => {
      clearTimeout(id);
      el.removeAttribute("data-resalta");
    };
  }, [activa, salto?.n]);
}

export function AjustesMarco({ children }: { children: ReactNode }) {
  useIdioma();
  const pedida = useSyncExternalStore(suscribir, categoria);
  const presentes = useSyncExternalStore(suscribir, presentesDe);
  const marcas = useSyncExternalStore(suscribir, marcasDe);
  const salto = useSyncExternalStore(suscribir, pendienteDeMostrar);
  const cont = useRef<HTMLDivElement>(null);
  // Las capturas nacen en la categoría de lo que muestran.
  if (MODO.captura === "ajustes" && pedida === null) inicial(deVariante(MODO.variante) ?? "modelos");
  const activa = efectiva((c) => hay(c, presentes));
  const cats = CATS.filter((c) => hay(c, presentes));
  useResaltar(activa, salto, cont);

  const opciones: Opcion[] = cats.map((c) => {
    const m = textoMarca(c, marcas[c]);
    return { id: c, nombre: t(TEXTOS[c].nombre), desc: m ?? t(TEXTOS[c].que), marca: m ? <span className="aj-punto" aria-hidden="true" /> : undefined };
  });

  return (
    <CatCtx.Provider value={activa}>
      <div className="aj-raiz">
        <div className="aj">
          <Buscador presentes={presentes} />
          <nav className="aj-nav" aria-label={t("aj.categorias")}>
            {cats.map((c) => {
              const { icono: Icono } = TEXTOS[c];
              const m = textoMarca(c, marcas[c]);
              return (
                <button key={c} type="button" className="aj-it" data-cat={c} aria-current={c === activa ? "page" : undefined} onClick={() => irA(c)}>
                  <Icono size={16} aria-hidden="true" />
                  <span className="aj-it-x">
                    <span className="aj-it-n">{t(TEXTOS[c].nombre)}</span>
                    {m ? <span className="aj-it-m">{m}</span> : null}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="aj-sel pn-sel pn-abajo">
            <Selector etiqueta={t("aj.categorias")} opciones={opciones} valor={activa} alElegir={(id) => irA(id as CatId)} reserva={[]} />
          </div>
          <div className="aj-cont" ref={cont}>
            <header className="aj-cab">
              <h2 className="aj-t">{t(TEXTOS[activa].nombre)}</h2>
              {/* Modelos ya abre con su propia introducción: repetirla acá sería leer lo mismo dos veces. */}
              {activa === "modelos" ? null : <p className="aj-sub">{t(TEXTOS[activa].que)}</p>}
            </header>
            {children}
          </div>
        </div>
      </div>
    </CatCtx.Provider>
  );
}
