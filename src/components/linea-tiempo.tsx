import { formatFechaEnLetra } from "@/lib/domain/dates";
import type { EstadoHito, Hito } from "@/lib/domain/linea-tiempo";
import { CheckIcon } from "./icons";
import { cn } from "./ui/cn";

const ESTADO_TEXTO: Record<EstadoHito, string> = {
  hecho: "hecho",
  siguiente: "siguiente paso",
  pendiente: "pendiente",
  cerrado: "cerrado",
};

function Marca({ estado }: { estado: EstadoHito }) {
  switch (estado) {
    case "hecho":
      return (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-[0_0_0_4px_rgb(22_163_74/0.12)]">
          <CheckIcon className="size-4" strokeWidth={2.5} />
        </span>
      );
    case "siguiente":
      return (
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-amber-500">
          <span className="absolute size-2.5 rounded-full bg-amber-500 motion-safe:animate-ping motion-safe:opacity-60" />
          <span className="relative size-2.5 rounded-full bg-amber-500" />
        </span>
      );
    case "cerrado":
      return (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700 ring-1 ring-red-200">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3}>
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </span>
      );
    case "pendiente":
      return <span className="block size-7 shrink-0 rounded-full border-2 border-dashed border-stone-300 bg-white" />;
  }
}

/**
 * Línea de tiempo del presupuesto: vertical en móvil y horizontal desde sm. Cada hito dice su estado también en
 * texto (para lectores de pantalla), no solo con el color.
 */
export function LineaTiempo({ hitos, className }: { hitos: readonly Hito[]; className?: string }) {
  return (
    <ol
      className={cn(
        "grid gap-0 sm:gap-4",
        hitos.length === 3 ? "sm:grid-cols-3" : hitos.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4",
        className,
      )}
    >
      {hitos.map((hito, i) => {
        const ultimo = i === hitos.length - 1;
        const tramoHecho = hito.estado === "hecho" && hitos[i + 1]?.estado === "hecho";
        return (
          <li key={hito.clave} className="relative flex gap-3 pb-5 last:pb-0 sm:block sm:pb-0">
            {/* Tramo hasta el siguiente hito: vertical en móvil, horizontal desde sm */}
            {!ultimo && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-8 bottom-1 left-[13px] w-0.5 rounded-full sm:top-[13px] sm:right-[-0.75rem] sm:bottom-auto sm:left-9 sm:h-0.5 sm:w-auto",
                  tramoHecho ? "bg-green-500/40" : "bg-[repeating-linear-gradient(to_bottom,var(--color-stone-300)_0_4px,transparent_4px_8px)] sm:bg-[repeating-linear-gradient(to_right,var(--color-stone-300)_0_4px,transparent_4px_8px)]",
                )}
              />
            )}
            <Marca estado={hito.estado} />
            <div className="min-w-0 sm:mt-3">
              <p
                className={cn(
                  "text-sm font-semibold",
                  hito.estado === "pendiente" ? "text-stone-500" : "text-stone-900",
                  hito.estado === "cerrado" && "text-red-800",
                )}
              >
                {hito.titulo}
                <span className="sr-only"> ({ESTADO_TEXTO[hito.estado]})</span>
              </p>
              {hito.fecha && (
                <p className="mt-0.5 text-sm text-stone-600 tabular-nums">
                  <time dateTime={hito.fecha}>{formatFechaEnLetra(hito.fecha)}</time>
                </p>
              )}
              {hito.detalle && <p className="mt-0.5 text-xs text-pretty text-stone-500">{hito.detalle}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
