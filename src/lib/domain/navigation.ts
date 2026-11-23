import type { Rol } from "./status";

export type NavIcon = "panel" | "clientes" | "presupuestos" | "facturas" | "materiales";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

const MENU: readonly (NavItem & { soloAdmin?: boolean })[] = [
  { href: "/", label: "Panel", icon: "panel" },
  { href: "/clientes", label: "Clientes", icon: "clientes" },
  { href: "/presupuestos", label: "Presupuestos", icon: "presupuestos" },
  { href: "/facturas", label: "Facturas", icon: "facturas", soloAdmin: true },
  { href: "/materiales", label: "Materiales", icon: "materiales" },
];

/** Menú de la zona privada según el rol (R2: facturas solo para admin). */
export function menuFor(rol: Rol): NavItem[] {
  return MENU.filter((item) => !item.soloAdmin || rol === "admin").map(({ href, label, icon }) => ({
    href,
    label,
    icon,
  }));
}

/** ¿La entrada del menú `href` es la sección actual? "/" solo en el panel; el resto incluye sus subrutas. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const ROL_LABEL: Record<Rol, string> = {
  admin: "Gerencia",
  empleado: "Encargado de obra",
};
