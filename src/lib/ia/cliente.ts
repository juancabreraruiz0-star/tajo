// «Montar con IA» (D10): la llamada a Claude. SOLO SERVIDOR: lo importa únicamente la Server Action de
// src/lib/actions/ia.ts. La clave se lee de ANTHROPIC_API_KEY (nunca NEXT_PUBLIC_*) y no se registra en ningún sitio.

import Anthropic from "@anthropic-ai/sdk";
import type { MaterialAlmacen } from "@/lib/domain/sugerencias";
import { ESQUEMA_IA, INSTRUCCIONES_IA, MODELO_IA, mensajeIa } from "./prompt";

export type RespuestaIa =
  | { ok: true; datos: unknown }
  | {
      ok: false;
      error: string;
      /**
       * true si la IA no ha llegado a atender la petición (no ha generado nada ni se ha cobrado): la acción devuelve
       * el uso de la cuota. false si ha respondido (rechazo, respuesta cortada o ilegible) o si no se sabe (tiempo
       * agotado: la IA puede seguir generando y cobrarse; y una descripción que tarda mucho a propósito no debe
       * salir gratis).
       */
      devolver: boolean;
    };

/**
 * Las páginas que invocan la acción tienen maxDuration = 60 s: la llamada se corta antes, sin reintentos (un
 * reintento de una llamada de 30 s ya no cabría), para devolver un error legible en vez de que Vercel corte la
 * petición.
 */
const TIEMPO_MAXIMO_MS = 55_000;

let cliente: Anthropic | null = null;

/** Se crea al primer uso (no al importar): sin clave, new Anthropic() fallaría. */
function getCliente(): Anthropic {
  cliente ??= new Anthropic({ timeout: TIEMPO_MAXIMO_MS, maxRetries: 0 });
  return cliente;
}

export const MENSAJES_IA = {
  rechazo: "La IA no ha podido proponer partidas para esta descripción.",
  demasiadoLarga:
    "La descripción es demasiado larga o compleja para proponer las partidas de una vez. Prueba a dividirla (por ejemplo, el baño y la cocina por separado).",
  ilegible: "La IA ha devuelto una respuesta que no se puede leer. Inténtalo de nuevo.",
  clave: "La IA no está bien configurada en el servidor (clave de API no válida). Avisa a quien administre la aplicación.",
  limite: "La IA está recibiendo demasiadas peticiones. Inténtalo en un minuto.",
  saturada: "La IA no está disponible ahora mismo. Inténtalo en unos minutos.",
  tiempo: "La IA ha tardado demasiado en responder. Inténtalo de nuevo; si se repite, acorta la descripción.",
  conexion: "No se ha podido conectar con la IA. Inténtalo de nuevo en un momento.",
  api: "La IA no ha podido atender la petición. Inténtalo de nuevo.",
  generico: "No se ha podido obtener la propuesta de la IA. Inténtalo de nuevo.",
} as const;

/**
 * Error del SDK → mensaje en español y si se devuelve el uso. Nunca se muestra el mensaje crudo de la API.
 * De más concreto a más general (APIConnectionTimeoutError es un APIConnectionError, y todos son APIError).
 */
function errorDe(error: unknown): { error: string; devolver: boolean } {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { error: MENSAJES_IA.clave, devolver: true };
  }
  if (error instanceof Anthropic.RateLimitError) return { error: MENSAJES_IA.limite, devolver: true };
  if (error instanceof Anthropic.InternalServerError) return { error: MENSAJES_IA.saturada, devolver: true };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { error: MENSAJES_IA.tiempo, devolver: false };
  if (error instanceof Anthropic.APIConnectionError) return { error: MENSAJES_IA.conexion, devolver: true };
  if (error instanceof Anthropic.APIError) return { error: MENSAJES_IA.api, devolver: false };
  return { error: MENSAJES_IA.generico, devolver: false };
}

/**
 * Pide a Claude las partidas para la obra descrita. Devuelve el JSON parseado (sin validar: eso lo hace
 * validarSugerencia del dominio) o un error legible. Nunca lanza.
 */
export async function pedirPartidasIa(descripcion: string, materiales: readonly MaterialAlmacen[]): Promise<RespuestaIa> {
  let respuesta: Anthropic.Beta.BetaMessage;
  try {
    respuesta = await getCliente().beta.messages.create({
      model: MODELO_IA,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA_IA } },
      system: INSTRUCCIONES_IA,
      messages: [{ role: "user", content: mensajeIa(descripcion, materiales) }],
    });
  } catch (error) {
    return { ok: false, ...errorDe(error) };
  }

  // Antes de leer el contenido: un rechazo o un corte por longitud no traen un JSON completo. La IA ha respondido:
  // el uso no se devuelve.
  if (respuesta.stop_reason === "refusal") return { ok: false, error: MENSAJES_IA.rechazo, devolver: false };
  if (respuesta.stop_reason === "max_tokens") return { ok: false, error: MENSAJES_IA.demasiadoLarga, devolver: false };

  // La salida estructurada llega como texto JSON. Con un fallback puede haber bloques de otro tipo antes: vale el
  // último bloque de texto.
  const texto = respuesta.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").at(-1)?.text;
  if (!texto) return { ok: false, error: MENSAJES_IA.ilegible, devolver: false };
  try {
    return { ok: true, datos: JSON.parse(texto) as unknown };
  } catch {
    return { ok: false, error: MENSAJES_IA.ilegible, devolver: false };
  }
}
