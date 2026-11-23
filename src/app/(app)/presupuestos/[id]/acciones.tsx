"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { controlClasses, controlState } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { cambiarEstado, facturarPresupuesto, type AccionState } from "@/lib/actions/presupuestos";
import { publicBudgetUrl } from "@/lib/domain/presupuestos";

interface AccionFormProps {
  action: () => Promise<AccionState>;
  label: string;
  pendingText: string;
  variant?: ButtonVariant;
  /** Si se indica, se pide confirmación antes de enviar. */
  confirmacion?: string;
}

/** Botón que lanza una Server Action y muestra su error (p. ej. el de un trigger) en un Alert. */
function AccionForm({ action, label, pendingText, variant = "secondary", confirmacion }: AccionFormProps) {
  const [state, formAction] = useActionState<AccionState>(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmacion && !window.confirm(confirmacion)) event.preventDefault();
      }}
      className="contents"
    >
      <SubmitButton variant={variant} pendingText={pendingText}>
        {label}
      </SubmitButton>
      {state.error && <Alert className="basis-full">{state.error}</Alert>}
    </form>
  );
}

type Destino = "enviado" | "aceptado" | "rechazado";

interface CambiarEstadoProps {
  id: string;
  destino: Destino;
  label: string;
  pendingText: string;
  variant?: ButtonVariant;
  confirmacion?: string;
}

export function CambiarEstado({ id, destino, ...props }: CambiarEstadoProps) {
  return <AccionForm action={cambiarEstado.bind(null, id, destino)} {...props} />;
}

export function Facturar({ id }: { id: string }) {
  return (
    <AccionForm
      action={facturarPresupuesto.bind(null, id)}
      variant="primary"
      label="Convertir en factura"
      pendingText="Facturando…"
      confirmacion="¿Convertir este presupuesto en factura? Se numerará la factura y se descontará del almacén el material de las partidas."
    />
  );
}

const noSubscribe = () => () => {};

/** Enlace público para el cliente: se ve en un campo de solo lectura y se copia con un botón. */
export function EnlacePublico({ token, serverOrigin }: { token: string; serverOrigin: string | null }) {
  // En el navegador manda su propio origen; en el servidor, el de la petición.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => serverOrigin ?? "",
  );
  const url = publicBudgetUrl(origin, token);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copia, setCopia] = useState<"copiado" | "error" | null>(null);

  useEffect(() => {
    if (copia !== "copiado") return;
    const timer = window.setTimeout(() => setCopia(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copia]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopia("copiado");
    } catch {
      // Sin API del portapapeles (p. ej. http en la red local): se selecciona el texto y se prueba a la antigua.
      inputRef.current?.select();
      setCopia(document.execCommand("copy") ? "copiado" : "error");
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor="enlace-publico" className="block text-sm font-medium text-stone-800">
        Enlace para el cliente
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id="enlace-publico"
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-describedby="enlace-publico-estado"
          className={`${controlClasses} ${controlState()} h-11 min-w-0 flex-1 font-mono text-sm`}
        />
        <Button variant="primary" onClick={copiar}>
          Copiar enlace para el cliente
        </Button>
      </div>
      <p id="enlace-publico-estado" role="status" className="min-h-5 text-sm">
        {copia === "copiado" && <span className="font-medium text-green-700">¡Enlace copiado!</span>}
        {copia === "error" && (
          <span className="text-red-700">No se ha podido copiar. Selecciona el enlace y cópialo a mano.</span>
        )}
      </p>
      <a
        href={`/p/${encodeURIComponent(token)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses("secondary", "md")}
      >
        Abrir vista del cliente
        <span className="sr-only"> (se abre en una pestaña nueva)</span>
      </a>
    </div>
  );
}
