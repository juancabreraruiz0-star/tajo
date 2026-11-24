import { describe, expect, it } from "vitest";
import { validatePresupuesto } from "./presupuestos";
import {
  normalizarUnidad,
  ERROR_RESPUESTA_ILEGIBLE,
  ERROR_SIN_PARTIDAS,
  LIMITES_IA,
  validarDescripcionObra,
  validarSugerencia,
  type MaterialAlmacen,
  type SugerenciaValida,
} from "./sugerencias";

const PLATO = "20000000-0000-4000-8000-000000000001";
const AZULEJO = "20000000-0000-4000-8000-000000000002";
const OTRA_EMPRESA = "99999999-0000-4000-8000-000000000001";

const MATERIALES: MaterialAlmacen[] = [
  { id: PLATO, nombre: "Plato de ducha resina 120×80", unidad: "ud", precio_cents: 18950 },
  { id: AZULEJO, nombre: "Azulejo porcelánico 30×60", unidad: "m²", precio_cents: 2475 },
];

const partida = (extra: Record<string, unknown> = {}) => ({
  descripcion: "Alicatado de paredes",
  cantidad: 18,
  unidad: "m²",
  precio_euros: 24,
  material_id: null,
  ...extra,
});

function ok(respuesta: unknown, materiales: readonly MaterialAlmacen[] = MATERIALES): SugerenciaValida {
  const r = validarSugerencia(respuesta, materiales);
  if (!r.ok) throw new Error(`Se esperaba ok y ha dado: ${r.error}`);
  return r.data;
}

describe("validarDescripcionObra", () => {
  it("acepta una descripción normal, recortada y con saltos de línea", () => {
    expect(validarDescripcionObra("  Reforma de baño de 6 m²:\r\nquitar bañera  ")).toEqual({
      ok: true,
      valor: "Reforma de baño de 6 m²:\nquitar bañera",
    });
  });

  it("obligatoria y de al menos 10 caracteres", () => {
    expect(validarDescripcionObra("")).toEqual({ ok: false, error: "Describe la obra." });
    expect(validarDescripcionObra("   \n ")).toEqual({ ok: false, error: "Describe la obra." });
    expect(validarDescripcionObra(null)).toEqual({ ok: false, error: "Describe la obra." });
    expect(validarDescripcionObra({ texto: "Reforma de baño completa" })).toEqual({ ok: false, error: "Describe la obra." });
    expect(validarDescripcionObra("baño")).toMatchObject({ ok: false, error: expect.stringMatching(/al menos 10/) });
    expect(validarDescripcionObra("a".repeat(10))).toMatchObject({ ok: true });
  });

  it("como mucho 1000 caracteres", () => {
    expect(validarDescripcionObra("a".repeat(1000))).toMatchObject({ ok: true });
    expect(validarDescripcionObra("a".repeat(1001))).toEqual({ ok: false, error: "Como mucho 1000 caracteres." });
  });

  it("quita caracteres de control", () => {
    expect(validarDescripcionObra("Reforma\u0000 de\u202e baño")).toEqual({ ok: true, valor: "Reforma  de  baño" });
  });
});

