import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

/**
 * Cliente de Supabase sin sesión (rol anon) para lo público: el presupuesto por enlace (/p/<token>).
 * No lee ni escribe cookies. Devuelve null si falta la configuración.
 */
export function createAnonClient() {
  const env = readSupabaseEnv();
  if (!env) return null;
  return createSupabaseClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
