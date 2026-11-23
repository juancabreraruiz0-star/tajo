import { describe, expect, it } from "vitest";
import { canMarkAccepted, canTransition, ESTADOS_PRESUPUESTO, nextActions, type EstadoPresupuesto } from "./status";

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

describe("canMarkAccepted", () => {
  it("solo gerencia y con la validez vigente", () => {
    expect(canMarkAccepted("admin", false)).toBe(true);
    expect(canMarkAccepted("admin", true)).toBe(false);
    expect(canMarkAccepted("empleado", false)).toBe(false);
    expect(canMarkAccepted("empleado", true)).toBe(false);
  });
});

describe("nextActions", () => {
  it("borrador: enviar (sin enlace todavía, tampoco para gerencia)", () => {
    expect(nextActions("borrador", "empleado")).toEqual(["enviar"]);
    expect(nextActions("borrador", "admin")).toEqual(["enviar"]);
  });

  it("enviado · gerencia: copiar enlace, aceptar, rechazar y regenerar el enlace", () => {
    expect(nextActions("enviado", "admin")).toEqual([
      "copiar_enlace",
      "marcar_aceptado",
      "marcar_rechazado",
      "regenerar_enlace",
    ]);
  });

  it("enviado · empleado: copiar enlace y rechazar; no puede darlo por aceptado ni regenerar el enlace", () => {
    expect(nextActions("enviado", "empleado")).toEqual(["copiar_enlace", "marcar_rechazado"]);
    expect(nextActions("enviado", "empleado", { vencido: true })).toEqual(["copiar_enlace", "marcar_rechazado"]);
  });

  it("enviado y vencido: nadie puede darlo por aceptado", () => {
    expect(nextActions("enviado", "admin", { vencido: true })).toEqual([
      "copiar_enlace",
      "marcar_rechazado",
      "regenerar_enlace",
    ]);
  });

  it("aceptado: facturar y regenerar el enlace solo si es admin", () => {
    expect(nextActions("aceptado", "admin")).toEqual(["facturar", "regenerar_enlace"]);
    expect(nextActions("aceptado", "empleado")).toEqual([]);
  });

  it("facturar no aparece en ningún otro estado", () => {
    for (const estado of ESTADOS_PRESUPUESTO.filter((e) => e !== "aceptado")) {
      expect(nextActions(estado, "admin")).not.toContain("facturar");
    }
  });

  it("marcar_aceptado solo aparece en enviado", () => {
    for (const estado of ESTADOS_PRESUPUESTO.filter((e) => e !== "enviado")) {
      expect(nextActions(estado, "admin")).not.toContain("marcar_aceptado");
    }
  });

  it("rechazado y facturado: solo gerencia puede regenerar el enlace", () => {
    expect(nextActions("rechazado", "admin")).toEqual(["regenerar_enlace"]);
    expect(nextActions("facturado", "admin")).toEqual(["regenerar_enlace"]);
    expect(nextActions("rechazado", "empleado")).toEqual([]);
    expect(nextActions("facturado", "empleado")).toEqual([]);
  });
});
