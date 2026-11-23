import { describe, expect, it } from "vitest";
import { canTransition, ESTADOS_PRESUPUESTO, nextActions, type EstadoPresupuesto } from "./status";

const permitidas: [EstadoPresupuesto, EstadoPresupuesto][] = [
  ["borrador", "enviado"],
  ["enviado", "aceptado"],
  ["enviado", "rechazado"],
  ["aceptado", "facturado"],
];

const esPermitida = (from: EstadoPresupuesto, to: EstadoPresupuesto) =>
  permitidas.some(([f, t]) => f === from && t === to);

const prohibidas = ESTADOS_PRESUPUESTO.flatMap((from) =>
  ESTADOS_PRESUPUESTO.filter((to) => !esPermitida(from, to)).map((to) => [from, to] as const),
);

describe("canTransition", () => {
  it.each(permitidas)("permite %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(prohibidas)("prohíbe %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("no se puede facturar un borrador ni un enviado", () => {
    expect(canTransition("borrador", "facturado")).toBe(false);
    expect(canTransition("enviado", "facturado")).toBe(false);
  });

  it("rechazado y facturado son estados finales", () => {
    for (const to of ESTADOS_PRESUPUESTO) {
      expect(canTransition("rechazado", to)).toBe(false);
      expect(canTransition("facturado", to)).toBe(false);
    }
  });
});

describe("nextActions", () => {
  it("borrador: enviar", () => {
    expect(nextActions("borrador", "empleado")).toEqual(["enviar"]);
    expect(nextActions("borrador", "admin")).toEqual(["enviar"]);
  });

  it("enviado: copiar enlace, aceptar o rechazar", () => {
    const esperadas = ["copiar_enlace", "marcar_aceptado", "marcar_rechazado"];
    expect(nextActions("enviado", "empleado")).toEqual(esperadas);
    expect(nextActions("enviado", "admin")).toEqual(esperadas);
  });

  it("aceptado: facturar solo si es admin", () => {
    expect(nextActions("aceptado", "admin")).toEqual(["facturar"]);
    expect(nextActions("aceptado", "empleado")).toEqual([]);
  });

  it("facturar no aparece en ningún otro estado", () => {
    for (const estado of ESTADOS_PRESUPUESTO.filter((e) => e !== "aceptado")) {
      expect(nextActions(estado, "admin")).not.toContain("facturar");
    }
  });

  it("rechazado y facturado no tienen acciones", () => {
    expect(nextActions("rechazado", "admin")).toEqual([]);
    expect(nextActions("facturado", "admin")).toEqual([]);
  });
});
