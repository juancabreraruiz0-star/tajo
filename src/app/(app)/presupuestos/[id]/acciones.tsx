"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { controlClasses, controlState } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  cambiarEstado,
  facturarPresupuesto,
  regenerarEnlace,
  type AccionState,
  type RegenerarEnlaceState,
} from "@/lib/actions/presupuestos";
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
      {state.error && (
        <Alert className="basis-full">
          <p>{state.error}</p>
          {state.enlace && (
            <Link href={state.enlace.href} className="mt-2 inline-block font-semibold underline hover:no-underline">
              {state.enlace.label}
            </Link>
          )}
        </Alert>
      )}
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

/** Origen de la app: en el navegador el suyo; en el servidor, el de la petición. */
function useOrigin(serverOrigin: string | null): string {
  return useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => serverOrigin ?? "",
  );
}

interface EnlacePublicoProps {
  token: string;
  serverOrigin: string | null;
  /** Etiqueta del campo (cambia si es un enlace recién generado). */
  label?: string;
}

/**
 * Enlace público para el cliente: se ve entero (en varias líneas si hace falta, también en móvil) y se copia con
 * un botón.
 */
export function EnlacePublico({ token, serverOrigin, label = "Enlace para el cliente" }: EnlacePublicoProps) {
  const id = useId();
  const url = publicBudgetUrl(useOrigin(serverOrigin), token);
  const campoRef = useRef<HTMLTextAreaElement>(null);
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
      campoRef.current?.select();
      setCopia(document.execCommand("copy") ? "copiado" : "error");
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      {/* Solo lectura y en varias líneas: el enlace se lee entero aunque la columna sea estrecha. */}
      <textarea
        ref={campoRef}
        id={id}
        readOnly
        rows={3}
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-describedby={`${id}-estado`}
        className={`${controlClasses} ${controlState()} resize-none py-2 font-mono text-xs leading-5 break-all`}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={copiar} className="flex-1 sm:flex-none">
          Copiar enlace
        </Button>
        <a
          href={`/p/${encodeURIComponent(token)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses("secondary", "md", "flex-1 sm:flex-none")}
        >
          Abrir vista del cliente
          <span className="sr-only"> (se abre en una pestaña nueva)</span>
        </a>
      </div>
      <p id={`${id}-estado`} role="status" className="min-h-5 text-sm">
        {copia === "copiado" && <span className="font-medium text-green-700">¡Enlace copiado!</span>}
        {copia === "error" && (
          <span className="text-red-700">No se ha podido copiar. Selecciona el enlace y cópialo a mano.</span>
        )}
      </p>
    </div>
  );
}

interface RegenerarEnlaceProps {
  id: string;
  serverOrigin: string | null;
  /** Si el enlace ya se muestra en la página (presupuesto enviado), aquí solo se confirma el cambio. */
  enlaceVisible: boolean;
}

const CONFIRMAR_REGENERAR =
  "¿Generar un enlace nuevo? El enlace anterior dejará de funcionar: quien lo tenga ya no podrá ver ni aceptar " +
  "el presupuesto. Tendrás que mandarle el nuevo al cliente.";

/** Gerencia: genera un enlace público nuevo; el anterior deja de funcionar. */
export function RegenerarEnlace({ id, serverOrigin, enlaceVisible }: RegenerarEnlaceProps) {
  const [state, formAction] = useActionState<RegenerarEnlaceState>(regenerarEnlace.bind(null, id), {});
  return (
    <div className="space-y-3">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm(CONFIRMAR_REGENERAR)) event.preventDefault();
        }}
      >
        <SubmitButton variant="secondary" pendingText="Generando…">
          Generar enlace nuevo
        </SubmitButton>
      </form>
      {state.error && <Alert>{state.error}</Alert>}
      {state.token &&
        (enlaceVisible ? (
          <Alert tone="info">Enlace nuevo generado: es el que ves arriba. El anterior ya no funciona.</Alert>
        ) : (
          <>
            <Alert tone="info">Enlace nuevo generado. El anterior ya no funciona.</Alert>
            <EnlacePublico token={state.token} serverOrigin={serverOrigin} label="Enlace nuevo para el cliente" />
          </>
        ))}
    </div>
  );
}