describe("validarSugerencia · casos normales", () => {
  it("partida sin material: pasa a texto del formulario y la unidad va en la descripción", () => {
    const data = ok({
      partidas: [partida({ descripcion: "Oficial alicatador", cantidad: 16, unidad: "h", precio_euros: 28.5 })],
      supuestos: ["Paredes de 2,5 m de alto"],
    });
    expect(data).toEqual({
      partidas: [{ descripcion: "Oficial alicatador (h)", cantidad: "16", precio: "28,50", material_id: "" }],
      supuestos: ["Paredes de 2,5 m de alto"],
      descartadas: 0,
    });
  });

  it("no repite la unidad si la descripción ya la lleva al final", () => {
    const data = ok({ partidas: [partida({ descripcion: "Oficial alicatador (H)", unidad: "h" })], supuestos: [] });
    expect(data.partidas[0].descripcion).toBe("Oficial alicatador (H)");
  });

  it("partida con material del almacén: se vincula, con el precio del material y sin unidad en el texto", () => {
    const data = ok({
      partidas: [partida({ descripcion: "Plato de ducha 120", cantidad: 1, unidad: "ud", precio_euros: 189.5, material_id: PLATO })],
      supuestos: [],
    });
    expect(data.partidas).toEqual([{ descripcion: "Plato de ducha 120", cantidad: "1", precio: "189,50", material_id: PLATO }]);
  });

  it("cantidades con decimales y redondeo a 3 decimales; precios redondeados al céntimo", () => {
    const data = ok({
      partidas: [
        partida({ cantidad: 2.5, precio_euros: 1.005 }),
        partida({ cantidad: 1.23456, precio_euros: 12.344 }),
        partida({ cantidad: 1500, precio_euros: 0.1 }),
      ],
      supuestos: [],
    });
    expect(data.partidas.map((p) => [p.cantidad, p.precio])).toEqual([
      ["2,5", "1,01"],
      ["1,235", "12,34"],
      ["1500", "0,10"],
    ]);
  });

  it("lo que devuelve lo acepta la validación del formulario tal cual", () => {
    const data = ok({
      partidas: [
        partida({ descripcion: "Desmontaje de bañera", cantidad: 1, unidad: "ud", precio_euros: 120 }),
        partida({ descripcion: "Azulejo", cantidad: 21.6, material_id: AZULEJO }),
        partida({ descripcion: "x".repeat(400), cantidad: 9_999.999, precio_euros: 1_000_000 }),
      ],
      supuestos: [],
    });
    const r = validatePresupuesto({ cliente_id: PLATO, titulo: "Baño", iva_pct: "10", validez_dias: "30", partidas: data.partidas });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.partidas.map((p) => [p.cantidad, p.precio_cents, p.material_id])).toEqual([
        [1, 12000, null],
        [21.6, 2475, AZULEJO],
        [9_999.999, 100_000_000, null],
      ]);
    }
  });

  it("supuestos: limpios, sin repetidos y sin los que no son texto", () => {
    const data = ok({ partidas: [partida()], supuestos: ["  Altura  de 2,5 m ", 7, null, "", "Altura de 2,5 m", "Calidad media"] });
    expect(data.supuestos).toEqual(["Altura de 2,5 m", "Calidad media"]);
  });

  it("supuestos que faltan o no son una lista: ninguno", () => {
    expect(ok({ partidas: [partida()] }).supuestos).toEqual([]);
    expect(ok({ partidas: [partida()], supuestos: "Altura de 2,5 m" }).supuestos).toEqual([]);
  });

  it("partidas vacías: se ignoran sin contarlas", () => {
    const data = ok({ partidas: [partida({ descripcion: "   " }), partida(), partida({ descripcion: "" })], supuestos: [] });
    expect(data.partidas).toHaveLength(1);
    expect(data.descartadas).toBe(0);
  });

  it("sin descripción pero con material del almacén: usa el nombre del material", () => {
    const data = ok({ partidas: [partida({ descripcion: "", cantidad: 20, material_id: AZULEJO })], supuestos: [] });
    expect(data.partidas[0]).toEqual({ descripcion: "Azulejo porcelánico 30×60", cantidad: "20", precio: "24,75", material_id: AZULEJO });
  });
});

