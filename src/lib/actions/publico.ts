"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { evidenciaPeticion, validateNombreAceptacion } from "@/lib/domain/aceptacion";
import { dbErrorMessage } from "@/lib/domain/errors";
import { parseRespuestaAceptar } from "@/lib/domain/presupuestos";
import { isUuid } from "@/lib/domain/validation";
import { createAnonClient } from "@/lib/supabase/anon";

export interface AceptarState {
  /** Por qué no se ha podido aceptar (viene de aceptar_presupuesto o de un error de conexión). */
  motivo?: string;
  /** Error del campo «Tu nombre y apellidos». */
  errorNombre?: string;
  aceptadoAt?: string;
}

/**
 * El cliente final acepta el presupuesto desde el enlace público, sin sesión (R11). El enlace es al portador: quien lo
 * tenga puede aceptar. Por eso se guarda constancia (D12): el nombre que escribe, y la IP y el navegador de la
 * petición, que salen de las cabeceras que pone el proxy (Vercel). Siempre con el cliente anónimo.
 */
export async function aceptarPresupuestoPublico(
  token: string,
  _prev: AceptarState,
  formData: FormData,
): Promise<AceptarState> {
  if (!isUuid(token)) return { motivo: "Este presupuesto no existe o ya no está disponible." };

  const nombre = validateNombreAceptacion(formData.get("nombre"));
  if (!nombre.ok) return { errorNombre: nombre.error };

  const supabase = createAnonClient();
  if (!supabase) return { motivo: "Ahora mismo no podemos registrar la aceptación. Inténtalo más tarde." };

  const { ip, userAgent } = evidenciaPeticion(await headers());
  const { data, error } = await supabase.rpc("aceptar_presupuesto", {
    p_token: token,
    p_nombre: nombre.nombre,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) return { motivo: dbErrorMessage(error) };

  const respuesta = parseRespuestaAceptar(data);
  revalidatePath(`/p/${token}`);
  if (respuesta.ok) return { aceptadoAt: respuesta.aceptadoAt };
  return respuesta.campo === "nombre" ? { errorNombre: respuesta.motivo } : { motivo: respuesta.motivo };
}
