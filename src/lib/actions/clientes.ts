"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { isUuid, validateCliente, type ClienteField } from "@/lib/domain/validation";
import { readFields, type FormState } from "./form-state";

export type ClienteFormState = FormState<ClienteField>;

const CAMPOS = ["nombre", "nif", "telefono", "email", "direccion", "notas"] as const;

/** Alta (id = null) o edición de un cliente. Si va bien, redirige a su ficha. */
export async function saveCliente(
  id: string | null,
  _prev: ClienteFormState,
  formData: FormData,
): Promise<ClienteFormState> {
  const values = readFields(formData, CAMPOS);
  if (id !== null && !isUuid(id)) return { error: "El cliente no existe.", values };

  const validation = validateCliente(values);
  if (!validation.ok) {
    return { error: "Revisa los campos marcados.", fieldErrors: validation.errors, values };
  }

  const { perfil, supabase } = await getSessionProfile();

  let clienteId: string;
  if (id === null) {
    const { data, error } = await supabase
      .from("clientes")
      .insert({ ...validation.data, empresa_id: perfil.empresa_id })
      .select("id")
      .single<{ id: string }>();
    if (error) return { error: dbErrorMessage(error), values };
    clienteId = data.id;
  } else {
    const { data, error } = await supabase
      .from("clientes")
      .update(validation.data)
      .eq("id", id)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) return { error: dbErrorMessage(error), values };
    if (!data) return { error: "El cliente no existe o no tienes acceso a él.", values };
    clienteId = data.id;
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  redirect(`/clientes/${clienteId}`);
}
