import { describe, expect, it } from "vitest";
import { authErrorMessage, dbErrorMessage } from "./errors";

describe("dbErrorMessage", () => {
  it.each([
    ["23505", "Ya existe un registro con esos datos."],
    ["23503", /dependen de este registro/],
    ["23502", "Falta un dato obligatorio."],
    ["23514", "Algún dato no es válido. Revisa los campos."],
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
