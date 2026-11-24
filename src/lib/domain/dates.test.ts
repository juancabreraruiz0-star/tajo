import { describe, expect, it } from "vitest";
import {
  formatFecha,
  formatFechaEnLetra,
  formatFechaHora,
  formatFechaLarga,
  formatMes,
  formatMesAnio,
  formatMesCorto,
} from "./dates";

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

describe("formatFechaHora", () => {
  it("pinta fecha y hora de Madrid", () => {
    expect(formatFechaHora("2026-11-24T09:32:00Z")).toBe("24/11/2026 a las 10:32");
    // Verano (UTC+2) y cambio de día.
    expect(formatFechaHora("2026-07-01T22:05:00Z")).toBe("02/07/2026 a las 0:05");
  });

  it("rechaza texto que no es una fecha", () => {
    expect(() => formatFechaHora("ayer")).toThrow("Fecha no válida");
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

describe("formatMesCorto", () => {
  it("abrevia el mes con tres letras fijas", () => {
    expect(formatMesCorto("2026-01-01")).toBe("ene");
    expect(formatMesCorto("2026-09-01")).toBe("sep");
    expect(formatMesCorto("2026-12-31")).toBe("dic");
  });

  it("con un timestamp usa el mes de Madrid", () => {
    // 23:30 UTC del 31/10 ya es 1 de noviembre en Madrid.
    expect(formatMesCorto("2026-10-31T23:30:00Z")).toBe("nov");
  });

  it("rechaza fechas no válidas", () => {
    expect(() => formatMesCorto("2026-13-01")).toThrow("Fecha no válida");
    expect(() => formatMesCorto("ayer")).toThrow("Fecha no válida");
  });
});

describe("formatMesAnio", () => {
  it("pinta el mes completo con el año", () => {
    expect(formatMesAnio("2026-11-01")).toBe("noviembre de 2026");
    expect(formatMesAnio("2027-01-15")).toBe("enero de 2027");
  });
});

describe("formatFechaEnLetra", () => {
  const hoy = new Date("2026-11-23T10:00:00Z");

  it("sin año si es el año en curso", () => {
    expect(formatFechaEnLetra("2026-12-23", hoy)).toBe("23 de diciembre");
    expect(formatFechaEnLetra("2026-03-01", hoy)).toBe("1 de marzo");
  });

  it("con año si es otro año", () => {
    expect(formatFechaEnLetra("2027-01-05", hoy)).toBe("5 de enero de 2027");
    expect(formatFechaEnLetra("2025-12-31", hoy)).toBe("31 de diciembre de 2025");
  });

  it("un timestamp se lee en hora de Madrid, también para decidir el año", () => {
    // 23:30 UTC del 31/12/2026 ya es 1 de enero de 2027 en Madrid.
    expect(formatFechaEnLetra("2026-12-31T23:30:00Z", hoy)).toBe("1 de enero de 2027");
    // Y «hoy» también se mira en Madrid: a esa hora el año en curso ya es 2027.
    expect(formatFechaEnLetra("2027-01-01", new Date("2026-12-31T23:30:00Z"))).toBe("1 de enero");
  });

  it("rechaza fechas no válidas", () => {
    expect(() => formatFechaEnLetra("no es fecha", hoy)).toThrow("Fecha no válida");
  });
});
