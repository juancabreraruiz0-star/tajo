import { describe, expect, it } from "vitest";
import { guiaDemo, guiaOculta, inicioDelDia, VALOR_GUIA_OCULTA, type HechosGuia } from "./guia-demo";

const NADA: HechosGuia = {
  presupuestoCreado: false,
  presupuestoEnviado: false,
  aceptadoPorEnlace: false,
  facturado: false,
  parteApuntado: false,
};

describe("guiaDemo", () => {
  it("gerencia ve los 5 pasos en orden, con enlace a donde se hace cada uno", () => {
    const guia = guiaDemo(NADA, { ia: true, admin: true });
    expect(guia.pasos.map((p) => p.clave)).toEqual(["crear", "enviar", "aceptar", "facturar", "parte"]);
    expect(guia.pasos.map((p) => p.href)).toEqual([
      "/presupuestos/nuevo",
      "/presupuestos?estado=borrador",
      "/presupuestos?estado=enviado",
      "/presupuestos?estado=aceptado",
      "/obras",
    ]);
    expect(guia).toMatchObject({ hechos: 0, total: 5, completa: false, siguiente: "crear" });
  });

  it("el encargado no ve el paso de facturar (solo factura gerencia)", () => {
    const guia = guiaDemo({ ...NADA, facturado: true }, { ia: true, admin: false });
    expect(guia.pasos.map((p) => p.clave)).toEqual(["crear", "enviar", "aceptar", "parte"]);
    expect(guia.total).toBe(4);
    expect(guia.hechos).toBe(0);
  });

  it("con IA propone montar el presupuesto con IA; sin IA, crearlo a mano", () => {
    expect(guiaDemo(NADA, { ia: true, admin: true }).pasos[0].titulo).toBe("Monta un presupuesto con IA");
    expect(guiaDemo(NADA, { ia: false, admin: true }).pasos[0].titulo).toBe("Crea un presupuesto");
  });

  it("cada paso se marca con su dato y el siguiente es el primero sin hacer", () => {
    const guia = guiaDemo(
      { ...NADA, presupuestoCreado: true, presupuestoEnviado: true, parteApuntado: true },
      { ia: false, admin: true },
    );
    expect(guia.pasos.map((p) => [p.clave, p.hecho])).toEqual([
      ["crear", true],
      ["enviar", true],
      ["aceptar", false],
      ["facturar", false],
      ["parte", true],
    ]);
    expect(guia).toMatchObject({ hechos: 3, completa: false, siguiente: "aceptar" });
  });

  it("completa cuando están todos los de su rol", () => {
    const todo: HechosGuia = {
      presupuestoCreado: true,
      presupuestoEnviado: true,
      aceptadoPorEnlace: true,
      facturado: true,
      parteApuntado: true,
    };
    expect(guiaDemo(todo, { ia: true, admin: true })).toMatchObject({ hechos: 5, completa: true, siguiente: null });
    // Al encargado no le hace falta facturar para terminarla.
    expect(guiaDemo({ ...todo, facturado: false }, { ia: true, admin: false })).toMatchObject({
      hechos: 4,
      completa: true,
      siguiente: null,
    });
  });
});

describe("guiaOculta", () => {
  it("solo con el valor de la cookie de «Ya lo conozco»", () => {
    expect(guiaOculta(VALOR_GUIA_OCULTA)).toBe(true);
    expect(guiaOculta(undefined)).toBe(false);
    expect(guiaOculta("")).toBe(false);
    expect(guiaOculta("visible")).toBe(false);
  });
});

describe("inicioDelDia", () => {
  it("en invierno, Madrid va una hora por delante de UTC", () => {
    expect(inicioDelDia("2026-11-23", "Europe/Madrid")).toBe("2026-11-22T23:00:00.000Z");
    expect(inicioDelDia("2027-01-01", "Europe/Madrid")).toBe("2026-12-31T23:00:00.000Z");
  });

  it("en verano, dos horas", () => {
    expect(inicioDelDia("2026-07-15", "Europe/Madrid")).toBe("2026-07-14T22:00:00.000Z");
  });

  it("los días del cambio de hora empiezan con el desfase de su medianoche", () => {
    // 29/03/2026: a las 2:00 pasan a ser las 3:00; la medianoche aún es de invierno.
    expect(inicioDelDia("2026-03-29", "Europe/Madrid")).toBe("2026-03-28T23:00:00.000Z");
    expect(inicioDelDia("2026-03-30", "Europe/Madrid")).toBe("2026-03-29T22:00:00.000Z");
    // 25/10/2026: a las 3:00 vuelven a ser las 2:00; la medianoche aún es de verano.
    expect(inicioDelDia("2026-10-25", "Europe/Madrid")).toBe("2026-10-24T22:00:00.000Z");
    expect(inicioDelDia("2026-10-26", "Europe/Madrid")).toBe("2026-10-25T23:00:00.000Z");
  });

  it("en UTC es la medianoche tal cual", () => {
    expect(inicioDelDia("2026-11-23", "UTC")).toBe("2026-11-23T00:00:00.000Z");
  });

  it("rechaza una fecha mal escrita", () => {
    expect(() => inicioDelDia("23/11/2026", "Europe/Madrid")).toThrow();
  });
});
