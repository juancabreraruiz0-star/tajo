import { describe, expect, it } from "vitest";
import { centsToEurosInput, eurosToCents, formatEuros } from "./money";

// Intl usa espacios duros (U+00A0 / U+202F) antes del símbolo.
const normaliza = (s: string) => s.replace(/[  ]/g, " ");

describe("eurosToCents", () => {
  it.each([
    ["12,50", 1250],
    ["12.50", 1250],
    ["12,5", 1250],
    ["12", 1200],
    ["0,99", 99],
    ["  7,05 ", 705],
    ["12,50 €", 1250],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["12,", 1200],
    ["0", 0],
    ["1.500", 150000],
    ["1.234", 123400],
    ["12.345.678", 1234567800],
    ["1.500,5", 150050],
    ["12.5", 1250],
    ["1.2345", 123],
    ["0.500", 50],
    ["0,500", 50],
    ["0.5", 50],
    ["0.050", 5],
  ])("texto %s → %i céntimos", (texto, cents) => {
    expect(eurosToCents(texto)).toBe(cents);
  });

  it.each([
    [12.5, 1250],
    [0.1, 10],
    [19.99, 1999],
    [1.005, 101],
    [1.5, 150],
    [1.234, 123],
    [1500, 150000],
    [0, 0],
    [100, 10000],
  ])("número %d → %i céntimos", (n, cents) => {
    expect(eurosToCents(n)).toBe(cents);
  });

  it("redondea al céntimo el tercer decimal", () => {
    expect(eurosToCents("1,234")).toBe(123);
    expect(eurosToCents("1,235")).toBe(124);
  });

  it.each(["-5", "-0,01", " -12,50"])("rechaza negativo en texto %s", (texto) => {
    expect(() => eurosToCents(texto)).toThrow(/negativo/);
  });

  it("rechaza números negativos", () => {
    expect(() => eurosToCents(-1)).toThrow(/negativo/);
  });

  it("el primer grupo de miles no puede empezar por 0", () => {
    expect(eurosToCents("0.500")).toBe(50);
    expect(() => eurosToCents("0.500,00")).toThrow();
  });

  it("notación científica: valores minúsculos se redondean y los enormes se rechazan", () => {
    expect(eurosToCents(1e-7)).toBe(0);
    expect(() => eurosToCents(1e21)).toThrow("Importe demasiado grande.");
    expect(() => eurosToCents(Number.MAX_VALUE)).toThrow("Importe demasiado grande.");
  });

  it("rechaza importes de texto que no caben en un entero seguro", () => {
    expect(() => eurosToCents("99999999999999999999")).toThrow("Importe demasiado grande.");
  });

  it.each(["", "abc", "12,50,3", "1..2", "12 euros", "1e3"])("rechaza texto no válido %j", (texto) => {
    expect(() => eurosToCents(texto)).toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rechaza %d", (n) => {
    expect(() => eurosToCents(n)).toThrow();
  });
});

describe("centsToEurosInput", () => {
  it.each([
    [1250, "12,50"],
    [5, "0,05"],
    [0, "0,00"],
    [123456, "1234,56"],
  ])("%i → %s", (cents, texto) => {
    expect(centsToEurosInput(cents)).toBe(texto);
  });

  it("su salida se vuelve a leer igual con eurosToCents", () => {
    for (const cents of [0, 1, 99, 1250, 150000, 123456]) {
      expect(eurosToCents(centsToEurosInput(cents))).toBe(cents);
    }
  });

  it.each([-1, 1.5, Number.NaN])("rechaza %d", (cents) => {
    expect(() => centsToEurosInput(cents)).toThrow();
  });
});

describe("formatEuros", () => {
  it("formatea céntimos en euros con formato español", () => {
    expect(normaliza(formatEuros(1250))).toBe("12,50 €");
    expect(normaliza(formatEuros(0))).toBe("0,00 €");
    expect(normaliza(formatEuros(12345678))).toBe("123.456,78 €");
  });

  it("es-ES no agrupa los miles con 4 cifras enteras", () => {
    expect(normaliza(formatEuros(123456))).toBe("1234,56 €");
  });
});
