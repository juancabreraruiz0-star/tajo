// «Montar con IA» (D10): validación de la descripción de la obra y de la respuesta de la IA.
// La respuesta de la IA es un dato NO fiable: aquí se comprueba todo antes de que toque el formulario (material del
// almacén de la empresa o ninguno, precio del material si va vinculada, cantidades y precios dentro de los límites,
// textos recortados). Puro: sin Next, Supabase ni el SDK de Anthropic.

import { centsToEurosInput, eurosToCents } from "./money";
import { LIMITES_PRESUPUESTO, MAX_TOTAL_CENTS, type PartidaRaw } from "./presupuestos";
import { parseQuantity, quantityToInput } from "./quantity";
import { lineTotalCents } from "./totals";
import { LIMITES_MATERIAL, MAX_PRECIO_CENTS } from "./validation";

export const LIMITES_IA = {
  /** Descripción de la obra que escribe el usuario. */
  descripcionMin: 10,
  descripcionMax: 1000,
  /** Partidas que se aceptan de una propuesta. */
  partidas: 30,
  /** Supuestos que se muestran y su largo máximo. */
  supuestos: 6,
  supuesto: 200,
  /** Materiales del almacén que se mandan a la IA. */
  materiales: 200,
} as const;

/** Material del almacén de la empresa (leído con la RLS del usuario). */
export interface MaterialAlmacen {
  id: string;
  nombre: string;
  unidad: string;
  precio_cents: number;
}

// ----------------------------------------------------------------------------
// Textos
// ----------------------------------------------------------------------------

// Caracteres de control y de cambio de dirección del texto (pueden disfrazar lo que se ve en pantalla): se
// cambian por un espacio. Van como escapes \u… para que se vean en el código.
const BIDI = "\u200e\u200f\u202a-\u202e\u2066-\u2069";
const CONTROL = new RegExp(`[\u0000-\u001f\u007f-\u009f${BIDI}]`, "g");
/** Igual, pero conserva tabuladores y saltos de línea (descripción de la obra). */
const CONTROL_MULTILINEA = new RegExp(`[\u0000-\u0008\u000b-\u001f\u007f-\u009f${BIDI}]`, "g");
// Caracteres de ancho cero (espacio, unión y no unión de ancho cero, unión de palabras, BOM): se quitan sin más.
const ANCHO_CERO = /[\u200b-\u200d\u2060\ufeff]/g;

/** Corta a `max` unidades de texto (como maxLength y la validación del formulario) sin partir un emoji. */
function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  let corte = texto.slice(0, max);
  const ultimo = corte.charCodeAt(corte.length - 1);
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) corte = corte.slice(0, -1);
  return corte.trimEnd();
}

/** Texto en una línea: sin caracteres de control, espacios seguidos juntos y recortado. null si no es texto. */
function textoLinea(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  return recortar(valor.replace(ANCHO_CERO, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim(), max);
}

// ----------------------------------------------------------------------------
// Descripción de la obra (lo que escribe el usuario)
// ----------------------------------------------------------------------------

export type DescripcionObraValidation = { ok: true; valor: string } | { ok: false; error: string };

/** Descripción de la obra: obligatoria, de 10 a 1000 caracteres. Conserva los saltos de línea. */
export function validarDescripcionObra(valor: unknown): DescripcionObraValidation {
  if (typeof valor !== "string") return { ok: false, error: "Describe la obra." };
  const limpio = valor
    .replace(/\r\n?/g, "\n")
    .replace(ANCHO_CERO, "")
    .replace(CONTROL_MULTILINEA, " ")
    .trim();
  if (limpio === "") return { ok: false, error: "Describe la obra." };
  if (limpio.length < LIMITES_IA.descripcionMin) {
    return { ok: false, error: `Cuenta algo más de la obra (al menos ${LIMITES_IA.descripcionMin} caracteres).` };
  }
  if (limpio.length > LIMITES_IA.descripcionMax) {
    return { ok: false, error: `Como mucho ${LIMITES_IA.descripcionMax} caracteres.` };
  }
  return { ok: true, valor: limpio };
}

// ----------------------------------------------------------------------------
// Respuesta de la IA
// ----------------------------------------------------------------------------

export interface SugerenciaValida {
  /** Partidas listas para el formulario (mismos textos que escribiría el usuario: "2,5", "12,50"). */
  partidas: PartidaRaw[];
  /** Lo que la IA ha dado por supuesto (medidas, calidades…), para avisar al usuario. */
  supuestos: string[];
  /** Partidas propuestas que no se han añadido: no válidas, fuera de rango o por encima del máximo. */
  descartadas: number;
}

export type SugerenciaValidation = { ok: true; data: SugerenciaValida } | { ok: false; error: string };

export const ERROR_RESPUESTA_ILEGIBLE = "La IA ha devuelto una respuesta que no se puede leer. Inténtalo de nuevo.";
export const ERROR_SIN_PARTIDAS =
  "La IA no ha propuesto ninguna partida válida. Prueba a describir la obra con más detalle.";

type Obj = Record<string, unknown>;

function isObj(valor: unknown): valor is Obj {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Cantidad > 0, con 3 decimales como mucho (se redondea) y dentro del límite del dominio. null si no vale. */
function leerCantidad(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) return null;
  try {
    // Mismo camino que lo que escribe el usuario: "2.5" con punto sería 2500 (miles), así que va con coma.
    const cantidad = parseQuantity(valor.toFixed(3).replace(".", ","));
    return cantidad > 0 ? cantidad : null;
  } catch {
    return null;
  }
}

/** Precio en euros → céntimos (redondeo al céntimo del dominio), entre 0 y el máximo por unidad. null si no vale. */
function leerPrecioCents(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) return null;
  try {
    const cents = eurosToCents(valor);
    return cents <= MAX_PRECIO_CENTS ? cents : null;
  } catch {
    return null;
  }
}

