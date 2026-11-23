export interface LineaImporte {
  /** Puede tener decimales (p. ej. 2,5 m²). */
  cantidad: number;
  /** Precio unitario en céntimos. */
  precioCents: number;
}

export interface TotalesPresupuesto {
  baseCents: number;
  ivaCents: number;
  totalCents: number;
}

/** Redondea al entero más cercano (medio hacia arriba), corrigiendo el ruido de coma flotante. */
function roundCents(valor: number): number {
  return Math.round(Number(valor.toFixed(6)));
}

/** Importe de una partida en céntimos: cantidad × precio, redondeado al céntimo. */
export function lineTotalCents({ cantidad, precioCents }: LineaImporte): number {
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new Error("La cantidad debe ser un número igual o mayor que 0.");
  }
  if (!Number.isSafeInteger(precioCents) || precioCents < 0) {
    throw new Error("El precio debe ser un número entero de céntimos igual o mayor que 0.");
  }
  return roundCents(cantidad * precioCents);
}

/** Base, IVA y total. El IVA se calcula una sola vez sobre la base total y se redondea al céntimo. */
export function budgetTotals(lineas: readonly LineaImporte[], ivaPct: number): TotalesPresupuesto {
  if (!Number.isInteger(ivaPct) || ivaPct < 0 || ivaPct > 100) {
    throw new Error("El IVA debe ser un porcentaje entero entre 0 y 100.");
  }
  const baseCents = lineas.reduce((suma, linea) => suma + lineTotalCents(linea), 0);
  const ivaCents = Math.round((baseCents * ivaPct) / 100);
  return { baseCents, ivaCents, totalCents: baseCents + ivaCents };
}
