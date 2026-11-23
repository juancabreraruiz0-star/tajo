"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, type NavIcon, type NavItem } from "@/lib/domain/navigation";
import { BoxIcon, DocumentIcon, HomeIcon, ReceiptIcon, UsersIcon } from "./icons";
import { cn } from "./ui/cn";

const ICONS: Record<NavIcon, typeof HomeIcon> = {
  panel: HomeIcon,
  clientes: UsersIcon,
  presupuestos: DocumentIcon,
  facturas: ReceiptIcon,
  materiales: BoxIcon,
};

/** Menú de la barra lateral (escritorio). */
export function SidebarNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menú principal" className="flex-1 px-3">
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const activo = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  activo ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
                )}
              >
                <Icon className={cn("size-5", activo ? "text-amber-400" : "text-slate-400")} />
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const activo = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] font-medium",
                  activo ? "text-amber-700" : "text-stone-500",
                )}
              >
                <Icon className={cn("size-6", activo ? "text-amber-600" : "text-stone-400")} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
