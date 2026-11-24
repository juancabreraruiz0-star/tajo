import Link from "next/link";
import { ocultarGuia } from "@/lib/actions/guia";
import type { GuiaDemo as DatosGuia } from "@/lib/domain/guia-demo";
import { CheckIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

interface GuiaDemoProps {
  guia: DatosGuia;
  /** Obra en rojo para el remate («mira el margen»), si hay alguna. */
  obraEnRojo: { id: string; titulo: string } | null;
}

/**
 * «Prueba Tajo en 3 minutos»: pasos con enlace a donde se hace cada uno, que se marcan solos con los datos de hoy.
 * Se oculta con «Ya lo conozco» (cookie) y vuelve desde el enlace pequeño del panel.
 */
export function GuiaDemo({ guia, obraEnRojo }: GuiaDemoProps) {
  const progreso = guia.total === 0 ? 0 : guia.hechos / guia.total;
  return (
    <Card className="relative mb-6 overflow-hidden">
      {/* Cuadrícula de plano muy tenue a la derecha: la identidad de Tajo, sin chillar. */}
      <div
        aria-hidden="true"
        className="fondo-plano pointer-events-none absolute inset-y-0 right-0 w-1/2 [mask-image:linear-gradient(to_left,black,transparent)]"
      />
      <section aria-labelledby="guia-titulo" className="relative px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold tracking-wider text-amber-700 uppercase">Guía de la demo</p>
            <h2 id="guia-titulo" className="mt-0.5 text-[0.9375rem] font-semibold tracking-tight text-stone-900">
              Prueba Tajo en 3 minutos
            </h2>
            <p className="mt-0.5 text-sm text-pretty text-stone-500">
              {guia.completa
                ? "Lo has visto todo. Los pasos se han ido marcando solos con lo que has hecho hoy."
                : "Cada paso se marca solo cuando lo haces. Pulsa uno para ir a donde se hace."}
            </p>
          </div>
          <form action={ocultarGuia}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-900/5 hover:text-stone-900"
            >
              Ya lo conozco
            </button>
          </form>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full origin-left animate-crecer-x rounded-full bg-amber-500"
              style={{ width: `${progreso * 100}%` }}
            />
          </div>
          <p className="shrink-0 text-xs font-medium text-stone-600 tabular-nums">
            {guia.hechos} de {guia.total}
          </p>
        </div>

        <ol
          className={cn(
            "mt-4 grid gap-2 sm:grid-cols-2",
            guia.total === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
          )}
        >
          {guia.pasos.map((paso, i) => {
            const siguiente = paso.clave === guia.siguiente;
            return (
              <li key={paso.clave} className="min-w-0">
                <Link
                  href={paso.href}
                  className={cn(
                    "group flex h-full gap-3 rounded-lg p-3 ring-1 transition-[box-shadow,background-color] duration-150 ring-inset hover:shadow-tarjeta",
                    paso.hecho
                      ? "bg-green-50 ring-green-200 hover:bg-green-100/70"
                      : cn("bg-white/80 hover:bg-white", siguiente ? "ring-amber-400" : "ring-stone-200"),
                  )}
                >
                  {paso.hecho ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                      <CheckIcon className="size-3.5" strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                        siguiente ? "bg-amber-500 text-stone-950" : "bg-stone-100 text-stone-600",
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-sm leading-snug font-medium group-hover:text-amber-800",
                        paso.hecho ? "text-green-900" : "text-stone-900",
                      )}
                    >
                      {paso.titulo}
                      <span className="sr-only">{paso.hecho ? " (hecho)" : siguiente ? " (siguiente paso)" : ""}</span>
                    </span>
                    {/* En el móvil solo se explica el paso que toca: la guía no ocupa media pantalla. */}
                    <span
                      className={cn("mt-0.5 text-xs text-pretty text-stone-500", siguiente ? "block" : "hidden sm:block")}
                    >
                      {paso.descripcion}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>

        {obraEnRojo && (
          <p className="mt-3 text-sm text-stone-600">
            Y para terminar, mira{" "}
            <Link href={`/obras/${obraEnRojo.id}`} className="font-semibold text-amber-800 hover:underline">
              la obra «{obraEnRojo.titulo}»
            </Link>
            : va en rojo, por encima de lo presupuestado.
          </p>
        )}
      </section>
    </Card>
  );
}
