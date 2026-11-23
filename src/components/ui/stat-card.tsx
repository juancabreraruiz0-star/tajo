import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./card";
import { cn } from "./cn";

type StatTone = "default" | "warning" | "danger";

const VALUE_TONES: Record<StatTone, string> = {
  default: "text-stone-900",
  warning: "text-amber-700",
  danger: "text-red-700",
};

interface StatCardProps {
  /** Id único en la página: une el título con la tarjeta para lectores de pantalla. */
  id: string;
  title: string;
  /** Cifra principal ya formateada; "—" si no hay dato. */
  value: string;
  icon?: ReactNode;
  tone?: StatTone;
  /** Línea de contexto bajo la cifra. */
  detail?: ReactNode;
  /** Contenido extra (p. ej. una lista corta). */
  children?: ReactNode;
  link?: { href: string; label: string };
  className?: string;
}

/** Tarjeta de cifra del panel: título, valor grande, detalle y enlace opcional al listado. */
export function StatCard({ id, title, value, icon, tone = "default", detail, children, link, className }: StatCardProps) {
  return (
    <Card className={cn("flex flex-col p-4 sm:p-5", className)}>
      <section aria-labelledby={id} className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <h2 id={id} className="text-sm font-medium text-stone-600">
            {title}
          </h2>
          {icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              {icon}
            </span>
          )}
        </div>
        <p className={cn("mt-1 text-3xl font-bold tracking-tight tabular-nums", VALUE_TONES[tone])}>{value}</p>
        {detail && <div className="mt-1 text-sm text-stone-500">{detail}</div>}
        {children && <div className="mt-3">{children}</div>}
        {link && (
          <div className="mt-auto pt-4">
            <Link href={link.href} className="text-sm font-semibold text-amber-700 hover:text-amber-800 hover:underline">
              {link.label} <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
      </section>
    </Card>
  );
}
