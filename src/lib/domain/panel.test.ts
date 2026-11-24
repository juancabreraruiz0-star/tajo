import { describe, expect, it } from "vitest";
import {
  embudoPresupuestos,
  facturacionPorMes,
  maximoMensual,
  mediaMensual,
  proporcion,
  rangoUltimosMeses,
} from "./panel";

const MADRID = "Europe/Madrid";
const AHORA = new Date("2026-11-23T10:00:00Z");

describe("rangoUltimosMeses", () => {
  it("cubre los 6 meses naturales hasta el actual incluido", () => {
    expect(rangoUltimosMeses(AHORA, MADRID)).toEqual({ desde: "2026-06-01", hasta: "2026-12-01" });
  });

  it("cruza el cambio de año", () => {
    expect(rangoUltimosMeses(new Date("2027-02-10T12:00:00Z"), MADRID)).toEqual({
      desde: "2026-09-01",
      hasta: "2027-03-01",
    });
  });

  it("decide el mes actual con la hora de Madrid", () => {
    // 23:30 UTC del 31/10 ya es noviembre en Madrid.
    expect(rangoUltimosMeses(new Date("2026-10-31T23:30:00Z"), MADRID)).toEqual({
      desde: "2026-06-01",
      hasta: "2026-12-01",
    });
  });

  it("rechaza un número de meses no válido", () => {
    expect(() => rangoUltimosMeses(AHORA, MADRID, 0)).toThrow("meses");
    expect(() => rangoUltimosMeses(AHORA, MADRID, 2.5)).toThrow("meses");
  });
});

describe("facturacionPorMes", () => {
  const facturas = [
    { fecha: "2026-06-01", total_cents: 10_000 },
    { fecha: "2026-06-30", total_cents: 5_000 },
    { fecha: "2026-08-15", total_cents: 250_000 },
    { fecha: "2026-11-01", total_cents: 7_550 },
    { fecha: "2026-11-23", total_cents: 2_450 },
    // Fuera del rango: no cuentan.
    { fecha: "2026-05-31", total_cents: 999_999 },
    { fecha: "2026-12-01", total_cents: 999_999 },
  ];

  it("agrupa por mes, del más antiguo al actual, y rellena con 0 los meses sin facturas", () => {
    expect(facturacionPorMes(facturas, AHORA, MADRID)).toEqual([
      { desde: "2026-06-01", totalCents: 15_000, actual: false },
      { desde: "2026-07-01", totalCents: 0, actual: false },
      { desde: "2026-08-01", totalCents: 250_000, actual: false },
      { desde: "2026-09-01", totalCents: 0, actual: false },
      { desde: "2026-10-01", totalCents: 0, actual: false },
      { desde: "2026-11-01", totalCents: 10_000, actual: true },
    ]);
  });

  it("sin facturas devuelve 6 meses a 0", () => {
    const serie = facturacionPorMes([], AHORA, MADRID);
    expect(serie).toHaveLength(6);
    expect(serie.every((m) => m.totalCents === 0)).toBe(true);
    expect(serie.filter((m) => m.actual)).toHaveLength(1);
  });

  it("el mes actual es el de Madrid aunque en UTC siga siendo el anterior", () => {
    const serie = facturacionPorMes(
      [{ fecha: "2026-11-01", total_cents: 1_000 }],
      new Date("2026-10-31T23:30:00Z"),
      MADRID,
    );
    expect(serie.at(-1)).toEqual({ desde: "2026-11-01", totalCents: 1_000, actual: true });
    expect(serie[0].desde).toBe("2026-06-01");
  });

  it("cruza el cambio de año", () => {
    const serie = facturacionPorMes(
      [
        { fecha: "2026-12-31", total_cents: 300 },
        { fecha: "2027-01-02", total_cents: 700 },
      ],
      new Date("2027-01-10T12:00:00Z"),
      MADRID,
      3,
    );
    expect(serie).toEqual([
      { desde: "2026-11-01", totalCents: 0, actual: false },
      { desde: "2026-12-01", totalCents: 300, actual: false },
      { desde: "2027-01-01", totalCents: 700, actual: true },
    ]);
  });

  it("rechaza importes que no son céntimos enteros", () => {
    expect(() => facturacionPorMes([{ fecha: "2026-11-02", total_cents: 1.5 }], AHORA, MADRID)).toThrow("céntimos");
  });
});

