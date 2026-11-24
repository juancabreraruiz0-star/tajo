import { beforeEach, describe, expect, it, vi } from "vitest";

// SDK simulado: el cliente solo tiene beta.messages.create (un mock) y conserva las clases de error reales, que son
// las que cliente.ts compara con instanceof.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const R = real.default;
  class AnthropicSimulado {
    beta = { messages: { create } };
  }
  return {
    default: Object.assign(AnthropicSimulado, {
      APIError: R.APIError,
      APIConnectionError: R.APIConnectionError,
      APIConnectionTimeoutError: R.APIConnectionTimeoutError,
      AuthenticationError: R.AuthenticationError,
      PermissionDeniedError: R.PermissionDeniedError,
      RateLimitError: R.RateLimitError,
      InternalServerError: R.InternalServerError,
    }),
  };
});

const SDK = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
const { MENSAJES_IA, pedirPartidasIa } = await import("./cliente");
const { PETICION_IA, VERSION_PETICION_IA, mensajeIa } = await import("./prompt");

const cabeceras = () => new Headers();
const respuesta = (extra: Record<string, unknown>) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [],
  usage: { input_tokens: 1, output_tokens: 1 },
  ...extra,
});
const texto = (t: string) => ({ type: "text", text: t, citations: null });
const JSON_BUENO = JSON.stringify({ partidas: [{ descripcion: "x" }], supuestos: [] });

beforeEach(() => {
  create.mockReset();
});

describe("pedirPartidasIa · petición", () => {
  it("llama exactamente como pide D10 (modelo, betas, fallbacks, effort, esquema) y sin thinking ni temperature", async () => {
    create.mockResolvedValue(respuesta({ content: [texto(JSON_BUENO)] }));
    await pedirPartidasIa("Reforma de baño de 6 m²", []);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    expect(typeof params.system).toBe("string");
    expect(params.messages).toEqual([{ role: "user", content: expect.stringContaining("Reforma de baño de 6 m²") }]);
  });

  it("envía exactamente PETICION_IA más el mensaje: lo mismo de lo que sale la clave de la caché (D14)", async () => {
    create.mockResolvedValue(respuesta({ content: [texto(JSON_BUENO)] }));
    await pedirPartidasIa("Reforma de baño de 6 m²", []);
    const { messages, ...resto } = create.mock.calls[0][0] as Record<string, unknown>;
    expect(resto).toEqual(PETICION_IA);
    expect(messages).toEqual([{ role: "user", content: mensajeIa("Reforma de baño de 6 m²", []) }]);
    // La versión de la caché recoge todos los parámetros de la llamada, también effort, max_tokens y fallbacks.
    expect(JSON.parse(VERSION_PETICION_IA)).toEqual(JSON.parse(JSON.stringify(resto)));
    expect(JSON.parse(VERSION_PETICION_IA)).toMatchObject({
      max_tokens: 16000,
      fallbacks: "default",
      output_config: { effort: "medium" },
    });
  });
});

