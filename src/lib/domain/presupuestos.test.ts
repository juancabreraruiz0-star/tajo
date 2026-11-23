import { describe, expect, it } from "vitest";
import {
  draftLineCents,
  draftTotals,
  isExpired,
  LIMITES_PRESUPUESTO,
  MAX_TOTAL_CENTS,
  originFromHeaders,
  parseEstadoFiltro,
  parsePresupuestoPublico,
  parseRespuestaAceptar,
  presupuestosHref,
  publicBudgetUrl,
  validatePresupuesto,
  validUntil,
  type PartidaRaw,
  type PresupuestoRaw,
} from "./presupuestos";
import { budgetTotals } from "./totals";

const CLIENTE = "10000000-0000-4000-8000-000000000001";
const MATERIAL = "20000000-0000-4000-8000-000000000002";

const partida = (p: Partial<PartidaRaw> = {}): PartidaRaw => ({
  descripcion: "Alicatado de paredes",
  cantidad: "24",
  precio: "12,90",
  material_id: "",
  ...p,
});

const raw = (p: Partial<PresupuestoRaw> = {}): PresupuestoRaw => ({
  cliente_id: CLIENTE,
  titulo: "Reforma de baño",
  iva_pct: "21",
  validez_dias: "30",
  partidas: [partida()],
  ...p,
});

