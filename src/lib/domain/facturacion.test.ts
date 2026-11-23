import { describe, expect, it } from "vitest";
import {
  inRange,
  lineasCuadranConBase,
  monthRange,
  percentChange,
  sumCents,
  sumCentsInRange,
} from "./facturacion";

const MADRID = "Europe/Madrid";

describe("monthRange", () => {
  it("devuelve el mes natural con el final excluido", () => {
    expect(monthRange(new Date("2026-11-23T10:00:00Z"), MADRID)).toEqual({ desde: "2026-11-01", hasta: "2026-12-01" });
  });

  it("usa el día de Madrid, no el de UTC", () => {
    // 23:30 UTC del 31/10 ya es 1 de noviembre en Madrid (UTC+1 en invierno).
    expect(monthRange(new Date("2026-10-31T23:30:00Z"), MADRID)).toEqual({ desde: "2026-11-01", hasta: "2026-12-01" });
    expect(monthRange(new Date("2026-10-31T23:30:00Z"), "UTC")).toEqual({ desde: "2026-10-01", hasta: "2026-11-01" });
  });

  it("en horario de verano Madrid va dos horas por delante de UTC", () => {
    // 30/06 a las 22:30 UTC ya es 1 de julio a las 00:30 en Madrid (UTC+2).
    expect(monthRange(new Date("2026-06-30T22:30:00Z"), MADRID)).toEqual({ desde: "2026-07-01", hasta: "2026-08-01" });
    // A las 21:59 UTC todavía son las 23:59 del 30 de junio.
    expect(monthRange(new Date("2026-06-30T21:59:00Z"), MADRID)).toEqual({ desde: "2026-06-01", hasta: "2026-07-01" });
    // El mes anterior se calcula desde el mes de Madrid, no desde el de UTC.
    expect(monthRange(new Date("2026-06-30T22:30:00Z"), MADRID, -1)).toEqual({
      desde: "2026-06-01",
      hasta: "2026-07-01",
    });
  });

  it("cruza el cambio de año en diciembre", () => {
    expect(monthRange(new Date("2026-12-15T12:00:00Z"), MADRID)).toEqual({ desde: "2026-12-01", hasta: "2027-01-01" });
  });

  it("se desplaza a meses anteriores o siguientes", () => {
    const enero = new Date("2027-01-10T12:00:00Z");
    expect(monthRange(enero, MADRID, -1)).toEqual({ desde: "2026-12-01", hasta: "2027-01-01" });
    expect(monthRange(enero, MADRID, -13)).toEqual({ desde: "2025-12-01", hasta: "2026-01-01" });
    expect(monthRange(enero, MADRID, 1)).toEqual({ desde: "2027-02-01", hasta: "2027-03-01" });
  });

  it("rechaza fechas no válidas o desplazamientos con decimales", () => {
    expect(() => monthRange(new Date("mañana"), MADRID)).toThrow("Fecha no válida");
    expect(() => monthRange(new Date(), MADRID, 0.5)).toThrow("entero");
  });
});

describe("inRange", () => {
  const noviembre = { desde: "2026-11-01", hasta: "2026-12-01" };

  it("incluye el primer día y excluye el primero del mes siguiente", () => {
    expect(inRange("2026-11-01", noviembre)).toBe(true);
    expect(inRange("2026-11-30", noviembre)).toBe(true);
    expect(inRange("2026-12-01", noviembre)).toBe(false);
    expect(inRange("2026-10-31", noviembre)).toBe(false);
  });
});

describe("sumCents", () => {
  it("suma céntimos enteros", () => {
    expect(sumCents([125_000, 99, 1])).toBe(125_100);
    expect(sumCents([])).toBe(0);
  });

  it("rechaza importes que no son enteros", () => {
    expect(() => sumCents([10, 0.5])).toThrow("céntimos enteros");
    expect(() => sumCents([Number.NaN])).toThrow("céntimos enteros");
  });
});

describe("sumCentsInRange", () => {
  it("suma solo las facturas del rango", () => {
    const facturas = [
      { fecha: "2026-10-31", total_cents: 1_000 },
      { fecha: "2026-11-01", total_cents: 2_000 },
      { fecha: "2026-11-30", total_cents: 3_000 },
      { fecha: "2026-12-01", total_cents: 4_000 },
    ];
    expect(sumCentsInRange(facturas, { desde: "2026-11-01", hasta: "2026-12-01" })).toBe(5_000);
    expect(sumCentsInRange(facturas, { desde: "2026-10-01", hasta: "2026-11-01" })).toBe(1_000);
    expect(sumCentsInRange([], { desde: "2026-10-01", hasta: "2026-11-01" })).toBe(0);
  });
});

describe("percentChange", () => {
  it("devuelve la variación como fracción", () => {
    expect(percentChange(150, 100)).toBe(0.5);
    expect(percentChange(50, 100)).toBe(-0.5);
    expect(percentChange(100, 100)).toBe(0);
    expect(percentChange(0, 100)).toBe(-1);
  });

  it("devuelve null si no hay cifra anterior", () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it("rechaza valores que no son números", () => {
    expect(() => percentChange(Number.NaN, 1)).toThrow("números");
  });
});

describe("lineasCuadranConBase", () => {
  const lineas = [
    { cantidad: 2.5, precioCents: 1_999 }, // 4.997,5 → 4.998
    { cantidad: 1, precioCents: 10_000 },
  ];

  it("compara la suma de importes redondeados por partida con la base guardada", () => {
    expect(lineasCuadranConBase(lineas, 14_998)).toBe(true);
    expect(lineasCuadranConBase(lineas, 14_997)).toBe(false);
  });

  it("reforma de baño con 3 partidas reales", () => {
    const bano = [
      { cantidad: 18.5, precioCents: 2_450 }, // alicatado: 18,5 m² × 24,50 € = 453,25 €
      { cantidad: 1, precioCents: 38_900 }, // plato de ducha 80×120 colocado = 389,00 €
      { cantidad: 6.75, precioCents: 3_200 }, // fontanería: 6,75 h × 32,00 € = 216,00 €
    ];
    expect(lineasCuadranConBase(bano, 105_825)).toBe(true); // base 1.058,25 €
    expect(lineasCuadranConBase(bano, 105_826)).toBe(false);
    // No cuadra con el total con IVA (21 % → 1.280,48 €): se compara con la base.
    expect(lineasCuadranConBase(bano, 128_048)).toBe(false);
  });

  it("sin partidas cuadra solo con base 0", () => {
    expect(lineasCuadranConBase([], 0)).toBe(true);
    expect(lineasCuadranConBase([], 100)).toBe(false);
  });
});
