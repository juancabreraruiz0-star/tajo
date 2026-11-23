"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authErrorMessage } from "@/lib/domain/errors";
import { validateLogin, type LoginField } from "@/lib/domain/validation";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readFields, type FormState } from "./form-state";

export type LoginState = FormState<LoginField>;

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = readFields(formData, ["email", "password"] as const);
  const values = { email: raw.email };

  if (!readSupabaseEnv()) {
    return { error: "La aplicación no está conectada a Supabase todavía. Revisa la configuración.", values };
  }

  const validation = validateLogin(raw);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(validation.data);
  if (error) return { error: authErrorMessage(error), values };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (readSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
