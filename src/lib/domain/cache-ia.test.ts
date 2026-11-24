import { describe, expect, it } from "vitest";
import {
  FORMATO_CLAVE_IA,
  claveCacheIa,
  combinarPropuesta,
  huellaAlmacen,
  normalizarDescripcionIa,
  propuestaParaGuardar,
  type DatosClaveIa,
} from "./cache-ia";
import { validarSugerencia, type MaterialAlmacen, type SugerenciaValida } from "./sugerencias";

const E1 = "00000000-0000-0000-0000-000000000001";
const E2 = "00000000-0000-0000-0000-000000000002";
const PLATO = "20000000-0000-4000-8000-000000000001";
const AZULEJO = "20000000-0000-4000-8000-000000000002";
const CEMENTO = "20000000-0000-4000-8000-000000000003";

const MATERIALES: MaterialAlmacen[] = [
  { id: PLATO, nombre: "Plato de ducha resina 120×80", unidad: "ud", precio_cents: 18950 },
  { id: AZULEJO, nombre: "Azulejo porcelánico 30×60", unidad: "m²", precio_cents: 2475 },
  { id: CEMENTO, nombre: "Cemento cola C2TE 25 kg", unidad: "saco", precio_cents: 1150 },
];

const DESCRIPCION = "Reforma de baño de 6 m²: quitar la bañera y poner plato de ducha de 120, alicatado hasta el techo.";

const datos = (extra: Partial<DatosClaveIa> = {}): DatosClaveIa => ({
  empresaId: E1,
  descripcion: DESCRIPCION,
  materiales: MATERIALES,
  version: "v1",
  ...extra,
});

function ok(respuesta: unknown, materiales: readonly MaterialAlmacen[] = MATERIALES): SugerenciaValida {
  const r = validarSugerencia(respuesta, materiales);
  if (!r.ok) throw new Error(`Se esperaba ok y ha dado: ${r.error}`);
  return r.data;
}

describe("normalizarDescripcionIa", () => {
  it("minúsculas, espacios y saltos de línea juntos, sin espacios a los lados", () => {
    expect(normalizarDescripcionIa("  Reforma DE  Baño\r\n\n de 6 M²\t con   mampara ")).toBe("reforma de baño de 6 m² con mampara");
  });

  it("quita la puntuación del final (repetida o no), pero no la de dentro", () => {
    const base = "reforma de baño: 6 m², plato de 120";
    for (const final of ["", ".", "...", "…", "!!", " .", ". \n", "?!", ";"]) {
      expect(normalizarDescripcionIa(`Reforma de baño: 6 m², plato de 120${final}`), JSON.stringify(final)).toBe(base);
    }
  });

  it("no quita números, comas decimales ni unidades", () => {
    expect(normalizarDescripcionIa("Alicatado de 2,5 m² y 3 ud.")).toBe("alicatado de 2,5 m² y 3 ud");
    expect(normalizarDescripcionIa("Baño de 6 m²")).not.toBe(normalizarDescripcionIa("Baño de 8 m²"));
    expect(normalizarDescripcionIa("Baño de 6 m²")).not.toBe(normalizarDescripcionIa("Baño de 6 m³"));
    expect(normalizarDescripcionIa("Pintar 2,5 m")).not.toBe(normalizarDescripcionIa("Pintar 25 m"));
  });

  it("quita caracteres invisibles y unifica las tildes compuestas (NFC)", () => {
    expect(normalizarDescripcionIa("ba​ño")).toBe("baño");
    expect(normalizarDescripcionIa("baño")).toBe("baño");
  });
});

describe("huellaAlmacen", () => {
  it("no depende del orden en que llegan los materiales", () => {
    expect(huellaAlmacen([...MATERIALES].reverse())).toBe(huellaAlmacen(MATERIALES));
  });

  it("cambia con el precio, la unidad, el nombre, un alta o una baja", () => {
    const h = huellaAlmacen(MATERIALES);
    const cambiar = (i: number, extra: Partial<MaterialAlmacen>) => MATERIALES.map((m, j) => (j === i ? { ...m, ...extra } : m));
    expect(huellaAlmacen(cambiar(1, { precio_cents: 2476 }))).not.toBe(h);
    expect(huellaAlmacen(cambiar(1, { unidad: "caja" }))).not.toBe(h);
    expect(huellaAlmacen(cambiar(1, { nombre: "Azulejo 30×60" }))).not.toBe(h);
    expect(huellaAlmacen(MATERIALES.slice(0, 2))).not.toBe(h);
    expect(huellaAlmacen([...MATERIALES, { id: "20000000-0000-4000-8000-000000000004", nombre: "Mampara", unidad: "ud", precio_cents: 1 }])).not.toBe(h);
  });

  it("solo cuenta los 200 materiales que se le pasan a la IA", () => {
    const muchos = Array.from({ length: 201 }, (_, i) => ({ id: `m${String(i).padStart(3, "0")}`, nombre: `M ${i}`, unidad: "ud", precio_cents: i }));
    const otroUltimo = [...muchos.slice(0, 200), { ...muchos[200], precio_cents: 999 }];
    expect(huellaAlmacen(otroUltimo)).toBe(huellaAlmacen(muchos));
  });
});

