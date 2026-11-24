// Obras en pantalla (T16b): filtro del listado, textos de las acciones y del semáforo, barra de consumo, permisos de
// los partes combinados y búsqueda de materiales. Las reglas de negocio (y sus validaciones) están en ./obras.
// Puro: sin Next ni Supabase.

import { formatQuantity } from "./quantity";
import type { Rol } from "./status";
import {
  diaMadrid,
  ESTADOS_OBRA,
  partesEditables,
  puedeEditarParte,
  type EstadoObra,
  type Semaforo,
} from "./obras";

// ----------------------------------------------------------------------------
// Filtro del listado (?estado=)
// ----------------------------------------------------------------------------

/** Valor de ?estado= para ver todas las obras (sin parámetro se elige solo: en curso si hay alguna). */
export const FILTRO_TODAS = "todas";

/**
 * Qué estado se filtra en /obras. ?estado=<estado> → ese estado; ?estado=todas → null (todas). Sin parámetro (o con
 * uno que no existe) → «En curso» si hay alguna obra en curso y, si no, todas.
 */
export function filtroObras(valor: string | string[] | undefined, hayEnCurso: boolean): EstadoObra | null {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (texto === FILTRO_TODAS) return null;
  const estado = ESTADOS_OBRA.find((e) => e === texto);
  if (estado) return estado;
  return hayEnCurso ? "en_curso" : null;
}

/** ¿Hace falta saber si hay obras en curso para resolver el filtro? Solo si la URL no dice nada válido. */
export function filtroObrasPendienteDeConteo(valor: string | string[] | undefined): boolean {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto !== FILTRO_TODAS && !ESTADOS_OBRA.some((e) => e === texto);
}

/**
 * ?aviso= del detalle de la obra cuando, al empezarla, la base de datos quitó la fecha de fin prevista porque ya había
 * pasado. El aviso se pinta junto a «Fin prevista», que sigue en pantalla después de empezar.
 */
export const AVISO_FIN_PREVISTA_QUITADA = "fin-prevista-quitada";

/** Enlace del listado con el filtro: null = todas (?estado=todas, para que no se elija solo «En curso»). */
export function obrasHref(estado: EstadoObra | null): string {
  return `/obras?estado=${estado ?? FILTRO_TODAS}`;
}

// ----------------------------------------------------------------------------
// Acciones de estado
// ----------------------------------------------------------------------------

/** Texto del botón para pasar de un estado a otro: «Empezar obra», «Reanudar», «Parar», «Terminar obra». */
export function textoAccionEstadoObra(desde: EstadoObra, hasta: EstadoObra): string {
  if (hasta === "en_curso") return desde === "parada" ? "Reanudar" : "Empezar obra";
  if (hasta === "parada") return "Parar";
  if (hasta === "terminada") return "Terminar obra";
  return "Volver a pendiente";
}

/** Confirmación antes de cambiar de estado, o null si no hace falta (terminar no se puede deshacer). */
export function confirmacionEstadoObra(hasta: EstadoObra): string | null {
  return hasta === "terminada"
    ? "¿Terminar la obra? Ya no se podrán añadir partes ni cambiar los que tiene, y no se puede deshacer."
    : null;
}

// ----------------------------------------------------------------------------
// Semáforo y barra de presupuestado frente a coste real
// ----------------------------------------------------------------------------

/** Texto corto del semáforo (nunca solo el color). Es lo único que ve el encargado del coste de una obra (D12). */
export const TEXTO_SEMAFORO: Record<Semaforo, string> = {
  verde: "Va bien",
  ambar: "Ajustada",
  rojo: "En pérdidas",
};

/** Explicación del semáforo, sin cifras: la ve quien no es gerencia en el detalle de la obra. */
export const DETALLE_SEMAFORO: Record<Semaforo, string> = {
  verde: "Lo gastado en mano de obra y material está dentro de lo presupuestado.",
  ambar: "Lo gastado se acerca a lo presupuestado: queda poco margen.",
  rojo: "Lo gastado ya supera lo presupuestado.",
};

