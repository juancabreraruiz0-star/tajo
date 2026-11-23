// Cantidades (stock, stock mínimo, cantidad de partida): números ≥ 0 con decimales.
// Mismas reglas que los importes: coma decimal, y punto seguido de grupos de 3 cifras = miles ("1.500" → 1500).

const WITH_THOUSANDS_DOT = /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/;
const PLAIN = /^(\d+)(?:[.,](\d+))?$/;

const MAX_DECIMALES_CANTIDAD = 3;
const MAX_CANTIDAD = 1_000_000_000;

const QUANTITY = new Intl.NumberFormat("es-ES", { maximumFractionDigits: MAX_DECIMALES_CANTIDAD });

/**
 * Lee una cantidad escrita por el usuario: "2,5", "2.5", "1.500", "1.500,25", "0".
 * Lanza un error en español si no es un número ≥ 0, tiene más de 3 decimales o es desproporcionada.
 */
export function parseQuantity(texto: string): number {
  const limpio = texto.trim().replace(/\s/g, "");
  if (limpio === "") throw new Error("Escribe una cantidad.");
  if (limpio.startsWith("-")) throw new Error("No puede ser negativa.");
  const match = WITH_THOUSANDS_DOT.exec(limpio) ?? PLAIN.exec(limpio);
  if (!match) throw new Error("Escribe un número, por ejemplo 12 o 2,5.");
  const entero = match[1].replace(/\./g, "");
  const decimales = match[2] ?? "";
  if (decimales.length > MAX_DECIMALES_CANTIDAD) {
    throw new Error(`Como mucho ${MAX_DECIMALES_CANTIDAD} decimales.`);
  }
  const valor = Number(decimales ? `${entero}.${decimales}` : entero);
  if (valor > MAX_CANTIDAD) throw new Error("La cantidad es demasiado grande.");
  return valor;
}

/** Cantidad para mostrar en español: 1500 → "1500", 2.5 → "2,5", 12345.5 → "12.345,5". */
export function formatQuantity(valor: number): string {
  return QUANTITY.format(valor);
}

/** Cantidad para un campo de formulario, sin separador de miles: 2.5 → "2,5". */
export function quantityToInput(valor: number): string {
  return String(valor).replace(".", ",");
}
