"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { CheckIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { aceptarPresupuestoPublico, type AceptarState } from "@/lib/actions/publico";
import { LIMITES_ACEPTACION, validateNombreAceptacion } from "@/lib/domain/aceptacion";
import { AvisoAceptado } from "./aviso-aceptado";

interface AceptarProps {
  token: string;
  /** Número y total para la confirmación: «P-2026-0008 por 1.234,56 €». */
  resumen: string;
  /** Nombre de la empresa, para el aviso de aceptado. */
  empresa: string;
}

/**
 * Aceptar el presupuesto desde el enlace público: el cliente escribe su nombre y apellidos (obligatorio) y confirma.
 * El nombre se valida aquí y otra vez en el servidor con la misma regla del dominio. Si la base de datos no deja
 * aceptar, se ve el motivo.
 */
export function Aceptar({ token, resumen, empresa }: AceptarProps) {
  const [state, formAction, pending] = useActionState<AceptarState, FormData>(
    aceptarPresupuestoPublico.bind(null, token),
    {},
  );
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const router = useRouter();
  const id = useId();
  const ids = { campo: `${id}-nombre`, error: `${id}-error`, nota: `${id}-nota` };

  // Aceptado: se vuelve a pintar la página desde el servidor para que la insignia y el aviso de arriba digan
  // «Aceptado» sin tener que recargar. Mientras llega, se ve la confirmación aquí mismo.
  useEffect(() => {
    if (state.aceptadoAt) router.refresh();
  }, [state.aceptadoAt, router]);

  if (state.aceptadoAt) return <AvisoAceptado aceptadoAt={state.aceptadoAt} empresa={empresa} />;

  const errorNombre = errorLocal ?? state.errorNombre ?? null;

  // Sin el reinicio automático del formulario de React 19: si algo falla, el nombre escrito se queda.
  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nombre = validateNombreAceptacion(formData.get("nombre"));
    if (!nombre.ok) {
      setErrorLocal(nombre.error);
      document.getElementById(ids.campo)?.focus();
      return;
    }
    setErrorLocal(null);
    if (!window.confirm(`¿Aceptar el presupuesto ${resumen} (IVA incluido) a nombre de ${nombre.nombre}?`)) return;
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-3">
      {state.motivo && <Alert>{state.motivo}</Alert>}
      <div className="space-y-1.5">
        <label htmlFor={ids.campo} className="block text-sm font-medium text-white">
          Tu nombre y apellidos
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id={ids.campo}
            name="nombre"
            type="text"
            autoComplete="name"
            required
            maxLength={LIMITES_ACEPTACION.nombre}
            aria-invalid={errorNombre ? true : undefined}
            aria-describedby={errorNombre ? `${ids.error} ${ids.nota}` : ids.nota}
            onChange={() => {
              if (errorLocal) setErrorLocal(null);
            }}
            placeholder="Como figura en tu DNI"
            className={[
              "h-14 w-full min-w-0 rounded-xl border bg-white px-4 text-base text-stone-950 shadow-tarjeta sm:flex-1",
              "placeholder:text-stone-400 focus:ring-4 focus:outline-none",
              errorNombre
                ? "border-red-400 focus:border-red-400 focus:ring-red-400/40"
                : "border-white/20 focus:border-amber-400 focus:ring-amber-400/40",
            ].join(" ")}
          />
          <button
            type="submit"
            disabled={pending}
            aria-disabled={pending}
            className="inline-flex h-14 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl bg-amber-400 px-8 text-base font-semibold text-stone-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_8px_20px_-6px_rgb(245_158_11/0.55)] transition-[background-color,box-shadow,transform] duration-150 select-none hover:bg-amber-300 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:pointer-events-none disabled:opacity-70 sm:w-auto"
          >
            <CheckIcon className="size-5" strokeWidth={2.5} />
            {pending ? "Aceptando…" : "Aceptar presupuesto"}
          </button>
        </div>
        {errorNombre && (
          <p id={ids.error} role="alert" className="text-sm font-medium text-red-300">
            {errorNombre}
          </p>
        )}
      </div>
      <p id={ids.nota} className="max-w-xl text-xs text-pretty text-slate-400">
        Al pulsar «Aceptar presupuesto» aceptas este presupuesto con tu nombre, como si lo firmaras. Como constancia
        guardamos tu nombre, la fecha y hora, tu dirección IP y el navegador desde el que lo aceptas.
      </p>
    </form>
  );
}
