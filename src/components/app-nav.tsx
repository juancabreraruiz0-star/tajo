"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { etiquetaBarraMovil, isActivePath, type NavIcon, type NavItem } from "@/lib/domain/navigation";
import { BoxIcon, ConoIcon, DocumentIcon, HomeIcon, ReceiptIcon, UsersIcon } from "./icons";
import { cn } from "./ui/cn";

const ICONS: Record<NavIcon, typeof HomeIcon> = {
  panel: HomeIcon,
  clientes: UsersIcon,
  presupuestos: DocumentIcon,
  obras: ConoIcon,
  facturas: ReceiptIcon,
  materiales: BoxIcon,
};

/** Menú de la barra lateral (escritorio). */
export function SidebarNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menú principal" className="flex-1 px-3">
      <p className="px-3 pb-2 text-[0.6875rem] font-semibold tracking-wider text-slate-400 uppercase">Gestión</p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const activo = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
                  "focus-visible:outline-amber-400",
                  activo ? "bg-white/[0.08] text-white" : "text-slate-300 hover:bg-white/[0.04] hover:text-white",
                )}
              >
                {/* Marca de la sección actual: una regla ámbar a la izquierda. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-amber-400 transition-opacity duration-200",
                    activo ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className={cn(
                    "size-5 transition-colors",
                    activo ? "text-amber-400" : "text-slate-400 group-hover:text-slate-200",
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barra inferior fija (móvil). */
export function BottomNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Menú principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgb(7_27_44/0.12)] backdrop-blur-md md:hidden print:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const activo = isActivePath(pathname, item.href);
          const etiqueta = etiquetaBarraMovil(item, items.length);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[0.6875rem] leading-none tracking-[-0.015em]",
                  activo ? "font-semibold text-stone-950" : "font-medium text-stone-500",
                )}
              >
                {/* Píldora detrás del icono en la sección actual. */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200",
                    activo ? "bg-amber-100" : "bg-transparent",
                  )}
                >
                  <Icon
                    className={cn("size-[1.375rem]", activo ? "text-amber-700" : "text-stone-500")}
                    strokeWidth={activo ? 2 : 1.8}
                  />
                </span>
                {etiqueta === item.label ? (
                  <span className="max-w-full truncate">{item.label}</span>
                ) : (
                  <>
                    {/* Abreviada a la vista; entera para lectores de pantalla. */}
                    <span aria-hidden="true" className="max-w-full truncate">
                      {etiqueta}
                    </span>
                    <span className="sr-only">{item.label}</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
