import type { ReactNode } from "react";
import { resumenPagina, type EstadoPaginacion } from "@/lib/domain/paginacion";
import { LinkButton } from "./button";
import { cn } from "./cn";
import { EmptyState } from "./empty-state";

interface PaginacionProps {
  estado: EstadoPaginacion;
  total: number;
  /** Enlace a una página conservando filtros y búsqueda (hrefPagina). */
  href: (pagina: number) => string;
  /** Texto para lectores de pantalla, p. ej. «Páginas de presupuestos». */
  label: string;
  className?: string;
}

const deshabilitado =
  "inline-flex h-11 items-center rounded-lg border border-stone-200 px-4 text-sm font-semibold text-stone-400";

/** «Anterior / Siguiente» debajo de un listado. No se pinta si todo cabe en una página. */
export function Paginacion({ estado, total, href, label, className }: PaginacionProps) {
  if (estado.fueraDeRango || estado.totalPaginas <= 1) return null;

  const anterior: ReactNode =
    estado.anterior !== null ? (
      <LinkButton href={href(estado.anterior)} rel="prev">
        <span aria-hidden="true">←</span> Anterior
      </LinkButton>
    ) : (
      <span className={deshabilitado} aria-disabled="true">
        <span aria-hidden="true">←&nbsp;</span>Anterior
      </span>
    );
  const siguiente: ReactNode =
    estado.siguiente !== null ? (
      <LinkButton href={href(estado.siguiente)} rel="next">
        Siguiente <span aria-hidden="true">→</span>
      </LinkButton>
    ) : (
      <span className={deshabilitado} aria-disabled="true">
        Siguiente<span aria-hidden="true">&nbsp;→</span>
      </span>
    );

  return (
    <nav aria-label={label} className={cn("mt-4 flex flex-wrap items-center justify-between gap-3", className)}>
      {anterior}
      <p className="order-last basis-full text-center text-sm text-stone-600 sm:order-none sm:basis-auto">
        Página {estado.pagina} de {estado.totalPaginas}
        <span className="text-stone-400"> · {resumenPagina(estado.pagina, total)}</span>
      </p>
      {siguiente}
    </nav>
  );
}

interface PaginaFueraDeRangoProps {
  estado: EstadoPaginacion;
  href: (pagina: number) => string;
}

/** Estado vacío para ?pagina= fuera de rango o no válida: enlaces a la primera y a la última página. */
export function PaginaFueraDeRango({ estado, href }: PaginaFueraDeRangoProps) {
  return (
    <EmptyState
      title="Esta página no existe"
      description={
        estado.totalPaginas === 1
          ? "Todo el listado cabe en una sola página."
          : `El listado tiene ${estado.totalPaginas} páginas.`
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <LinkButton href={href(1)}>Ir a la primera página</LinkButton>
          {estado.totalPaginas > 1 && (
            <LinkButton href={href(estado.totalPaginas)}>Ir a la última página ({estado.totalPaginas})</LinkButton>
          )}
        </div>
      }
    />
  );
}
