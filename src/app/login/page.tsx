import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const sinPerfil = error === "perfil";
  const configurado = readSupabaseEnv() !== null;

  // Con sesión abierta no tiene sentido volver a entrar (salvo que vengamos de un error de perfil).
  if (configurado && !sinPerfil) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/");
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/* Fondo: franja de obra muy suave */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(135deg,#f59e0b_0_14px,#1c1917_14px_28px)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-amber-200/40 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 text-sm text-stone-600">Gestión para empresas de reformas</p>
        </div>

        <Card className="p-6 sm:p-7">
          <h1 className="mb-5 text-lg font-semibold text-stone-900">Entra en tu cuenta</h1>

          {sinPerfil && (
            <Alert className="mb-4" title="Sin acceso">
              Tu usuario no tiene acceso a ninguna empresa. Pide una invitación a gerencia.
            </Alert>
          )}

          {configurado ? (
            <LoginForm />
          ) : (
            <Alert tone="warning" title="Falta configurar la conexión">
              <p>
                La aplicación no tiene las variables de Supabase. Añade{" "}
                <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
                <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> en{" "}
                <code className="font-mono text-xs">.env.local</code> (o en Vercel) y vuelve a arrancar.
              </p>
            </Alert>
          )}
        </Card>
      </div>
    </main>
  );
}