const ALIAS_UNIDAD: Readonly<Record<string, string>> = {
  u: "ud",
  uds: "ud",
  unidad: "ud",
  unidades: "ud",
  hora: "h",
  horas: "h",
  hr: "h",
  hrs: "h",
  mts: "m",
  metro: "m",
  metros: "m",
  ml: "ml",
  metrolineal: "ml",
  metroslineales: "ml",
};

/**
 * Unidad para comparar: "m²" = "M2" = "m 2", "ud." = "uds" = "unidad", "m.l." = "ml", "horas" = "h".
 * NFKC convierte los superíndices (² ³) en cifras.
 */
export function normalizarUnidad(unidad: string): string {
  const limpia = unidad.normalize("NFKC").toLowerCase().replace(/[\s.]/g, "");
  return ALIAS_UNIDAD[limpia] ?? limpia;
}

function precioMaterialValido(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_PRECIO_CENTS;
}

/**
 * Una partida de la IA → partida del formulario, "vacia" (sin descripción ni material: se ignora sin contarla) o
 * "descartada" (tipos mal, cantidad o precio fuera de rango: se cuenta para avisar).
 */
function leerPartida(valor: unknown, materiales: ReadonlyMap<string, MaterialAlmacen>): PartidaRaw | "vacia" | "descartada" {
  if (!isObj(valor)) return "descartada";

  // Solo materiales de la empresa; cualquier otro id (inventado, de otra empresa, mal formado) se desvincula.
  const candidato = typeof valor.material_id === "string" ? materiales.get(valor.material_id.trim()) : undefined;
  const unidadIa = textoLinea(valor.unidad, LIMITES_MATERIAL.unidad) ?? "";
  // Y solo si la IA ha medido en la unidad del material: si no, su cantidad no casa con el precio del almacén
  // (p. ej. 6 m² de un azulejo que se vende por caja). Entonces va sin vincular, con su precio y su unidad.
  const material =
    candidato && normalizarUnidad(unidadIa) === normalizarUnidad(candidato.unidad) ? candidato : undefined;
  if (material && !precioMaterialValido(material.precio_cents)) return "descartada";

  const max = LIMITES_PRESUPUESTO.descripcion;
  let descripcion = textoLinea(valor.descripcion, max);
  if (descripcion === null) return "descartada";
  if (descripcion === "") {
    if (!material) return "vacia";
    descripcion = textoLinea(material.nombre, max) ?? "";
    if (descripcion === "") return "descartada";
  }

  // Sin material, la unidad de la IA va en la descripción ("Oficial alicatador (h)"): la partida no tiene campo de
  // unidad. Con material, manda la unidad del material (la muestra el formulario).
  const unidad = material ? "" : unidadIa;
  if (unidad !== "" && !descripcion.toLowerCase().endsWith(`(${unidad.toLowerCase()})`)) {
    descripcion = `${recortar(descripcion, max - unidad.length - 3)} (${unidad})`;
  }

  const cantidad = leerCantidad(valor.cantidad);
  if (cantidad === null) return "descartada";
  // Vinculada a un material: SIEMPRE el precio del almacén, diga lo que diga la IA.
  const precioCents = material ? material.precio_cents : leerPrecioCents(valor.precio_euros);
  if (precioCents === null) return "descartada";
  if (lineTotalCents({ cantidad, precioCents }) > MAX_TOTAL_CENTS) return "descartada";

  return {
    descripcion,
    cantidad: quantityToInput(cantidad),
    precio: centsToEurosInput(precioCents),
    material_id: material?.id ?? "",
  };
}

function leerSupuestos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const supuestos: string[] = [];
  for (const s of valor) {
    const texto = textoLinea(s, LIMITES_IA.supuesto);
    if (texto && !supuestos.includes(texto)) supuestos.push(texto);
    if (supuestos.length === LIMITES_IA.supuestos) break;
  }
  return supuestos;
}

/**
 * Valida la respuesta de la IA (ya parseada de JSON) contra los materiales de la empresa. Devuelve como mucho 30
 * partidas listas para el formulario, los supuestos y cuántas partidas se han descartado; o un error legible si la
 * respuesta no tiene la forma esperada o no queda ninguna partida válida. Los campos de más se ignoran.
 */
export function validarSugerencia(respuesta: unknown, materiales: readonly MaterialAlmacen[]): SugerenciaValidation {
  if (!isObj(respuesta) || !Array.isArray(respuesta.partidas)) return { ok: false, error: ERROR_RESPUESTA_ILEGIBLE };

  const porId = new Map(materiales.map((m) => [m.id, m]));
  const partidas: PartidaRaw[] = [];
  let descartadas = 0;
  for (const valor of respuesta.partidas) {
    const partida = leerPartida(valor, porId);
    if (partida === "vacia") continue;
    if (partida === "descartada" || partidas.length >= LIMITES_IA.partidas) descartadas++;
    else partidas.push(partida);
  }

  if (partidas.length === 0) return { ok: false, error: ERROR_SIN_PARTIDAS };
  return { ok: true, data: { partidas, supuestos: leerSupuestos(respuesta.supuestos), descartadas } };
}
