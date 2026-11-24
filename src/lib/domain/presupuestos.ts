// Presupuestos (R6–R11): validación del formulario, totales en vivo, filtros, enlace público y lectura de las
// respuestas de las funciones públicas. Puro: sin Next ni Supabase.

import { eurosToCents } from "./money";
import { parseQuantity } from "./quantity";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto } from "./status";
import { budgetTotals, lineTotalCents, type TotalesPresupuesto } from "./totals";
import { isUuid, MAX_PRECIO_CENTS, text, type FieldErrors } from "./validation";

// ----------------------------------------------------------------------------
// Valores por defecto y límites
// ----------------------------------------------------------------------------

/** IVA que se puede elegir en el formulario: 21 % general y 10 % para reformas de vivienda habitual. */
export const IVA_OPCIONES = [21, 10] as const;
export type IvaPresupuesto = (typeof IVA_OPCIONES)[number];
export const IVA_POR_DEFECTO: IvaPresupuesto = 21;
export const VALIDEZ_POR_DEFECTO = 30;

export const LIMITES_PRESUPUESTO = {
  titulo: 160,
  descripcion: 300,
  partidas: 100,
  validezDias: 365,
} as const;

/**
 * Tope del total (base + IVA): 10^13 céntimos, 100.000 millones de euros. Los importes son bigint en la base (0004);
 * con este tope ninguna partida supera el CHECK de la base (presupuesto_lineas_importe_max_chk, como mucho 10^13
 * céntimos por partida) y todas las cifras son enteros exactos en JavaScript (muy por debajo de 2^53 ≈ 9·10^15).
 */
export const MAX_TOTAL_CENTS = 10_000_000_000_000;

// ----------------------------------------------------------------------------
// Validación del formulario (servidor) — la BD exige cantidad > 0, precio ≥ 0 e IVA permitido.
// ----------------------------------------------------------------------------

export type PresupuestoField = "cliente_id" | "titulo" | "iva_pct" | "validez_dias" | "partidas";
export type PartidaField = "descripcion" | "cantidad" | "precio" | "material_id";

/** Una partida tal como llega del formulario (todo texto). material_id vacío = sin vincular. */
export interface PartidaRaw {
  descripcion: string;
  cantidad: string;
  precio: string;
  material_id: string;
}

export interface PresupuestoRaw {
  cliente_id: string;
  titulo: string;
  iva_pct: string;
  validez_dias: string;
  partidas: readonly PartidaRaw[];
}

export interface PartidaInput {
  orden: number;
  descripcion: string;
  cantidad: number;
  precio_cents: number;
  material_id: string | null;
}

export interface PresupuestoInput {
  cliente_id: string;
  titulo: string;
  iva_pct: IvaPresupuesto;
  validez_dias: number;
  partidas: PartidaInput[];
}

export interface PresupuestoErrors {
  campos: FieldErrors<PresupuestoField>;
  /** Mismo índice que las partidas recibidas; undefined si la partida está bien. */
  partidas: (FieldErrors<PartidaField> | undefined)[];
}

export type PresupuestoValidation = { ok: true; data: PresupuestoInput } | { ok: false; errors: PresupuestoErrors };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Valor no válido.";
}

function parseIva(valor: string): IvaPresupuesto | null {
  return IVA_OPCIONES.find((iva) => String(iva) === valor.trim()) ?? null;
}

function parseValidez(valor: string): { valor: number; error?: string } {
  const limpio = valor.trim();
  if (limpio === "") return { valor: 0, error: "Indica cuántos días es válido." };
  if (!/^\d+$/.test(limpio)) return { valor: 0, error: "Escribe un número entero de días, por ejemplo 30." };
  const dias = Number(limpio);
  if (dias < 1) return { valor: 0, error: "Tiene que ser válido al menos 1 día." };
  if (dias > LIMITES_PRESUPUESTO.validezDias) {
    return { valor: 0, error: `Como mucho ${LIMITES_PRESUPUESTO.validezDias} días.` };
  }
  return { valor: dias };
}

