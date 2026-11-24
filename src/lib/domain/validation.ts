// Validadores de formularios: reciben lo que llega del FormData y devuelven datos limpios o errores por campo.
// Puros: sin Next ni Supabase.

import { eurosToCents } from "./money";
import { parseNif } from "./nif";
import { parseQuantity, quantityToInput } from "./quantity";
import { isNegativeStock } from "./stock";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type ValidationResult<K extends string, T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors<K> };

export type RawForm<K extends string> = Partial<Record<K, unknown>>;

/** Texto recortado; cualquier cosa que no sea texto (null, File…) cuenta como vacío. */
export function text(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function optionalText(valor: unknown): string | null {
  const limpio = text(valor);
  return limpio === "" ? null : limpio;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidEmail(valor: string): boolean {
  return valor.length <= 254 && EMAIL.test(valor);
}

export function isUuid(valor: string): boolean {
  return UUID.test(valor);
}

function tooLong(valor: string | null, max: number): string | undefined {
  return valor !== null && valor.length > max ? `Como mucho ${max} caracteres.` : undefined;
}

function result<K extends string, T>(errors: FieldErrors<K>, data: T): ValidationResult<K, T> {
  const limpios = Object.fromEntries(
    Object.entries(errors).filter(([, mensaje]) => mensaje !== undefined),
  ) as FieldErrors<K>;
  return Object.keys(limpios).length > 0 ? { ok: false, errors: limpios } : { ok: true, data };
}

// ----------------------------------------------------------------------------
// Acceso
// ----------------------------------------------------------------------------

export type LoginField = "email" | "password";

export interface LoginInput {
  email: string;
  password: string;
}

export function validateLogin(raw: RawForm<LoginField>): ValidationResult<LoginField, LoginInput> {
  const email = text(raw.email).toLowerCase();
  // La contraseña no se recorta: los espacios pueden ser parte de ella.
  const password = typeof raw.password === "string" ? raw.password : "";
  return result<LoginField, LoginInput>(
    {
      email: email === "" ? "Escribe tu email." : isValidEmail(email) ? undefined : "El email no es válido.",
      password: password === "" ? "Escribe tu contraseña." : undefined,
    },
    { email, password },
  );
}

// ----------------------------------------------------------------------------
// Clientes (R4)
// ----------------------------------------------------------------------------

export type ClienteField = "nombre" | "nif" | "telefono" | "email" | "direccion" | "notas";

export interface ClienteInput {
  nombre: string;
  /** Normalizado (mayúsculas, sin espacios, puntos ni guiones); null si se deja vacío. */
  nif: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  notas: string | null;
}

export const LIMITES_CLIENTE = { nombre: 120, telefono: 40, direccion: 200, notas: 2000 } as const;

export function validateCliente(raw: RawForm<ClienteField>): ValidationResult<ClienteField, ClienteInput> {
  const nombre = text(raw.nombre);
  const nif = parseNif(raw.nif);
  const telefono = optionalText(raw.telefono);
  const email = optionalText(raw.email);
  const direccion = optionalText(raw.direccion);
  const notas = optionalText(raw.notas);

  return result<ClienteField, ClienteInput>(
    {
      nombre: nombre === "" ? "El nombre es obligatorio." : tooLong(nombre, LIMITES_CLIENTE.nombre),
      nif: nif.error,
      telefono: tooLong(telefono, LIMITES_CLIENTE.telefono),
      email: email !== null && !isValidEmail(email) ? "El email no es válido (ej.: nombre@correo.es)." : undefined,
      direccion: tooLong(direccion, LIMITES_CLIENTE.direccion),
      notas: tooLong(notas, LIMITES_CLIENTE.notas),
    },
    { nombre, nif: nif.valor, telefono, email, direccion, notas },
  );
}

// ----------------------------------------------------------------------------
// Materiales (R15)
// ----------------------------------------------------------------------------

export type MaterialField = "nombre" | "unidad" | "precio" | "coste" | "stock" | "stock_minimo";

export interface MaterialInput {
  nombre: string;
  unidad: string;
  precio_cents: number;
  stock: number;
  stock_minimo: number;
  /**
   * Coste para la empresa, sin IVA (null = sin coste: los partes usan el precio). Solo está si se valida con
   * conCoste (gerencia); si no, no se envía y la base de datos no lo toca.
   */
  coste_cents?: number | null;
}

export const LIMITES_MATERIAL = { nombre: 120, unidad: 20 } as const;

/** Precio máximo de un material: 1.000.000 € (en céntimos). */
export const MAX_PRECIO_CENTS = 100_000_000;

function parseOr<T>(parse: () => T, fallback: T): { valor: T; error?: string } {
  try {
    return { valor: parse() };
  } catch (error) {
    return { valor: fallback, error: error instanceof Error ? error.message : "Valor no válido." };
  }
}

function parsePrecio(valor: unknown): { valor: number; error?: string } {
  const texto = text(valor);
  if (texto === "") return { valor: 0, error: "Escribe el precio (ej.: 12,50)." };
  const precio = parseOr(() => eurosToCents(texto), 0);
  if (precio.error) return precio;
  if (precio.valor > MAX_PRECIO_CENTS) return { valor: 0, error: "El precio es demasiado alto." };
  return precio;
}

/** Coste del material: opcional (vacío = null) y con los mismos límites que el precio. */
function parseCoste(valor: unknown): { valor: number | null; error?: string } {
  const texto = text(valor);
  if (texto === "") return { valor: null };
  const coste = parseOr<number | null>(() => eurosToCents(texto), null);
  if (coste.error) return coste;
  if ((coste.valor ?? 0) > MAX_PRECIO_CENTS) return { valor: null, error: "El coste es demasiado alto." };
  return coste;
}

function parseCantidadCampo(valor: unknown): { valor: number; error?: string } {
  const texto = text(valor);
  return texto === "" ? { valor: 0 } : parseOr(() => parseQuantity(texto), 0);
}

/**
 * Stock de un material: un número ≥ 0. Un valor negativo solo se acepta al editar y si es exactamente el que
 * el material ya tenía (queda así tras facturar sin existencias): deja guardar otros cambios sin tocar el stock.
 */
function parseStock(valor: unknown, stockActual: number | undefined): { valor: number; error?: string } {
  const texto = text(valor);
  if (stockActual === undefined || !isNegativeStock(stockActual) || !texto.startsWith("-")) {
    return parseCantidadCampo(texto);
  }
  const sinSigno = parseOr(() => parseQuantity(texto.slice(1)), 0);
  if (!sinSigno.error && -sinSigno.valor === stockActual) return { valor: stockActual };
  return {
    valor: 0,
    error: `No puede ser negativo: deja ${quantityToInput(stockActual)} para no tocarlo o escribe el stock real.`,
  };
}

export interface MaterialOptions {
  /** Al editar: el stock que el material tiene ahora en la base de datos. */
  stockActual?: number;
  /** Validar también el coste (solo gerencia lo ve y lo puede cambiar; trigger materiales_coste_solo_gerencia). */
  conCoste?: boolean;
}

export function validateMaterial(
  raw: RawForm<MaterialField>,
  { stockActual, conCoste = false }: MaterialOptions = {},
): ValidationResult<MaterialField, MaterialInput> {
  const nombre = text(raw.nombre);
  const unidad = text(raw.unidad);
  const precio = parsePrecio(raw.precio);
  const coste = conCoste ? parseCoste(raw.coste) : null;
  // Stock y mínimo vacíos cuentan como 0.
  const stock = parseStock(raw.stock, stockActual);
  const stockMinimo = parseCantidadCampo(raw.stock_minimo);

  return result<MaterialField, MaterialInput>(
    {
      nombre: nombre === "" ? "El nombre es obligatorio." : tooLong(nombre, LIMITES_MATERIAL.nombre),
      unidad: unidad === "" ? "Indica la unidad (ud, m², kg…)." : tooLong(unidad, LIMITES_MATERIAL.unidad),
      precio: precio.error,
      coste: coste?.error,
      stock: stock.error,
      stock_minimo: stockMinimo.error,
    },
    {
      nombre,
      unidad,
      precio_cents: precio.valor,
      stock: stock.valor,
      stock_minimo: stockMinimo.valor,
      ...(coste ? { coste_cents: coste.valor } : {}),
    },
  );
}

/**
 * Columnas que se envían al guardar un material que ya existe. Si el stock es negativo (solo pasa la validación
 * cuando es el que ya tenía) se deja fuera: los demás cambios se guardan y el stock no se toca.
 */
export function materialChanges(data: MaterialInput): Omit<MaterialInput, "stock"> & { stock?: number } {
  const { stock, ...resto } = data;
  return isNegativeStock(stock) ? resto : data;
}
