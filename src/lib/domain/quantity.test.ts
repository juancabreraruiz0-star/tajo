import { describe, expect, it } from "vitest";
import { formatQuantity, parseQuantity, quantityToInput } from "./quantity";

describe("parseQuantity", () => {
  it.each([
    ["0", 0],
    ["12", 12],
    ["2,5", 2.5],
    ["2.5", 2.5],
    [" 7,25 ", 7.25],
    ["0,125", 0.125],
    ["1.500", 1500],
    ["1.500,5", 1500.5],
    ["12.345.678", 12345678],
    ["0.500", 0.5],
    ["1 500", 1500],
  ])("%j → %d", (texto, valor) => {
    expect(parseQuantity(texto)).toBe(valor);
  });

  it("pide una cantidad si está vacía", () => {
    expect(() => parseQuantity("  ")).toThrow("Escribe una cantidad.");
  });

  it.each(["-1", "-0,5"])("rechaza negativos %j", (texto) => {
    expect(() => parseQuantity(texto)).toThrow("No puede ser negativa.");
  });

  it.each(["abc", "1,2,3", "1..2", "2,", "1e3", "12 kg"])("rechaza texto no válido %j", (texto) => {
    expect(() => parseQuantity(texto)).toThrow(/Escribe un número/);
  });

  it("rechaza más de 3 decimales", () => {
    expect(() => parseQuantity("1,2345")).toThrow("Como mucho 3 decimales.");
  });

  it("rechaza cantidades desproporcionadas", () => {
    expect(() => parseQuantity("1000000001")).toThrow("demasiado grande");
    expect(parseQuantity("1000000000")).toBe(1_000_000_000);
  });
});

describe("formatQuantity", () => {
  // Intl puede usar espacios duros; aquí no hay símbolo, así que no aparecen.
  it.each([
    [0, "0"],
    [2.5, "2,5"],
    [1500, "1500"],
    [12345.5, "12.345,5"],
    [0.125, "0,125"],
  ])("%d → %s", (valor, texto) => {
    expect(formatQuantity(valor)).toBe(texto);
  });
});

describe("quantityToInput", () => {
  it("usa coma decimal y se vuelve a leer igual", () => {
    for (const valor of [0, 2.5, 1500, 0.125, 12345.5]) {
      const texto = quantityToInput(valor);
      expect(texto).not.toContain(".");
      expect(parseQuantity(texto)).toBe(valor);
    }
  });
});
