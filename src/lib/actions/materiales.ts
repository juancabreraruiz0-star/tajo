"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { isUuid, materialChanges, validateMaterial, type MaterialField } from "@/lib/domain/validation";
import type { Material } from "@/lib/types";
import { readFields, type FormState } from "./form-state";

export type MaterialFormState = FormState<MaterialField>;
export type DeleteState = { error?: string };

const CAMPOS = ["nombre", "unidad", "precio", "coste", "stock", "stock_minimo"] as const;

/** Alta (id = null) o edición de un material. Si va bien, vuelve al listado. */
export async function saveMaterial(
  id: string | null,
  _prev: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  const values = readFields(formData, CAMPOS);
  if (id !== null && !isUuid(id)) return { error: "El material no existe.", values };

  const { perfil, supabase } = await getSessionProfile();
  // El coste (M2) solo lo pone o cambia gerencia; la base de datos también lo impone (trigger de 0006). Para un
  // empleado no se lee del formulario ni se envía: al crear queda vacío y al editar no se toca.
  const conCoste = isAdmin(perfil);

  // Al editar se lee el stock actual: si está en negativo, el formulario puede devolverlo tal cual (sin tocarlo).
  let stockActual: number | undefined;
  if (id !== null) {
    const { data: actual, error } = await supabase
      .from("materiales")
      .select("stock")
      .eq("id", id)
      .maybeSingle<Pick<Material, "stock">>();
    if (error) return { error: dbErrorMessage(error), values };
    if (!actual) return { error: "El material no existe o no tienes acceso a él.", values };
    stockActual = Number(actual.stock);
  }

  const validation = validateMaterial(values, { stockActual, conCoste });
  if (!validation.ok) {
    return { error: "Revisa los campos marcados.", fieldErrors: validation.errors, values };
  }

  if (id === null) {
    const { error } = await supabase
      .from("materiales")
      .insert({ ...validation.data, empresa_id: perfil.empresa_id });
    if (error) return { error: dbErrorMessage(error), values };
  } else {
    const { data, error } = await supabase
      .from("materiales")
      .update(materialChanges(validation.data))
      .eq("id", id)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) return { error: dbErrorMessage(error), values };
    if (!data) return { error: "El material no existe o no tienes acceso a él.", values };
  }

  revalidatePath("/materiales");
  // El panel de inicio muestra los materiales bajo mínimo (R16).
  revalidatePath("/");
  redirect("/materiales");
}

/** Borra un material. Solo admin: se comprueba aquí y, sobre todo, en la RLS (materiales_delete). */
export async function deleteMaterial(id: string): Promise<DeleteState> {
  if (!isUuid(id)) return { error: "El material no existe." };

  const { perfil, supabase } = await getSessionProfile();
  if (!isAdmin(perfil)) return { error: "Solo gerencia puede borrar materiales." };

  // Con RLS, un borrado no permitido no da error: simplemente no borra nada. Por eso se pide la fila borrada.
  const { data, error } = await supabase
    .from("materiales")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: dbErrorMessage(error) };
  if (!data || data.length === 0) {
    return { error: "No se ha podido borrar: el material no existe o no tienes permiso." };
  }

  revalidatePath("/materiales");
  // El panel de inicio muestra los materiales bajo mínimo (R16).
  revalidatePath("/");
  redirect("/materiales");
}
