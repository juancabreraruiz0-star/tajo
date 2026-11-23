import { describe, expect, it } from "vitest";
import { filterLowStock, isLowStock, isNegativeStock } from "./stock";

describe("isNegativeStock", () => {
  it.each([
    [-0.001, true],
    [-12, true],
    [0, false],
    [3.5, false],
  ])("%d → %s", (stock, negativo) => {
    expect(isNegativeStock(stock)).toBe(negativo);
  });
});

describe("isLowStock", () => {
  it.each([
    [{ stock: 3, stock_minimo: 5 }, true],
    [{ stock: 4.5, stock_minimo: 5 }, true],
    [{ stock: -2, stock_minimo: 0 }, true],
    [{ stock: 5, stock_minimo: 5 }, false],
    [{ stock: 8, stock_minimo: 5 }, false],
    [{ stock: 0, stock_minimo: 0 }, false],
  ])("%o → %s", (nivel, bajo) => {
    expect(isLowStock(nivel)).toBe(bajo);
  });

  it("el stock negativo cuenta como bajo aunque el material no tenga mínimo", () => {
    expect(isLowStock({ stock: -0.5, stock_minimo: 0 })).toBe(true);
    expect(isLowStock({ stock: -4, stock_minimo: 10 })).toBe(true);
  });
});

describe("filterLowStock", () => {
  it("deja solo los que están bajo mínimo, conservando el orden", () => {
    const materiales = [
      { nombre: "Azulejo", stock: 2, stock_minimo: 10 },
      { nombre: "Cemento", stock: 40, stock_minimo: 10 },
      { nombre: "Silicona", stock: 1, stock_minimo: 6 },
    ];
    expect(filterLowStock(materiales).map((m) => m.nombre)).toEqual(["Azulejo", "Silicona"]);
  });

  it("incluye los materiales en negativo (facturados sin existencias)", () => {
    const materiales = [
      { nombre: "Plato de ducha", stock: -1, stock_minimo: 0 },
      { nombre: "Cemento cola", stock: 12, stock_minimo: 0 },
    ];
    expect(filterLowStock(materiales).map((m) => m.nombre)).toEqual(["Plato de ducha"]);
  });

  it("lista vacía → lista vacía", () => {
    expect(filterLowStock([])).toEqual([]);
  });
});
