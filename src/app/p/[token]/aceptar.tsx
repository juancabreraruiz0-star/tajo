"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { aceptarPresupuestoPublico, type AceptarState } from "@/lib/actions/publico";
import { AvisoAceptado } from "./aviso-aceptado";

interface AceptarProps {
  token: string;
  /** Texto de la confirmación, p. ej. «¿Aceptar el presupuesto P-2026-0008 por 1.234,56 €?». */
  confirmacion: string;
}

/** Botón «Aceptar presupuesto» del enlace público. Si la base de datos no lo permite, muestra el motivo. */
export function Aceptar({ token, confirmacion }: AceptarProps) {
  const [state, formAction] = useActionState<AceptarState>(aceptarPresupuestoPublico.bind(null, token), {});

  if (state.aceptadoAt) return <AvisoAceptado aceptadoAt={state.aceptadoAt} />;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmacion)) event.preventDefault();
      }}
      className="space-y-3"
    >
      {state.motivo && <Alert>{state.motivo}</Alert>}
      <SubmitButton pendingText="Aceptando…" className="h-14 w-full px-8 text-base sm:w-auto">
        Aceptar presupuesto
      </SubmitButton>
    </form>
  );
}
