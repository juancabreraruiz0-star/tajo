"use server";

import { getSessionProfile, type SupabaseServerClient } from "@/lib/auth";
import { claveCacheIa, propuestaParaGuardar } from "@/lib/domain/cache-ia";
import { dbErrorMessage } from "@/lib/domain/errors";
import type { PartidaRaw } from "@/lib/domain/presupuestos";
import {
  LIMITES_IA,
  validarDescripcionObra,
  validarSugerencia,
  type MaterialAlmacen,
  type SugerenciaValida,
} from "@/lib/domain/sugerencias";
import { pedirPartidasIa } from "@/lib/ia/cliente";
import { iaConfigurada } from "@/lib/ia/config";
import { VERSION_PETICION_IA } from "@/lib/ia/prompt";

export type SugerenciaIaState =
  | {
      /** Partidas listas para meter en el formulario (no se guarda nada del presupuesto). */
      partidas: PartidaRaw[];
      supuestos: string[];
      /** Partidas propuestas que no se han añadido por no ser válidas. */
      descartadas: number;
      /**
       * true si la descripción (normalizada) y el almacén son los de una propuesta anterior de la empresa: se devuelve
       * esa misma propuesta, sin llamar a la IA ni gastar cuota (D14).
       */
      repetida: boolean;
      /** Propuestas con IA que le quedan hoy a este usuario: el menor de lo que le queda de su cuota (15) y de la de
       * la empresa (40), como lo calcula consumir_uso_ia() de 0007. null si no se ha gastado ninguna (repetida). */
      quedan: number | null;
      error?: undefined;
    }
  | { error: string };

/** Fila de consumir_uso_ia() (0005): usos que quedan hoy y la reserva para poder devolver este uso. */
function leerCuota(data: unknown): { quedan: number; reserva: string } | null {
  const fila: unknown = Array.isArray(data) ? data[0] : data;
  if (typeof fila !== "object" || fila === null) return null;
  const { quedan, reserva } = fila as Record<string, unknown>;
  return typeof quedan === "number" && typeof reserva === "string" ? { quedan, reserva } : null;
}

/**
 * Propuesta guardada con esta clave (0009, RLS: solo las de la empresa del usuario). undefined si no hay; si no se
 * puede leer, también (se pide a la IA como si no la hubiera).
 */
async function leerGuardada(supabase: SupabaseServerClient, empresaId: string, clave: string): Promise<unknown> {
  const { data, error } = await supabase
    .from("ia_propuestas")
    .select("respuesta")
    .eq("empresa_id", empresaId)
    .eq("clave", clave)
    .maybeSingle<{ respuesta: unknown }>();
  return error || !data ? undefined : data.respuesta;
}

/**
 * «Montar con IA» (D10, D14): propone partidas para la obra descrita con los materiales del almacén de la empresa.
 * No guarda nada del presupuesto: devuelve las partidas para que el usuario las revise en el formulario.
 *
 * Misma descripción, mismo presupuesto (D14): con la empresa, la descripción normalizada, el almacén que se le pasa a
 * la IA y la versión de la petición se calcula una clave (src/lib/domain/cache-ia.ts). Si ya hay una propuesta
 * guardada con esa clave y sigue pasando validarSugerencia contra el almacén actual, se devuelve tal cual: sin llamar a
 * la IA y sin gastar cuota. Si no, se pide a la IA y la propuesta ya validada se guarda con guardar_propuesta_ia()
 * (0009), que gasta la reserva de este uso.
 *
 * Orden: sesión → descripción válida → materiales (RLS) → propuesta guardada → cuota (consumir_uso_ia, ANTES de llamar
 * a la IA) → Claude → validación de la respuesta en el dominio → guardar.
 * Si la IA no llega a atender la petición (clave mal, límite de peticiones, caída, sin conexión), se devuelve el uso con
 * devolver_uso_ia(reserva). La reserva no sale nunca de este servidor: el usuario no puede devolver por su cuenta un uso
 * que sí ha llegado a la IA (ver 0005).
 */
export async function sugerirPartidas(descripcion: unknown): Promise<SugerenciaIaState> {
  if (!iaConfigurada()) return { error: "La función de IA no está disponible en este servidor." };

  const { supabase, perfil } = await getSessionProfile();

  const texto = validarDescripcionObra(descripcion);
  if (!texto.ok) return { error: texto.error };

  // Orden fijo (nombre y, a igual nombre, id): los mismos 200 materiales cada vez.
  const { data: materiales, error: errorMateriales } = await supabase
    .from("materiales")
    .select("id, nombre, unidad, precio_cents")
    .order("nombre")
    .order("id")
    .limit(LIMITES_IA.materiales)
    .overrideTypes<MaterialAlmacen[], { merge: false }>();
  if (errorMateriales) return { error: dbErrorMessage(errorMateriales) };
  // precio_cents es bigint: puede llegar como texto.
  const almacen = (materiales ?? []).map((m) => ({ ...m, precio_cents: Number(m.precio_cents) }));

  const clave = await claveCacheIa({
    empresaId: perfil.empresa_id,
    descripcion: texto.valor,
    materiales: almacen,
    version: VERSION_PETICION_IA,
  });
  const guardada = await leerGuardada(supabase, perfil.empresa_id, clave);
  if (guardada !== undefined) {
    const anterior = validarSugerencia(guardada, almacen);
    if (anterior.ok) return { ...anterior.data, repetida: true, quedan: null };
  }

  const { data: datosCuota, error: errorCuota } = await supabase.rpc("consumir_uso_ia");
  if (errorCuota) return { error: dbErrorMessage(errorCuota) };
  const cuota = leerCuota(datosCuota);
  if (!cuota) return { error: "No se ha podido comprobar el límite diario de la IA. Inténtalo de nuevo." };

  const respuesta = await pedirPartidasIa(texto.valor, almacen);
  if (!respuesta.ok) {
    // Devuelve el uso y luego el error. Si la devolución falla, se pierde ese uso y nada más: el error es el mismo.
    if (respuesta.devolver) await supabase.rpc("devolver_uso_ia", { p_reserva: cuota.reserva });
    return { error: respuesta.error };
  }

  const sugerencia = validarSugerencia(respuesta.datos, almacen);
  if (!sugerencia.ok) return { error: sugerencia.error };

  const final = await guardar(supabase, cuota.reserva, clave, sugerencia.data, almacen, guardada !== undefined);
  return { ...final, repetida: false, quedan: cuota.quedan };
}

/**
 * Guarda la propuesta validada para esta clave y devuelve la que queda guardada, ya validada: la nuestra o, si otra
 * petición con la misma descripción ha guardado antes la suya, esa (así las dos ven lo mismo). `sustituir` solo cuando
 * la guardada ya no pasaba la validación. Si no se puede guardar, se devuelve la nuestra: el usuario tiene su
 * propuesta, y la siguiente vez se volverá a pedir.
 */
async function guardar(
  supabase: SupabaseServerClient,
  reserva: string,
  clave: string,
  sugerencia: SugerenciaValida,
  almacen: readonly MaterialAlmacen[],
  sustituir: boolean,
): Promise<SugerenciaValida> {
  const { data, error } = await supabase.rpc("guardar_propuesta_ia", {
    p_reserva: reserva,
    p_clave: clave,
    p_respuesta: propuestaParaGuardar(sugerencia, almacen),
    p_sustituir: sustituir,
  });
  if (error) return sugerencia;
  const queda = validarSugerencia(data, almacen);
  return queda.ok ? { ...queda.data, descartadas: sugerencia.descartadas } : sugerencia;
}