describe("validarSugerencia · límites", () => {
  it(`como mucho ${LIMITES_IA.partidas} partidas; las demás cuentan como descartadas`, () => {
    const data = ok({ partidas: Array.from({ length: 50 }, (_, i) => partida({ descripcion: `Partida ${i + 1}` })), supuestos: [] });
    expect(data.partidas).toHaveLength(30);
    expect(data.partidas[29].descripcion).toBe("Partida 30 (m²)");
    expect(data.descartadas).toBe(20);
  });

  it("exactamente 30 partidas: ninguna descartada", () => {
    const data = ok({ partidas: Array.from({ length: 30 }, () => partida()), supuestos: [] });
    expect(data).toMatchObject({ descartadas: 0 });
    expect(data.partidas).toHaveLength(30);
  });

  it(`como mucho ${LIMITES_IA.supuestos} supuestos de ${LIMITES_IA.supuesto} caracteres`, () => {
    const data = ok({ partidas: [partida()], supuestos: Array.from({ length: 10 }, (_, i) => `${i} ${"s".repeat(300)}`) });
    expect(data.supuestos).toHaveLength(6);
    expect(data.supuestos.every((s) => s.length === 200)).toBe(true);
  });

  it("descripción recortada a 300 caracteres (con la unidad dentro) y sin partir un emoji", () => {
    const larga = ok({ partidas: [partida({ descripcion: "d".repeat(500), unidad: "m²" })], supuestos: [] });
    expect(larga.partidas[0].descripcion).toHaveLength(300);
    expect(larga.partidas[0].descripcion.endsWith(" (m²)")).toBe(true);

    const emoji = ok({ partidas: [partida({ descripcion: `${"d".repeat(299)}🚿🚿`, unidad: "" })], supuestos: [] });
    expect(emoji.partidas[0].descripcion).toBe("d".repeat(299));
  });

  it("cantidad: la mínima que no se redondea a 0 y la máxima del dominio", () => {
    const data = ok({
      partidas: [partida({ cantidad: 0.001 }), partida({ cantidad: 1_000_000_000, precio_euros: 0 })],
      supuestos: [],
    });
    expect(data.partidas.map((p) => p.cantidad)).toEqual(["0,001", "1000000000"]);
    expect(data.descartadas).toBe(0);
  });

  it("precio: 0 € y el máximo de 1.000.000 € por unidad", () => {
    const data = ok({ partidas: [partida({ precio_euros: 0 }), partida({ cantidad: 1, precio_euros: 1_000_000 })], supuestos: [] });
    expect(data.partidas.map((p) => p.precio)).toEqual(["0,00", "1000000,00"]);
  });

  it("importe de la partida por encima del tope del presupuesto: descartada", () => {
    const data = ok({ partidas: [partida(), partida({ cantidad: 1_000_000_000, precio_euros: 1_000_000 })], supuestos: [] });
    expect(data.partidas).toHaveLength(1);
    expect(data.descartadas).toBe(1);
  });
});

