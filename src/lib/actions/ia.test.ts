import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialAlmacen } from "@/lib/domain/sugerencias";

// Server Action de «Montar con IA» con la sesión, Supabase y la IA simulados. Supabase simulado: lee materiales y
// ia_propuestas, y las RPC de la cuota y de guardar se comportan como las de 0005, 0007 y 0009 (la primera propuesta
// guardada gana salvo con p_sustituir).

const { pedirPartidasIa, estado } = vi.hoisted(() => ({
  pedirPartidasIa: vi.fn(),
  estado: {
    materiales: [] as MaterialAlmacen[],
    errorMateriales: null as { message: string } | null,
    guardadas: new Map<string, unknown>(),
    errorLeer: null as { message: string } | null,
    errorGuardar: null as { message: string } | null,
    rpc: [] as { nombre: string; args?: Record<string, unknown> }[],
    usos: 0,
  },
}));

const E1 = "00000000-0000-0000-0000-000000000001";

function consulta(tabla: string) {
  const filtros: Record<string, unknown> = {};
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (columna: string, valor: unknown) => {
      filtros[columna] = valor;
      return q;
    },
    overrideTypes: async () =>
      tabla === "materiales"
        ? estado.errorMateriales
          ? { data: null, error: estado.errorMateriales }
          : { data: estado.materiales.map((m) => ({ ...m, precio_cents: String(m.precio_cents) })), error: null }
        : { data: null, error: { message: `tabla inesperada ${tabla}` } },
    maybeSingle: async () => {
      if (tabla !== "ia_propuestas" || filtros.empresa_id !== E1) return { data: null, error: { message: "inesperado" } };
      if (estado.errorLeer) return { data: null, error: estado.errorLeer };
      const respuesta = estado.guardadas.get(String(filtros.clave));
      return { data: respuesta === undefined ? null : { respuesta: structuredClone(respuesta) }, error: null };
    },
  };
  return q;
}

const supabase = {
  from: (tabla: string) => consulta(tabla),
  rpc: async (nombre: string, args?: Record<string, unknown>) => {
    estado.rpc.push({ nombre, args });
    if (nombre === "consumir_uso_ia") {
      estado.usos++;
      return { data: [{ quedan: 15 - estado.usos, reserva: `reserva-${estado.usos}` }], error: null };
    }
    if (nombre === "devolver_uso_ia") {
      estado.usos--;
      return { data: true, error: null };
    }
    if (nombre === "guardar_propuesta_ia") {
      if (estado.errorGuardar) return { data: null, error: estado.errorGuardar };
      const clave = String(args?.p_clave);
      if (!estado.guardadas.has(clave) || args?.p_sustituir === true) estado.guardadas.set(clave, structuredClone(args?.p_respuesta));
      return { data: structuredClone(estado.guardadas.get(clave)), error: null };
    }
    return { data: null, error: { message: `rpc inesperada ${nombre}` } };
  },
};

vi.mock("@/lib/auth", () => ({
  getSessionProfile: async () => ({ supabase, perfil: { id: "u1", empresa_id: E1, nombre: "Toni", email: "x", rol: "empleado" } }),
}));
vi.mock("@/lib/ia/config", () => ({ iaConfigurada: () => true }));
vi.mock("@/lib/ia/cliente", () => ({ pedirPartidasIa }));

const { sugerirPartidas } = await import("./ia");

const AZULEJO = "20000000-0000-4000-8000-000000000002";
const MATERIALES: MaterialAlmacen[] = [
  { id: "20000000-0000-4000-8000-000000000001", nombre: "Plato de ducha resina 120×80", unidad: "ud", precio_cents: 18950 },
  { id: AZULEJO, nombre: "Azulejo porcelánico 30×60", unidad: "m²", precio_cents: 2475 },
];

const DESCRIPCION = "Reforma de baño de 6 m²: quitar la bañera y alicatado hasta el techo.";

