// Traducción a español de los errores que devuelve Supabase (Auth y PostgREST/Postgres).

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

export interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

const SIN_CONEXION = "No se ha podido conectar con el servidor. Revisa la conexión e inténtalo de nuevo.";

function isNetworkError(message: string): boolean {
  return /fetch failed|failed to fetch|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message);
}

/**
 * Qué se estaba haciendo cuando falló la base de datos. Cambia el mensaje de los errores que significan cosas
 * distintas según la operación: una clave ajena rota (23503) al borrar es «otros datos dependen de este»; al
 * guardar un presupuesto es «el cliente o el material al que apunta ya no existe».
 */
export type DbErrorContext = "general" | "guardar_presupuesto";

const CLAVE_AJENA: Record<DbErrorContext, string> = {
  general:
    "No se puede completar: hay otros datos que dependen de este registro (por ejemplo, presupuestos o facturas).",
  guardar_presupuesto: "El cliente o algún material ya no existe. Recarga la página e inténtalo de nuevo.",
};

/** Error propio de facturar_presupuesto() (0004) cuando el cliente no tiene NIF. Su mensaje ya viene en español. */
export const ERROR_CLIENTE_SIN_NIF = "TJ001";

export function isClienteSinNif(error: DbErrorLike): boolean {
  return error.code === ERROR_CLIENTE_SIN_NIF;
}

/**
 * CHECK de la base (23514) → qué límite se ha saltado. Se busca por el nombre de la restricción, que Postgres pone
 * en el mensaje («… violates check constraint "presupuesto_lineas_precio_max_chk"»). Mismos límites que el dominio.
 */
const CHECKS: readonly [RegExp, string][] = [
  [/_nif_formato_chk/, "El NIF tiene que tener 9 letras o cifras (ej.: 12345678Z o B12345674)."],
  [/_largo_chk/, "Algún texto es demasiado largo. Revisa los campos."],
  [/_importe_max_chk/, "El importe de alguna partida es demasiado alto."],
  [/_precio_max_chk|precio_cents_check/, "El precio tiene que estar entre 0 € y 1.000.000 € por unidad."],
  [/cantidad/, "La cantidad tiene que ser mayor que 0 y como mucho 1.000.000.000, con 3 decimales como mucho."],
  [/stock/, "El stock está fuera de los límites permitidos."],
  [/validez/, "La validez tiene que estar entre 1 y 365 días."],
  [/iva_pct/, "El IVA elegido no está permitido."],
];

const FUERA_DE_LIMITES =
  "Algún dato está fuera de los límites permitidos (longitud de un texto, cantidad o importe). Revisa los campos.";

function checkMessage(message: string): string {
  const restriccion = /check constraint "([^"]+)"/.exec(message)?.[1] ?? "";
  return CHECKS.find(([patron]) => patron.test(restriccion))?.[1] ?? FUERA_DE_LIMITES;
}

/** Mensaje en español para un error de base de datos (PostgREST / Postgres). */
export function dbErrorMessage(error: DbErrorLike, contexto: DbErrorContext = "general"): string {
  const message = error.message ?? "";
  switch (error.code) {
    case "23505":
      return "Ya existe un registro con esos datos.";
    case "23503":
      return CLAVE_AJENA[contexto];
    case "23502":
      return "Falta un dato obligatorio.";
    case "23514":
      return checkMessage(message);
    case "22003":
      // Desbordamiento numérico: un número no cabe en su columna.
      return "Algún número es demasiado grande. Revisa cantidades, precios e importes.";
    case "22P02":
      return "Algún dato no es válido. Revisa los campos.";
    case "42501":
      return "No tienes permiso para hacer esto.";
    case "PGRST116":
      return "No se ha encontrado el registro.";
    case "PGRST301":
    case "PGRST303":
      return "Tu sesión ha caducado. Vuelve a entrar.";
    case "PGRST103":
      // Rango pedido fuera del total (paginación).
      return "Esa página no existe.";
    case "P0001":
      // Excepciones de nuestros triggers y funciones: ya vienen redactadas en español.
      return message || "La base de datos ha rechazado la operación.";
    case ERROR_CLIENTE_SIN_NIF:
      // facturar_presupuesto() sin NIF del cliente: el mensaje también viene en español y nombra al cliente.
      return message || "El cliente no tiene NIF. Añádelo en su ficha antes de facturar.";
  }
  if (isNetworkError(message)) return SIN_CONEXION;
  return "Ha ocurrido un error inesperado. Inténtalo de nuevo.";
}

/** Mensaje en español para un error de inicio de sesión de Supabase Auth. */
export function authErrorMessage(error: AuthErrorLike): string {
  const message = error.message ?? "";
  switch (error.code) {
    case "invalid_credentials":
      return "Email o contraseña incorrectos.";
    case "email_not_confirmed":
      return "Tienes que confirmar tu email antes de entrar.";
    case "user_banned":
      return "Este usuario está bloqueado. Habla con gerencia.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Demasiados intentos. Espera un momento y vuelve a probar.";
  }
  if (error.status === 429) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  if (/invalid login credentials/i.test(message)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(message)) return "Tienes que confirmar tu email antes de entrar.";
  if (isNetworkError(message)) return SIN_CONEXION;
  return "No se ha podido iniciar sesión. Inténtalo de nuevo.";
}
