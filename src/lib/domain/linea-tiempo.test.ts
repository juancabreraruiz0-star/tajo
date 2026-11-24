import { describe, expect, it } from "vitest";
import { lineaDeTiempo, textoCanalAceptacion, type DatosLineaTiempo } from "./linea-tiempo";

const BASE: DatosLineaTiempo = {
  estado: "borrador",
  created_at: "2026-11-02T09:00:00Z",
  enviado_at: null,
  aceptado_at: null,
  aceptado_canal: null,
  validoHasta: "02/12/2026",
};

const resumen = (datos: DatosLineaTiempo) => lineaDeTiempo(datos).map((h) => `${h.clave}:${h.estado}`);

describe("lineaDeTiempo", () => {
  it("borrador: creado y el siguiente paso es enviarlo", () => {
    expect(resumen(BASE)).toEqual(["creado:hecho", "enviado:siguiente", "aceptado:pendiente", "facturado:pendiente"]);
    expect(lineaDeTiempo(BASE)[0]).toMatchObject({ fecha: "2026-11-02T09:00:00Z", detalle: "Borrador: aún se puede editar" });
  });

  it("enviado: espera la aceptación y dice hasta cuándo", () => {
    const hitos = lineaDeTiempo({ ...BASE, estado: "enviado", enviado_at: "2026-11-03T10:00:00Z" });
    expect(hitos.map((h) => `${h.clave}:${h.estado}`)).toEqual([
      "creado:hecho",
      "enviado:hecho",
      "aceptado:siguiente",
      "facturado:pendiente",
    ]);
    expect(hitos[1].fecha).toBe("2026-11-03T10:00:00Z");
    expect(hitos[2].detalle).toBe("Puede aceptarlo hasta el 02/12/2026");
  });

  it("enviado y vencido: la aceptación queda cerrada", () => {
    const hitos = lineaDeTiempo({ ...BASE, estado: "enviado", enviado_at: "2026-11-03T10:00:00Z", vencido: true });
    expect(hitos[2]).toMatchObject({ estado: "cerrado", detalle: "La validez venció el 02/12/2026" });
    expect(hitos[3].estado).toBe("pendiente");
  });

  it("aceptado por el cliente desde el enlace: siguiente paso, facturar", () => {
    const hitos = lineaDeTiempo({
      ...BASE,
      estado: "aceptado",
      enviado_at: "2026-11-03T10:00:00Z",
      aceptado_at: "2026-11-05T18:00:00Z",
      aceptado_canal: "enlace",
      vencido: true, // un aceptado no se ve afectado por la validez
    });
    expect(hitos.map((h) => h.estado)).toEqual(["hecho", "hecho", "hecho", "siguiente"]);
    expect(hitos[2]).toMatchObject({ fecha: "2026-11-05T18:00:00Z", detalle: "Por el cliente, desde el enlace" });
  });

  it("facturado: con la factura si se puede ver (gerencia)", () => {
    const datos: DatosLineaTiempo = {
      ...BASE,
      estado: "facturado",
      enviado_at: "2026-11-03T10:00:00Z",
      aceptado_at: "2026-11-05T18:00:00Z",
      aceptado_canal: "interno",
      aceptadoPor: "Marta",
      factura: { numero: "F-2026-0007", fecha: "2026-11-10" },
    };
    const hitos = lineaDeTiempo(datos);
    expect(hitos.every((h) => h.estado === "hecho")).toBe(true);
    expect(hitos[2].detalle).toBe("Por Marta (gerencia), desde la app");
    expect(hitos[3]).toMatchObject({ fecha: "2026-11-10", detalle: "Factura F-2026-0007" });

    // Sin acceso a la factura (encargado): hecho, pero sin fecha ni número.
    expect(lineaDeTiempo({ ...datos, factura: null })[3]).toMatchObject({ estado: "hecho", fecha: null, detalle: null });
  });

  it("rechazado: termina en «Rechazado» y no hay factura", () => {
    const hitos = lineaDeTiempo({ ...BASE, estado: "rechazado", enviado_at: "2026-11-03T10:00:00Z" });
    expect(hitos.map((h) => `${h.clave}:${h.estado}`)).toEqual(["creado:hecho", "enviado:hecho", "rechazado:cerrado"]);
  });
});