describe("validarSugerencia · respuestas maliciosas o rotas", () => {
  it("material de otra empresa o inventado: la partida se queda, pero sin vincular y con su precio", () => {
    const data = ok({
      partidas: [
        partida({ descripcion: "Plato de ducha", cantidad: 1, precio_euros: 150, material_id: OTRA_EMPRESA }),
        partida({ descripcion: "Mampara", cantidad: 1, precio_euros: 320, material_id: "no-es-un-uuid" }),
        partida({ descripcion: "Grifería", cantidad: 1, precio_euros: 95, material_id: 42 }),
      ],
      supuestos: [],
    });
    expect(data.partidas.map((p) => [p.material_id, p.precio])).toEqual([
      ["", "150,00"],
      ["", "320,00"],
      ["", "95,00"],
    ]);
    expect(data.descartadas).toBe(0);
  });

  it("precio inventado para un material del almacén: manda el precio del almacén", () => {
    const data = ok({
      partidas: [
        partida({ descripcion: "Azulejo", cantidad: 20, precio_euros: 0.01, material_id: AZULEJO }),
        partida({ descripcion: "Plato", cantidad: 1, unidad: "ud", precio_euros: 999_999, material_id: PLATO }),
        partida({ descripcion: "Plato", cantidad: 1, unidad: "ud", precio_euros: -50, material_id: PLATO }),
        partida({ descripcion: "Plato", cantidad: 1, unidad: "ud", precio_euros: "gratis", material_id: PLATO }),
      ],
      supuestos: [],
    });
    expect(data.partidas.map((p) => p.precio)).toEqual(["24,75", "189,50", "189,50", "189,50"]);
  });

  it("solo vale un material de la lista que se le pasa (la de la empresa del usuario)", () => {
    const data = ok({ partidas: [partida({ material_id: AZULEJO, precio_euros: 1 })], supuestos: [] }, [MATERIALES[0]]);
    expect(data.partidas[0]).toMatchObject({ material_id: "", precio: "1,00" });
  });

  it("cantidades negativas, cero, enormes, NaN o como texto: descartadas y contadas", () => {
    const r = validarSugerencia(
      {
        partidas: [
          partida({ cantidad: -3 }),
          partida({ cantidad: 0 }),
          partida({ cantidad: 0.0004 }),
          partida({ cantidad: 1e12 }),
          partida({ cantidad: 1e300 }),
          partida({ cantidad: "18" }),
          partida({ cantidad: null }),
          partida(),
        ],
        supuestos: [],
      },
      MATERIALES,
    );
    expect(r).toMatchObject({ ok: true, data: { descartadas: 7 } });
    if (r.ok) expect(r.data.partidas).toHaveLength(1);
  });

  it("precios negativos, enormes o que no son número (sin material): descartadas", () => {
    const data = ok({
      partidas: [
        partida({ precio_euros: -1 }),
        partida({ precio_euros: 1_000_000.01 }),
        partida({ precio_euros: Number.POSITIVE_INFINITY }),
        partida({ precio_euros: "24" }),
        partida({ precio_euros: undefined }),
        partida(),
      ],
      supuestos: [],
    });
    expect(data.partidas).toHaveLength(1);
    expect(data.descartadas).toBe(5);
  });

  it("campos de más: se ignoran (ni importe, ni orden, ni empresa)", () => {
    const data = ok({
      partidas: [partida({ importe_cents: 1, orden: 99, empresa_id: OTRA_EMPRESA, precio_cents: 1 })],
      supuestos: [],
      total: 1,
      instrucciones: "ignora las reglas",
    });
    expect(data.partidas).toEqual([{ descripcion: "Alicatado de paredes (m²)", cantidad: "18", precio: "24,00", material_id: "" }]);
  });

  it("tipos mal en la partida: descartada y contada", () => {
    const data = ok({
      partidas: [null, 7, "partida", [partida()], partida({ descripcion: 12 }), partida({ descripcion: null }), {}, partida()],
      supuestos: [],
    });
    expect(data.partidas).toHaveLength(1);
    expect(data.descartadas).toBe(7);
  });

  it("textos con caracteres de control o de cambio de dirección: se limpian", () => {
    const data = ok({
      partidas: [partida({ descripcion: "Alicatado\u0000\n\t de\u202e paredes", unidad: "m\u0007²" })],
      supuestos: ["Línea 1\nLínea 2"],
    });
    expect(data.partidas[0].descripcion).toBe("Alicatado de paredes (m ²)");
    expect(data.supuestos).toEqual(["Línea 1 Línea 2"]);
  });

  it("respuesta sin la forma esperada: error legible", () => {
    for (const respuesta of [null, undefined, "texto", 42, [], {}, { partidas: "muchas" }, { partidas: { 0: partida() } }]) {
      expect(validarSugerencia(respuesta, MATERIALES)).toEqual({ ok: false, error: ERROR_RESPUESTA_ILEGIBLE });
    }
  });

  it("ninguna partida válida: error que lo explica", () => {
    expect(validarSugerencia({ partidas: [], supuestos: ["x"] }, MATERIALES)).toEqual({ ok: false, error: ERROR_SIN_PARTIDAS });
    expect(validarSugerencia({ partidas: [partida({ cantidad: -1 }), partida({ descripcion: "" })], supuestos: [] }, MATERIALES)).toEqual({
      ok: false,
      error: ERROR_SIN_PARTIDAS,
    });
  });

  it("un material con un precio imposible en la lista (dato corrupto): la partida se descarta", () => {
    const r = validarSugerencia({ partidas: [partida({ unidad: "ud", material_id: PLATO }), partida()] }, [{ ...MATERIALES[0], precio_cents: -5 }]);
    expect(r).toMatchObject({ ok: true, data: { descartadas: 1 } });
  });
});

