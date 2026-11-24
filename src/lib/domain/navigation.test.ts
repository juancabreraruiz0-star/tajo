import { describe, expect, it } from "vitest";
import { etiquetaBarraMovil, isActivePath, menuFor, ROL_LABEL } from "./navigation";

describe("menuFor", () => {
  it("admin ve Facturas", () => {
    expect(menuFor("admin").map((i) => i.label)).toEqual([
      "Panel",
      "Clientes",
      "Presupuestos",
      "Obras",
      "Facturas",
      "Materiales",
    ]);
  });

  it("empleado no ve Facturas", () => {
    const menu = menuFor("empleado");
    expect(menu.map((i) => i.label)).toEqual(["Panel", "Clientes", "Presupuestos", "Obras", "Materiales"]);
    expect(menu.some((i) => i.href === "/facturas")).toBe(false);
  });
});

describe("etiquetaBarraMovil", () => {
  it("con 6 entradas (gerencia) acorta las que no caben en 375 px; con 5, nombre entero", () => {
    const admin = menuFor("admin");
    expect(admin.map((i) => etiquetaBarraMovil(i, admin.length))).toEqual([
      "Panel",
      "Clientes",
      "Presup.",
      "Obras",
      "Facturas",
      "Materiales",
    ]);
    const empleado = menuFor("empleado");
    expect(empleado.map((i) => etiquetaBarraMovil(i, empleado.length))).toEqual([
      "Panel",
      "Clientes",
      "Presupuestos",
      "Obras",
      "Materiales",
    ]);
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
    ["/obras/123/partes/nuevo", "/obras", true],
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