function parseCantidadPartida(valor: string): { valor: number; error?: string } {
  if (valor.trim() === "") return { valor: 0, error: "Escribe la cantidad." };
  try {
    const cantidad = parseQuantity(valor);
    return cantidad > 0 ? { valor: cantidad } : { valor: 0, error: "Tiene que ser mayor que 0." };
  } catch (error) {
    return { valor: 0, error: errorMessage(error) };
  }
}

function parsePrecioPartida(valor: string): { valor: number; error?: string } {
  if (valor.trim() === "") return { valor: 0, error: "Escribe el precio (ej.: 12,50)." };
  try {
    const cents = eurosToCents(valor);
    return cents > MAX_PRECIO_CENTS ? { valor: 0, error: "El precio es demasiado alto." } : { valor: cents };
  } catch (error) {
    return { valor: 0, error: errorMessage(error) };
  }
}

function compact<K extends string>(errors: FieldErrors<K>): FieldErrors<K> | undefined {
  const limpios = Object.fromEntries(Object.entries(errors).filter(([, m]) => m !== undefined)) as FieldErrors<K>;
  return Object.keys(limpios).length > 0 ? limpios : undefined;
}

function validatePartida(raw: PartidaRaw, orden: number): { data: PartidaInput; errors?: FieldErrors<PartidaField> } {
  const descripcion = text(raw.descripcion);
  const cantidad = parseCantidadPartida(text(raw.cantidad));
  const precio = parsePrecioPartida(text(raw.precio));
  const materialId = text(raw.material_id);

  const errors = compact<PartidaField>({
    descripcion:
      descripcion === ""
        ? "Describe la partida."
        : descripcion.length > LIMITES_PRESUPUESTO.descripcion
          ? `Como mucho ${LIMITES_PRESUPUESTO.descripcion} caracteres.`
          : undefined,
    cantidad: cantidad.error,
    precio: precio.error,
    material_id: materialId !== "" && !isUuid(materialId) ? "El material no es válido." : undefined,
  });

  return {
    data: { orden, descripcion, cantidad: cantidad.valor, precio_cents: precio.valor, material_id: materialId || null },
    errors,
  };
}

/** Valida cabecera y partidas. Devuelve los datos listos para la BD (céntimos, orden 1..n) o los errores. */
export function validatePresupuesto(raw: PresupuestoRaw): PresupuestoValidation {
  const clienteId = text(raw.cliente_id);
  const titulo = text(raw.titulo);
  const iva = parseIva(text(raw.iva_pct));
  const validez = parseValidez(text(raw.validez_dias));
  const partidas = raw.partidas.map((p, i) => validatePartida(p, i + 1));

  const campos =
    compact<PresupuestoField>({
      cliente_id: clienteId === "" ? "Elige el cliente." : isUuid(clienteId) ? undefined : "El cliente no es válido.",
      titulo:
        titulo === ""
          ? "Pon un título (ej.: Reforma de baño)."
          : titulo.length > LIMITES_PRESUPUESTO.titulo
            ? `Como mucho ${LIMITES_PRESUPUESTO.titulo} caracteres.`
            : undefined,
      iva_pct: iva === null ? "Elige un IVA del 21 % o del 10 %." : undefined,
      validez_dias: validez.error,
      partidas:
        partidas.length === 0
          ? "Añade al menos una partida."
          : partidas.length > LIMITES_PRESUPUESTO.partidas
            ? `Como mucho ${LIMITES_PRESUPUESTO.partidas} partidas.`
            : undefined,
    }) ?? {};

  const erroresPartidas = partidas.map((p) => p.errors);
  if (iva !== null && campos.partidas === undefined && !erroresPartidas.some(Boolean)) {
    const lineas = partidas.map((p) => ({ cantidad: p.data.cantidad, precioCents: p.data.precio_cents }));
    if (budgetTotals(lineas, iva).totalCents > MAX_TOTAL_CENTS) {
      campos.partidas = "El importe total es demasiado alto.";
    }
  }
  if (Object.keys(campos).length > 0 || erroresPartidas.some(Boolean) || iva === null) {
    return { ok: false, errors: { campos, partidas: erroresPartidas } };
  }

  return {
    ok: true,
    data: {
      cliente_id: clienteId,
      titulo,
      iva_pct: iva,
      validez_dias: validez.valor,
      partidas: partidas.map((p) => p.data),
    },
  };
}

