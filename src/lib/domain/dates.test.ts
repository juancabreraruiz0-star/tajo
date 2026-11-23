import { describe, expect, it } from "vitest";
import { formatFecha, formatFechaLarga, formatMes } from "./dates";

describe("formatFecha", () => {
  it("pinta una fecha AAAA-MM-DD sin moverla de día", () => {
    expect(formatFecha("2026-01-05")).toBe("05/01/2026");
    expect(formatFecha("2026-12-31")).toBe("31/12/2026");
  });

  it("pinta un timestamp en hora de Madrid", () => {
    // 23:30 UTC del 31/12 ya es 1 de enero en Madrid (UTC+1).
    expect(formatFecha("2026-12-31T23:30:00Z")).toBe("01/01/2027");
    expect(formatFecha("2026-11-23T10:00:00+00:00")).toBe("23/11/2026");
  });

  it("rechaza texto que no es una fecha", () => {
    expect(() => formatFecha("mañana")).toThrow("Fecha no válida");
  });
});

describe("formatFechaLarga", () => {
  it("pinta día de la semana, día, mes y año en hora de Madrid", () => {
    expect(formatFechaLarga(new Date("2026-11-23T10:00:00Z"))).toBe("Lunes, 23 de noviembre de 2026");
    // 23:30 UTC del 31/12 ya es viernes 1 de enero en Madrid.
    expect(formatFechaLarga(new Date("2026-12-31T23:30:00Z"))).toBe("Viernes, 1 de enero de 2027");
  });

  it("rechaza fechas no válidas", () => {
    expect(() => formatFechaLarga(new Date("mañana"))).toThrow("Fecha no válida");
  });
});

describe("formatMes", () => {
  it("devuelve el nombre del mes", () => {
    expect(formatMes("2026-10-01")).toBe("octubre");
    expect(formatMes("2027-01-31")).toBe("enero");
  });

  it("rechaza lo que no es AAAA-MM-DD", () => {
    expect(() => formatMes("octubre")).toThrow("Fecha no válida");
  });
});
