import type { SupabaseServerClient } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import type { ClienteOpcion, MaterialOpcion } from "./presupuesto-form";

export type OpcionesFormulario =
  | { ok: true; clientes: ClienteOpcion[]; materiales: MaterialOpcion[] }
  | { ok: false; error: string };

/** Clientes y materiales de la empresa para los desplegables del formulario de presupuesto. */
export async function loadOpcionesFormulario(supabase: SupabaseServerClient): Promise<OpcionesFormulario> {
  const [clientes, materiales] = await Promise.all([
    supabase.from("clientes").select("id, nombre").order("nombre").overrideTypes<ClienteOpcion[], { merge: false }>(),
    supabase
      .from("materiales")
      .select("id, nombre, unidad, precio_cents")
      .order("nombre")
      .overrideTypes<MaterialOpcion[], { merge: false }>(),
  ]);
  if (clientes.error) return { ok: false, error: dbErrorMessage(clientes.error) };
  if (materiales.error) return { ok: false, error: dbErrorMessage(materiales.error) };
  return { ok: true, clientes: clientes.data ?? [], materiales: materiales.data ?? [] };
}
