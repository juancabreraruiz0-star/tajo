// Facturación (R12–R14, R18): rangos de meses, sumas de importes y comprobaciones de facturas. Puro.

/** Rango de fechas AAAA-MM-DD: `desde` incluido, `hasta` excluido (primer día del mes siguiente). */
export interface RangoFechas {
  desde: string;
  hasta: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function primerDia(anio: number, mesIndice: number): string {
  // Date.UTC normaliza meses fuera de 0..11 (p. ej. -1 = diciembre del año anterior).
  const fecha = new Date(Date.UTC(anio, mesIndice, 1));
  return `${fecha.getUTCFullYear()}-${pad(fecha.getUTCMonth() + 1)}-01`;
}

/**
 * Mes natural que contiene `fecha` en la zona horaria indicada, desplazado `desplazamiento` meses
 * (0 = este mes, -1 = el anterior). Ej.: 23/11/2026 → { desde: "2026-11-01", hasta: "2026-12-01" }.
 */
export function monthRange(fecha: Date, timeZone: string, desplazamiento = 0): RangoFechas {
  if (Number.isNaN(fecha.getTime())) throw new Error("Fecha no válida.");
  if (!Number.isInteger(desplazamiento)) throw new Error("El desplazamiento debe ser un número entero de meses.");
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(fecha);
  const anio = Number(partes.find((p) => p.type === "year")?.value);
  const mes = Number(partes.find((p) => p.type === "month")?.value);
  return { desde: primerDia(anio, mes - 1 + desplazamiento), hasta: primerDia(anio, mes + desplazamiento) };
}

/** ¿La fecha AAAA-MM-DD cae dentro del rango? (las fechas ISO se comparan bien como texto). */
export function inRange(fecha: string, { desde, hasta }: RangoFechas): boolean {
  return fecha >= desde && fecha < hasta;
}

/** Suma de importes en céntimos. Lanza error si alguno no es un entero. */
export function sumCents(importes: readonly number[]): number {
  return importes.reduce((suma, cents) => {
    if (!Number.isSafeInteger(cents)) throw new Error("Los importes deben ser céntimos enteros.");
    return suma + cents;
  }, 0);
}

/** Suma de `total_cents` de las facturas cuya fecha cae en el rango. */
export function sumCentsInRange(
  facturas: readonly { fecha: string; total_cents: number }[],
  rango: RangoFechas,
): number {
  return sumCents(facturas.filter((f) => inRange(f.fecha, rango)).map((f) => f.total_cents));
}

/**
 * Variación relativa entre dos cifras como fracción: (actual − anterior) / anterior.
 * 150 frente a 100 → 0,5 (+50 %). Devuelve null si `anterior` es 0 (no hay con qué comparar).
 */
export function percentChange(actual: number, anterior: number): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(anterior)) throw new Error("Las cifras deben ser números.");
  if (anterior === 0) return null;
  return (actual - anterior) / Math.abs(anterior);
}

/**
 * ¿La suma de los importes guardados en las partidas de la factura (`factura_lineas.importe_cents`) coincide con la
 * base imponible guardada en la factura? Se suman los importes tal como se emitieron, sin recalcular
 * cantidad × precio: la factura es una copia fija.
 */
export function importesCuadranConBase(lineas: readonly { importe_cents: number }[], baseCents: number): boolean {
  return sumCents(lineas.map((l) => l.importe_cents)) === baseCents;
}