describe("pedirPartidasIa · respuestas", () => {
  it("respuesta normal: devuelve el JSON parseado y no es de respaldo", async () => {
    create.mockResolvedValue(respuesta({ content: [texto(JSON_BUENO)] }));
    expect(await pedirPartidasIa("Reforma de baño", [])).toEqual({ ok: true, datos: JSON.parse(JSON_BUENO), deRespaldo: false });
  });

  it("con iteraciones normales (sin fallback_message) tampoco es de respaldo", async () => {
    create.mockResolvedValue(
      respuesta({
        content: [texto(JSON_BUENO)],
        usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: "message", input_tokens: 1, output_tokens: 1 }] },
      }),
    );
    expect(await pedirPartidasIa("Reforma de baño", [])).toMatchObject({ ok: true, deRespaldo: false });
  });

  it("el id canónico con fecha del modelo pedido no es de respaldo (si no, no se guardaría nunca nada)", async () => {
    create.mockResolvedValue(respuesta({ model: "claude-opus-5-5-20261001", content: [texto(JSON_BUENO)] }));
    expect(await pedirPartidasIa("Reforma de baño", [])).toMatchObject({ ok: true, deRespaldo: false });
  });

  it("con un fallback a mitad: vale el último bloque de texto y es de respaldo", async () => {
    create.mockResolvedValue(
      respuesta({
        model: "claude-opus-5",
        content: [{ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } }, texto(JSON_BUENO)],
      }),
    );
    expect(await pedirPartidasIa("Reforma de baño", [])).toEqual({ ok: true, datos: JSON.parse(JSON_BUENO), deRespaldo: true });
  });

  it.each([
    ["usage.iterations con fallback_message (respaldo desde el principio, sin bloque)", { usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: "fallback_message", model: "claude-opus-5", input_tokens: 1, output_tokens: 1 }] } }],
    ["otro model en la respuesta", { model: "claude-opus-5" }],
    ["un bloque fallback aunque model sea el principal", { content: [{ type: "fallback", from: { model: "a" }, to: { model: "b" } }, texto(JSON_BUENO)] }],
  ])("%s: es de respaldo", async (_, extra) => {
    create.mockResolvedValue(respuesta({ content: [texto(JSON_BUENO)], ...extra }));
    expect(await pedirPartidasIa("Reforma de baño", [])).toMatchObject({ ok: true, deRespaldo: true });
  });

  it("refusal: mensaje propio y el uso no se devuelve", async () => {
    create.mockResolvedValue(respuesta({ stop_reason: "refusal", content: [texto(JSON_BUENO)] }));
    expect(await pedirPartidasIa("Reforma de baño", [])).toEqual({ ok: false, error: MENSAJES_IA.rechazo, devolver: false });
    expect(MENSAJES_IA.rechazo).toBe("La IA no ha podido proponer partidas para esta descripción.");
  });

  it("max_tokens: descripción demasiado larga o compleja (aunque traiga texto)", async () => {
    create.mockResolvedValue(respuesta({ stop_reason: "max_tokens", content: [texto('{"partidas": [')] }));
    expect(await pedirPartidasIa("Reforma de baño", [])).toEqual({
      ok: false,
      error: MENSAJES_IA.demasiadoLarga,
      devolver: false,
    });
  });

  it.each([
    ["texto que no es JSON", [texto("Aquí tienes las partidas: …")]],
    ["JSON cortado", [texto('{"partidas": [{"descripcion": "x"')]],
    ["sin bloque de texto", []],
  ])("%s: respuesta ilegible, sin romper y sin devolver el uso", async (_, content) => {
    create.mockResolvedValue(respuesta({ content }));
    expect(await pedirPartidasIa("Reforma de baño", [])).toEqual({ ok: false, error: MENSAJES_IA.ilegible, devolver: false });
  });
});

describe("pedirPartidasIa · errores del SDK", () => {
  it.each([
    ["AuthenticationError (401)", () => new SDK.AuthenticationError(401, {}, "invalid x-api-key sk-ant-SECRETO", cabeceras()), MENSAJES_IA.clave, true],
    ["PermissionDeniedError (403)", () => new SDK.PermissionDeniedError(403, {}, "forbidden", cabeceras()), MENSAJES_IA.clave, true],
    ["RateLimitError (429)", () => new SDK.RateLimitError(429, {}, "rate_limit_error", cabeceras()), MENSAJES_IA.limite, true],
    ["InternalServerError (500)", () => new SDK.InternalServerError(500, {}, "api_error", cabeceras()), MENSAJES_IA.saturada, true],
    ["OverloadedError (529)", () => new SDK.OverloadedError(529, {}, "overloaded_error", cabeceras()), MENSAJES_IA.saturada, true],
    ["APIConnectionTimeoutError", () => new SDK.APIConnectionTimeoutError(), MENSAJES_IA.tiempo, false],
    ["APIConnectionError", () => new SDK.APIConnectionError({ message: "ECONNRESET" }), MENSAJES_IA.conexion, true],
    ["BadRequestError (400)", () => new SDK.BadRequestError(400, {}, "invalid_request_error: schema", cabeceras()), MENSAJES_IA.api, false],
    ["un error que no es del SDK", () => new TypeError("boom"), MENSAJES_IA.generico, false],
  ] as const)("%s → mensaje en español y si se devuelve el uso", async (_, crear, mensaje, devolver) => {
    create.mockRejectedValue(crear());
    const r = await pedirPartidasIa("Reforma de baño", []);
    expect(r).toEqual({ ok: false, error: mensaje, devolver });
    // Nunca el mensaje crudo de la API (ni nada que se parezca a la clave).
    expect(JSON.stringify(r)).not.toMatch(/sk-ant|x-api-key|invalid_request_error|ECONNRESET|boom/);
  });
});
