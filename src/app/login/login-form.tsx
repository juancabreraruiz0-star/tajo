"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/lib/actions/auth";
import { ArrowRightIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="nombre@empresa.es"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Input
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <SubmitButton pendingText="Entrando…" className="w-full">
        Entrar
        <ArrowRightIcon className="size-4" />
      </SubmitButton>
    </form>
  );
}