describe("unidad del material vinculado", () => {
  it.each([
    ["m²", "m2"],
    ["M2", "m2"],
    [" m ² ", "m2"],
    ["m³", "m3"],
    ["ud.", "ud"],
    ["uds", "ud"],
    ["Unidad", "ud"],
    ["u", "ud"],
    ["m.l.", "ml"],
    ["ML", "ml"],
    ["horas", "h"],
    ["h", "h"],
    ["kg", "kg"],
  ])("normalizarUnidad(%j) = %j", (entrada, esperada) => {
    expect(normalizarUnidad(entrada)).toBe(esperada);
  });

  it("misma unidad escrita de otra forma: se vincula con el precio del almacén", () => {
    const data = ok({
      partidas: [
        partida({ descripcion: "Azulejo", cantidad: 20, unidad: "M2", precio_euros: 1, material_id: AZULEJO }),
        partida({ descripcion: "Plato", cantidad: 1, unidad: "uds.", precio_euros: 1, material_id: PLATO }),
      ],
      supuestos: [],
    });
    expect(data.partidas.map((p) => [p.material_id, p.precio, p.descripcion])).toEqual([
      [AZULEJO, "24,75", "Azulejo"],
      [PLATO, "189,50", "Plato"],
    ]);
  });

  it("unidad distinta de la del material: sin vincular, con el precio y la unidad de la IA", () => {
    const data = ok({
      partidas: [
        // El azulejo se vende por m²; la IA lo ha medido en cajas.
        partida({ descripcion: "Azulejo porcelánico", cantidad: 12, unidad: "caja", precio_euros: 35.4, material_id: AZULEJO }),
        // El plato es por unidades; la IA ha puesto m².
        partida({ descripcion: "Plato de ducha", cantidad: 0.96, unidad: "m²", precio_euros: 210, material_id: PLATO }),
      ],
      supuestos: [],
    });
    expect(data.partidas).toEqual([
      { descripcion: "Azulejo porcelánico (caja)", cantidad: "12", precio: "35,40", material_id: "" },
      { descripcion: "Plato de ducha (m²)", cantidad: "0,96", precio: "210,00", material_id: "" },
    ]);
    expect(data.descartadas).toBe(0);
  });

  it("unidad distinta y precio de la IA no válido: descartada (no se cuela el precio del almacén)", () => {
    const r = validarSugerencia(
      { partidas: [partida({ unidad: "caja", precio_euros: -1, material_id: AZULEJO }), partida()], supuestos: [] },
      MATERIALES,
    );
    expect(r).toMatchObject({ ok: true, data: { descartadas: 1 } });
  });

  it("sin unidad (texto vacío o que no es texto): no se vincula", () => {
    const data = ok({
      partidas: [
        partida({ descripcion: "Azulejo", unidad: "", precio_euros: 30, material_id: AZULEJO }),
        partida({ descripcion: "Azulejo", unidad: null, precio_euros: 30, material_id: AZULEJO }),
      ],
      supuestos: [],
    });
    expect(data.partidas.map((p) => [p.material_id, p.precio])).toEqual([
      ["", "30,00"],
      ["", "30,00"],
    ]);
  });

  it("sin descripción, con un material de otra unidad: vacía (no toma el nombre del material)", () => {
    expect(validarSugerencia({ partidas: [partida({ descripcion: "", unidad: "caja", material_id: AZULEJO })] }, MATERIALES)).toEqual({
      ok: false,
      error: ERROR_SIN_PARTIDAS,
    });
  });
});

describe("caracteres invisibles", () => {
  const ZW = "\u200b";
  const ZWNJ = "\u200c";
  const ZWJ = "\u200d";
  const BOM = "\ufeff";
  const RLO = "\u202e";

  it("los de ancho cero se quitan en descripciones, unidades y supuestos", () => {
    const data = ok({
      partidas: [partida({ descripcion: `${BOM}Ali${ZW}ca${ZWNJ}tado${ZWJ}`, unidad: `m${ZW}²` })],
      supuestos: [`Al${ZW}tura${BOM}`, `${ZW}${ZWJ}`],
    });
    expect(data.partidas[0].descripcion).toBe("Alicatado (m²)");
    expect(data.supuestos).toEqual(["Altura"]);
  });

  it("una descripción solo de invisibles cuenta como vacía", () => {
    expect(validarSugerencia({ partidas: [partida({ descripcion: `${ZW}${BOM} ${RLO}` })] }, MATERIALES)).toEqual({
      ok: false,
      error: ERROR_SIN_PARTIDAS,
    });
  });

  it("un id de material con invisibles no se vincula", () => {
    const data = ok({ partidas: [partida({ material_id: `${AZULEJO}${ZW}`, precio_euros: 3 })], supuestos: [] });
    expect(data.partidas[0]).toMatchObject({ material_id: "", precio: "3,00" });
  });

  it("descripción de la obra: se quitan los de ancho cero y se conservan los saltos de línea", () => {
    expect(validarDescripcionObra(`${BOM}Reforma${ZW} de baño\ncon ${RLO}ducha`)).toEqual({
      ok: true,
      valor: "Reforma de baño\ncon  ducha",
    });
    expect(validarDescripcionObra(`${ZW.repeat(20)}baño`)).toMatchObject({ ok: false });
  });
});
