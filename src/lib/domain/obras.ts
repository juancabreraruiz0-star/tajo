// Obras (D11): estados y quién los cambia, partes de trabajo, coste real, margen y semáforo.
// Misma regla que la base de datos (supabase/migrations/0006_obras.sql: triggers y vista obras_resumen).
// Puro: sin Next ni Supabase.

import { parseQuantity, quantityToInput } from "./quantity";
import type { Rol } from "./status";
import { isUuid, text, type FieldErrors, type ValidationResult } from "./validation";

// ----------------------------------------------------------------------------
// Estados
// ----------------------------------------------------------------------------

export const ESTADOS_OBRA = ["pendiente", "en_curso", "parada", "terminada"] as const;

export type EstadoObra = (typeof ESTADOS_OBRA)[number];

export const ETIQUETAS_ESTADO_OBRA: Record<EstadoObra, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  parada: "Parada",
  terminada: "Terminada",
};

/** pendiente → en_curso ⇄ parada → terminada; terminada es final. Igual que el trigger obras_reglas. */
const TRANSICIONES_OBRA: Record<EstadoObra, readonly EstadoObra[]> = {
  pendiente: ["en_curso"],
  en_curso: ["parada", "terminada"],
  parada: ["en_curso", "terminada"],
  terminada: [],
};

export function isEstadoObra(valor: unknown): valor is EstadoObra {
  return typeof valor === "string" && (ESTADOS_OBRA as readonly string[]).includes(valor);
}

export function puedeCambiarEstadoObra(desde: EstadoObra, hasta: EstadoObra): boolean {
  return TRANSICIONES_OBRA[desde].includes(hasta);
}

/**
 * Por qué no se puede hacer un cambio de estado (el mismo texto que da la base de datos), o null si se puede.
 * Pasar al mismo estado no es un cambio: null.
 */
export function errorCambioEstadoObra(desde: EstadoObra, hasta: EstadoObra): string | null {
  if (desde === hasta || puedeCambiarEstadoObra(desde, hasta)) return null;
  if (desde === "terminada") return "La obra ya está terminada: no puede cambiar de estado.";
  return `Una obra no puede pasar de «${desde.replace("_", " ")}» a «${hasta.replace("_", " ")}».`;
}

/** Estado, encargado, fechas y notas de una obra: los cambia gerencia o el encargado de esa obra (RLS de 0006). */
export function puedeGestionarObra(rol: Rol, esEncargado: boolean): boolean {
  return rol === "admin" || esEncargado;
}

/** Estados a los que este usuario puede pasar la obra desde la pantalla (vacío si no la gestiona). */
export function accionesEstadoObra(estado: EstadoObra, rol: Rol, esEncargado: boolean): EstadoObra[] {
  return puedeGestionarObra(rol, esEncargado) ? [...TRANSICIONES_OBRA[estado]] : [];
}

// ----------------------------------------------------------------------------
// Partes: cuándo se añaden y quién los cambia
// ----------------------------------------------------------------------------

/** Solo se añaden partes a una obra en curso (cualquier usuario de la empresa). */
export function admitePartesNuevos(estado: EstadoObra): boolean {
  return estado === "en_curso";
}

/** Por qué no se puede añadir un parte a una obra en este estado (texto de la base de datos), o null si se puede. */
export function errorParteNuevo(estado: EstadoObra): string | null {
  switch (estado) {
    case "en_curso":
      return null;
    case "pendiente":
      return "La obra todavía no ha empezado: ponla en curso antes de añadir partes.";
    case "parada":
      return "La obra está parada: vuelve a ponerla en curso para añadir partes.";
    case "terminada":
      return "La obra está terminada: ya no admite partes nuevos.";
  }
}

/** Los partes de una obra terminada ya no se cambian ni se borran (nadie, tampoco gerencia). */
export function partesEditables(estado: EstadoObra): boolean {
  return estado !== "terminada";
}

/**
 * ¿Puede este usuario cambiar o borrar un parte (y sus materiales)? Gerencia, siempre; su autor, solo el día en que lo
 * registró. `diaRegistro` es el día de Madrid de `partes.created_at` (no la fecha del trabajo, que puede ser anterior):
 * `diaMadrid(parte.created_at)`. Además, la obra no puede estar terminada (`partesEditables`).
 */
