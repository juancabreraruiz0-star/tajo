import { CheckIcon } from "@/components/icons";
import { formatFechaEnLetra } from "@/lib/domain/dates";

interface AvisoAceptadoProps {
  aceptadoAt: string | null;
  /** Nombre de la empresa, para decir quién se pondrá en contacto. */
  empresa?: string;
  /** El presupuesto ya se ha facturado. */
  facturado?: boolean;
}

/** Confirmación verde de presupuesto aceptado (la usan la página y el botón de aceptar). */
export function AvisoAceptado({ aceptadoAt, empresa, facturado = false }: AvisoAceptadoProps) {
  return (
    <div
      role="status"
      className="flex animate-entrada items-start gap-4 rounded-2xl border border-green-200 bg-green-50 px-5 py-5 text-green-950 sm:px-6"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-[0_0_0_6px_rgb(22_163_74/0.14)]">
        <CheckIcon className="size-5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-base font-semibold">
          Presupuesto aceptado{aceptadoAt ? ` el ${formatFechaEnLetra(aceptadoAt)}` : ""}
        </p>
        <p className="mt-1 text-sm text-pretty text-green-900">
          {facturado
            ? "La obra ya está facturada. Gracias por tu confianza."
            : `Gracias. ${empresa ? `${empresa} se pondrá` : "Nos pondremos"} en contacto contigo para organizar la obra.`}
        </p>
      </div>
    </div>
  );
}