/** Respuesta de la IA: la mano de obra cambia de una llamada a otra (la IA no es determinista). */
const respuestaIa = (horas: number, deRespaldo = false) => ({
  ok: true,
  deRespaldo,
  datos: {
    partidas: [
      { descripcion: "Demolición de alicatado", cantidad: 14, unidad: "m²", precio_euros: 12, material_id: null },
      { descripcion: "Azulejo", cantidad: 18, unidad: "m²", precio_euros: 1, material_id: AZULEJO },
      { descripcion: "Oficial alicatador", cantidad: horas, unidad: "h", precio_euros: 24.5, material_id: null },
    ],
    supuestos: ["Altura de techo de 2,50 m"],
  },
});

const llamadas = (nombre: string) => estado.rpc.filter((r) => r.nombre === nombre);

beforeEach(() => {
  pedirPartidasIa.mockReset();
  pedirPartidasIa.mockResolvedValueOnce(respuestaIa(16)).mockResolvedValueOnce(respuestaIa(18)).mockResolvedValue(respuestaIa(20));
  estado.materiales = MATERIALES.map((m) => ({ ...m }));
  estado.errorMateriales = null;
  estado.guardadas.clear();
  estado.errorLeer = null;
  estado.errorGuardar = null;
  estado.rpc = [];
  estado.usos = 0;
});

