export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/** Devuelve la configuración pública de Supabase o null si falta alguna variable. */
export function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Igual que readSupabaseEnv, pero lanza un error legible si falta configuración. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = readSupabaseEnv();
  if (!env) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. Cópialas de .env.example a .env.local.",
    );
  }
  return env;
}