export function puedeEditarParte(rol: Rol, esAutor: boolean, diaRegistro: string, hoyMadrid: string): boolean {
  return rol === "admin" || (esAutor && diaRegistro === hoyMadrid);
}

const DIA_MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día AAAA-MM-DD en hora de Madrid de un instante (Date o timestamp ISO). `diaMadrid(new Date())` = hoy. */
export function diaMadrid(valor: Date | string): string {
  const fecha = typeof valor === "string" ? new Date(valor) : valor;
  if (Number.isNaN(fecha.getTime())) throw new Error("Fecha no válida.");
  return DIA_MADRID.format(fecha);
}

// ----------------------------------------------------------------------------
// % consumido (misma regla que la vista obras_resumen, que calcula el coste real y el margen en SQL)
//   consumido = coste real / presupuestado × 100, con 1 decimal (medio hacia arriba); null si presupuestado = 0.
// ----------------------------------------------------------------------------

/** % del presupuesto consumido, con 1 decimal (medio hacia arriba, exacto con enteros); null si no hay presupuesto. */
export function consumidoPct(costeRealCents: number, presupuestadoCents: number): number | null {
  if (!Number.isSafeInteger(costeRealCents) || costeRealCents < 0) {
    throw new Error("El coste real debe ser un número entero de céntimos igual o mayor que 0.");
  }
  if (!Number.isSafeInteger(presupuestadoCents) || presupuestadoCents < 0) {
    throw new Error("El presupuestado debe ser un número entero de céntimos igual o mayor que 0.");
  }
  if (presupuestadoCents === 0) return null;
  // Décimas de % = round(coste × 1000 / presupuestado) con BigInt: sin errores de coma flotante en importes grandes.
  // (Sin literales 123n: el target de tsconfig es anterior a ES2020.)
  const numerador = BigInt(costeRealCents) * BigInt(1000);
  const denominador = BigInt(presupuestadoCents);
  const dos = BigInt(2);
  const decimas = (dos * numerador + denominador) / (dos * denominador);
  return Number(decimas) / 10;
}

// ----------------------------------------------------------------------------
// Semáforo
// ----------------------------------------------------------------------------

export type Semaforo = "verde" | "ambar" | "rojo";

/** Desde este % consumido, ámbar (cerca de gastar todo lo presupuestado). */
export const UMBRAL_AMBAR_PCT = 80;
/** Por encima de este %, rojo: en pérdidas. */
export const UMBRAL_ROJO_PCT = 100;

/**
 * verde (< 80 %), ámbar (80–100 %), rojo (> 100 %, en pérdidas). Una obra pendiente siempre va en verde (aún no se ha
 * gastado nada) y una sin presupuestado (consumido null) también, porque no hay con qué comparar. Una obra terminada
 * conserva su color: dice con qué margen acabó. Para listar «obras en pérdidas», mejor margen_cents < 0 (exacto; el %
 * va redondeado a 1 decimal).
 */
export function semaforoObra(consumido: number | null, estado: EstadoObra): Semaforo {
  if (estado === "pendiente" || consumido === null) return "verde";
  if (consumido > UMBRAL_ROJO_PCT) return "rojo";
  if (consumido >= UMBRAL_AMBAR_PCT) return "ambar";
  return "verde";
}

// ----------------------------------------------------------------------------
// Validación de un parte (alta o edición). Mismos límites que la base de datos.
// ----------------------------------------------------------------------------

export const MAX_HORAS_PARTE = 24;
export const MAX_NOTAS_PARTE = 1000;
export const MAX_MATERIALES_PARTE = 30;
export const MAX_NOTAS_OBRA = 2000;
/** Un parte se puede apuntar como mucho con esta antigüedad (D12; el trigger partes_reglas de 0007 también). */
export const MAX_DIAS_ATRAS_PARTE = 30;
export const ERROR_PARTE_ANTIGUO = `La fecha del parte no puede ser de hace más de ${MAX_DIAS_ATRAS_PARTE} días.`;

