"use client";

import { usePathname } from "next/navigation";
import { AlertIcon } from "@/components/icons";
import { IlustracionPlano } from "@/components/ilustracion-plano";
import { Logo } from "@/components/logo";
import { Button, LinkButton } from "@/components/ui/button";

interface PantallaErrorProps {
  /** Identificador del error en los registros del servidor (lo pone Next); no revela nada del error. */
  digest?: string;
  /** Vuelve a intentar pintar la página. */
  reset: () => void;
}

/**
 * Pantalla de error no controlado (error.tsx y global-error.tsx), con el estilo de not-found.tsx. No enseña el mensaje
 * técnico del error: solo el digest, pequeño, para poder buscarlo en los registros.
 */
export function PantallaError({ digest, reset }: PantallaErrorProps) {
  // En la página pública del presupuesto la ve el cliente final: no tiene panel al que volver.
  const publica = usePathname()?.startsWith("/p/") ?? false;
  return (
    <main className="fondo-plano flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div aria-hidden="true" className="franja-obra fixed inset-x-0 top-0 h-1.5" />
      <div className="mb-8">
        <Logo />
      </div>
      <div
        role="alert"
        className="w-full max-w-md animate-entrada rounded-2xl bg-white px-6 py-12 text-center shadow-elevada"
      >
        <IlustracionPlano icon={<AlertIcon className="size-6" />} />
        <h1 className="text-lg font-semibold tracking-tight text-stone-950">Algo ha fallado</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-pretty text-stone-500">
          {publica
            ? "No se ha podido cargar el presupuesto. Vuelve a intentarlo en un momento; si sigue fallando, avisa a la empresa que te lo envió."
            : "No se ha podido cargar esta página. Vuelve a intentarlo; si sigue fallando, espera un momento o vuelve al panel."}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="primary" onClick={reset}>
            Reintentar
          </Button>
          {!publica && <LinkButton href="/">Volver al panel</LinkButton>}
        </div>
        {digest && <p className="mt-6 font-mono text-[0.6875rem] text-stone-400">Código: {digest}</p>}
      </div>
    </main>
  );
}
