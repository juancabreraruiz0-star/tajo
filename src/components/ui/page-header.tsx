import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Botones a la derecha (en móvil bajan debajo del título). */
  actions?: ReactNode;
  /** Enlace de vuelta, p. ej. { href: "/clientes", label: "Clientes" }. */
  back?: { href: string; label: string };
}

export function PageHeader({ title, description, actions, back }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-stone-800"
        >
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
          {description && <div className="mt-1 text-sm text-stone-500">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
