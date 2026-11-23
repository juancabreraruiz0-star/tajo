import { describe, expect, it } from "vitest";
import { isPublicPath } from "./middleware";

describe("isPublicPath", () => {
  it.each(["/login", "/login/", "/p/2b1c0d3e-0000-4000-8000-000000000000", "/_next/static/chunk.js", "/logo.svg", "/foto.PNG", "/favicon.ico", "/fuentes/inter.woff2", "/site.webmanifest"])(
    "%s es pública",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each(["/", "/clientes", "/presupuestos/nuevo", "/facturas/1", "/loginx", "/p", "/materiales", "/clientes/x.js", "/robots.txt", "/sitemap.xml", "/app.js.map", "/estilos.css", "/materiales/logopng"])(
    "%s requiere sesión",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});