const SEMAFOROS: readonly Semaforo[] = ["verde", "ambar", "rojo"];

/** Lee la columna `semaforo` de obras_resumen (0007). null si no llega o no es un valor conocido. */
export function parseSemaforo(valor: unknown): Semaforo | null {
  return SEMAFOROS.find((s) => s === valor) ?? null;
}

export interface BarraConsumo {
  /** Parte rellena de la barra, de 0 a 1 (lo consumido hasta el 100 %). */
  relleno: number;
  /** Lo que pasa del 100 %, como fracción de toda la barra (0 si no se pasa). La barra se reescala para que quepa. */
  exceso: number;
  /** Dónde cae la marca del 100 % (1 si no se pasa; menos si hay exceso). */
  marca: number;
}

/**
 * Barra de consumo: hasta el 100 % se rellena en proporción; por encima, la barra entera representa lo consumido y
 * una marca indica dónde estaba el 100 %. 150 % → relleno 2/3, exceso 1/3, marca en 2/3. null o negativo = vacía.
 */
export function barraConsumo(consumidoPct: number | null): BarraConsumo {
  if (consumidoPct === null || !Number.isFinite(consumidoPct) || consumidoPct <= 0) {
    return { relleno: 0, exceso: 0, marca: 1 };
  }
  if (consumidoPct <= 100) return { relleno: consumidoPct / 100, exceso: 0, marca: 1 };
  const marca = 100 / consumidoPct;
  return { relleno: marca, exceso: 1 - marca, marca };
}

const PCT = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

/** «76,2 %»; «—» si no hay presupuestado con el que comparar. */
export function formatConsumido(consumidoPct: number | null): string {
  return consumidoPct === null ? "—" : `${PCT.format(consumidoPct)} %`;
}

/** Horas para leer: 58 → «58 h», 7.5 → «7,5 h». */
export function formatHoras(horas: number): string {
  return `${formatQuantity(horas)} h`;
}

// ----------------------------------------------------------------------------
// Partes: ¿se puede cambiar este?
// ----------------------------------------------------------------------------

export interface ParteParaPermiso {
  autor_id: string | null;
  /** Cuándo se registró (timestamptz): su autor lo puede cambiar ese día de Madrid. */
  created_at: string;
}

/**
 * ¿Puede este usuario editar o borrar el parte? La obra no puede estar terminada (nadie) y, además, gerencia siempre;
 * su autor, solo el día en que lo registró (hora de Madrid de created_at, no la fecha del trabajo).
 */
export function parteEditablePor(
  parte: ParteParaPermiso,
  usuario: { id: string; rol: Rol },
  estadoObra: EstadoObra,
  ahora: Date,
): boolean {
  if (!partesEditables(estadoObra)) return false;
  return puedeEditarParte(usuario.rol, parte.autor_id === usuario.id, diaMadrid(parte.created_at), diaMadrid(ahora));
}

// ----------------------------------------------------------------------------
// Buscar materiales del almacén por nombre (formulario del parte)
// ----------------------------------------------------------------------------

/** Texto sin tildes ni mayúsculas, para buscar «azulejo» y encontrar «Azulejo cerámico» o «AZULEJO». */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Materiales cuyo nombre contiene todas las palabras buscadas (sin tildes ni mayúsculas), sin los que ya están en el
 * parte, como mucho `max`. Sin texto, los primeros por orden.
 */
export function buscarMateriales<T extends { id: string; nombre: string }>(
  materiales: readonly T[],
  texto: string,
  excluir: ReadonlySet<string>,
  max = 8,
): T[] {
  const palabras = normalizarBusqueda(texto).split(" ").filter(Boolean);
  const resultado: T[] = [];
  for (const material of materiales) {
    if (resultado.length >= max) break;
    if (excluir.has(material.id)) continue;
    const nombre = normalizarBusqueda(material.nombre);
    if (palabras.every((p) => nombre.includes(p))) resultado.push(material);
  }
  return resultado;
}
