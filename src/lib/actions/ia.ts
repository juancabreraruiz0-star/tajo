"use server";

import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import type { PartidaRaw } from "@/lib/domain/presupuestos";
import { LIMITES_IA, validarDescripcionObra, validarSugerencia, type MaterialAlmacen } from "@/lib/domain/sugerencias";
import { pedirPartidasIa } from "@/lib/ia/cliente";
import { iaConfigurada } from "@/lib/ia/config";

export type SugerenciaIaState =
  | {
      /** Partidas listas para añadir al formulario (no se guarda nada). */
      partidas: PartidaRaw[];
      supuestos: string[];
      /** Partidas propuestas que no se han añadido por no ser válidas. */
      descartadas: number;
      /** Propuestas con IA que le quedan hoy a este usuario: el menor de lo que le queda de su cuota (15) y de la de
       * la empresa (40), como lo calcula consumir_uso_ia() de 0007. */
      quedan: number;
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
 * «Montar con IA» (D10): propone partidas para la obra descrita con los materiales del almacén de la empresa.
 * No guarda nada: devuelve las partidas para que el usuario las revise en el formulario.
 * Orden: sesión → descripción válida → cuota (consumir_uso_ia, 0005, ANTES de llamar a la IA) → materiales (RLS) →
 * Claude → validación de la respuesta en el dominio.
 * Si la IA no llega a atender la petición (clave mal, límite de peticiones, caída, sin conexión) o no se ha podido
 * leer el almacén, se devuelve el uso con devolver_uso_ia(reserva). La reserva no sale nunca de este servidor: el
 * usuario no puede devolver por su cuenta un uso que sí ha llegado a la IA (ver 0005).
 */
export async function sugerirPartidas(descripcion: unknown): Promise<SugerenciaIaState> {
  if (!iaConfigurada()) return { error: "La función de IA no está disponible en este servidor." };

  const { supabase } = await getSessionProfile();

  const texto = validarDescripcionObra(descripcion);
  if (!texto.ok) return { error: texto.error };

  const { data: datosCuota, error: errorCuota } = await supabase.rpc("consumir_uso_ia");
  if (errorCuota) return { error: dbErrorMessage(errorCuota) };
  const cuota = leerCuota(datosCuota);
  if (!cuota) return { error: "No se ha podido comprobar el límite diario de la IA. Inténtalo de nuevo." };

  const { reserva } = cuota;
  /** Devuelve el uso y luego el error. Si la devolución falla, se pierde ese uso y nada más: el error es el mismo. */
  async function devolverUso(error: string): Promise<SugerenciaIaState> {
    await supabase.rpc("devolver_uso_ia", { p_reserva: reserva });
    return { error };
  }

  const { data: materiales, error: errorMateriales } = await supabase
    .from("materiales")
    .select("id, nombre, unidad, precio_cents")
    .order("nombre")
    .limit(LIMITES_IA.materiales)
    .overrideTypes<MaterialAlmacen[], { merge: false }>();
  if (errorMateriales) return devolverUso(dbErrorMessage(errorMateriales));
  // precio_cents es bigint: puede llegar como texto.
  const almacen = (materiales ?? []).map((m) => ({ ...m, precio_cents: Number(m.precio_cents) }));

  const respuesta = await pedirPartidasIa(texto.valor, almacen);
  if (!respuesta.ok) return respuesta.devolver ? devolverUso(respuesta.error) : { error: respuesta.error };

  const sugerencia = validarSugerencia(respuesta.datos, almacen);
  if (!sugerencia.ok) return { error: sugerencia.error };

  return { ...sugerencia.data, quedan: cuota.quedan };
}