describe("sugerirPartidas · misma descripción, mismo presupuesto (D14)", () => {
  it("la segunda vez, con otra capitalización y otros espacios, da las mismas partidas sin llamar a la IA ni gastar cuota", async () => {
    const primera = await sugerirPartidas(DESCRIPCION);
    const segunda = await sugerirPartidas(`  ${DESCRIPCION.toUpperCase().replace(": ", ":\n\n")}  `);
    const tercera = await sugerirPartidas(DESCRIPCION.replace(/\.$/, "..."));

    expect(primera).toMatchObject({ repetida: false, quedan: 14, descartadas: 0 });
    expect(segunda).toMatchObject({ repetida: true, quedan: null });
    expect(tercera).toMatchObject({ repetida: true, quedan: null });
    if (primera.error !== undefined || segunda.error !== undefined || tercera.error !== undefined) throw new Error("error");
    expect(segunda.partidas).toEqual(primera.partidas);
    expect(tercera.partidas).toEqual(primera.partidas);
    expect(segunda.supuestos).toEqual(primera.supuestos);
    expect(primera.partidas.map((p) => p.cantidad)).toEqual(["14", "18", "16"]);

    expect(pedirPartidasIa).toHaveBeenCalledTimes(1);
    expect(llamadas("consumir_uso_ia")).toHaveLength(1);
    expect(estado.usos).toBe(1);
  });

  it("guarda la propuesta validada con la reserva de ese uso y una clave SHA-256", async () => {
    await sugerirPartidas(DESCRIPCION);
    const [guardar] = llamadas("guardar_propuesta_ia");
    expect(guardar.args).toMatchObject({ p_reserva: "reserva-1", p_sustituir: false });
    expect(String(guardar.args?.p_clave)).toMatch(/^[0-9a-f]{64}$/);
    expect(guardar.args?.p_respuesta).toEqual({
      partidas: [
        { descripcion: "Demolición de alicatado (m²)", cantidad: 14, unidad: "", precio_euros: 12, material_id: null },
        { descripcion: "Azulejo", cantidad: 18, unidad: "m²", precio_euros: 24.75, material_id: AZULEJO },
        { descripcion: "Oficial alicatador (h)", cantidad: 16, unidad: "", precio_euros: 24.5, material_id: null },
      ],
      supuestos: ["Altura de techo de 2,50 m"],
    });
  });

  it("un número distinto en la descripción es otra obra: se pide a la IA", async () => {
    await sugerirPartidas(DESCRIPCION);
    const otra = await sugerirPartidas(DESCRIPCION.replace("6 m²", "8 m²"));
    expect(otra).toMatchObject({ repetida: false, quedan: 13 });
    expect(pedirPartidasIa).toHaveBeenCalledTimes(2);
  });

  it("si cambia el almacén (otro precio), se vuelve a pedir y la nueva propuesta usa el precio nuevo", async () => {
    await sugerirPartidas(DESCRIPCION);
    estado.materiales = MATERIALES.map((m) => (m.id === AZULEJO ? { ...m, precio_cents: 2600 } : { ...m }));
    const otra = await sugerirPartidas(DESCRIPCION);
    expect(otra).toMatchObject({ repetida: false });
    if (otra.error !== undefined) throw new Error(otra.error);
    expect(otra.partidas[1]).toMatchObject({ material_id: AZULEJO, precio: "26,00" });
    expect(pedirPartidasIa).toHaveBeenCalledTimes(2);
  });

  it("una propuesta guardada que ya no pasa la validación se ignora: se pide a la IA y se sustituye", async () => {
    await sugerirPartidas(DESCRIPCION);
    const [clave] = [...estado.guardadas.keys()];
    estado.guardadas.set(clave, { partidas: [{ descripcion: "x", cantidad: -1, unidad: "", precio_euros: 1, material_id: null }], supuestos: [] });
    const otra = await sugerirPartidas(DESCRIPCION);
    expect(otra).toMatchObject({ repetida: false });
    expect(pedirPartidasIa).toHaveBeenCalledTimes(2);
    expect(llamadas("guardar_propuesta_ia").at(-1)?.args).toMatchObject({ p_sustituir: true, p_reserva: "reserva-2" });
    // Y la siguiente ya sale de la caché.
    expect(await sugerirPartidas(DESCRIPCION)).toMatchObject({ repetida: true });
  });

  it("si otra petición con la misma descripción ha guardado antes la suya, se devuelve esa (las dos ven lo mismo)", async () => {
    // Simula la carrera: guardar_propuesta_ia encuentra ya una con 30 h de oficial.
    const primera = await sugerirPartidas(DESCRIPCION);
    if (primera.error !== undefined) throw new Error(primera.error);
    const [clave] = [...estado.guardadas.keys()];
    const deOtro = structuredClone(estado.guardadas.get(clave)) as { partidas: { cantidad: number }[] };
    deOtro.partidas[2].cantidad = 30;
    estado.guardadas.clear();
    const guardarReal = supabase.rpc;
    supabase.rpc = async (nombre, args) => {
      if (nombre === "guardar_propuesta_ia") estado.guardadas.set(String(args?.p_clave), deOtro);
      return guardarReal(nombre, args);
    };
    try {
      const r = await sugerirPartidas(DESCRIPCION);
      if (r.error !== undefined) throw new Error(r.error);
      expect(r.partidas[2].cantidad).toBe("30");
    } finally {
      supabase.rpc = guardarReal;
    }
  });

  it("una respuesta de un modelo de respaldo (fallback) se le da al usuario pero no se guarda: la siguiente vez se pide otra vez", async () => {
    pedirPartidasIa.mockReset().mockResolvedValueOnce(respuestaIa(16, true)).mockResolvedValue(respuestaIa(18));
    const primera = await sugerirPartidas(DESCRIPCION);
    expect(primera).toMatchObject({ repetida: false, quedan: 14, descartadas: 0 });
    if (primera.error !== undefined) throw new Error(primera.error);
    expect(primera.partidas.map((p) => p.cantidad)).toEqual(["14", "18", "16"]);
    expect(llamadas("guardar_propuesta_ia")).toHaveLength(0);
    expect(llamadas("devolver_uso_ia")).toHaveLength(0);
    expect(estado.guardadas.size).toBe(0);

    // La siguiente la da el modelo principal: esa sí se guarda, y la tercera ya sale de la caché.
    expect(await sugerirPartidas(DESCRIPCION)).toMatchObject({ repetida: false, quedan: 13 });
    expect(llamadas("guardar_propuesta_ia")).toHaveLength(1);
    expect(await sugerirPartidas(DESCRIPCION)).toMatchObject({ repetida: true });
    expect(pedirPartidasIa).toHaveBeenCalledTimes(2);
  });

  it("una propuesta guardada que ya no vale tampoco se sustituye con una respuesta de respaldo", async () => {
    await sugerirPartidas(DESCRIPCION);
    const [clave] = [...estado.guardadas.keys()];
    const mala = { partidas: [{ descripcion: "x", cantidad: -1, unidad: "", precio_euros: 1, material_id: null }], supuestos: [] };
    estado.guardadas.set(clave, mala);
    pedirPartidasIa.mockReset().mockResolvedValue(respuestaIa(20, true));
    expect(await sugerirPartidas(DESCRIPCION)).toMatchObject({ repetida: false });
    expect(llamadas("guardar_propuesta_ia")).toHaveLength(1);
    expect(estado.guardadas.get(clave)).toEqual(mala);
  });

  it.each([
    ["sin reserva válida (TJ005)", "TJ005"],
    ["la guardada es de otro autor y no es admin (TJ006, 0010)", "TJ006"],
  ])("si no se puede guardar (%s), el usuario tiene su propuesta igualmente", async (_, codigo) => {
    estado.errorGuardar = { message: codigo };
    const r = await sugerirPartidas(DESCRIPCION);
    expect(r).toMatchObject({ repetida: false, quedan: 14 });
    if (r.error !== undefined) throw new Error(r.error);
    expect(r.partidas).toHaveLength(3);
  });

  it("sin 0009 en la base (ni la tabla ni la función), funciona como antes: pide a la IA, gasta su uso y propone", async () => {
    estado.errorLeer = { message: 'relation "public.ia_propuestas" does not exist' };
    estado.errorGuardar = { message: "Could not find the function public.guardar_propuesta_ia" };
    const primera = await sugerirPartidas(DESCRIPCION);
    const segunda = await sugerirPartidas(DESCRIPCION);
    expect(primera).toMatchObject({ repetida: false, quedan: 14, descartadas: 0 });
    expect(segunda).toMatchObject({ repetida: false, quedan: 13 });
    if (primera.error !== undefined) throw new Error(primera.error);
    expect(primera.partidas).toHaveLength(3);
    expect(pedirPartidasIa).toHaveBeenCalledTimes(2);
    expect(llamadas("devolver_uso_ia")).toHaveLength(0);
  });

  it("si la IA no llega a atender la petición, se devuelve el uso y no se guarda nada", async () => {
    pedirPartidasIa.mockReset().mockResolvedValue({ ok: false, error: "La IA no está disponible", devolver: true });
    expect(await sugerirPartidas(DESCRIPCION)).toEqual({ error: "La IA no está disponible" });
    expect(llamadas("devolver_uso_ia")[0].args).toEqual({ p_reserva: "reserva-1" });
    expect(llamadas("guardar_propuesta_ia")).toHaveLength(0);
    expect(estado.guardadas.size).toBe(0);
  });

  it("si la IA responde algo que no vale, cuenta el uso y no se guarda nada", async () => {
    pedirPartidasIa.mockReset().mockResolvedValue({ ok: true, datos: { partidas: [], supuestos: [] } });
    expect(await sugerirPartidas(DESCRIPCION)).toMatchObject({ error: expect.stringMatching(/ninguna partida válida/) });
    expect(llamadas("devolver_uso_ia")).toHaveLength(0);
    expect(estado.guardadas.size).toBe(0);
  });

  it("si no se puede leer el almacén, no se gasta cuota ni se llama a la IA", async () => {
    estado.errorMateriales = { message: "fallo" };
    expect(await sugerirPartidas(DESCRIPCION)).toHaveProperty("error");
    expect(estado.rpc).toEqual([]);
    expect(pedirPartidasIa).not.toHaveBeenCalled();
  });

  it("una descripción no válida no lee nada ni gasta cuota", async () => {
    expect(await sugerirPartidas("baño")).toMatchObject({ error: expect.stringMatching(/al menos 10/) });
    expect(estado.rpc).toEqual([]);
  });
});
