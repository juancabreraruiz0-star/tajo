"use server";

import { revalidatePath } from "next/cache";
import { dbErrorMessage } from "@/lib/domain/errors";
import { parseRespuestaAceptar } from "@/lib/domain/presupuestos";
import { isUuid } from "@/lib/domain/validation";
import { createAnonClient } from "@/lib/supabase/anon";

export interface AceptarState {
  /** Por qué no se ha podido aceptar (viene de aceptar_presupuesto o de un error de conexión). */
  motivo?: string;
  aceptadoAt?: string;
}

/** El cliente final acepta el presupuesto desde el enlace público, sin sesión (R11). */
export async function aceptarPresupuestoPublico(token: string): Promise<AceptarState> {
  if (!isUuid(token)) return { motivo: "Este presupuesto no existe o ya no está disponible." };

  const supabase = createAnonClient();
  if (!supabase) return { motivo: "Ahora mismo no podemos registrar la aceptación. Inténtalo más tarde." };

  const { data, error } = await supabase.rpc("aceptar_presupuesto", { p_token: token });
  if (error) return { motivo: dbErrorMessage(error) };

  const respuesta = parseRespuestaAceptar(data);
  revalidatePath(`/p/${token}`);
  return respuesta.ok ? { aceptadoAt: respuesta.aceptadoAt } : { motivo: respuesta.motivo };
}
