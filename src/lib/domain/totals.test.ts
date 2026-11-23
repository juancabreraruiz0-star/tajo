import { describe, expect, it } from "vitest";
import { budgetTotals, lineTotalCents } from "./totals";

const bano = [
  { cantidad: 12.5, precioCents: 3240 }, // alicatado 12,5 m² × 32,40 € = 405,00 €
  { cantidad: 1, precioCents: 28990 }, // plato de ducha 289,90 €
  { cantidad: 6.5, precioCents: 2875 }, // fontanería 6,5 h × 28,75 € = 186,875 → 186,88 €
];

describe("lineTotalCents", () => {
  it("multiplica cantidad por precio", () => {
    expect(lineTotalCents({ cantidad: 3, precioCents: 1250 })).toBe(3750);
  });

  it("admite cantidades decimales y redondea al céntimo", () => {
    expect(lineTotalCents({ cantidad: 2.5, precioCents: 1999 })).toBe(4998); // 49,975 → 49,98
    expect(lineTotalCents({ cantidad: 0.333, precioCents: 1000 })).toBe(333);
    expect(lineTotalCents({ cantidad: 1.15, precioCents: 100 })).toBe(115); // 1.15*100 = 114.999… en float
  });

  it("cantidad 0 da 0", () => {
    expect(lineTotalCents({ cantidad: 0, precioCents: 5000 })).toBe(0);
  });

  it.each([
    { cantidad: -1, precioCents: 100 },
    { cantidad: Number.NaN, precioCents: 100 },
    { cantidad: 1, precioCents: -100 },
    { cantidad: 1, precioCents: 12.5 },
  ])("rechaza datos no válidos %o", (linea) => {
    expect(() => lineTotalCents(linea)).toThrow();
  });
});

describe("budgetTotals", () => {
  it("baño con 3 partidas al 21 %", () => {
    expect(budgetTotals(bano, 21)).toEqual({
      baseCents: 88178,
      ivaCents: 18517, // 18517,38
      totalCents: 106695,
    });
  });

  it("el mismo baño al 10 % (reforma de vivienda)", () => {
    expect(budgetTotals(bano, 10)).toEqual({
      baseCents: 88178,
      ivaCents: 8818, // 8817,8
      totalCents: 96996,
    });
  });

  it("calcula el IVA una sola vez sobre la base, no sumando el IVA de cada partida", () => {
    // Por partida: 0,105 + 0,105 → 0,11 + 0,11 = 0,22. Sobre la base: 1,00 × 21 % = 0,21.
    const lineas = [
      { cantidad: 1, precioCents: 50 },
      { cantidad: 1, precioCents: 50 },
    ];
    expect(budgetTotals(lineas, 21)).toEqual({ baseCents: 100, ivaCents: 21, totalCents: 121 });
  });

  it("redondea medio céntimo de IVA hacia arriba", () => {
    expect(budgetTotals([{ cantidad: 1, precioCents: 50 }], 21).ivaCents).toBe(11); // 10,5
  });

  it("base 0: sin partidas o con importes a 0", () => {
    const cero = { baseCents: 0, ivaCents: 0, totalCents: 0 };
    expect(budgetTotals([], 21)).toEqual(cero);
    expect(budgetTotals([{ cantidad: 0, precioCents: 1500 }, { cantidad: 3, precioCents: 0 }], 10)).toEqual(cero);
  });

  it("cantidades decimales en todas las partidas", () => {
    const lineas = [
      { cantidad: 2.5, precioCents: 1999 }, // 4998
      { cantidad: 0.75, precioCents: 1234 }, // 925,5 → 926
      { cantidad: 3.333, precioCents: 300 }, // 999,9 → 1000
    ];
    expect(budgetTotals(lineas, 21)).toEqual({
      baseCents: 6924,
      ivaCents: 1454, // 1454,04
      totalCents: 8378,
    });
  });

  it.each([-1, 10.5, 101, Number.NaN])("rechaza IVA no válido %d", (iva) => {
    expect(() => budgetTotals(bano, iva)).toThrow();
  });
});
