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

const CUENTAS_DEMO = [
  { email: "gerencia@reformaslevante.es", rol: "Gerencia" },
  { email: "obra@reformaslevante.es", rol: "Encargado de obra" },
] as const;

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
            <Alert className="mb-4">
              Tu usuario no tiene un perfil de empresa asignado. Pide a gerencia que lo revise.
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

        <section
          aria-labelledby="demo-titulo"
          className="mt-5 rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-sm text-stone-600"
        >
          <h2 id="demo-titulo" className="font-medium text-stone-800">
            Acceso de demostración
          </h2>
          <ul className="mt-2 space-y-1.5">
            {CUENTAS_DEMO.map((cuenta) => (
              <li key={cuenta.email} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-mono text-xs break-all text-stone-800 select-all">{cuenta.email}</span>
                <span className="text-xs text-stone-500">{cuenta.rol}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">La contraseña se facilita junto al enlace de la prueba.</p>
        </section>
      </div>
    </main>
  );
}
