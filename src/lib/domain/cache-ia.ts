// «Montar con IA» (D14, T19): misma descripción y mismo almacén → mismo presupuesto.
// La IA no es determinista, así que la garantía la da una caché por huella: la clave sale de la empresa, la descripción
// normalizada, el almacén que se le pasa a la IA y la versión de la petición (modelo, instrucciones y esquema). Si ya
// hay una propuesta guardada con esa clave, se devuelve tal cual sin llamar a la IA. Y en el formulario, pedirla otra
// vez sustituye las partidas en vez de sumarlas (combinarPropuesta).
// Puro: sin Next, Supabase ni el SDK de Anthropic (solo Web Crypto, que está en Node y en el navegador).

import { eurosToCents } from "./money";
import { parseQuantity } from "./quantity";
import { LIMITES_IA, type MaterialAlmacen, type SugerenciaValida } from "./sugerencias";

// Caracteres de ancho cero (espacio, unión y no unión de ancho cero, unión de palabras, BOM): no se ven. Van como
// escapes \u… para que se vean en el código.
const ANCHO_CERO = /[\u200b-\u200d\u2060\ufeff]/g;
// Signos de puntuación al final: «baño.», «baño...», «baño!!» y «baño» son la misma descripción.
const PUNTUACION_FINAL = /[\s.,;:!?¡¿…]+$/u;

/**
 * Descripción para comparar: sin caracteres invisibles, en minúsculas, con los espacios, tabuladores y saltos de línea
 * seguidos convertidos en un espacio, sin espacios a los lados y sin la puntuación del final. Los números, las comas
 * decimales y las unidades no se tocan: «6 m²» y «8 m²» son obras distintas.
 */
export function normalizarDescripcionIa(texto: string): string {
  return texto
    .normalize("NFC")
    .replace(ANCHO_CERO, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim()
    .replace(PUNTUACION_FINAL, "");
}

/**
 * Huella del almacén que se le pasa a la IA: los mismos materiales (los 200 primeros, como mensajeIa) con id, nombre,
 * unidad y precio, ordenados por id para que no dependa del orden en que llegan. Si cambia un precio, una unidad, un
 * nombre o se da de alta o de baja un material, cambia la huella.
 */
export function huellaAlmacen(materiales: readonly MaterialAlmacen[]): string {
  const filas = materiales
    .slice(0, LIMITES_IA.materiales)
    .map((m) => [m.id, m.nombre, m.unidad, m.precio_cents] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(filas);
}

export interface DatosClaveIa {
  empresaId: string;
  /** Descripción de la obra (ya validada con validarDescripcionObra). */
  descripcion: string;
  /** Materiales que se le pasan a la IA. */
  materiales: readonly MaterialAlmacen[];
  /** Lo que define la petición a la IA (modelo, instrucciones y esquema): si cambia, se vuelve a pedir. */
  version: string;
}

/** Texto del que sale la clave: JSON, para que ningún campo se pueda confundir con el siguiente. */
export function materialClaveIa({ empresaId, descripcion, materiales, version }: DatosClaveIa): string {
  return JSON.stringify([version, empresaId, normalizarDescripcionIa(descripcion), huellaAlmacen(materiales)]);
}

/** Formato de la clave: SHA-256 en hexadecimal (la base de datos comprueba lo mismo). */
export const FORMATO_CLAVE_IA = /^[0-9a-f]{64}$/;

/** Clave de la caché: SHA-256 (hex) de materialClaveIa. Determinista: mismos datos, misma clave. */
export async function claveCacheIa(datos: DatosClaveIa): Promise<string> {
  const bytes = new TextEncoder().encode(materialClaveIa(datos));
  const resumen = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(resumen, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Partida en el formato de la respuesta de la IA (el que lee validarSugerencia). */
export interface PartidaGuardadaIa {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_euros: number;
  material_id: string | null;
}

/** Lo que se guarda en la caché: la propuesta ya validada, en el formato de la IA, para volver a validarla al leerla. */
export interface PropuestaGuardadaIa {
  partidas: PartidaGuardadaIa[];
  supuestos: string[];
}

/**
 * Propuesta validada → lo que se guarda. Solo las partidas que han pasado la validación, ya limpias (la unidad de una
 * partida sin material ya va en su descripción; una vinculada lleva la unidad de su material). Al leerla,
 * validarSugerencia(propuesta, mismos materiales) devuelve exactamente las mismas partidas y supuestos.
 */
export function propuestaParaGuardar(
  sugerencia: Pick<SugerenciaValida, "partidas" | "supuestos">,
  materiales: readonly MaterialAlmacen[],
): PropuestaGuardadaIa {
  const porId = new Map(materiales.map((m) => [m.id, m]));
  return {
    partidas: sugerencia.partidas.map((p) => {
      const material = p.material_id ? porId.get(p.material_id) : undefined;
      return {
        descripcion: p.descripcion,
        cantidad: parseQuantity(p.cantidad),
        unidad: material?.unidad ?? "",
        precio_euros: eurosToCents(p.precio) / 100,
        material_id: material?.id ?? null,
      };
    }),
    supuestos: [...sugerencia.supuestos],
  };
}

/**
 * Cómo quedan las filas del formulario con una propuesta de la IA. Por defecto la propuesta SUSTITUYE a las partidas
 * que hay (pedirla otra vez no las duplica); con `anadir`, va detrás de las que hay. Las filas vacías se quitan
 * siempre. Como mucho `max` filas: lo que no quepa no se mete. `nuevas` son las filas de la propuesta que han entrado.
 */
export function combinarPropuesta<T>(
  actuales: readonly T[],
  propuesta: readonly T[],
  opciones: { anadir: boolean; esVacia: (fila: T) => boolean; max: number },
): { filas: T[]; nuevas: T[] } {
  const base = opciones.anadir ? actuales.filter((f) => !opciones.esVacia(f)) : [];
  const nuevas = propuesta.slice(0, Math.max(0, opciones.max - base.length));
  return { filas: [...base, ...nuevas], nuevas };
}