export type ParteField = "fecha" | "horas" | "notas" | "materiales";

/** Material del parte tal como lo recibe guardar_parte() en p_materiales. */
export interface ParteMaterialInput {
  material_id: string;
  cantidad: number;
}

export interface ParteInput {
  /** AAAA-MM-DD */
  fecha: string;
  horas: number;
  notas: string | null;
  materiales: ParteMaterialInput[];
}

export interface ParteRaw {
  fecha?: unknown;
  horas?: unknown;
  notas?: unknown;
  /** Lista de { material_id, cantidad } (cantidad como texto del formulario o número). */
  materiales?: unknown;
}

const HORAS = /^(\d+)(?:[.,](\d+))?$/;

/** Lee las horas de un parte: "8", "7,5", "7.25", "6 h". Más de 0, como mucho 24 y con 2 decimales como mucho. */
export function parseHoras(valor: string | number): number {
  let horas: number;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new Error("Escribe un número de horas, por ejemplo 8 o 7,5.");
    if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-9) throw new Error("Como mucho 2 decimales.");
    horas = valor;
  } else {
    const limpio = valor.trim().replace(/\s*h$/i, "").replace(/\s/g, "");
    if (limpio === "") throw new Error("Escribe las horas.");
    if (limpio.startsWith("-")) throw new Error("Las horas no pueden ser negativas.");
    const match = HORAS.exec(limpio);
    if (!match) throw new Error("Escribe un número de horas, por ejemplo 8 o 7,5.");
    const decimales = match[2] ?? "";
    if (decimales.length > 2) throw new Error("Como mucho 2 decimales.");
    horas = Number(decimales ? `${match[1]}.${decimales}` : match[1]);
  }
  if (horas < 0) throw new Error("Las horas no pueden ser negativas.");
  if (horas === 0) throw new Error("Las horas tienen que ser más de 0.");
  if (horas > MAX_HORAS_PARTE) throw new Error(`Como mucho ${MAX_HORAS_PARTE} horas en un parte.`);
  return horas;
}

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** AAAA-MM-DD → dd/mm/aaaa, como to_char(…, 'DD/MM/YYYY') en los mensajes de la base de datos. */
function fechaEs(valor: string): string {
  const [anio, mes, dia] = valor.split("-");
  return `${dia}/${mes}/${anio}`;
}

function esFechaReal(valor: string): boolean {
  const partes = SOLO_FECHA.exec(valor);
  if (!partes) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/** AAAA-MM-DD menos `dias` días, en calendario (sin horas ni zona horaria). */
function restarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - dias)).toISOString().slice(0, 10);
}

/**
 * Primer día que admite un parte: hace 30 días o, si es posterior, el inicio de la obra. Al editar un parte más
 * antiguo, su propia fecha (se puede dejar como está). Para el `min` del campo de fecha; la regla la aplica
 * validateParte.
 */
export function fechaMinimaParte(
  hoyMadrid: string,
  fechaInicioObra: string | null,
  fechaAnterior: string | null = null,
): string {
  if (!esFechaReal(hoyMadrid)) throw new Error("hoyMadrid tiene que ser una fecha AAAA-MM-DD.");
  const haceUnMes = restarDias(hoyMadrid, MAX_DIAS_ATRAS_PARTE);
  const minima = fechaInicioObra !== null && fechaInicioObra > haceUnMes ? fechaInicioObra : haceUnMes;
  return fechaAnterior !== null && fechaAnterior < minima ? fechaAnterior : minima;
}

function errorCantidad(valor: unknown): { cantidad?: number; error?: string } {
  try {
    const textoCantidad = typeof valor === "number" ? quantityToInput(valor) : text(valor);
    const cantidad = parseQuantity(textoCantidad);
    if (cantidad <= 0) return { error: "la cantidad tiene que ser mayor que 0." };
    return { cantidad };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "cantidad no válida.";
    return { error: mensaje.charAt(0).toLowerCase() + mensaje.slice(1) };
  }
}