// ----------------------------------------------------------------------------
// Totales en vivo (cliente): mismas funciones que el servidor; lo que aún no es válido cuenta como 0.
// ----------------------------------------------------------------------------

/** Importe de una partida que se está escribiendo, o null si cantidad o precio aún no son válidos. */
export function draftLineCents(partida: Pick<PartidaRaw, "cantidad" | "precio">): number | null {
  try {
    const cantidad = parseQuantity(partida.cantidad);
    const precioCents = eurosToCents(partida.precio.trim());
    return lineTotalCents({ cantidad, precioCents });
  } catch {
    return null;
  }
}

/** Base, IVA y total del formulario mientras se escribe. IVA no válido = el de por defecto. */
export function draftTotals(partidas: readonly Pick<PartidaRaw, "cantidad" | "precio">[], ivaPct: string): TotalesPresupuesto {
  const iva = parseIva(ivaPct) ?? IVA_POR_DEFECTO;
  const lineas = partidas.flatMap((p) => {
    const importe = draftLineCents(p);
    // Una partida con importe ya calculado entra como cantidad 1 × importe: mismo redondeo por línea.
    return importe === null ? [] : [{ cantidad: 1, precioCents: importe }];
  });
  return budgetTotals(lineas, iva);
}

// ----------------------------------------------------------------------------
// Filtro del listado (?estado=)
// ----------------------------------------------------------------------------

/** Estado del filtro de la URL o null (= todos) si falta o no es un estado conocido. */
export function parseEstadoFiltro(valor: string | string[] | undefined): EstadoPresupuesto | null {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return ESTADOS_PRESUPUESTO.find((estado) => estado === texto) ?? null;
}

/** Enlace del listado con el filtro aplicado. */
export function presupuestosHref(estado: EstadoPresupuesto | null): string {
  return estado ? `/presupuestos?estado=${estado}` : "/presupuestos";
}

// ----------------------------------------------------------------------------
// Enlace público (R10) y fechas
// ----------------------------------------------------------------------------

/** URL pública del presupuesto para el cliente: publicBudgetUrl("https://tajo.app/", t) → "https://tajo.app/p/t". */
export function publicBudgetUrl(origin: string, token: string): string {
  return `${origin.trim().replace(/\/+$/, "")}/p/${encodeURIComponent(token)}`;
}

/**
 * Origen (protocolo + host) de la petición a partir de sus cabeceras, o null si no hay host.
 * Detrás de un proxy (Vercel) manda x-forwarded-host / x-forwarded-proto.
 */
export function originFromHeaders(headers: {
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}): string | null {
  const primero = (valor?: string | null) => valor?.split(",")[0]?.trim() || null;
  const host = primero(headers.forwardedHost) ?? primero(headers.host);
  if (!host || !/^[a-z0-9.\-[\]:]+$/i.test(host)) return null;
  const proto = primero(headers.forwardedProto);
  const esLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return `${proto === "http" || proto === "https" ? proto : esLocal ? "http" : "https"}://${host}`;
}

const DIA_MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Último día de validez (AAAA-MM-DD): fecha de creación en Madrid + validez en días naturales. */
export function validUntil(createdAt: string, validezDias: number): string {
  const creado = new Date(createdAt);
  if (Number.isNaN(creado.getTime())) throw new Error(`Fecha no válida: «${createdAt}».`);
  if (!Number.isInteger(validezDias) || validezDias < 0) throw new Error("La validez debe ser un número de días.");
  const [anio, mes, dia] = DIA_MADRID.format(creado).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + validezDias)).toISOString().slice(0, 10);
}

/** Hoy en Madrid (AAAA-MM-DD). */
function todayMadrid(now: Date): string {
  return DIA_MADRID.format(now);
}

/** ¿Ha pasado ya el último día de validez? (El último día todavía es válido; misma regla que aceptar_presupuesto.) */
export function isExpired(createdAt: string, validezDias: number, now: Date = new Date()): boolean {
  return todayMadrid(now) > validUntil(createdAt, validezDias);
}

