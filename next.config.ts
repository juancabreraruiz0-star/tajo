import path from "node:path";
import type { NextConfig } from "next";

const enDesarrollo = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy (D9). Sin script-src ni default-src: Next 15 mete scripts en línea en cada página (el
 * payload de React Server Components) y bloquearlos exige un nonce por petición desde el middleware. Lo que sí se
 * fija:
 *  - frame-ancestors 'none': nadie puede meter la app en un iframe (clickjacking).
 *  - base-uri y form-action 'self': ni <base> ajeno ni formularios que envíen a otra web.
 *  - object-src 'none': nada de plugins.
 *  - connect-src: el navegador solo habla con la propia app (Supabase se llama desde el servidor). Se deja también
 *    Supabase por si algún día hay cliente de navegador, y ws: en desarrollo para la recarga en caliente.
 */
const CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${enDesarrollo ? " ws: wss:" : ""}`,
].join("; ");

const CABECERAS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Solo tiene efecto por https (Vercel); en http://localhost el navegador lo ignora.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Hay otro package-lock.json fuera del proyecto: se fija aquí la raíz para el tracing.
  outputFileTracingRoot: path.join(__dirname),
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: CABECERAS },
      // Enlace público del presupuesto: el token va en la URL y no se manda como referer a ninguna web (como el
      // <meta name="referrer"> de src/app/p/layout.tsx). Va después: sustituye a la Referrer-Policy general.
      { source: "/p/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
