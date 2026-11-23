"use client";

import { useActionState } from "react";
import { saveCliente, type ClienteFormState } from "@/lib/actions/clientes";
import { LIMITES_CLIENTE, type ClienteField } from "@/lib/domain/validation";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";

interface ClienteFormProps {
  /** null = alta. */
  id: string | null;
  initial?: Partial<Record<ClienteField, string>>;
  cancelHref: string;
}

export function ClienteForm({ id, initial = {}, cancelHref }: ClienteFormProps) {
  const [state, formAction] = useActionState<ClienteFormState, FormData>(saveCliente.bind(null, id), {});
  const value = (campo: ClienteField) => state.values?.[campo] ?? initial[campo] ?? "";
  const error = (campo: ClienteField) => state.fieldErrors?.[campo];

  return (
    <Card className="p-4 sm:p-6">
      <form action={formAction} className="space-y-5" noValidate>
        {state.error && <Alert>{state.error}</Alert>}

        <Input
          label="Nombre"
          name="nombre"
          required
          autoComplete="off"
          maxLength={LIMITES_CLIENTE.nombre}
          placeholder="Nombre y apellidos o empresa"
          defaultValue={value("nombre")}
          error={error("nombre")}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Teléfono"
            name="telefono"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={LIMITES_CLIENTE.telefono}
            placeholder="612 345 678"
            defaultValue={value("telefono")}
            error={error("telefono")}
          />
          <Input
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="cliente@correo.es"
            defaultValue={value("email")}
            error={error("email")}
          />
        </div>

        <Input
          label="Dirección"
          name="direccion"
          autoComplete="off"
          maxLength={LIMITES_CLIENTE.direccion}
          placeholder="Calle, número, piso, CP y población"
          defaultValue={value("direccion")}
          error={error("direccion")}
        />

        <Textarea
          label="Notas"
          name="notas"
          maxLength={LIMITES_CLIENTE.notas}
          hint="Horarios, acceso a la obra, cómo prefiere que le contacten…"
          defaultValue={value("notas")}
          error={error("notas")}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
          <LinkButton href={cancelHref}>Cancelar</LinkButton>
          <SubmitButton pendingText="Guardando…">{id ? "Guardar cambios" : "Crear cliente"}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
