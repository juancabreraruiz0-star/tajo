import type { User } from "@supabase/supabase-js";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { readSupabaseEnv } from "@/lib/supabase/env";
import type { Perfil } from "@/lib/types";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface SessionProfile {
  user: User;
  perfil: Perfil;
  /** Cliente de Supabase de esta petición, ya con la sesión del usuario. */
  supabase: SupabaseServerClient;
}

/**
 * Usuario con sesión y su perfil (empresa y rol). Si no hay sesión, redirige a /login.
 * Se cachea por petición: layout, página y acciones comparten una sola consulta.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile> => {
  // Siempre en tiempo de petición: depende de las cookies y de la configuración.
  await connection();
  if (!readSupabaseEnv()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, empresa_id, nombre, email, rol")
    .eq("id", user.id)
    .maybeSingle<Perfil>();
  if (!perfil) redirect("/login?error=perfil");

  return { user, perfil, supabase };
});

export function isAdmin(perfil: Perfil): boolean {
  return perfil.rol === "admin";
}

/** Como getSessionProfile, pero solo para admin: al resto lo manda al panel. */
export async function requireAdmin(): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!isAdmin(session.perfil)) redirect("/");
  return session;
}
