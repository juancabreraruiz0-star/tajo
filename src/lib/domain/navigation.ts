import type { Rol } from "./status";

export type NavIcon = "panel" | "clientes" | "presupuestos" | "obras" | "facturas" | "materiales";

export interface NavItem {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior del móvil cuando no cabe la larga (6 entradas en 375 px). */
  corta?: string;
  icon: NavIcon;
}

const MENU: readonly (NavItem & { soloAdmin?: boolean })[] = [
  { href: "/", label: "Panel", icon: "panel" },
  { href: "/clientes", label: "Clientes", icon: "clientes" },
  { href: "/presupuestos", label: "Presupuestos", corta: "Presup.", icon: "presupuestos" },
  { href: "/obras", label: "Obras", icon: "obras" },
  { href: "/facturas", label: "Facturas", icon: "facturas", soloAdmin: true },
  { href: "/materiales", label: "Materiales", icon: "materiales" },
];

/** Menú de la zona privada según el rol (R2: facturas solo para admin). */
export function menuFor(rol: Rol): NavItem[] {
  return MENU.filter((item) => !item.soloAdmin || rol === "admin").map(({ href, label, corta, icon }) =>
    corta ? { href, label, corta, icon } : { href, label, icon },
  );
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

/** En la barra inferior del móvil caben 5 entradas con su nombre entero; con más, se usan las cortas. */
export const MAX_ENTRADAS_BARRA_MOVIL = 5;

/** Etiqueta de una entrada en la barra inferior del móvil, según cuántas entradas tiene. */
export function etiquetaBarraMovil(item: NavItem, entradas: number): string {
  return entradas > MAX_ENTRADAS_BARRA_MOVIL ? (item.corta ?? item.label) : item.label;
}
