import { describe, expect, it } from "vitest";
import { MAX_BUSQUEDA, normalizeSearch, toIlikeContains } from "./search";

describe("normalizeSearch", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    ["  García  ", "García"],
    ["Ana   María", "Ana María"],
    [["López", "otro"], "López"],
    [[], ""],
    ["*", ""],
    ["***", ""],
    [" * ", ""],
    ["Gar*cía", "García"],
    ["* López *", "López"],
    ["Ana * María", "Ana María"],
    [["*"], ""],
  ])("%j → %j", (valor, texto) => {
    expect(normalizeSearch(valor)).toBe(texto);
  });

  it("quita los asteriscos antes de cortar: no queda ninguno aunque el texto sea largo", () => {
    const texto = normalizeSearch("*".repeat(150) + "a".repeat(150));
    expect(texto).toBe("a".repeat(MAX_BUSQUEDA));
  });

  it("corta a la longitud máxima", () => {
    expect(normalizeSearch("a".repeat(300))).toHaveLength(MAX_BUSQUEDA);
  });
});

describe("toIlikeContains", () => {
  it("envuelve en % para buscar «contiene»", () => {
    expect(toIlikeContains("garcía")).toBe("%garcía%");
  });

  it("escapa los comodines y la barra del usuario", () => {
    expect(toIlikeContains("50%")).toBe("%50\\%%");
    expect(toIlikeContains("a_b")).toBe("%a\\_b%");
    expect(toIlikeContains("c\\d")).toBe("%c\\\\d%");
  });
});
