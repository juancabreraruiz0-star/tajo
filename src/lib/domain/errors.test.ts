import { describe, expect, it } from "vitest";
import { authErrorMessage, dbErrorMessage, isClienteSinNif } from "./errors";

describe("dbErrorMessage", () => {
  it.each([
    ["23505", "Ya existe un registro con esos datos."],
    ["23503", /dependen de este registro/],
    ["23502", "Falta un dato obligatorio."],
    ["23514", /fuera de los límites permitidos/],
    ["22003", "Algún número es demasiado grande. Revisa cantidades, precios e importes."],
    ["22P02", "Algún dato no es válido. Revisa los campos."],
    ["42501", "No tienes permiso para hacer esto."],
    ["PGRST116", "No se ha encontrado el registro."],
    ["PGRST301", "Tu sesión ha caducado. Vuelve a entrar."],
  ])("código %s", (code, esperado) => {
    const mensaje = dbErrorMessage({ code, message: "duplicate key value violates unique constraint" });
    if (typeof esperado === "string") expect(mensaje).toBe(esperado);
    else expect(mensaje).toMatch(esperado);
  });

  it("clave ajena (23503): el mensaje depende de lo que se estaba haciendo", () => {
    const error = {
      code: "23503",
      message: 'insert or update on table "presupuesto_lineas" violates foreign key constraint',
    };
    // Al guardar un presupuesto: el cliente o un material se ha borrado mientras se rellenaba el formulario.
    expect(dbErrorMessage(error, "guardar_presupuesto")).toBe(
      "El cliente o algún material ya no existe. Recarga la página e inténtalo de nuevo.",
    );
    // Al borrar (contexto por defecto) se mantiene el mensaje de siempre.
    expect(dbErrorMessage(error)).toBe(
      "No se puede completar: hay otros datos que dependen de este registro (por ejemplo, presupuestos o facturas).",
    );
    expect(dbErrorMessage(error, "general")).toBe(dbErrorMessage(error));
  });

  it("el contexto solo cambia la clave ajena: el resto de errores se traducen igual", () => {
    const partidas = { code: "P0001", message: "Añade al menos una partida." };
    expect(dbErrorMessage(partidas, "guardar_presupuesto")).toBe("Añade al menos una partida.");
    expect(dbErrorMessage({ code: "42501" }, "guardar_presupuesto")).toBe("No tienes permiso para hacer esto.");
    expect(dbErrorMessage({ message: "fetch failed" }, "guardar_presupuesto")).toMatch(/No se ha podido conectar/);
  });

  it("deja pasar el mensaje en español de nuestros triggers (P0001)", () => {
    const message = "Solo se pueden cambiar las partidas de un presupuesto en borrador (estado actual: enviado).";
    expect(dbErrorMessage({ code: "P0001", message })).toBe(message);
    expect(dbErrorMessage({ code: "P0001", message: "" })).toBe("La base de datos ha rechazado la operación.");
  });

  it("CHECK (23514): dice qué límite se ha saltado según la restricción", () => {
    const check = (restriccion: string) =>
      dbErrorMessage({
        code: "23514",
        message: `new row for relation "x" violates check constraint "${restriccion}"`,
      });
    expect(check("clientes_nif_formato_chk")).toMatch(/NIF tiene que tener 9 letras o cifras/);
    expect(check("clientes_notas_largo_chk")).toBe("Algún texto es demasiado largo. Revisa los campos.");
    expect(check("presupuesto_lineas_importe_max_chk")).toBe("El importe de alguna partida es demasiado alto.");
    expect(check("materiales_precio_max_chk")).toMatch(/precio tiene que estar entre/);
    expect(check("presupuesto_lineas_cantidad_max_chk")).toMatch(/cantidad tiene que ser mayor que 0/);
    expect(check("materiales_stock_rango_chk")).toMatch(/stock/);
    expect(check("presupuestos_validez_rango_chk")).toBe("La validez tiene que estar entre 1 y 365 días.");
    expect(check("presupuestos_iva_pct_check")).toBe("El IVA elegido no está permitido.");
    // Una restricción sin mensaje propio: el genérico, nunca «error inesperado».
    expect(check("clientes_nombre_check")).toMatch(/fuera de los límites permitidos/);
    expect(dbErrorMessage({ code: "23514" })).toMatch(/fuera de los límites permitidos/);
  });

  it("cliente sin NIF al facturar (TJ001): usa el mensaje de la base, que ya está en español", () => {
    const error = {
      code: "TJ001",
      message: "El cliente «Carmen Puig Soler» no tiene NIF. Añádelo en su ficha antes de facturar.",
    };
    expect(dbErrorMessage(error)).toBe(error.message);
    expect(dbErrorMessage({ code: "TJ001", message: "" })).toMatch(/no tiene NIF/);
    expect(isClienteSinNif(error)).toBe(true);
    expect(isClienteSinNif({ code: "P0001", message: "x" })).toBe(false);
  });

  it("límite de partidas: el mensaje del trigger llega tal cual", () => {
    const message = "Un presupuesto puede tener como mucho 100 partidas.";
    expect(dbErrorMessage({ code: "P0001", message })).toBe(message);
    expect(dbErrorMessage({ code: "P0001", message }, "guardar_presupuesto")).toBe(message);
  });

  it("aceptación interna rechazada por el trigger: mensaje legible", () => {
    const message = "Solo gerencia puede dar por aceptado un presupuesto; el cliente lo acepta desde el enlace público.";
    expect(dbErrorMessage({ code: "P0001", message })).toBe(message);
  });

  it("página fuera de rango (PGRST103)", () => {
    expect(dbErrorMessage({ code: "PGRST103", message: "Requested range not satisfiable" })).toBe(
      "Esa página no existe.",
    );
  });

  it("detecta los fallos de red", () => {
    expect(dbErrorMessage({ message: "TypeError: fetch failed" })).toMatch(/No se ha podido conectar/);
  });

  it("nunca enseña el mensaje técnico en inglés", () => {
    expect(dbErrorMessage({ code: "XX000", message: "internal error" })).toBe(
      "Ha ocurrido un error inesperado. Inténtalo de nuevo.",
    );
    expect(dbErrorMessage({})).toBe("Ha ocurrido un error inesperado. Inténtalo de nuevo.");
  });
});

describe("authErrorMessage", () => {
  it.each([
    [{ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, "Email o contraseña incorrectos."],
    [{ message: "Invalid login credentials", status: 400 }, "Email o contraseña incorrectos."],
    [{ code: "email_not_confirmed" }, "Tienes que confirmar tu email antes de entrar."],
    [{ message: "Email not confirmed" }, "Tienes que confirmar tu email antes de entrar."],
    [{ code: "user_banned" }, "Este usuario está bloqueado. Habla con gerencia."],
    [{ code: "over_request_rate_limit", status: 429 }, "Demasiados intentos. Espera un momento y vuelve a probar."],
    [{ status: 429 }, "Demasiados intentos. Espera un momento y vuelve a probar."],
    [{ message: "fetch failed" }, "No se ha podido conectar con el servidor. Revisa la conexión e inténtalo de nuevo."],
    [{ code: "unexpected_failure", message: "Database error" }, "No se ha podido iniciar sesión. Inténtalo de nuevo."],
  ])("%o", (error, esperado) => {
    expect(authErrorMessage(error)).toBe(esperado);
  });
});