describe("claveCacheIa", () => {
  it("es un SHA-256 en hexadecimal y determinista", async () => {
    const a = await claveCacheIa(datos());
    expect(a).toMatch(FORMATO_CLAVE_IA);
    expect(await claveCacheIa(datos())).toBe(a);
  });

  it("mismo texto con distinta capitalización, espacios, saltos de línea o punto final → misma clave", async () => {
    const a = await claveCacheIa(datos());
    for (const d of [
      DESCRIPCION.toUpperCase(),
      `  ${DESCRIPCION.replaceAll(" ", "   ")}  `,
      DESCRIPCION.replace(": ", ":\n").replace(", ", ",\r\n\t"),
      DESCRIPCION.replace(/\.$/, "..."),
      DESCRIPCION.replace(/\.$/, ""),
    ]) {
      expect(await claveCacheIa(datos({ descripcion: d })), d).toBe(a);
    }
  });

  it("un número distinto → otra clave", async () => {
    const a = await claveCacheIa(datos());
    expect(await claveCacheIa(datos({ descripcion: DESCRIPCION.replace("6 m²", "7 m²") }))).not.toBe(a);
    expect(await claveCacheIa(datos({ descripcion: DESCRIPCION.replace("120", "100") }))).not.toBe(a);
  });

  it("otro precio, unidad o material del almacén → otra clave; el mismo almacén en otro orden → la misma", async () => {
    const a = await claveCacheIa(datos());
    const otroPrecio = MATERIALES.map((m) => (m.id === AZULEJO ? { ...m, precio_cents: 2500 } : m));
    const otraUnidad = MATERIALES.map((m) => (m.id === CEMENTO ? { ...m, unidad: "kg" } : m));
    expect(await claveCacheIa(datos({ materiales: otroPrecio }))).not.toBe(a);
    expect(await claveCacheIa(datos({ materiales: otraUnidad }))).not.toBe(a);
    expect(await claveCacheIa(datos({ materiales: MATERIALES.slice(1) }))).not.toBe(a);
    expect(await claveCacheIa(datos({ materiales: [...MATERIALES].reverse() }))).toBe(a);
  });

  it("otra empresa u otra versión de la petición → otra clave", async () => {
    const a = await claveCacheIa(datos());
    expect(await claveCacheIa(datos({ empresaId: E2 }))).not.toBe(a);
    expect(await claveCacheIa(datos({ version: "v2" }))).not.toBe(a);
  });
});