describe("validatePresupuesto", () => {
  it("devuelve los datos limpios, en céntimos y con orden 1..n", () => {
    const r = validatePresupuesto(
      raw({
        titulo: "  Reforma de baño  ",
        iva_pct: "10",
        partidas: [partida({ material_id: MATERIAL }), partida({ descripcion: "Fontanería", cantidad: "2,5", precio: "1.200,00" })],
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        cliente_id: CLIENTE,
        titulo: "Reforma de baño",
        iva_pct: 10,
        validez_dias: 30,
        partidas: [
          { orden: 1, descripcion: "Alicatado de paredes", cantidad: 24, precio_cents: 1290, material_id: MATERIAL },
          { orden: 2, descripcion: "Fontanería", cantidad: 2.5, precio_cents: 120000, material_id: null },
        ],
      },
    });
  });

  it("exige al menos una partida", () => {
    const r = validatePresupuesto(raw({ partidas: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.campos.partidas).toBe("Añade al menos una partida.");
  });

  it("limita el número de partidas", () => {
    const r = validatePresupuesto(raw({ partidas: Array.from({ length: LIMITES_PRESUPUESTO.partidas + 1 }, () => partida()) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.campos.partidas).toMatch(/Como mucho/);
  });

  it.each(["0", "0,000", ""])("rechaza la cantidad «%s» (la BD exige cantidad > 0)", (cantidad) => {
    const r = validatePresupuesto(raw({ partidas: [partida({ cantidad })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.partidas[0]?.cantidad).toBeDefined();
  });

  it("rechaza cantidades negativas o con más de 3 decimales", () => {
    for (const cantidad of ["-1", "1,2345", "abc"]) {
      const r = validatePresupuesto(raw({ partidas: [partida({ cantidad })] }));
      expect(r.ok).toBe(false);
    }
  });

  it("admite precio 0 y rechaza precio negativo, vacío o desproporcionado", () => {
    expect(validatePresupuesto(raw({ partidas: [partida({ precio: "0" })] })).ok).toBe(true);
    for (const precio of ["-5", "", "doce", "2.000.000,00"]) {
      const r = validatePresupuesto(raw({ partidas: [partida({ precio })] }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.partidas[0]?.precio).toBeDefined();
    }
  });

  it.each(["0", "4", "7", "", "21.5"])("solo permite IVA del 21 o 10 %% (rechaza «%s»)", (iva_pct) => {
    const r = validatePresupuesto(raw({ iva_pct }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.campos.iva_pct).toBeDefined();
  });

  it("valida cliente, título y validez", () => {
    const r = validatePresupuesto(raw({ cliente_id: "", titulo: "  ", validez_dias: "0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.campos.cliente_id).toBe("Elige el cliente.");
      expect(r.errors.campos.titulo).toBeDefined();
      expect(r.errors.campos.validez_dias).toBeDefined();
    }
    for (const validez_dias of ["", "2,5", "-3", "366"]) {
      expect(validatePresupuesto(raw({ validez_dias })).ok).toBe(false);
    }
    expect(validatePresupuesto(raw({ cliente_id: "no-es-uuid" })).ok).toBe(false);
  });

  it("marca los errores en la partida correcta", () => {
    const r = validatePresupuesto(
      raw({ partidas: [partida(), partida({ descripcion: "", material_id: "x" }), partida()] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.partidas[0]).toBeUndefined();
      expect(r.errors.partidas[1]).toEqual({ descripcion: "Describe la partida.", material_id: "El material no es válido." });
      expect(r.errors.partidas[2]).toBeUndefined();
      expect(r.errors.campos).toEqual({});
    }
  });

  it("rechaza un total (con IVA) por encima de 10^13 céntimos", () => {
    expect(MAX_TOTAL_CENTS).toBe(10_000_000_000_000);
    expect(Number.isSafeInteger(MAX_TOTAL_CENTS * LIMITES_PRESUPUESTO.partidas)).toBe(true);
    const r = validatePresupuesto(raw({ partidas: [partida({ cantidad: "1.000.000", precio: "1.000.000,00" })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.campos.partidas).toBe("El importe total es demasiado alto.");
    // 82.644 × 1.000.000 € = 8.264.400.000.000 cts de base; con el 21 % → 9.999.924.000.000 cts: cabe.
    expect(validatePresupuesto(raw({ partidas: [partida({ cantidad: "82.644", precio: "1.000.000,00" })] })).ok).toBe(true);
    // 82.645 → 10.000.045.000.000 cts con IVA: no cabe.
    expect(validatePresupuesto(raw({ partidas: [partida({ cantidad: "82.645", precio: "1.000.000,00" })] })).ok).toBe(false);
    // Importes que antes no cabían en integer (más de 21 millones de euros) ya se admiten.
    expect(validatePresupuesto(raw({ partidas: [partida({ cantidad: "30", precio: "1.000.000,00" })] })).ok).toBe(true);
  });

  it("limita la longitud del título y de la descripción", () => {
    const largo = "x".repeat(LIMITES_PRESUPUESTO.descripcion + 1);
    const r = validatePresupuesto(raw({ titulo: largo, partidas: [partida({ descripcion: largo })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.campos.titulo).toMatch(/Como mucho/);
      expect(r.errors.partidas[0]?.descripcion).toMatch(/Como mucho/);
    }
  });
});

describe("totales en vivo", () => {
  it("calcula el importe de la línea o null si aún no es válida", () => {
    expect(draftLineCents({ cantidad: "2,5", precio: "10,01" })).toBe(2503);
    expect(draftLineCents({ cantidad: "", precio: "10" })).toBeNull();
    expect(draftLineCents({ cantidad: "2", precio: "-1" })).toBeNull();
  });

  it("coincide con budgetTotals (mismo redondeo que el servidor) e ignora líneas incompletas", () => {
    const partidas = [
      { cantidad: "3", precio: "0,335" },
      { cantidad: "1,5", precio: "19,99" },
      { cantidad: "", precio: "100" },
    ];
    expect(draftTotals(partidas, "10")).toEqual(
      budgetTotals(
        [
          { cantidad: 3, precioCents: 34 },
          { cantidad: 1.5, precioCents: 1999 },
        ],
        10,
      ),
    );
  });

  it("usa el 21 % si el IVA no es válido", () => {
    expect(draftTotals([{ cantidad: "1", precio: "100" }], "x")).toEqual({
      baseCents: 10000,
      ivaCents: 2100,
      totalCents: 12100,
    });
  });
});

describe("filtro por estado", () => {
  it("lee el estado de la URL o null", () => {
    expect(parseEstadoFiltro("enviado")).toBe("enviado");
    expect(parseEstadoFiltro(["facturado", "borrador"])).toBe("facturado");
    expect(parseEstadoFiltro(undefined)).toBeNull();
    expect(parseEstadoFiltro("ENVIADO")).toBeNull();
    expect(parseEstadoFiltro("cualquiera")).toBeNull();
  });

  it("construye el enlace del filtro", () => {
    expect(presupuestosHref(null)).toBe("/presupuestos");
    expect(presupuestosHref("rechazado")).toBe("/presupuestos?estado=rechazado");
  });
});

describe("publicBudgetUrl", () => {
  const token = "2b1c0d3e-0000-4000-8000-000000000000";
  it("une origen y token sin barras dobles", () => {
    expect(publicBudgetUrl("https://tajo.vercel.app", token)).toBe(`https://tajo.vercel.app/p/${token}`);
    expect(publicBudgetUrl("https://tajo.vercel.app/", token)).toBe(`https://tajo.vercel.app/p/${token}`);
    expect(publicBudgetUrl("http://localhost:3000//", token)).toBe(`http://localhost:3000/p/${token}`);
  });
});

describe("originFromHeaders", () => {
  it("usa las cabeceras del proxy si existen", () => {
    expect(originFromHeaders({ host: "interno:3000", forwardedHost: "tajo.vercel.app", forwardedProto: "https" })).toBe(
      "https://tajo.vercel.app",
    );
  });
  it("en local usa http y fuera https por defecto", () => {
    expect(originFromHeaders({ host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(originFromHeaders({ host: "tajo.es" })).toBe("https://tajo.es");
  });
  it("devuelve null sin host o con un host raro", () => {
    expect(originFromHeaders({})).toBeNull();
    expect(originFromHeaders({ host: "evil.com/<script>" })).toBeNull();
  });
});

describe("validUntil", () => {
  it("suma los días a la fecha de creación en Madrid", () => {
    expect(validUntil("2026-03-10T09:00:00Z", 30)).toBe("2026-04-09");
    // 23:30 UTC del 31/12 ya es 1/1 en Madrid.
    expect(validUntil("2025-12-31T23:30:00Z", 15)).toBe("2026-01-16");
    // 22:30 UTC del 29/3 (ya en horario de verano) es 30/3 en Madrid.
    expect(validUntil("2026-03-29T22:30:00Z", 1)).toBe("2026-03-31");
  });
  it("lanza error con fecha o días no válidos", () => {
    expect(() => validUntil("no", 30)).toThrow();
    expect(() => validUntil("2026-03-10T09:00:00Z", 1.5)).toThrow();
  });
});

describe("isExpired", () => {
  const creado = "2026-03-10T09:00:00Z"; // válido hasta el 2026-04-09
  it("el último día todavía es válido", () => {
    expect(isExpired(creado, 30, new Date("2026-04-09T21:00:00Z"))).toBe(false);
  });
  it("vence al día siguiente (hora de Madrid)", () => {
    expect(isExpired(creado, 30, new Date("2026-04-09T22:30:00Z"))).toBe(true);
    expect(isExpired(creado, 30, new Date("2026-05-01T10:00:00Z"))).toBe(true);
  });
});

describe("parsePresupuestoPublico", () => {
  const respuesta = {
    empresa: { nombre: "Reformas Levante S.L.", cif: "B12345678", direccion: null, telefono: "961 234 567", email: null },
    cliente: { nombre: "Marta Soler" },
    presupuesto: {
      numero: "P-2026-0008",
      titulo: "Reforma integral de piso",
      estado: "enviado",
      iva_pct: 10,
      validez_dias: 30,
      created_at: "2026-11-14T10:00:00+00:00",
      enviado_at: "2026-11-16T10:00:00+00:00",
      aceptado_at: null,
    },
    lineas: [{ orden: 1, descripcion: "Demolición", cantidad: 2.5, precio_cents: 1000, importe_cents: 2500 }],
    base_cents: 2500,
    iva_cents: 250,
    total_cents: 2750,
  };

  it("lee una respuesta correcta", () => {
    const p = parsePresupuestoPublico(respuesta);
    expect(p?.presupuesto.numero).toBe("P-2026-0008");
    expect(p?.lineas).toHaveLength(1);
    expect(p?.total_cents).toBe(2750);
  });

  it("acepta numeric como texto", () => {
    const p = parsePresupuestoPublico({
      ...respuesta,
      lineas: [{ ...respuesta.lineas[0], cantidad: "2.5" }],
      total_cents: "2750",
    });
    expect(p?.lineas[0].cantidad).toBe(2.5);
    expect(p?.total_cents).toBe(2750);
  });

  it("devuelve null si no hay presupuesto o la forma no es la esperada", () => {
    expect(parsePresupuestoPublico(null)).toBeNull();
    expect(parsePresupuestoPublico({})).toBeNull();
    expect(parsePresupuestoPublico({ ...respuesta, presupuesto: { ...respuesta.presupuesto, estado: "otro" } })).toBeNull();
    expect(parsePresupuestoPublico({ ...respuesta, lineas: [{ descripcion: "x" }] })).toBeNull();
  });
});

describe("parseRespuestaAceptar", () => {
  it("lee el ok con la fecha", () => {
    expect(parseRespuestaAceptar({ ok: true, estado: "aceptado", aceptado_at: "2026-11-23T10:00:00Z" })).toEqual({
      ok: true,
      aceptadoAt: "2026-11-23T10:00:00Z",
    });
  });
  it("devuelve el motivo si no se ha podido aceptar", () => {
    expect(parseRespuestaAceptar({ ok: false, motivo: "Este presupuesto ya estaba aceptado." })).toEqual({
      ok: false,
      motivo: "Este presupuesto ya estaba aceptado.",
    });
  });
  it("da un mensaje genérico ante respuestas raras", () => {
    expect(parseRespuestaAceptar(null).ok).toBe(false);
    expect(parseRespuestaAceptar({ ok: true }).ok).toBe(false);
  });
});
