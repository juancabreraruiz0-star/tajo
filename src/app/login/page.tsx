import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { PlanoReforma } from "@/components/plano-reforma";
import { Alert } from "@/components/ui/alert";
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
    <main className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Identidad: plano de una reforma y lo que hace Tajo (solo en pantallas anchas) */}
      <section
        aria-labelledby="login-valor"
        className="relative hidden overflow-hidden bg-slate-900 text-white lg:flex lg:flex-col"
      >
        <div aria-hidden="true" className="franja-obra h-1.5 shrink-0" />
        <div
          aria-hidden="true"
          className="fondo-plano pointer-events-none absolute inset-0 [--plano-linea:rgb(148_163_184/0.06)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -bottom-40 size-[32rem] rounded-full bg-amber-500/10 blur-3xl"
        />
        <div className="relative flex flex-1 flex-col justify-between gap-10 px-12 py-10 xl:px-16 xl:py-12">
          <Logo tone="dark" size="lg" />
          <PlanoReforma className="mx-auto max-w-md animate-entrada xl:max-w-lg" />
          <div className="max-w-lg">
            <p id="login-valor" className="text-3xl leading-tight font-semibold tracking-tight text-balance">
              Del presupuesto a la factura, sin papeles ni hojas de cálculo.
            </p>
            <p className="mt-3 text-base text-pretty text-slate-300">
              Clientes, presupuestos que tu cliente acepta desde el móvil, facturas y almacén en un solo sitio. También
              desde la obra.
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-slate-200">
              {["Aceptación con un enlace", "Factura en PDF al momento", "Aviso de stock bajo"].map((punto) => (
                <li key={punto} className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
                    <CheckIcon className="size-3.5" strokeWidth={2.5} />
                  </span>
                  {punto}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Formulario */}
      <section className="flex min-h-dvh flex-col">
        <div aria-hidden="true" className="franja-obra h-1.5 shrink-0 lg:hidden" />
        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
          <div className="w-full max-w-sm animate-entrada">
            <div className="mb-10 lg:hidden">
              <Logo size="lg" />
              <p className="mt-4 text-lg leading-snug font-semibold tracking-tight text-balance text-stone-800">
                Del presupuesto a la factura, sin papeles ni hojas de cálculo.
              </p>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-stone-950">Entra en tu cuenta</h1>
            <p className="mt-1.5 text-sm text-stone-500">Con el email y la contraseña que te ha dado gerencia.</p>

            {sinPerfil && (
              <Alert tone="warning" className="mt-6" title="Tu usuario no tiene acceso todavía">
                No está invitado a ninguna empresa. Pide a gerencia que te invite y vuelve a entrar.
              </Alert>
            )}

            <div className="mt-7">
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
            </div>

            <p className="mt-8 border-t border-stone-100 pt-5 text-xs text-pretty text-stone-500">
              El acceso es solo por invitación. Si no tienes usuario, pídeselo a gerencia.
            </p>
          </div>
        </div>
        <p className="px-5 pb-6 text-center text-xs text-stone-500 lg:text-left lg:px-8">
          Tajo · Gestión para empresas de reformas
        </p>
      </section>
    </main>
  );
}
