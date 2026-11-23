import { formatFecha } from "@/lib/domain/dates";

/** Aviso verde de presupuesto aceptado (lo usan la página y el botón de aceptar). */
export function AvisoAceptado({ aceptadoAt }: { aceptadoAt: string | null }) {
  return (
    <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-green-900 sm:px-5">
      <p className="font-semibold">
        Presupuesto aceptado{aceptadoAt ? ` el ${formatFecha(aceptadoAt)}` : ""}.
      </p>
      <p className="mt-1 text-sm">Gracias, nos pondremos en contacto contigo.</p>
    </div>
  );
}
