import { describe, expect, it } from "vitest";
import {
  ERROR_OBRA_TERMINADA_SOLO_NOTAS,
  ERROR_PARTE_ANTIGUO,
  ESTADOS_OBRA,
  accionesEstadoObra,
  admitePartesNuevos,
  camposEditablesObra,
  consumidoPct,
  diaMadrid,
  errorCambioEstadoObra,
  errorParteNuevo,
  fechaMinimaParte,
  isEstadoObra,
  parseHoras,
  partesEditables,
  puedeCambiarEstadoObra,
  puedeEditarParte,
  puedeGestionarObra,
  semaforoObra,
  validateObra,
  validateParte,
  type EstadoObra,
} from "./obras";

const MAT_A = "20000000-0000-4000-8000-000000000010";
const MAT_B = "20000000-0000-4000-8000-000000000012";

describe("estados de obra", () => {
  const permitidas: [EstadoObra, EstadoObra][] = [
    ["pendiente", "en_curso"],
    ["en_curso", "parada"],
    ["en_curso", "terminada"],
    ["parada", "en_curso"],
    ["parada", "terminada"],
  ];

  it("solo permite las transiciones del trigger obras_reglas", () => {
    for (const desde of ESTADOS_OBRA) {
      for (const hasta of ESTADOS_OBRA) {
        const esperada = permitidas.some(([d, h]) => d === desde && h === hasta);
        expect(puedeCambiarEstadoObra(desde, hasta), `${desde} → ${hasta}`).toBe(esperada);
      }
    }
  });

  it("da el mismo mensaje que la base de datos", () => {
    expect(errorCambioEstadoObra("pendiente", "terminada")).toBe(
      "Una obra no puede pasar de «pendiente» a «terminada».",
    );
    expect(errorCambioEstadoObra("en_curso", "pendiente")).toBe("Una obra no puede pasar de «en curso» a «pendiente».");
    expect(errorCambioEstadoObra("terminada", "en_curso")).toBe(
      "La obra ya está terminada: no puede cambiar de estado.",
    );
    expect(errorCambioEstadoObra("parada", "en_curso")).toBeNull();
    expect(errorCambioEstadoObra("en_curso", "en_curso")).toBeNull();
  });

  it("gestionan la obra gerencia o su encargado", () => {
    expect(puedeGestionarObra("admin", false)).toBe(true);
    expect(puedeGestionarObra("empleado", true)).toBe(true);
    expect(puedeGestionarObra("empleado", false)).toBe(false);
  });

  it("acciones de estado según quién mira", () => {
    expect(accionesEstadoObra("en_curso", "empleado", true)).toEqual(["parada", "terminada"]);
    expect(accionesEstadoObra("en_curso", "empleado", false)).toEqual([]);
    expect(accionesEstadoObra("pendiente", "admin", false)).toEqual(["en_curso"]);
    expect(accionesEstadoObra("terminada", "admin", true)).toEqual([]);
  });

  it("reconoce los estados", () => {
    expect(isEstadoObra("en_curso")).toBe(true);
    expect(isEstadoObra("cerrada")).toBe(false);
    expect(isEstadoObra(null)).toBe(false);
  });
});

