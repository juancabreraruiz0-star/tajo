import { describe, expect, it } from "vitest";
import {
  barraConsumo,
  buscarMateriales,
  normalizarBusqueda,
  confirmacionEstadoObra,
  filtroObras,
  filtroObrasPendienteDeConteo,
  formatConsumido,
  formatHoras,
  obrasHref,
  parseSemaforo,
  parteEditablePor,
  TEXTO_SEMAFORO,
  textoAccionEstadoObra,
} from "./obras-pantalla";

describe("filtroObras", () => {
  it("sin parámetro: «En curso» si hay alguna en curso y, si no, todas", () => {
    expect(filtroObras(undefined, true)).toBe("en_curso");
    expect(filtroObras(undefined, false)).toBeNull();
    expect(filtroObras("", true)).toBe("en_curso");
  });

  it("respeta el estado pedido y «todas»", () => {
    expect(filtroObras("terminada", true)).toBe("terminada");
    expect(filtroObras("pendiente", false)).toBe("pendiente");
    expect(filtroObras("todas", true)).toBeNull();
    expect(filtroObras(["parada", "en_curso"], true)).toBe("parada");
  });

  it("un estado que no existe cuenta como sin parámetro", () => {
    expect(filtroObras("borrador", true)).toBe("en_curso");
    expect(filtroObras("EN_CURSO", false)).toBeNull();
  });

  it("solo hace falta contar las obras en curso si la URL no decide", () => {
    expect(filtroObrasPendienteDeConteo(undefined)).toBe(true);
    expect(filtroObrasPendienteDeConteo("xyz")).toBe(true);
    expect(filtroObrasPendienteDeConteo("todas")).toBe(false);
    expect(filtroObrasPendienteDeConteo("parada")).toBe(false);
  });
});

describe("obrasHref", () => {
  it("lleva el estado o «todas»", () => {
    expect(obrasHref("en_curso")).toBe("/obras?estado=en_curso");
    expect(obrasHref(null)).toBe("/obras?estado=todas");
  });
});

describe("acciones de estado", () => {
  it("nombra cada paso como se dice en la obra", () => {
    expect(textoAccionEstadoObra("pendiente", "en_curso")).toBe("Empezar obra");
    expect(textoAccionEstadoObra("parada", "en_curso")).toBe("Reanudar");
    expect(textoAccionEstadoObra("en_curso", "parada")).toBe("Parar");
    expect(textoAccionEstadoObra("en_curso", "terminada")).toBe("Terminar obra");
    expect(textoAccionEstadoObra("parada", "terminada")).toBe("Terminar obra");
  });

  it("solo pide confirmación al terminar", () => {
    expect(confirmacionEstadoObra("terminada")).toMatch(/no se puede deshacer/);
    expect(confirmacionEstadoObra("en_curso")).toBeNull();
    expect(confirmacionEstadoObra("parada")).toBeNull();
  });
});

describe("semáforo (D12)", () => {
  it("lee la columna semaforo de la vista", () => {
    expect(parseSemaforo("verde")).toBe("verde");
    expect(parseSemaforo("ambar")).toBe("ambar");
    expect(parseSemaforo("rojo")).toBe("rojo");
  });

  it("cualquier otra cosa es null", () => {
    for (const valor of [null, undefined, "", "ROJO", "azul", 1, {}]) expect(parseSemaforo(valor)).toBeNull();
  });

  it("cada color tiene su texto", () => {
    expect(TEXTO_SEMAFORO).toEqual({ verde: "Va bien", ambar: "Ajustada", rojo: "En pérdidas" });
  });
});

describe("barraConsumo", () => {
  it("hasta el 100 % se rellena en proporción", () => {
    expect(barraConsumo(76.2)).toEqual({ relleno: 0.762, exceso: 0, marca: 1 });
    expect(barraConsumo(100)).toEqual({ relleno: 1, exceso: 0, marca: 1 });
  });

  it("por encima, la marca del 100 % se desplaza y el resto es exceso", () => {
    const barra = barraConsumo(150);
    expect(barra.marca).toBeCloseTo(2 / 3);
    expect(barra.relleno).toBeCloseTo(2 / 3);
    expect(barra.exceso).toBeCloseTo(1 / 3);
  });

  it("sin dato o a cero, vacía", () => {
    expect(barraConsumo(null)).toEqual({ relleno: 0, exceso: 0, marca: 1 });
    expect(barraConsumo(0)).toEqual({ relleno: 0, exceso: 0, marca: 1 });
    expect(barraConsumo(Number.NaN)).toEqual({ relleno: 0, exceso: 0, marca: 1 });
  });
});