describe("hito de la obra", () => {
  const ACEPTADO: DatosLineaTiempo = {
    ...BASE,
    estado: "aceptado",
    enviado_at: "2026-11-03T10:00:00Z",
    aceptado_at: "2026-11-05T18:00:00Z",
    aceptado_canal: "enlace",
  };

  it("sin obra no aparece (y nunca antes de aceptar)", () => {
    expect(resumen(ACEPTADO)).not.toContain("obra:pendiente");
    expect(lineaDeTiempo(ACEPTADO)).toHaveLength(4);
    const enviado = lineaDeTiempo({
      ...BASE,
      estado: "enviado",
      obra: { estado: "pendiente", fecha_inicio: null, fecha_fin: null },
    });
    expect(enviado.map((h) => h.clave)).not.toContain("obra");
  });

  it("aceptado con la obra sin empezar: pendiente; en curso: en marcha desde su inicio", () => {
    const pendiente = lineaDeTiempo({ ...ACEPTADO, obra: { estado: "pendiente", fecha_inicio: null, fecha_fin: null } });
    expect(pendiente[4]).toMatchObject({ clave: "obra", estado: "pendiente", fecha: null, detalle: "Sin empezar" });

    const enCurso = lineaDeTiempo({
      ...ACEPTADO,
      obra: { estado: "en_curso", fecha_inicio: "2026-11-10", fecha_fin: null },
    });
    expect(enCurso[4]).toMatchObject({ estado: "siguiente", fecha: "2026-11-10", detalle: "En curso desde esta fecha" });

    const parada = lineaDeTiempo({ ...ACEPTADO, obra: { estado: "parada", fecha_inicio: "2026-11-10", fecha_fin: null } });
    expect(parada[4]).toMatchObject({ estado: "siguiente", detalle: "Parada" });
  });

  it("facturado: la obra es lo siguiente; terminada, hecho con su fecha de fin", () => {
    const facturado: DatosLineaTiempo = { ...ACEPTADO, estado: "facturado" };
    expect(
      lineaDeTiempo({ ...facturado, obra: { estado: "pendiente", fecha_inicio: null, fecha_fin: null } })[4].estado,
    ).toBe("siguiente");
    const terminada = lineaDeTiempo({
      ...facturado,
      obra: { estado: "terminada", fecha_inicio: "2026-11-10", fecha_fin: "2026-11-20" },
    });
    expect(terminada.map((h) => h.estado)).toEqual(["hecho", "hecho", "hecho", "hecho", "hecho"]);
    expect(terminada[4]).toMatchObject({ fecha: "2026-11-20", detalle: "Obra terminada" });
  });
});

describe("textoCanalAceptacion", () => {
  it("dice quién y por dónde", () => {
    expect(textoCanalAceptacion("enlace")).toBe("Por el cliente, desde el enlace");
    expect(textoCanalAceptacion("interno", "Marta")).toBe("Por Marta (gerencia), desde la app");
    expect(textoCanalAceptacion("interno", null)).toBe("Por gerencia, desde la app");
    expect(textoCanalAceptacion(null)).toBeNull();
  });

  it("por el enlace, con el nombre que escribió el cliente (D12)", () => {
    expect(textoCanalAceptacion("enlace", null, "Ana López")).toBe("Por Ana López, desde el enlace");
    expect(textoCanalAceptacion("enlace", null, "  ")).toBe("Por el cliente, desde el enlace");
  });
});

describe("lineaDeTiempo con evidencia (D12)", () => {
  it("dice quién lo envió y el nombre de quien lo aceptó por el enlace", () => {
    const hitos = lineaDeTiempo({
      ...BASE,
      estado: "aceptado",
      enviado_at: "2026-11-03T10:00:00Z",
      aceptado_at: "2026-11-04T10:00:00Z",
      aceptado_canal: "enlace",
      aceptadoNombre: "Ana López",
      enviadoPor: "Marta",
    });
    expect(hitos[1].detalle).toBe("Por Marta");
    expect(hitos[2].detalle).toBe("Por Ana López, desde el enlace");
  });

  it("si no se sabe quién lo envió, sin detalle", () => {
    const hitos = lineaDeTiempo({ ...BASE, estado: "enviado", enviado_at: "2026-11-03T10:00:00Z", enviadoPor: null });
    expect(hitos[1].detalle).toBeNull();
  });
});