describe("maximoMensual y mediaMensual", () => {
  const serie = [
    { desde: "2026-09-01", totalCents: 100, actual: false },
    { desde: "2026-10-01", totalCents: 0, actual: false },
    { desde: "2026-11-01", totalCents: 201, actual: true },
  ];

  it("máximo de la serie", () => {
    expect(maximoMensual(serie)).toBe(201);
    expect(maximoMensual([])).toBe(0);
  });

  it("media redondeada al céntimo, contando los meses a 0", () => {
    expect(mediaMensual(serie)).toBe(100); // 301 / 3 = 100,33
    expect(mediaMensual([])).toBe(0);
  });
});

describe("proporcion", () => {
  it("fracción sobre el máximo, entre 0 y 1", () => {
    expect(proporcion(50, 200)).toBe(0.25);
    expect(proporcion(200, 200)).toBe(1);
    expect(proporcion(300, 200)).toBe(1);
  });

  it("0 si el máximo o el valor son 0", () => {
    expect(proporcion(0, 0)).toBe(0);
    expect(proporcion(10, 0)).toBe(0);
    expect(proporcion(0, 10)).toBe(0);
  });

  it("rechaza valores que no son números", () => {
    expect(() => proporcion(Number.NaN, 1)).toThrow("números");
  });
});

describe("embudoPresupuestos", () => {
  it("cada etapa cuenta los que llegaron a ella y la conversión sobre la anterior", () => {
    const embudo = embudoPresupuestos({ borrador: 2, enviado: 3, aceptado: 1, rechazado: 2, facturado: 2 });
    expect(embudo.total).toBe(10);
    expect(embudo.etapas.map((e) => [e.clave, e.total])).toEqual([
      ["creados", 10],
      ["enviados", 8],
      ["aceptados", 3],
      ["facturados", 2],
    ]);
    expect(embudo.etapas.map((e) => e.fraccion)).toEqual([1, 0.8, 0.3, 0.2]);
    expect(embudo.etapas[0].conversion).toBeNull();
    expect(embudo.etapas[1].conversion).toBe(0.8);
    expect(embudo.etapas[2].conversion).toBe(3 / 8);
    expect(embudo.etapas[3].conversion).toBe(2 / 3);
    expect(embudo.rechazados).toEqual({ total: 2, fraccionDeEnviados: 0.25 });
  });

  it("la aceptación coincide con la tasa del panel (aceptados + facturados sobre enviados)", () => {
    const embudo = embudoPresupuestos({ enviado: 5, aceptado: 3, facturado: 1, rechazado: 1 });
    expect(embudo.etapas[2].conversion).toBe(0.4);
  });

  it("sin presupuestos: todo a 0 y sin conversiones", () => {
    const embudo = embudoPresupuestos({});
    expect(embudo.total).toBe(0);
    expect(embudo.etapas.every((e) => e.total === 0 && e.fraccion === 0 && e.conversion === null)).toBe(true);
    expect(embudo.rechazados).toEqual({ total: 0, fraccionDeEnviados: null });
  });

  it("solo borradores: ninguna conversión más allá de enviados", () => {
    const embudo = embudoPresupuestos({ borrador: 4 });
    expect(embudo.etapas[1]).toMatchObject({ total: 0, fraccion: 0, conversion: 0 });
    expect(embudo.etapas[2].conversion).toBeNull();
    expect(embudo.rechazados.fraccionDeEnviados).toBeNull();
  });

  it("rechaza conteos negativos o con decimales", () => {
    expect(() => embudoPresupuestos({ enviado: -1 })).toThrow("enteros");
    expect(() => embudoPresupuestos({ enviado: 1.5 })).toThrow("enteros");
  });
});
