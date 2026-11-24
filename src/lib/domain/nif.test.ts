import { describe, expect, it } from "vitest";
import { cifControlDigit, nifError, normalizeNif, parseNif } from "./nif";

describe("normalizeNif", () => {
  it("pasa a mayúsculas y quita espacios, puntos y guiones", () => {
    expect(normalizeNif(" 12.345.678-z ")).toBe("12345678Z");
    expect(normalizeNif("x-1234567-l")).toBe("X1234567L");
    expect(normalizeNif("b 12 345 674")).toBe("B12345674");
  });

  it("vacío o solo separadores → null", () => {
    expect(normalizeNif("")).toBeNull();
    expect(normalizeNif("   ")).toBeNull();
    expect(normalizeNif(" .- ")).toBeNull();
  });
});

describe("nifError · DNI", () => {
  // Letra = número mod 23 sobre TRWAGMYFPDXBNJZSQVHLCKE.
  it.each(["12345678Z", "00000000T", "99999999R", "20481537Z", "48291736Q"])("acepta %s", (nif) => {
    expect(nifError(nif)).toBeNull();
  });

  it("rechaza una letra que no corresponde", () => {
    expect(nifError("12345678A")).toBe("La letra no corresponde al número del DNI. Revísalo.");
    expect(nifError("00000000R")).toMatch(/no corresponde/);
  });
});

describe("nifError · NIE", () => {
  // X = 0, Y = 1, Z = 2 delante del número y la misma regla que el DNI.
  it.each(["X1234567L", "Y7654321G", "Z0000001Y"])("acepta %s", (nie) => {
    expect(nifError(nie)).toBeNull();
  });

  it("rechaza una letra que no corresponde", () => {
    expect(nifError("X1234567A")).toBe("La letra no corresponde al número del NIE. Revísalo.");
    // Misma cifra con otra letra inicial: la letra de control cambia.
    expect(nifError("Y1234567L")).toMatch(/no corresponde/);
  });
});

describe("nifError · NIF especiales (K, L, M)", () => {
  it("valida la letra con las 7 cifras", () => {
    expect(nifError("K1234567L")).toBeNull();
    expect(nifError("M1234567L")).toBeNull();
    expect(nifError("K1234567A")).toMatch(/letra de control/);
  });
});

describe("cifControlDigit", () => {
  it("calcula el dígito de control", () => {
    // 1234567: pares 2+4+6 = 12; impares 1·2=2, 3·2=6, 5·2=10→1, 7·2=14→5 = 14; 26 → 10 − 6 = 4.
    expect(cifControlDigit("1234567")).toBe(4);
    expect(cifControlDigit("0000000")).toBe(0);
    expect(cifControlDigit("2826000")).toBe(8);
  });
});

describe("nifError · CIF", () => {
  it.each([
    "B12345674", // sociedad limitada: control con número
    "B30516249",
    "B96452131",
    "A30872154", // sociedad anónima
    "H96381272", // comunidad de propietarios
    "Q2826000H", // organismo público: control con letra
    "P0800000B", // corporación local
    "S2800000H",
    "N0012345E", // entidad extranjera
    "G00000000", // asociación: admite número…
    "G0000000J", // …o letra
    "J12345674",
    "J1234567D",
  ])("acepta %s", (cif) => {
    expect(nifError(cif)).toBeNull();
  });

  it("rechaza un dígito o letra de control incorrecto", () => {
    expect(nifError("B12345675")).toBe("El dígito o la letra de control del CIF no es correcto. Revísalo.");
    expect(nifError("Q2826000A")).toMatch(/control del CIF/);
    expect(nifError("G0000000A")).toMatch(/control del CIF/);
  });

  it("A, B, E y H terminan en número", () => {
    expect(nifError("B1234567D")).toBe("Un CIF que empieza por B termina en número, no en letra.");
    expect(nifError("A3087215D")).toMatch(/termina en número/);
  });

  it("N, P, Q, R, S y W terminan en letra", () => {
    expect(nifError("Q28260008")).toBe("Un CIF que empieza por Q termina en letra, no en número.");
    expect(nifError("P08000002")).toMatch(/termina en letra/);
  });

  it("rechaza letras iniciales que no son de CIF", () => {
    expect(nifError("I12345674")).toMatch(/No parece un NIF, NIE ni CIF/);
    expect(nifError("T12345674")).toMatch(/No parece/);
  });
});

describe("nifError · forma", () => {
  it("exige 9 caracteres", () => {
    expect(nifError("1234567Z")).toMatch(/9 letras o cifras/);
    expect(nifError("123456789Z")).toMatch(/9 letras o cifras/);
    expect(nifError("")).toMatch(/9 letras o cifras/);
  });

  it("rechaza lo que no encaja con ningún tipo", () => {
    expect(nifError("123456789")).toMatch(/No parece/);
    expect(nifError("ABCDEFGHI")).toMatch(/No parece/);
    expect(nifError("X12345678")).toMatch(/No parece/);
  });
});

describe("parseNif", () => {
  it("vacío es válido y queda a null (el NIF es opcional)", () => {
    expect(parseNif("")).toEqual({ valor: null });
    expect(parseNif("  ")).toEqual({ valor: null });
    expect(parseNif(null)).toEqual({ valor: null });
  });

  it("devuelve el NIF normalizado si es válido", () => {
    expect(parseNif("12.345.678-z")).toEqual({ valor: "12345678Z" });
    expect(parseNif("b-12345674")).toEqual({ valor: "B12345674" });
  });

  it("devuelve el error si no es válido", () => {
    expect(parseNif("12345678A")).toEqual({
      valor: null,
      error: "La letra no corresponde al número del DNI. Revísalo.",
    });
  });
});