function validarMateriales(valor: unknown): { materiales: ParteMaterialInput[]; error?: string } {
  if (valor === undefined || valor === null) return { materiales: [] };
  if (!Array.isArray(valor)) return { materiales: [], error: "Los materiales no son válidos." };
  if (valor.length > MAX_MATERIALES_PARTE) {
    return { materiales: [], error: `Un parte puede tener como mucho ${MAX_MATERIALES_PARTE} materiales.` };
  }
  const materiales: ParteMaterialInput[] = [];
  for (const [i, item] of valor.entries()) {
    const fila = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const materialId = text(fila.material_id);
    if (!isUuid(materialId)) return { materiales: [], error: `Material ${i + 1}: elige un material del almacén.` };
    const { cantidad, error } = errorCantidad(fila.cantidad);
    if (cantidad === undefined) return { materiales: [], error: `Material ${i + 1}: ${error}` };
    if (materiales.some((m) => m.material_id === materialId)) {
      return { materiales: [], error: `Material ${i + 1}: ya está en el parte; junta las cantidades en una línea.` };
    }
    materiales.push({ material_id: materialId, cantidad });
  }
  return { materiales };
}

/**
 * Valida un parte. `hoyMadrid` (AAAA-MM-DD, `diaMadrid(new Date())`): la fecha no puede ser posterior ni de hace más
 * de 30 días; vacía = hoy. `fechaInicioObra` (la de la obra, si se conoce): la fecha del parte no puede ser anterior.
 * `fechaAnterior` (al editar, la fecha que ya tenía): si no cambia, no cuenta el límite de 30 días, como en el
 * trigger partes_reglas (0007). Mismas reglas y mensajes que la base de datos.
 * Devuelve los datos listos para guardar_parte() o los errores por campo, en español.
 */
export function validateParte(
  raw: ParteRaw,
  hoyMadrid: string,
  fechaInicioObra: string | null = null,
  fechaAnterior: string | null = null,
): ValidationResult<ParteField, ParteInput> {
  if (!esFechaReal(hoyMadrid)) throw new Error("hoyMadrid tiene que ser una fecha AAAA-MM-DD.");
  if (fechaInicioObra !== null && !esFechaReal(fechaInicioObra)) {
    throw new Error("fechaInicioObra tiene que ser una fecha AAAA-MM-DD.");
  }
  const errors: FieldErrors<ParteField> = {};

  const fecha = text(raw.fecha) || hoyMadrid;
  if (!esFechaReal(fecha)) errors.fecha = "Elige una fecha válida.";
  else if (fecha > hoyMadrid) errors.fecha = "La fecha del parte no puede ser posterior a hoy.";
  else if (fechaInicioObra !== null && fecha < fechaInicioObra) {
    errors.fecha = `La fecha del parte no puede ser anterior al inicio de la obra (${fechaEs(fechaInicioObra)}).`;
  } else if (fecha !== fechaAnterior && fecha < restarDias(hoyMadrid, MAX_DIAS_ATRAS_PARTE)) {
    errors.fecha = ERROR_PARTE_ANTIGUO;
  }

  let horas = 0;
  try {
    horas = parseHoras(typeof raw.horas === "number" ? raw.horas : text(raw.horas));
  } catch (error) {
    errors.horas = error instanceof Error ? error.message : "Horas no válidas.";
  }

  const notas = text(raw.notas) || null;
  if (notas !== null && notas.length > MAX_NOTAS_PARTE) errors.notas = `Como mucho ${MAX_NOTAS_PARTE} caracteres.`;

  const { materiales, error: errorMateriales } = validarMateriales(raw.materiales);
  if (errorMateriales) errors.materiales = errorMateriales;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, data: { fecha, horas, notas, materiales } };
}

// ----------------------------------------------------------------------------
// Validación de los datos de una obra (fechas y notas). Mismos mensajes que el trigger obras_reglas.
// ----------------------------------------------------------------------------

export type ObraField = "fecha_inicio" | "fecha_fin_prevista" | "fecha_fin" | "notas";

export interface ObraInput {
  fecha_inicio: string | null;
  fecha_fin_prevista: string | null;
  fecha_fin: string | null;
  notas: string | null;
}

export interface ObraRaw {
  fecha_inicio?: unknown;
  fecha_fin_prevista?: unknown;
  fecha_fin?: unknown;
  notas?: unknown;
}