describe("propuestaParaGuardar", () => {
  const RESPUESTA = {
    partidas: [
      { descripcion: "Demolición de alicatado", cantidad: 14.5, unidad: "m²", precio_euros: 12.345, material_id: null },
      { descripcion: "Plato de ducha", cantidad: 1, unidad: "ud.", precio_euros: 1, material_id: PLATO },
      { descripcion: "", cantidad: 18.333, unidad: "M2", precio_euros: 0, material_id: AZULEJO },
      { descripcion: "Cemento cola", cantidad: 3, unidad: "kg", precio_euros: 0.5, material_id: CEMENTO },
      { descripcion: "Oficial alicatador (h)", cantidad: 16, unidad: "h", precio_euros: 24, material_id: null },
      { descripcion: "Portes", cantidad: 1, unidad: "", precio_euros: 1234.56, material_id: null },
      { descripcion: "No vale", cantidad: -1, unidad: "ud", precio_euros: 1, material_id: null },
      "basura",
    ],
    supuestos: ["Altura de techo de 2,50 m", "Altura de techo de 2,50 m", "Plato de resina"],
  };

  it("al volver a validarla con el mismo almacén da exactamente las mismas partidas, en el mismo orden, y los mismos supuestos", () => {
    const validada = ok(RESPUESTA);
    expect(validada.descartadas).toBe(2);
    const guardada = propuestaParaGuardar(validada, MATERIALES);
    const otraVez = ok(JSON.parse(JSON.stringify(guardada)));
    expect(otraVez.partidas).toEqual(validada.partidas);
    expect(otraVez.supuestos).toEqual(validada.supuestos);
    expect(otraVez.descartadas).toBe(0);
    // Y es estable: guardarla otra vez da lo mismo.
    expect(propuestaParaGuardar(otraVez, MATERIALES)).toEqual(guardada);
  });

  it("solo lleva las partidas válidas y limpias: la unidad de una sin material ya va en su descripción", () => {
    const guardada = propuestaParaGuardar(ok(RESPUESTA), MATERIALES);
    expect(guardada.partidas).toHaveLength(6);
    expect(guardada.partidas[0]).toEqual({
      descripcion: "Demolición de alicatado (m²)",
      cantidad: 14.5,
      unidad: "",
      precio_euros: 12.35,
      material_id: null,
    });
    expect(guardada.partidas[1]).toEqual({ descripcion: "Plato de ducha", cantidad: 1, unidad: "ud", precio_euros: 189.5, material_id: PLATO });
    expect(guardada.partidas[2]).toMatchObject({ descripcion: "Azulejo porcelánico 30×60", cantidad: 18.333, unidad: "m²", material_id: AZULEJO });
    // Medido en otra unidad que su material: se guarda sin vincular, como la validó la IA.
    expect(guardada.partidas[3]).toMatchObject({ descripcion: "Cemento cola (kg)", unidad: "", material_id: null });
    expect(guardada.supuestos).toEqual(["Altura de techo de 2,50 m", "Plato de resina"]);
  });

  it("los precios en céntimos sobreviven a la ida y vuelta (sin errores de coma flotante)", () => {
    const precios = [1, 5, 10, 99, 105, 1005, 1999, 123456, 99999999, 100000000];
    const respuesta = {
      partidas: precios.map((c, i) => ({ descripcion: `Partida ${i}`, cantidad: 1.001, unidad: "", precio_euros: c / 100, material_id: null })),
      supuestos: [],
    };
    const validada = ok(respuesta);
    expect(ok(propuestaParaGuardar(validada, MATERIALES)).partidas).toEqual(validada.partidas);
  });

  it("si el material ya no está en el almacén, al volver a validarla queda sin vincular (no se inventa el precio)", () => {
    const guardada = propuestaParaGuardar(ok(RESPUESTA), MATERIALES);
    const sinPlato = MATERIALES.filter((m) => m.id !== PLATO);
    const otraVez = ok(guardada, sinPlato);
    expect(otraVez.partidas[1]).toMatchObject({ material_id: "", precio: "189,50" });
  });
});

describe("combinarPropuesta", () => {
  type F = { k: string; vacia?: boolean };
  const esVacia = (f: F) => f.vacia === true;
  const actuales: F[] = [{ k: "a" }, { k: "vacía", vacia: true }, { k: "b" }];
  const propuesta: F[] = [{ k: "x" }, { k: "y" }];

  it("por defecto sustituye las partidas actuales: pedirla dos veces no las duplica", () => {
    const primera = combinarPropuesta(actuales, propuesta, { anadir: false, esVacia, max: 100 });
    expect(primera).toEqual({ filas: propuesta, nuevas: propuesta });
    const segunda = combinarPropuesta(primera.filas, propuesta, { anadir: false, esVacia, max: 100 });
    expect(segunda.filas).toEqual(propuesta);
  });

  it("con «añadir» va detrás de las actuales, sin las filas vacías", () => {
    expect(combinarPropuesta(actuales, propuesta, { anadir: true, esVacia, max: 100 })).toEqual({
      filas: [{ k: "a" }, { k: "b" }, { k: "x" }, { k: "y" }],
      nuevas: propuesta,
    });
  });

  it("como mucho el máximo de filas: lo que no cabe no entra", () => {
    expect(combinarPropuesta(actuales, propuesta, { anadir: true, esVacia, max: 3 })).toEqual({
      filas: [{ k: "a" }, { k: "b" }, { k: "x" }],
      nuevas: [{ k: "x" }],
    });
    expect(combinarPropuesta(actuales, propuesta, { anadir: true, esVacia, max: 2 }).nuevas).toEqual([]);
    expect(combinarPropuesta(actuales, propuesta, { anadir: false, esVacia, max: 1 }).filas).toEqual([{ k: "x" }]);
  });
});
