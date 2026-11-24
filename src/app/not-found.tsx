import type { Metadata } from "next";
import { IlustracionPlano } from "@/components/ilustracion-plano";
import { HelmetIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main className="fondo-plano flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div aria-hidden="true" className="franja-obra fixed inset-x-0 top-0 h-1.5" />
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-md animate-entrada rounded-2xl bg-white px-6 py-12 text-center shadow-elevada">
        <IlustracionPlano icon={<HelmetIcon className="size-6" />} />
        <h1 className="text-lg font-semibold tracking-tight text-stone-950">No encontramos esta página</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-pretty text-stone-500">
          Puede que el enlace esté mal escrito o que el registro se haya borrado.
        </p>
        <LinkButton href="/" variant="primary" className="mt-6">
          Volver al panel
        </LinkButton>
      </div>
    </main>
  );
}
