export interface NivelStock {
  stock: number;
  stock_minimo: number;
}

/** Aviso de un material en negativo (formulario de edición). */
export const AVISO_STOCK_NEGATIVO = "Stock negativo: se ha facturado más material del que había en el almacén";

/** El stock queda en negativo cuando se factura más material del que había (R13 no lo impide). */
export function isNegativeStock(stock: number): boolean {
  return stock < 0;
}

/**
 * R16: un material está bajo mínimo cuando su stock es menor que el stock mínimo.
 * Un stock negativo cuenta siempre como bajo, sea cual sea el mínimo.
 */
export function isLowStock({ stock, stock_minimo }: NivelStock): boolean {
  return isNegativeStock(stock) || stock < stock_minimo;
}

/** Solo los materiales bajo mínimo, en el mismo orden. */
export function filterLowStock<T extends NivelStock>(materiales: readonly T[]): T[] {
  return materiales.filter(isLowStock);
}
