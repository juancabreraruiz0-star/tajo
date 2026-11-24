import { describe, expect, it } from "vitest";
import { enlaceWhatsApp, mensajeWhatsApp, nombreFirma, nombreSaludo, normalizarTelefono } from "./whatsapp";

describe("normalizarTelefono", () => {
  it.each([
    // Móviles (6 y 7) y fijos (9 y 8) sin prefijo: se les pone el 34
    ["600 112 233", "34600112233"],
    ["646-221-908", "34646221908"],
    ["712345678", "34712345678"],
    ["963 600 144", "34963600144"],
    ["(96) 360.01.44", "34963600144"],
    ["876 54 32 10", "34876543210"],
    // Con +34, 0034 o 34 delante
    ["+34 600 112 233", "34600112233"],
    ["+34-963-600-144", "34963600144"],
    ["0034 655 340 127", "34655340127"],
    ["34 678 905 412", "34678905412"],
    ["  +34 (600) 11 22 33  ", "34600112233"],
    // Extranjeros con + o 00
    ["+44 20 7946 0958", "442079460958"],
    ["0044 20 7946 0958", "442079460958"],
    ["+33 6 12 34 56 78", "33612345678"],
    ["+1 (415) 555-0132", "14155550132"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarTelefono(entrada)).toBe(esperado);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["sin teléfono"],
    ["600 11 22"], // 8 cifras
    ["6001122334"], // 10 cifras sin prefijo
    ["500 112 233"], // no empieza por 6, 7, 8 ni 9
    ["123456789"],
    ["+34 500 112 233"], // +34 con un número español imposible
    ["+34 600 11 22"],
    ["+0 600112233"],
    ["+44 12"], // demasiado corto
    ["+123456789012345678"], // más de 15 cifras
    ["600 112 233 ext. 4"],
    ["+34 600 112 233 / 963 600 144"], // dos teléfonos en el mismo campo
    ["++34600112233"],
  ])("%s → null", (entrada) => {
    expect(normalizarTelefono(entrada)).toBeNull();
  });
});

describe("nombreSaludo", () => {
  it("usa el nombre de pila de una persona", () => {
    expect(nombreSaludo("Carmen Puig Soler")).toBe("Carmen");
    expect(nombreSaludo("  Vicent   Llorens ")).toBe("Vicent");
  });

  it("no saluda por el nombre a empresas ni comunidades", () => {
    expect(nombreSaludo("Comunidad de Propietarios Blasco Ibáñez 88")).toBeNull();
    expect(nombreSaludo("Promociones del Segura S.A.")).toBeNull();
    expect(nombreSaludo("Restaurante El Puerto")).toBeNull();
    expect(nombreSaludo("Talleres Vila SL")).toBeNull();
    expect(nombreSaludo("")).toBeNull();
    expect(nombreSaludo(null)).toBeNull();
  });
});

describe("nombreFirma", () => {
  it("quita la forma jurídica", () => {
    expect(nombreFirma("Reformas Levante S.L.")).toBe("Reformas Levante");
    expect(nombreFirma("Reformas Levante, S.L.U.")).toBe("Reformas Levante");
    expect(nombreFirma("Promociones del Segura S.A.")).toBe("Promociones del Segura");
    expect(nombreFirma("Reformas Levante SL")).toBe("Reformas Levante");
  });

  it("deja el nombre tal cual si no la tiene", () => {
    expect(nombreFirma("Reformas Levante")).toBe("Reformas Levante");
    expect(nombreFirma("  ")).toBe("");
    expect(nombreFirma(null)).toBe("");
  });
});

describe("mensajeWhatsApp", () => {
  const enlace = "https://tajo.app/p/3b1f0c2e-8c1a-4a57-9d0e-2f1b7a6c9e10";

  it("saluda, nombra la obra, pone el enlace en su línea y firma", () => {
    expect(
      mensajeWhatsApp({ cliente: "Carmen Puig Soler", titulo: "Reforma completa de baño", enlace, empresa: "Reformas Levante S.L." }),
    ).toBe(
      [
        "Hola, Carmen. Te paso el presupuesto de reforma completa de baño:",
        enlace,
        "Cualquier duda me dices. Un saludo,",
        "Reformas Levante",
      ].join("\n"),
    );
  });

  it("a una empresa o comunidad la saluda sin nombre", () => {
    const mensaje = mensajeWhatsApp({
      cliente: "Comunidad de Propietarios Blasco Ibáñez 88",
      titulo: "Arreglo del portal",
      enlace,
      empresa: "Reformas Levante S.L.",
    });
    expect(mensaje.startsWith("Hola. Te paso el presupuesto de arreglo del portal:")).toBe(true);
  });

  it("respeta las siglas del título", () => {
    expect(mensajeWhatsApp({ cliente: "Ana", titulo: "PVC en ventanas", enlace, empresa: "X" })).toContain(
      "presupuesto de PVC en ventanas:",
    );
  });

  it("sin empresa ni título sigue siendo un mensaje correcto", () => {
    expect(mensajeWhatsApp({ cliente: null, titulo: " ", enlace, empresa: null })).toBe(
      ["Hola. Te paso el presupuesto:", enlace, "Cualquier duda me dices. Un saludo."].join("\n"),
    );
  });
});

describe("enlaceWhatsApp", () => {
  it("con teléfono válido abre el chat de ese número, con el texto codificado", () => {
    const url = enlaceWhatsApp("600 112 233", "Hola, Carmen.\nTe paso: https://x/p/1?a=b&c=d");
    expect(url).toBe(
      "https://wa.me/34600112233?text=Hola%2C%20Carmen.%0ATe%20paso%3A%20https%3A%2F%2Fx%2Fp%2F1%3Fa%3Db%26c%3Dd",
    );
  });

  it("sin teléfono válido deja elegir el contacto", () => {
    expect(enlaceWhatsApp(null, "Hola")).toBe("https://wa.me/?text=Hola");
    expect(enlaceWhatsApp("no tiene", "Hola")).toBe("https://wa.me/?text=Hola");
  });
});