// ----------------------------------------------------------------------------
// Respuestas de las funciones públicas (jsonb) — se comprueban antes de pintar.
// ----------------------------------------------------------------------------

export interface PresupuestoPublico {
  empresa: {
    nombre: string;
    cif: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
  };
  cliente: { nombre: string };
  presupuesto: {
    numero: string;
    titulo: string;
    estado: EstadoPresupuesto;
    iva_pct: number;
    validez_dias: number;
    created_at: string;
    enviado_at: string | null;
    aceptado_at: string | null;
  };
  lineas: {
    orden: number;
    descripcion: string;
    cantidad: number;
    precio_cents: number;
    importe_cents: number;
  }[];
  base_cents: number;
  iva_cents: number;
  total_cents: number;
}

type Obj = Record<string, unknown>;

function isObj(valor: unknown): valor is Obj {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function str(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

/** numeric/bigint de Postgres pueden llegar como número o como texto. */
function num(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Lee la respuesta de presupuesto_publico(). null si no hay presupuesto o la forma no es la esperada. */
export function parsePresupuestoPublico(valor: unknown): PresupuestoPublico | null {
  if (!isObj(valor) || !isObj(valor.empresa) || !isObj(valor.presupuesto) || !Array.isArray(valor.lineas)) return null;
  const { empresa: e, presupuesto: p } = valor;
  const cliente = isObj(valor.cliente) ? valor.cliente : {};

  const estado = ESTADOS_PRESUPUESTO.find((x) => x === p.estado);
  const numero = str(p.numero);
  const titulo = str(p.titulo);
  const createdAt = str(p.created_at);
  const ivaPct = num(p.iva_pct);
  const validez = num(p.validez_dias);
  const base = num(valor.base_cents);
  const iva = num(valor.iva_cents);
  const total = num(valor.total_cents);
  if (!estado || !numero || titulo === null || !createdAt || ivaPct === null || validez === null) return null;
  if (base === null || iva === null || total === null) return null;

  const lineas: PresupuestoPublico["lineas"] = [];
  for (const l of valor.lineas) {
    if (!isObj(l)) return null;
    const descripcion = str(l.descripcion);
    const cantidad = num(l.cantidad);
    const precio = num(l.precio_cents);
    const importe = num(l.importe_cents);
    if (descripcion === null || cantidad === null || precio === null || importe === null) return null;
    lineas.push({ orden: num(l.orden) ?? 0, descripcion, cantidad, precio_cents: precio, importe_cents: importe });
  }

  return {
    empresa: {
      nombre: str(e.nombre) ?? "",
      cif: str(e.cif),
      direccion: str(e.direccion),
      telefono: str(e.telefono),
      email: str(e.email),
    },
    cliente: { nombre: str(cliente.nombre) ?? "" },
    presupuesto: {
      numero,
      titulo,
      estado,
      iva_pct: ivaPct,
      validez_dias: validez,
      created_at: createdAt,
      enviado_at: str(p.enviado_at),
      aceptado_at: str(p.aceptado_at),
    },
    lineas,
    base_cents: base,
    iva_cents: iva,
    total_cents: total,
  };
}

export type RespuestaAceptar =
  | { ok: true; aceptadoAt: string }
  /** campo = "nombre": el motivo es del nombre y se pinta junto a su campo (0007). */
  | { ok: false; motivo: string; campo?: "nombre" };

/** Lee la respuesta de aceptar_presupuesto(): { ok: true, aceptado_at } o { ok: false, motivo[, campo] }. */
export function parseRespuestaAceptar(valor: unknown): RespuestaAceptar {
  if (isObj(valor) && valor.ok === true) {
    const aceptadoAt = str(valor.aceptado_at);
    if (aceptadoAt) return { ok: true, aceptadoAt };
  }
  if (isObj(valor) && valor.ok === false) {
    const motivo = str(valor.motivo) || "No se ha podido aceptar el presupuesto.";
    return valor.campo === "nombre" ? { ok: false, motivo, campo: "nombre" } : { ok: false, motivo };
  }
  return { ok: false, motivo: "No se ha podido aceptar el presupuesto. Inténtalo de nuevo." };
}
