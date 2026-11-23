"use client";

import { useActionState } from "react";
import { deleteMaterial, type DeleteState } from "@/lib/actions/materiales";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export function DeleteMaterial({ id, nombre }: { id: string; nombre: string }) {
  const [state, formAction] = useActionState<DeleteState>(deleteMaterial.bind(null, id), {});

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`¿Borrar «${nombre}» del almacén? No se puede deshacer.`)) event.preventDefault();
      }}
      className="space-y-3"
    >
      {state.error && <Alert>{state.error}</Alert>}
      <SubmitButton variant="danger" pendingText="Borrando…">
        Borrar material
      </SubmitButton>
    </form>
  );
}
