import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "../icons";
import { Card } from "./card";
import { cn } from "./cn";

type StatTone = "default" | "warning" | "danger";

const TONES: Record<StatTone, { valor: string; icono: string }> = {
  default: { valor: "text-stone-950", icono: "bg-amber-50 text-amber-700 ring-amber-200/70" },
  warning: { valor: "text-amber-800", icono: "bg-amber-100 text-amber-800 ring-amber-300/70" },
  danger: { valor: "text-red-700", icono: "bg-red-50 text-red-600 ring-red-200" },
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
    <Card
      className={cn(
        "flex flex-col transition-[box-shadow,transform] duration-200 ease-out hover:shadow-elevada motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      <section aria-labelledby={id} className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-3">
          {icon && (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                TONES[tone].icono,
              )}
            >
              {icon}
            </span>
          )}
          <h2 id={id} className="text-sm leading-tight font-medium text-stone-600">
            {title}
          </h2>
        </div>
        <p
          className={cn(
            "mt-4 text-[2rem] leading-none font-semibold tracking-tight tabular-nums",
            TONES[tone].valor,
          )}
        >
          {value}
        </p>
        {detail && <div className="mt-2 text-sm text-pretty text-stone-500">{detail}</div>}
        {children && <div className="mt-4">{children}</div>}
      </section>
      {link && (
        <Link
          href={link.href}
          className="group flex items-center justify-between gap-2 rounded-b-xl border-t border-stone-100 px-5 py-3 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50/60 hover:text-amber-900"
        >
          {link.label}
          <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </Card>
  );
}
