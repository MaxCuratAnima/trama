// La cuenta de tokens de la app, en un solo lugar: "Hoy" del panel de consumo (src/datos/consumo.ts) y las
// cifras de Estadísticas (src/paneles/historial-datos.ts) la usan. Cuentan entrada + caché leído + salida, como los
// anota `pa` en `medicion.tsv`. El caché escrito se ve aparte (en el detalle al pasar el mouse), pero no suma:
// para el mismo día, el panel y Estadísticas tienen que dar el mismo total (tests/consumo-historial.test.ts).
export type Cuenta = { entrada: number; cacheLeido: number; salida: number };

export const total = (s: Cuenta): number => s.entrada + s.cacheLeido + s.salida;
