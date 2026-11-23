const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

// Miles con punto (1.500 / 1.234,56): grupos de exactamente 3 cifras y decimales con coma.
// El primer grupo no empieza por 0: "0.500" no son miles, es 0,50 € (lo lee PLAIN).
const WITH_THOUSANDS_DOT = /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d*))?$/;
// Entero con decimales opcionales con coma o punto: 12,50 / 12.50.
const PLAIN = /^(\d+)(?:[.,](\d*))?$/;
// Miles con coma y decimales con punto: 1,234.56.
const WITH_THOUSANDS_COMMA = /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d*))?$/;
// Salida de String(number): punto decimal y sin separador de miles.
const NUMBER_STRING = /^(\d+)(?:\.(\d+))?$/;

function assertSafeCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new Error("Importe demasiado grande.");
  return cents;
}

function partsToCents(intPart: string, fracPart: string): number {
  const digits = intPart.replace(/[.,]/g, "");
  const frac = (fracPart + "000").slice(0, 3);
  return assertSafeCents(Number(digits) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0));
}

function parseText(texto: string): number {
  const limpio = texto.trim().replace(/\s*€$/, "").replace(/\s/g, "");
  if (limpio.startsWith("-")) throw new Error("El importe no puede ser negativo.");
  const match =
    WITH_THOUSANDS_DOT.exec(limpio) ?? PLAIN.exec(limpio) ?? WITH_THOUSANDS_COMMA.exec(limpio);
  if (!match) throw new Error(`Importe no válido: «${texto}».`);
  return partsToCents(match[1], match[2] ?? "");
}

function parseNumber(valor: number): number {
  if (!Number.isFinite(valor)) throw new Error("El importe no es un número válido.");
  if (valor < 0) throw new Error("El importe no puede ser negativo.");
  // String(1.005) da "1.005": se redondea por texto para evitar el error de coma flotante.
  // Notación científica (valores extremos): se redondea directamente.
  const match = NUMBER_STRING.exec(String(valor));
  return match ? partsToCents(match[1], match[2] ?? "") : assertSafeCents(Math.round(valor * 100));
}

/**
 * Convierte euros a céntimos enteros, redondeando al céntimo (medio hacia arriba).
 * Texto: "12,50", "12.50", "1.500" (miles), "1.234,56", "12,50 €". Número: 12.5.
 * Lanza error si es negativo o no es un número.
 */
export function eurosToCents(valor: string | number): number {
  return typeof valor === "string" ? parseText(valor) : parseNumber(valor);
}

/** Céntimos al texto que se pone en un campo de formulario: 1250 → "12,50" (sin símbolo ni miles). */
export function centsToEurosInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Los céntimos deben ser un entero igual o mayor que 0.");
  }
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** Formatea céntimos como euros en español: 123456 → "1234,56 €". */
export function formatEuros(cents: number): string {
  return EUR.format(cents / 100);
}
