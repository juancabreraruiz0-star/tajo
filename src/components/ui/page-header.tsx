import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "../icons";

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
    <header className="mb-6 sm:mb-8">
      {back && (
        <Link
          href={back.href}
          className="group mb-3 -ml-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-stone-500 transition-colors hover:text-stone-900"
        >
          <ArrowLeftIcon className="size-4 shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5" />
          <span className="truncate">{back.label}</span>
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words text-stone-950 sm:text-[1.75rem] sm:leading-9">
            {title}
          </h1>
          {description && <div className="mt-1.5 text-sm text-pretty text-stone-500">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}
