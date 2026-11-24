import { describe, expect, it } from "vitest";
import {
  evidenciaPeticion,
  LIMITES_ACEPTACION,
  textoAceptacion,
  textoEnviadoPor,
  validateNombreAceptacion,
  type CabecerasLike,
} from "./aceptacion";

function cabeceras(valores: Record<string, string>): CabecerasLike {
  return { get: (nombre) => valores[nombre.toLowerCase()] ?? null };
}

describe("validateNombreAceptacion", () => {
  it("acepta un nombre normal y lo deja limpio", () => {
    expect(validateNombreAceptacion("Ana López")).toEqual({ ok: true, nombre: "Ana López" });
    expect(validateNombreAceptacion("  Ana   López\tGarcía \n")).toEqual({ ok: true, nombre: "Ana López García" });
  });

  it("es obligatorio", () => {
    for (const valor of ["", "   ", null, undefined, 42, { nombre: "Ana" }]) {
      expect(validateNombreAceptacion(valor)).toEqual({ ok: false, error: "Escribe tu nombre y apellidos para aceptar." });
    }
  });

  it("de 2 a 120 caracteres, contados como en Postgres", () => {
    expect(validateNombreAceptacion("A")).toEqual({ ok: false, error: "El nombre tiene que tener al menos 2 caracteres." });
    expect(validateNombreAceptacion("Al")).toEqual({ ok: true, nombre: "Al" });
    expect(validateNombreAceptacion("a".repeat(120))).toMatchObject({ ok: true });
    expect(validateNombreAceptacion("a".repeat(121))).toEqual({
      ok: false,
      error: "El nombre puede tener como mucho 120 caracteres.",
    });
    // «𝒜» son 2 unidades UTF-16 pero 1 carácter (y es una letra): 120 caben, 121 no.
    expect(validateNombreAceptacion("𝒜".repeat(LIMITES_ACEPTACION.nombre))).toMatchObject({ ok: true });
    expect(validateNombreAceptacion("𝒜".repeat(LIMITES_ACEPTACION.nombre + 1))).toMatchObject({ ok: false });
    // Solo emojis: sin letras.
    expect(validateNombreAceptacion("😀😀")).toEqual({ ok: false, error: "El nombre tiene que llevar letras." });
  });

  it("recorta espacios Unicode e invisibles y exige alguna letra", () => {
    expect(validateNombreAceptacion("​​")).toEqual({
      ok: false,
      error: "Escribe tu nombre y apellidos para aceptar.",
    });
    expect(validateNombreAceptacion("..")).toEqual({ ok: false, error: "El nombre tiene que llevar letras." });
    expect(validateNombreAceptacion("12 34")).toEqual({ ok: false, error: "El nombre tiene que llevar letras." });
    expect(validateNombreAceptacion(" Ana")).toEqual({ ok: true, nombre: "Ana" });
    expect(validateNombreAceptacion("Ana ​López﻿")).toEqual({ ok: true, nombre: "Ana López" });
    // Un invisible no cuenta para el mínimo de 2 caracteres.
    expect(validateNombreAceptacion("A​")).toEqual({
      ok: false,
      error: "El nombre tiene que tener al menos 2 caracteres.",
    });
  });

  it("quita los caracteres de control", () => {
    expect(validateNombreAceptacion("Ana\u0000López")).toEqual({ ok: true, nombre: "Ana López" });
    expect(validateNombreAceptacion("\u0007\u0008")).toMatchObject({ ok: false });
  });
});

describe("evidenciaPeticion", () => {
  it("la IP es el primer valor de x-forwarded-for", () => {
    expect(
      evidenciaPeticion(cabeceras({ "x-forwarded-for": " 81.33.10.2 , 10.0.0.1", "x-real-ip": "10.0.0.9" })),
    ).toEqual({ ip: "81.33.10.2", userAgent: null });
  });

  it("si no hay x-forwarded-for (o viene vacía), usa x-real-ip", () => {
    expect(evidenciaPeticion(cabeceras({ "x-real-ip": "2a02:9130::1" })).ip).toBe("2a02:9130::1");
    expect(evidenciaPeticion(cabeceras({ "x-forwarded-for": " , 10.0.0.1", "x-real-ip": "81.33.10.2" })).ip).toBe(
      "81.33.10.2",
    );
  });

  it("guarda el navegador y recorta lo largo", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)";
    expect(evidenciaPeticion(cabeceras({ "user-agent": ua })).userAgent).toBe(ua);
    const largo = evidenciaPeticion(cabeceras({ "user-agent": "x".repeat(2000), "x-forwarded-for": "9".repeat(200) }));
    expect(largo.userAgent).toHaveLength(LIMITES_ACEPTACION.userAgent);
    expect(largo.ip).toHaveLength(LIMITES_ACEPTACION.ip);
  });

  it("sin cabeceras, null; sin caracteres de control", () => {
    expect(evidenciaPeticion(cabeceras({}))).toEqual({ ip: null, userAgent: null });
    expect(evidenciaPeticion(cabeceras({ "user-agent": "curl/8.0\u0000\n" })).userAgent).toBe("curl/8.0");
  });
});

describe("textoAceptacion", () => {
  const aceptadoAt = "2026-11-24T09:32:00Z";

  it("por enlace, con el nombre que escribió el cliente y la hora de Madrid", () => {
    expect(textoAceptacion({ canal: "enlace", aceptadoAt, aceptadoNombre: "Ana López" })).toBe(
      "Aceptado por Ana López desde el enlace el 24/11/2026 a las 10:32",
    );
  });

  it("por enlace, antes de pedir el nombre: «el cliente»", () => {
    expect(textoAceptacion({ canal: "enlace", aceptadoAt, aceptadoNombre: null })).toBe(
      "Aceptado por el cliente desde el enlace el 24/11/2026 a las 10:32",
    );
  });

  it("dado por aceptado por gerencia desde la app", () => {
    expect(textoAceptacion({ canal: "interno", aceptadoAt, aceptadoPor: "Marta" })).toBe(
      "Dado por aceptado por Marta (gerencia) desde la app el 24/11/2026 a las 10:32",
    );
    expect(textoAceptacion({ canal: "interno", aceptadoAt: null })).toBe("Dado por aceptado por gerencia desde la app");
  });

  it("sin aceptar, null", () => {
    expect(textoAceptacion({ canal: null, aceptadoAt: null })).toBeNull();
  });
});

describe("textoEnviadoPor", () => {
  it("dice quién y cuándo lo envió", () => {
    expect(textoEnviadoPor("Marta", "2026-11-20T08:15:00Z")).toBe("Enviado por Marta el 20/11/2026 a las 9:15");
    expect(textoEnviadoPor("Marta", null)).toBe("Enviado por Marta");
  });

  it("si no se sabe quién, null", () => {
    expect(textoEnviadoPor(null, "2026-11-20T08:15:00Z")).toBeNull();
    expect(textoEnviadoPor("  ", null)).toBeNull();
  });
});
