import { describe, expect, it } from "vitest";
import { hrefPagina, paginacion, parsePagina, POR_PAGINA, rangoPagina, resumenPagina, totalPaginas } from "./paginacion";

describe("parsePagina", () => {
  it("sin parámetro o vacío es la primera página", () => {
    expect(parsePagina(undefined)).toBe(1);
    expect(parsePagina("")).toBe(1);
    expect(parsePagina("  ")).toBe(1);
    expect(parsePagina([])).toBe(1);
  });

  it("acepta enteros ≥ 1", () => {
    expect(parsePagina("1")).toBe(1);
    expect(parsePagina("3")).toBe(3);
    expect(parsePagina(" 12 ")).toBe(12);
    expect(parsePagina(["2", "5"])).toBe(2);
  });

  it.each(["0", "-1", "2,5", "2.5", "abc", "1e3", "0x10", "+2", "1234567"])("«%s» no es una página válida", (valor) => {
    expect(parsePagina(valor)).toBeNull();
  });
});

describe("rangoPagina", () => {
  it("25 filas por página, desde 0", () => {
    expect(POR_PAGINA).toBe(25);
    expect(rangoPagina(1)).toEqual({ desde: 0, hasta: 24 });
    expect(rangoPagina(2)).toEqual({ desde: 25, hasta: 49 });
    expect(rangoPagina(3, 10)).toEqual({ desde: 20, hasta: 29 });
  });
});

describe("totalPaginas", () => {
  it("redondea hacia arriba y nunca baja de 1", () => {
    expect(totalPaginas(0)).toBe(1);
    expect(totalPaginas(1)).toBe(1);
    expect(totalPaginas(25)).toBe(1);
    expect(totalPaginas(26)).toBe(2);
    expect(totalPaginas(120)).toBe(5);
  });
});

describe("paginacion", () => {
  it("primera, intermedia y última página", () => {
    expect(paginacion(1, 60)).toEqual({ pagina: 1, totalPaginas: 3, anterior: null, siguiente: 2, fueraDeRango: false });
    expect(paginacion(2, 60)).toEqual({ pagina: 2, totalPaginas: 3, anterior: 1, siguiente: 3, fueraDeRango: false });
    expect(paginacion(3, 60)).toEqual({ pagina: 3, totalPaginas: 3, anterior: 2, siguiente: null, fueraDeRango: false });
  });

  it("una sola página: sin navegación", () => {
    expect(paginacion(1, 10)).toMatchObject({ anterior: null, siguiente: null, fueraDeRango: false });
    expect(paginacion(1, 0)).toMatchObject({ totalPaginas: 1, fueraDeRango: false });
  });

  it("página más allá de la última o no válida: fuera de rango", () => {
    expect(paginacion(4, 60)).toMatchObject({ fueraDeRango: true, totalPaginas: 3, anterior: null, siguiente: null });
    expect(paginacion(2, 0)).toMatchObject({ fueraDeRango: true, totalPaginas: 1 });
    expect(paginacion(null, 60)).toMatchObject({ fueraDeRango: true, totalPaginas: 3 });
  });
});

describe("hrefPagina", () => {
  it("conserva filtros y búsqueda y no escribe la página 1", () => {
    expect(hrefPagina("/presupuestos", { estado: "enviado" }, 2)).toBe("/presupuestos?estado=enviado&pagina=2");
    expect(hrefPagina("/presupuestos", { estado: "enviado" }, 1)).toBe("/presupuestos?estado=enviado");
    expect(hrefPagina("/presupuestos", {}, 1)).toBe("/presupuestos");
  });

  it("quita los parámetros vacíos y no duplica la página", () => {
    expect(hrefPagina("/clientes", { q: "", estado: null, pagina: "7" }, 3)).toBe("/clientes?pagina=3");
  });

  it("admite otro nombre de parámetro para un segundo listado en la misma página", () => {
    expect(hrefPagina("/clientes/1", { pagina: "2" }, 3, "pagina_facturas")).toBe(
      "/clientes/1?pagina=2&pagina_facturas=3",
    );
    expect(hrefPagina("/clientes/1", { pagina_facturas: "3" }, 1, "pagina_facturas")).toBe("/clientes/1");
  });

  it("codifica el texto de búsqueda", () => {
    expect(hrefPagina("/clientes", { q: "García & hijos" }, 2)).toBe("/clientes?q=Garc%C3%ADa+%26+hijos&pagina=2");
  });
});

describe("resumenPagina", () => {
  it("dice qué filas se ven", () => {
    expect(resumenPagina(1, 60)).toBe("Del 1 al 25 de 60");
    expect(resumenPagina(3, 60)).toBe("Del 51 al 60 de 60");
  });
});
