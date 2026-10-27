// El texto del portapapeles para la caja del líder cuando el pegado del navegador no lo trae: Chromium
// sólo reconoce `text/plain` (y `;charset=utf-8`), y una app de origen que ofrece otro nombre o un offer
// que se quedó viejo dejan el `paste` con `clipboardData` vacío: Ctrl+V no hace nada. Sin Electron, para
// probarlo con `node --test` (tests/portapapeles.test.ts); ventana-canales.ts le pasa el `clipboard` de verdad.

/** Lo que se usa del `clipboard` de Electron (desde la 44 es asíncrono: `read()` da los items con sus tipos MIME). */
export type Portapapeles = {
  readText(): Promise<string>;
  read(): Promise<readonly { types: readonly string[]; getType(tipo: string): Promise<unknown> }[]>;
};

/** Tope de lo que se pega por este camino (como el de un borrador: 200 KB). */
export const TOPE_PEGADO = 200_000;

/** Un formato que ofrece texto aunque Chromium no lo llame `text/plain`. */
const esDeTexto = (f: string) => /^(text\/(?!html|uri-list|rtf)|utf8_string$|string$|text$|compound_text$)/i.test(f);

/**
 * El texto plano del portapapeles, por el camino más corto: `readText()`; si viene vacío, cada tipo
 * de texto que ofrezca la app de origen (UTF-8 primero). `""` si no hay ninguno; los tipos que ofrecía
 * van a `aviso` para el log.
 */
export async function textoDelPortapapeles(cb: Portapapeles, aviso: (tipos: string[]) => void = () => {}): Promise<string> {
  const dar = (t: string) => (t.length > TOPE_PEGADO ? t.slice(0, TOPE_PEGADO) : t).replace(/\0+$/, "");
  try {
    const t = await cb.readText();
    if (t) return dar(t);
  } catch {
    // sigue con los tipos
  }
  const tipos: string[] = [];
  try {
    for (const item of await cb.read()) {
      tipos.push(...item.types);
      const candidatos = item.types.filter(esDeTexto).sort((a, b) => Number(/utf-?8/i.test(b)) - Number(/utf-?8/i.test(a)));
      for (const tipo of candidatos) {
        try {
          const dato = await item.getType(tipo);
          const t = dato instanceof Blob ? await dato.text() : (dato as { text?: () => Promise<string> }).text ? await (dato as { text: () => Promise<string> }).text() : "";
          if (t) return dar(t);
        } catch {
          // el siguiente
        }
      }
    }
  } catch {
    // nada más que probar
  }
  aviso(tipos);
  return "";
}
