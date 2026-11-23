import { describe, expect, it } from "vitest";
import { acceptanceBreakdown, acceptanceRate, formatPercent, percentTrend } from "./kpis";

describe("acceptanceRate", () => {
  it("(aceptados + facturados) / (enviados + aceptados + facturados + rechazados)", () => {
    expect(acceptanceRate({ enviado: 2, aceptado: 3, facturado: 1, rechazado: 2 })).toBe(0.5);
  });

  it("ignora los borradores", () => {
    expect(acceptanceRate({ borrador: 10, aceptado: 1, rechazado: 3 })).toBe(0.25);
  });

  it("los estados que faltan cuentan como 0", () => {
    expect(acceptanceRate({ facturado: 4 })).toBe(1);
    expect(acceptanceRate({ rechazado: 4 })).toBe(0);
  });

  it("devuelve null si el denominador es 0", () => {
    expect(acceptanceRate({})).toBeNull();
    expect(acceptanceRate({ borrador: 5 })).toBeNull();
    expect(acceptanceRate({ enviado: 0, aceptado: 0, facturado: 0, rechazado: 0 })).toBeNull();
  });
});

describe("acceptanceBreakdown", () => {
  it("devuelve aceptados, enviados y la tasa", () => {
    expect(acceptanceBreakdown({ borrador: 4, enviado: 2, aceptado: 3, facturado: 1, rechazado: 2 })).toEqual({
      aceptados: 4,
      enviados: 8,
      tasa: 0.5,
    });
  });

  it("sin enviados la tasa es null", () => {
    expect(acceptanceBreakdown({ borrador: 3 })).toEqual({ aceptados: 0, enviados: 0, tasa: null });
  });
});

describe("formatPercent", () => {
  // Intl separa número y % con un espacio duro; se normaliza para comparar.
  const plano = (texto: string) => texto.replace(/\s/g, " ");

  it("redondea al entero", () => {
    expect(plano(formatPercent(0.5))).toBe("50 %");
    expect(plano(formatPercent(2 / 3))).toBe("67 %");
    expect(plano(formatPercent(0))).toBe("0 %");
  });

  it("con signo marca subidas y bajadas", () => {
    expect(plano(formatPercent(0.12, { signo: true }))).toBe("+12 %");
    expect(plano(formatPercent(-0.3, { signo: true }))).toBe("-30 %");
    expect(plano(formatPercent(0, { signo: true }))).toBe("0 %");
  });
});

describe("percentTrend", () => {
  it("distingue subidas y bajadas", () => {
    expect(percentTrend(0.12)).toBe("sube");
    expect(percentTrend(-0.3)).toBe("baja");
    expect(percentTrend(2.5)).toBe("sube");
    expect(percentTrend(-1)).toBe("baja");
  });

  it("es «igual» si la variación redondeada es 0 %", () => {
    expect(percentTrend(0)).toBe("igual");
    expect(percentTrend(0.004)).toBe("igual");
    expect(percentTrend(-0.004)).toBe("igual");
    expect(percentTrend(-0)).toBe("igual");
  });

  it("a partir de medio punto ya cuenta, igual que el texto que se pinta", () => {
    expect(percentTrend(0.006)).toBe("sube");
    expect(percentTrend(-0.006)).toBe("baja");
  });

  it("coincide siempre con lo que pinta formatPercent", () => {
    const sinVariacion = formatPercent(0, { signo: true });
    for (const fraccion of [-0.5, -0.0149, -0.006, -0.004, -0.0001, 0, 0.0001, 0.004, 0.006, 0.0149, 0.5]) {
      const pintaCero = formatPercent(fraccion, { signo: true }) === sinVariacion;
      expect(percentTrend(fraccion) === "igual").toBe(pintaCero);
    }
  });

  it("rechaza valores que no son números", () => {
    expect(() => percentTrend(Number.NaN)).toThrow("número");
    expect(() => percentTrend(Number.POSITIVE_INFINITY)).toThrow("número");
  });
});
