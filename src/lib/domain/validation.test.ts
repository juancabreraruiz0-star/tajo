import { describe, expect, it } from "vitest";
import {
  isUuid,
  isValidEmail,
  materialChanges,
  text,
  validateCliente,
  validateLogin,
  validateMaterial,
} from "./validation";

describe("text", () => {
  it("recorta texto y trata lo que no es texto como vacío", () => {
    expect(text("  hola ")).toBe("hola");
    expect(text(null)).toBe("");
    expect(text(undefined)).toBe("");
    expect(text(12)).toBe("");
  });
});

describe("isValidEmail", () => {
  it.each(["ana@reformaslevante.es", "a.b+c@correo.com"])("%s es válido", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(["ana", "ana@", "ana@correo", "ana @correo.es", "@correo.es", `${"a".repeat(250)}@x.es`])(
    "%s no es válido",
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});

describe("isUuid", () => {
  it("acepta uuid y rechaza lo demás", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000001")).toBe(true);
    expect(isUuid("2B1C0D3E-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("nuevo")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-00000000000")).toBe(false);
  });
});

describe("validateLogin", () => {
  it("normaliza el email y no toca la contraseña", () => {
    expect(validateLogin({ email: "  Gerencia@ReformasLevante.es ", password: " clave " })).toEqual({
      ok: true,
      data: { email: "gerencia@reformaslevante.es", password: " clave " },
    });
  });

  it("pide email y contraseña", () => {
    expect(validateLogin({})).toEqual({
      ok: false,
      errors: { email: "Escribe tu email.", password: "Escribe tu contraseña." },
    });
  });

  it("rechaza un email mal escrito", () => {
    const r = validateLogin({ email: "gerencia", password: "x" });
    expect(r).toEqual({ ok: false, errors: { email: "El email no es válido." } });
  });
});

describe("validateCliente", () => {
  it("limpia los datos y deja a null los opcionales vacíos", () => {
    expect(
      validateCliente({ nombre: "  Marta Gil ", telefono: " 612 345 678 ", email: "", direccion: "  ", notas: null }),
    ).toEqual({
      ok: true,
      data: { nombre: "Marta Gil", nif: null, telefono: "612 345 678", email: null, direccion: null, notas: null },
    });
  });

  it("el NIF es opcional y se guarda normalizado", () => {
    const r = validateCliente({ nombre: "Marta", nif: " 12.345.678-z " });
    expect(r.ok && r.data.nif).toBe("12345678Z");
    const cif = validateCliente({ nombre: "Reformas SL", nif: "b-12345674" });
    expect(cif.ok && cif.data.nif).toBe("B12345674");
    const vacio = validateCliente({ nombre: "Marta", nif: "  " });
    expect(vacio.ok && vacio.data.nif).toBeNull();
  });

  it("da el error del NIF junto al campo", () => {
    expect(validateCliente({ nombre: "Marta", nif: "12345678A" })).toEqual({
      ok: false,
      errors: { nif: "La letra no corresponde al número del DNI. Revísalo." },
    });
    expect(validateCliente({ nombre: "Marta", nif: "1234" })).toEqual({
      ok: false,
      errors: { nif: expect.stringMatching(/9 letras o cifras/) },
    });
  });

  it("el nombre es obligatorio", () => {
    expect(validateCliente({ nombre: "   " })).toEqual({
      ok: false,
      errors: { nombre: "El nombre es obligatorio." },
    });
  });

  it("valida el email solo si se rellena", () => {
    expect(validateCliente({ nombre: "Marta", email: "marta@correo.es" }).ok).toBe(true);
    expect(validateCliente({ nombre: "Marta", email: "marta@" })).toEqual({
      ok: false,
      errors: { email: "El email no es válido (ej.: nombre@correo.es)." },
    });
  });

  it("el teléfono es texto libre", () => {
    const r = validateCliente({ nombre: "Marta", telefono: "+34 96 123 45 67 (tardes)" });
    expect(r.ok && r.data.telefono).toBe("+34 96 123 45 67 (tardes)");
  });

  it("limita la longitud de los campos", () => {
    const r = validateCliente({ nombre: "a".repeat(121), notas: "n".repeat(2001) });
    expect(r).toEqual({
      ok: false,
      errors: { nombre: "Como mucho 120 caracteres.", notas: "Como mucho 2000 caracteres." },
    });
  });
});

describe("validateMaterial", () => {
  const base = { nombre: "Azulejo blanco 20×20", unidad: "m²", precio: "12,50", stock: "40", stock_minimo: "10" };

  it("convierte precio a céntimos y cantidades a número", () => {
    expect(validateMaterial(base)).toEqual({
      ok: true,
      data: { nombre: "Azulejo blanco 20×20", unidad: "m²", precio_cents: 1250, stock: 40, stock_minimo: 10 },
    });
  });

  it("admite decimales con coma y miles con punto", () => {
    const r = validateMaterial({ ...base, precio: "1.234,56", stock: "2,5", stock_minimo: "1.500" });
    expect(r.ok && r.data).toMatchObject({ precio_cents: 123456, stock: 2.5, stock_minimo: 1500 });
  });

  it("stock y mínimo vacíos cuentan como 0", () => {
    const r = validateMaterial({ ...base, stock: "", stock_minimo: undefined });
    expect(r.ok && r.data).toMatchObject({ stock: 0, stock_minimo: 0 });
  });

  it("nombre, unidad y precio son obligatorios", () => {
    expect(validateMaterial({})).toEqual({
      ok: false,
      errors: {
        nombre: "El nombre es obligatorio.",
        unidad: "Indica la unidad (ud, m², kg…).",
        precio: "Escribe el precio (ej.: 12,50).",
      },
    });
  });

  it("rechaza precio negativo o mal escrito", () => {
    expect(validateMaterial({ ...base, precio: "-3" })).toEqual({
      ok: false,
      errors: { precio: "El importe no puede ser negativo." },
    });
    const r = validateMaterial({ ...base, precio: "doce" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.precio).toMatch(/Importe no válido/);
  });

  it("rechaza precios desproporcionados", () => {
    expect(validateMaterial({ ...base, precio: "1.000.000,01" })).toEqual({
      ok: false,
      errors: { precio: "El precio es demasiado alto." },
    });
    expect(validateMaterial({ ...base, precio: "1.000.000" }).ok).toBe(true);
  });

  it("stock y mínimo deben ser números ≥ 0", () => {
    expect(validateMaterial({ ...base, stock: "-1", stock_minimo: "muchos" })).toEqual({
      ok: false,
      errors: { stock: "No puede ser negativa.", stock_minimo: "Escribe un número, por ejemplo 12 o 2,5." },
    });
  });

  it("limita la longitud de nombre y unidad", () => {
    expect(validateMaterial({ ...base, nombre: "a".repeat(121), unidad: "u".repeat(21) })).toEqual({
      ok: false,
      errors: { nombre: "Como mucho 120 caracteres.", unidad: "Como mucho 20 caracteres." },
    });
  });

  describe("material con stock negativo (facturado sin existencias)", () => {
    it("acepta el stock negativo solo si es el que ya tenía, y deja cambiar el resto", () => {
      const r = validateMaterial({ ...base, precio: "13,90", stock: "-3" }, { stockActual: -3 });
      expect(r).toEqual({
        ok: true,
        data: { nombre: "Azulejo blanco 20×20", unidad: "m²", precio_cents: 1390, stock: -3, stock_minimo: 10 },
      });
    });

    it("lo reconoce con decimales, tal como lo pinta el formulario", () => {
      const r = validateMaterial({ ...base, stock: "-2,5" }, { stockActual: -2.5 });
      expect(r.ok && r.data.stock).toBe(-2.5);
    });

    it("rechaza un negativo distinto del actual y dice qué hacer", () => {
      expect(validateMaterial({ ...base, stock: "-5" }, { stockActual: -3 })).toEqual({
        ok: false,
        errors: { stock: "No puede ser negativo: deja -3 para no tocarlo o escribe el stock real." },
      });
      expect(validateMaterial({ ...base, stock: "-tres" }, { stockActual: -3 }).ok).toBe(false);
    });

    it("deja corregirlo a 0 o a un número positivo", () => {
      const cero = validateMaterial({ ...base, stock: "0" }, { stockActual: -3 });
      expect(cero.ok && cero.data.stock).toBe(0);
      const repuesto = validateMaterial({ ...base, stock: "25" }, { stockActual: -3 });
      expect(repuesto.ok && repuesto.data.stock).toBe(25);
    });

    it("no acepta negativos si el material no estaba en negativo ni en el alta", () => {
      const errors = { stock: "No puede ser negativa." };
      expect(validateMaterial({ ...base, stock: "-3" }, { stockActual: 3 })).toEqual({ ok: false, errors });
      expect(validateMaterial({ ...base, stock: "-3" }, { stockActual: 0 })).toEqual({ ok: false, errors });
      expect(validateMaterial({ ...base, stock: "-3" })).toEqual({ ok: false, errors });
    });
  });
});

describe("validateMaterial · coste (solo gerencia, M2)", () => {
  const base = { nombre: "Rodapié cerámico", unidad: "m", precio: "9,00", stock: "0", stock_minimo: "0" };

  it("sin conCoste no se lee ni se envía el coste, aunque llegue en el formulario", () => {
    const r = validateMaterial({ ...base, coste: "6,00" });
    expect(r.ok && "coste_cents" in r.data).toBe(false);
  });

  it("con conCoste convierte el coste a céntimos (sin IVA)", () => {
    const r = validateMaterial({ ...base, coste: "6,35" }, { conCoste: true });
    expect(r.ok && r.data.coste_cents).toBe(635);
    expect(validateMaterial({ ...base, coste: "0" }, { conCoste: true })).toMatchObject({ data: { coste_cents: 0 } });
  });

  it("vacío queda null (los partes usan el precio de venta)", () => {
    for (const coste of ["", "   ", undefined]) {
      const r = validateMaterial({ ...base, coste }, { conCoste: true });
      expect(r.ok && r.data.coste_cents).toBeNull();
    }
  });

  it("negativo, no numérico o por encima de 1.000.000 € da error en el campo", () => {
    for (const coste of ["-1", "barato", "1.000.000,01"]) {
      const r = validateMaterial({ ...base, coste }, { conCoste: true });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.errors.coste).toBeTruthy();
    }
    expect(validateMaterial({ ...base, coste: "1.000.000" }, { conCoste: true }).ok).toBe(true);
  });
});

describe("materialChanges", () => {
  const data = { nombre: "Plato de ducha 80×120", unidad: "ud", precio_cents: 18_900, stock: 4, stock_minimo: 2 };

  it("con stock ≥ 0 se guardan todas las columnas", () => {
    expect(materialChanges(data)).toEqual(data);
    expect(materialChanges({ ...data, stock: 0 })).toEqual({ ...data, stock: 0 });
  });

  it("con stock negativo no se envía el stock: no se toca", () => {
    const cambios = materialChanges({ ...data, stock: -1 });
    expect(cambios).toEqual({ nombre: "Plato de ducha 80×120", unidad: "ud", precio_cents: 18_900, stock_minimo: 2 });
    expect("stock" in cambios).toBe(false);
  });
});
