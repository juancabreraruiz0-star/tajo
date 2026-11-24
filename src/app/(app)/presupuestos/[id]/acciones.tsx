"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CheckIcon, SendIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  cambiarEstado,
  facturarPresupuesto,
  regenerarEnlace,
  type AccionState,
  type RegenerarEnlaceState,
} from "@/lib/actions/presupuestos";
import { publicBudgetUrl } from "@/lib/domain/presupuestos";
import { enlaceWhatsApp, mensajeWhatsApp, normalizarTelefono } from "@/lib/domain/whatsapp";

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

// Clases propias (no controlClasses): esas traen «text-base sm:text-sm» y, como cn() no fusiona clases de Tailwind,
// añadir «text-xs» encima no garantizaba el tamaño. Aquí el enlace va siempre en monoespaciada pequeña.
const ENLACE_CLASES = [
  "block w-full resize-none rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5",
  "font-mono text-xs leading-5 break-all text-stone-800 shadow-tarjeta",
  "transition-[border-color,box-shadow] duration-150 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 focus:outline-none",
].join(" ");

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
  /** Si se indica, se ofrece «Enviar por WhatsApp» con el mensaje para este cliente (presupuesto enviado). */
  whatsapp?: { cliente: string | null; telefono: string | null; titulo: string; empresa: string | null };
}

/**
 * Enlace público para el cliente: se ve entero (en varias líneas si hace falta, también en móvil) y se copia con
 * un botón.
 */
export function EnlacePublico({ token, serverOrigin, label = "Enlace para el cliente", whatsapp }: EnlacePublicoProps) {
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
        className={ENLACE_CLASES}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={copiar} className="flex-1 sm:flex-none">
          Copiar enlace
        </Button>
        {whatsapp && (
          <a
            href={enlaceWhatsApp(whatsapp.telefono, mensajeWhatsApp({ ...whatsapp, enlace: url }))}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={normalizarTelefono(whatsapp.telefono) ? undefined : `${id}-whatsapp`}
            className={buttonClasses("secondary", "md", "flex-1 sm:flex-none")}
          >
            <SendIcon className="size-4 text-green-700" />
            Enviar por WhatsApp
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        )}
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
      {whatsapp && !normalizarTelefono(whatsapp.telefono) && (
        <p id={`${id}-whatsapp`} className="text-xs text-pretty text-stone-500">
          {whatsapp.telefono
            ? "El teléfono del cliente no parece válido: WhatsApp te dejará elegir el contacto."
            : "El cliente no tiene teléfono: WhatsApp te dejará elegir el contacto."}
        </p>
      )}
      <p id={`${id}-estado`} role="status" className="min-h-5 text-sm">
        {copia === "copiado" && (
          <span className="inline-flex animate-entrada items-center gap-1.5 font-medium text-green-700">
            <CheckIcon className="size-4" strokeWidth={2.5} />
            Enlace copiado
          </span>
        )}
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