describe("partes: cuándo y quién", () => {
  it("solo se añaden a obras en curso, con el mensaje de la base de datos", () => {
    expect(admitePartesNuevos("en_curso")).toBe(true);
    for (const estado of ["pendiente", "parada", "terminada"] as const) {
      expect(admitePartesNuevos(estado)).toBe(false);
      expect(errorParteNuevo(estado)).toMatch(/obra/);
    }
    expect(errorParteNuevo("en_curso")).toBeNull();
    expect(errorParteNuevo("terminada")).toBe("La obra está terminada: ya no admite partes nuevos.");
  });

  it("los partes de una obra terminada ya no se tocan", () => {
    expect(partesEditables("terminada")).toBe(false);
    expect(partesEditables("parada")).toBe(true);
  });

  it("puedeEditarParte: gerencia siempre; el autor, solo el día en que lo registró", () => {
    expect(puedeEditarParte("admin", false, "2026-11-01", "2026-11-23")).toBe(true);
    expect(puedeEditarParte("empleado", true, "2026-11-23", "2026-11-23")).toBe(true);
    expect(puedeEditarParte("empleado", true, "2026-11-22", "2026-11-23")).toBe(false);
    expect(puedeEditarParte("empleado", false, "2026-11-23", "2026-11-23")).toBe(false);
  });

  it("diaMadrid usa la hora de Madrid", () => {
    // 23:30 UTC del 22 de noviembre = 00:30 del 23 en Madrid (invierno, UTC+1).
    expect(diaMadrid("2026-11-22T23:30:00Z")).toBe("2026-11-23");
    // 22:30 UTC del 30 de junio = 00:30 del 1 de julio en Madrid (verano, UTC+2).
    expect(diaMadrid(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(() => diaMadrid("no es una fecha")).toThrow();
  });
});

describe("% consumido (misma regla que obras_resumen)", () => {
  it("consumido: 1 decimal, medio hacia arriba, exacto con importes grandes; null sin presupuestado", () => {
    expect(consumidoPct(107830, 115100)).toBe(93.7);
    expect(consumidoPct(1, 2000)).toBe(0.1); // 0,05 % → 0,1
    expect(consumidoPct(1, 2001)).toBe(0); // 0,0499… → 0,0
    expect(consumidoPct(9_000_000_000_005, 10_000_000_000_000)).toBe(90); // 90,00000000005 → 90,0
    expect(consumidoPct(500, 0)).toBeNull();
    expect(() => consumidoPct(-1, 100)).toThrow();
    expect(() => consumidoPct(1, 1.5)).toThrow();
  });
});

describe("semaforoObra", () => {
  it.each([
    [0, "verde"],
    [79.9, "verde"],
    [80, "ambar"],
    [100, "ambar"],
    [100.1, "rojo"],
    [250, "rojo"],
  ] as const)("%s %% en curso → %s", (pct, color) => {
    expect(semaforoObra(pct, "en_curso")).toBe(color);
  });

  it("una obra terminada conserva su color; una pendiente o sin presupuestado, verde", () => {
    expect(semaforoObra(93.7, "terminada")).toBe("ambar");
    expect(semaforoObra(120, "terminada")).toBe("rojo");
    expect(semaforoObra(0, "pendiente")).toBe("verde");
    expect(semaforoObra(null, "en_curso")).toBe("verde");
  });
});

describe("parseHoras", () => {
  it.each([
    ["8", 8],
    ["7,5", 7.5],
    ["7.25", 7.25],
    [" 6 h", 6],
    ["24", 24],
    ["0,01", 0.01],
  ] as const)("lee %j", (texto, horas) => {
    expect(parseHoras(texto)).toBe(horas);
  });

  it.each([
    ["", "Escribe las horas."],
    ["-2", "Las horas no pueden ser negativas."],
    ["0", "Las horas tienen que ser más de 0."],
    ["24,5", "Como mucho 24 horas en un parte."],
    ["7,125", "Como mucho 2 decimales."],
    ["ocho", "Escribe un número de horas, por ejemplo 8 o 7,5."],
  ])("rechaza %j", (texto, mensaje) => {
    expect(() => parseHoras(texto)).toThrow(mensaje);
  });

  it("también acepta números", () => {
    expect(parseHoras(7.5)).toBe(7.5);
    expect(() => parseHoras(1.234)).toThrow("Como mucho 2 decimales.");
    expect(() => parseHoras(Number.NaN)).toThrow();
    expect(() => parseHoras(25)).toThrow();
  });
});

describe("validateParte", () => {
  const HOY = "2026-11-23";

  it("devuelve los datos listos para guardar_parte", () => {
    const r = validateParte(
      {
        fecha: "2026-11-20",
        horas: "7,5",
        notas: "  Alicatado del frontal.  ",
        materiales: [
          { material_id: MAT_A, cantidad: "2,5" },
          { material_id: MAT_B, cantidad: 3 },
        ],
      },
      HOY,
    );
    expect(r).toEqual({
      ok: true,
      data: {
        fecha: "2026-11-20",
        horas: 7.5,
        notas: "Alicatado del frontal.",
        materiales: [
          { material_id: MAT_A, cantidad: 2.5 },
          { material_id: MAT_B, cantidad: 3 },
        ],
      },
    });
  });

  it("fecha vacía = hoy; sin notas ni materiales", () => {
    expect(validateParte({ horas: "8" }, HOY)).toEqual({
      ok: true,
      data: { fecha: HOY, horas: 8, notas: null, materiales: [] },
    });
  });

  it("errores por campo, en español", () => {
    const r = validateParte(
      { fecha: "2026-11-24", horas: "0", notas: "x".repeat(1001), materiales: "no" },
      HOY,
    );
    expect(r).toEqual({
      ok: false,
      errors: {
        fecha: "La fecha del parte no puede ser posterior a hoy.",
        horas: "Las horas tienen que ser más de 0.",
        notas: "Como mucho 1000 caracteres.",
        materiales: "Los materiales no son válidos.",
      },
    });
  });

  it("rechaza fechas imposibles", () => {
    const r = validateParte({ fecha: "2026-02-30", horas: "8" }, HOY);
    expect(r.ok === false && r.errors.fecha).toBe("Elige una fecha válida.");
  });

  it.each([
    [[{ material_id: "no-uuid", cantidad: "1" }], "Material 1: elige un material del almacén."],
    [[{ material_id: MAT_A, cantidad: "0" }], "Material 1: la cantidad tiene que ser mayor que 0."],
    [[{ material_id: MAT_A, cantidad: "" }], "Material 1: escribe una cantidad."],
    [[{ material_id: MAT_A, cantidad: "1,2345" }], "Material 1: como mucho 3 decimales."],
    [
      [
        { material_id: MAT_A, cantidad: "1" },
        { material_id: MAT_A, cantidad: "2" },
      ],
      "Material 2: ya está en el parte; junta las cantidades en una línea.",
    ],
    [Array.from({ length: 31 }, () => ({ material_id: MAT_A, cantidad: "1" })), "Un parte puede tener como mucho 30 materiales."],
  ])("materiales no válidos: %#", (materiales, mensaje) => {
    const r = validateParte({ horas: "8", materiales }, HOY);
    expect(r.ok === false && r.errors.materiales).toBe(mensaje);
  });

  it("exige un hoy válido", () => {
    expect(() => validateParte({ horas: "8" }, "23/11/2026")).toThrow();
  });

  it("la fecha no puede ser anterior al inicio de la obra (mismo mensaje que la base de datos)", () => {
    const r = validateParte({ fecha: "2026-11-13", horas: "8" }, HOY, "2026-11-14");
    expect(r.ok === false && r.errors.fecha).toBe(
      "La fecha del parte no puede ser anterior al inicio de la obra (14/11/2026).",
    );
    expect(validateParte({ fecha: "2026-11-14", horas: "8" }, HOY, "2026-11-14").ok).toBe(true);
    expect(() => validateParte({ horas: "8" }, HOY, "14/11/2026")).toThrow();
  });

  it("como mucho 30 días hacia atrás (mismo mensaje que la base de datos, D12)", () => {
    expect(ERROR_PARTE_ANTIGUO).toBe("La fecha del parte no puede ser de hace más de 30 días.");
    // Hoy 23/11: el 24/10 es hace 30 días (vale); el 23/10, hace 31 (no).
    expect(validateParte({ fecha: "2026-10-24", horas: "8" }, HOY).ok).toBe(true);
    const r = validateParte({ fecha: "2026-10-23", horas: "8" }, HOY);
    expect(r.ok === false && r.errors.fecha).toBe(ERROR_PARTE_ANTIGUO);
    // También cruzando de año y con una obra que empezó antes.
    const enero = validateParte({ fecha: "2025-12-05", horas: "8" }, "2026-01-05", "2025-11-01");
    expect(enero.ok === false && enero.errors.fecha).toBe(ERROR_PARTE_ANTIGUO);
    expect(validateParte({ fecha: "2025-12-06", horas: "8" }, "2026-01-05", "2025-11-01").ok).toBe(true);
  });

  it("al editar un parte antiguo sin cambiarle la fecha, el límite de 30 días no cuenta (como la base)", () => {
    expect(validateParte({ fecha: "2026-09-01", horas: "6" }, HOY, null, "2026-09-01").ok).toBe(true);
    const cambiada = validateParte({ fecha: "2026-09-02", horas: "6" }, HOY, null, "2026-09-01");
    expect(cambiada.ok === false && cambiada.errors.fecha).toBe(ERROR_PARTE_ANTIGUO);
  });
});

describe("fechaMinimaParte", () => {
  it("hace 30 días, o el inicio de la obra si es posterior", () => {
    expect(fechaMinimaParte("2026-11-23", null)).toBe("2026-10-24");
    expect(fechaMinimaParte("2026-11-23", "2026-09-01")).toBe("2026-10-24");
    expect(fechaMinimaParte("2026-11-23", "2026-11-14")).toBe("2026-11-14");
    expect(fechaMinimaParte("2026-03-01", null)).toBe("2026-01-30");
  });

  it("al editar un parte más antiguo, su propia fecha", () => {
    expect(fechaMinimaParte("2026-11-23", null, "2026-09-01")).toBe("2026-09-01");
    expect(fechaMinimaParte("2026-11-23", null, "2026-11-20")).toBe("2026-10-24");
  });

  it("exige un hoy válido", () => {
    expect(() => fechaMinimaParte("23/11/2026", null)).toThrow();
  });
});

describe("validateObra", () => {
  const HOY = "2026-11-23";

  it("devuelve fechas y notas limpias; vacío = null", () => {
    expect(
      validateObra(
        { fecha_inicio: "2026-11-14", fecha_fin_prevista: "2026-11-27", fecha_fin: "", notas: "  Vigilar horas.  " },
        { estado: "en_curso", hoyMadrid: HOY, primerParte: "2026-11-14" },
      ),
    ).toEqual({
      ok: true,
      data: { fecha_inicio: "2026-11-14", fecha_fin_prevista: "2026-11-27", fecha_fin: null, notas: "Vigilar horas." },
    });
    expect(validateObra({}, { estado: "pendiente", hoyMadrid: HOY })).toEqual({
      ok: true,
      data: { fecha_inicio: null, fecha_fin_prevista: null, fecha_fin: null, notas: null },
    });
  });

  it("una pendiente puede tener inicio previsto futuro; una empezada no", () => {
    expect(validateObra({ fecha_inicio: "2026-11-26" }, { estado: "pendiente", hoyMadrid: HOY }).ok).toBe(true);
    const r = validateObra({ fecha_inicio: "2026-11-26" }, { estado: "en_curso", hoyMadrid: HOY });
    expect(r.ok === false && r.errors.fecha_inicio).toBe(
      "La fecha de inicio de una obra empezada no puede ser posterior a hoy.",
    );
    const r2 = validateObra({ fecha_inicio: "" }, { estado: "parada", hoyMadrid: HOY });
    expect(r2.ok === false && r2.errors.fecha_inicio).toBe("Una obra empezada tiene que tener fecha de inicio.");
  });

  it("el inicio no puede ser posterior al parte más antiguo", () => {
    const r = validateObra({ fecha_inicio: "2026-11-16" }, { estado: "en_curso", hoyMadrid: HOY, primerParte: "2026-11-15" });
    expect(r.ok === false && r.errors.fecha_inicio).toBe(
      "La obra tiene partes desde el 15/11/2026: la fecha de inicio no puede ser posterior.",
    );
  });

  it("fechas de fin coherentes, con los mensajes de la base de datos", () => {
    const casos: [Parameters<typeof validateObra>[0], EstadoObra, string, string][] = [
      [{ fecha_inicio: "2026-11-14", fecha_fin_prevista: "2026-11-13" }, "en_curso", "fecha_fin_prevista",
        "La fecha de fin prevista no puede ser anterior a la de inicio."],
      [{ fecha_inicio: "2026-11-14", fecha_fin: "2026-11-20" }, "en_curso", "fecha_fin",
        "La fecha de fin real solo se pone al terminar la obra."],
      [{ fecha_inicio: "2026-11-14", fecha_fin: "2026-11-24" }, "terminada", "fecha_fin",
        "La fecha de fin real no puede ser posterior a hoy."],
      [{ fecha_inicio: "2026-11-14", fecha_fin: "2026-11-13" }, "terminada", "fecha_fin",
        "La fecha de fin no puede ser anterior a la de inicio."],
      [{ fecha_inicio: "2026-02-30" }, "pendiente", "fecha_inicio", "Elige una fecha válida."],
      [{ notas: "x".repeat(2001) }, "pendiente", "notas", "Las notas de la obra pueden tener como mucho 2000 caracteres."],
    ];
    for (const [raw, estado, campo, mensaje] of casos) {
      const r = validateObra(raw, { estado, hoyMadrid: HOY });
      expect(r.ok === false && r.errors[campo as keyof typeof r.errors], `${campo}: ${mensaje}`).toBe(mensaje);
    }
  });

  it("una terminada solo deja editar las notas", () => {
    expect(camposEditablesObra("terminada")).toEqual(["notas"]);
    expect(camposEditablesObra("en_curso")).toEqual(["fecha_inicio", "fecha_fin_prevista", "fecha_fin", "notas"]);
    expect(ERROR_OBRA_TERMINADA_SOLO_NOTAS).toBe("La obra está terminada: solo se pueden cambiar las notas.");
  });

  it("exige un hoy válido", () => {
    expect(() => validateObra({}, { estado: "pendiente", hoyMadrid: "hoy" })).toThrow();
  });
});