export interface ContextoObra {
  /** Estado que tendrá la obra después del cambio. */
  estado: EstadoObra;
  /** AAAA-MM-DD, `diaMadrid(new Date())`. */
  hoyMadrid: string;
  /** Fecha del parte más antiguo de la obra (AAAA-MM-DD), o null si no tiene partes. */
  primerParte?: string | null;
}

/** De una obra terminada solo se cambian las notas (trigger obras_reglas). */
export const ERROR_OBRA_TERMINADA_SOLO_NOTAS = "La obra está terminada: solo se pueden cambiar las notas.";

/** Campos que se pueden editar en una obra en este estado (la pantalla muestra solo estos). */
export function camposEditablesObra(estado: EstadoObra): ObraField[] {
  return estado === "terminada" ? ["notas"] : ["fecha_inicio", "fecha_fin_prevista", "fecha_fin", "notas"];
}

function fechaOpcional(valor: unknown): { fecha: string | null; error?: string } {
  const limpio = text(valor);
  if (limpio === "") return { fecha: null };
  return esFechaReal(limpio) ? { fecha: limpio } : { fecha: null, error: "Elige una fecha válida." };
}

/**
 * Valida fechas y notas de una obra con las reglas de la base de datos. Ojo: al pasar de pendiente a en curso, la base
 * de datos pone la fecha de inicio a hoy si falta o es futura, y vacía la fecha de fin prevista si queda antes del
 * inicio sin que se haya cambiado; esta función valida los valores tal como se van a guardar.
 */
export function validateObra(raw: ObraRaw, contexto: ContextoObra): ValidationResult<ObraField, ObraInput> {
  const { estado, hoyMadrid, primerParte = null } = contexto;
  if (!esFechaReal(hoyMadrid)) throw new Error("hoyMadrid tiene que ser una fecha AAAA-MM-DD.");
  const errors: FieldErrors<ObraField> = {};

  const inicio = fechaOpcional(raw.fecha_inicio);
  const prevista = fechaOpcional(raw.fecha_fin_prevista);
  const fin = fechaOpcional(raw.fecha_fin);
  if (inicio.error) errors.fecha_inicio = inicio.error;
  if (prevista.error) errors.fecha_fin_prevista = prevista.error;
  if (fin.error) errors.fecha_fin = fin.error;

  if (!errors.fecha_inicio) {
    if (estado !== "pendiente" && inicio.fecha === null) {
      errors.fecha_inicio = "Una obra empezada tiene que tener fecha de inicio.";
    } else if (estado !== "pendiente" && inicio.fecha !== null && inicio.fecha > hoyMadrid) {
      errors.fecha_inicio = "La fecha de inicio de una obra empezada no puede ser posterior a hoy.";
    } else if (inicio.fecha !== null && primerParte !== null && inicio.fecha > primerParte) {
      errors.fecha_inicio = `La obra tiene partes desde el ${fechaEs(primerParte)}: la fecha de inicio no puede ser posterior.`;
    }
  }

  if (!errors.fecha_fin && fin.fecha !== null) {
    if (estado !== "terminada") errors.fecha_fin = "La fecha de fin real solo se pone al terminar la obra.";
    else if (fin.fecha > hoyMadrid) errors.fecha_fin = "La fecha de fin real no puede ser posterior a hoy.";
    else if (inicio.fecha !== null && fin.fecha < inicio.fecha) {
      errors.fecha_fin = "La fecha de fin no puede ser anterior a la de inicio.";
    }
  }

  if (!errors.fecha_fin_prevista && prevista.fecha !== null && inicio.fecha !== null && prevista.fecha < inicio.fecha) {
    errors.fecha_fin_prevista = "La fecha de fin prevista no puede ser anterior a la de inicio.";
  }

  const notas = text(raw.notas) || null;
  if (notas !== null && notas.length > MAX_NOTAS_OBRA) {
    errors.notas = `Las notas de la obra pueden tener como mucho ${MAX_NOTAS_OBRA} caracteres.`;
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        data: { fecha_inicio: inicio.fecha, fecha_fin_prevista: prevista.fecha, fecha_fin: fin.fecha, notas },
      };
}