describe("formatos", () => {
  it("porcentaje consumido con un decimal y coma", () => {
    expect(formatConsumido(112.4)).toBe("112,4 %");
    expect(formatConsumido(80)).toBe("80 %");
    expect(formatConsumido(null)).toBe("—");
  });

  it("horas", () => {
    expect(formatHoras(58)).toBe("58 h");
    expect(formatHoras(7.5)).toBe("7,5 h");
  });
});

describe("parteEditablePor", () => {
  const TONI = { id: "toni", rol: "empleado" as const };
  const GERENCIA = { id: "ana", rol: "admin" as const };
  // 23/11/2026 a las 10:00 en Madrid
  const ahora = new Date("2026-11-23T09:00:00Z");
  const deHoy = { autor_id: "toni", created_at: "2026-11-23T08:30:00Z" };
  const deAyer = { autor_id: "toni", created_at: "2026-11-22T17:30:00Z" };
  // 23:30 del 22 en Madrid es el 22, aunque en UTC ya sea el 22 a las 22:30
  const anocheTarde = { autor_id: "toni", created_at: "2026-11-22T22:30:00Z" };
  // 00:30 del 23 en Madrid (el 22 a las 23:30 en UTC) ya es de hoy
  const pasadaMedianoche = { autor_id: "toni", created_at: "2026-11-22T23:30:00Z" };

  it("el autor solo el día en que lo registró (hora de Madrid)", () => {
    expect(parteEditablePor(deHoy, TONI, "en_curso", ahora)).toBe(true);
    expect(parteEditablePor(deAyer, TONI, "en_curso", ahora)).toBe(false);
    expect(parteEditablePor(anocheTarde, TONI, "en_curso", ahora)).toBe(false);
    expect(parteEditablePor(pasadaMedianoche, TONI, "en_curso", ahora)).toBe(true);
  });

  it("otro empleado nunca; gerencia siempre", () => {
    expect(parteEditablePor(deHoy, { id: "otro", rol: "empleado" }, "en_curso", ahora)).toBe(false);
    expect(parteEditablePor({ ...deHoy, autor_id: null }, TONI, "en_curso", ahora)).toBe(false);
    expect(parteEditablePor(deAyer, GERENCIA, "en_curso", ahora)).toBe(true);
    expect(parteEditablePor(deAyer, GERENCIA, "parada", ahora)).toBe(true);
  });

  it("en una obra terminada, nadie", () => {
    expect(parteEditablePor(deHoy, TONI, "terminada", ahora)).toBe(false);
    expect(parteEditablePor(deHoy, GERENCIA, "terminada", ahora)).toBe(false);
  });
});

describe("buscarMateriales", () => {
  const materiales = [
    { id: "1", nombre: "Azulejo cerámico 30×60" },
    { id: "2", nombre: "Cemento cola C2" },
    { id: "3", nombre: "Tubería multicapa 16 mm" },
    { id: "4", nombre: "Plato de ducha 120×80" },
    { id: "5", nombre: "Grifería termostática" },
  ];

  it("busca sin tildes ni mayúsculas y con varias palabras en cualquier orden", () => {
    expect(normalizarBusqueda("  Cerámico   AZUL ")).toBe("ceramico azul");
    expect(buscarMateriales(materiales, "ceramico", new Set()).map((m) => m.id)).toEqual(["1"]);
    expect(buscarMateriales(materiales, "GRIFERIA", new Set()).map((m) => m.id)).toEqual(["5"]);
    expect(buscarMateriales(materiales, "16 tuberia", new Set()).map((m) => m.id)).toEqual(["3"]);
    expect(buscarMateriales(materiales, "ladrillo", new Set())).toEqual([]);
  });

  it("quita los que ya están en el parte y respeta el máximo", () => {
    expect(buscarMateriales(materiales, "", new Set(["1", "2"]), 2).map((m) => m.id)).toEqual(["3", "4"]);
    expect(buscarMateriales(materiales, "", new Set()).length).toBe(5);
  });
});
