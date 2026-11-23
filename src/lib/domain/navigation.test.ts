import { describe, expect, it } from "vitest";
import { isActivePath, menuFor, ROL_LABEL } from "./navigation";

describe("menuFor", () => {
  it("admin ve Facturas", () => {
    expect(menuFor("admin").map((i) => i.label)).toEqual([
      "Panel",
      "Clientes",
      "Presupuestos",
      "Facturas",
      "Materiales",
    ]);
  });

  it("empleado no ve Facturas", () => {
    const menu = menuFor("empleado");
    expect(menu.map((i) => i.label)).toEqual(["Panel", "Clientes", "Presupuestos", "Materiales"]);
    expect(menu.some((i) => i.href === "/facturas")).toBe(false);
  });
});

describe("isActivePath", () => {
  it.each([
    ["/", "/", true],
    ["/clientes", "/", false],
    ["/clientes", "/clientes", true],
    ["/clientes/123/editar", "/clientes", true],
    ["/clientesx", "/clientes", false],
    ["/materiales/nuevo", "/clientes", false],
  ])("%s con %s → %s", (pathname, href, activo) => {
    expect(isActivePath(pathname, href)).toBe(activo);
  });
});

describe("ROL_LABEL", () => {
  it("nombra los roles como en la empresa", () => {
    expect(ROL_LABEL.admin).toBe("Gerencia");
    expect(ROL_LABEL.empleado).toBe("Encargado de obra");
  });
});
