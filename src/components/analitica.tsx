"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/** Sustituye el token del enlace público del presupuesto por «[token]» y quita la query y el fragmento. */
function urlSinToken(url: string): string {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/^\/p\/[^/]+/, "/p/[token]");
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Vercel Web Analytics y Speed Insights (sin cookies). El enlace público del presupuesto lleva en la ruta el token
 * que da acceso al presupuesto: se tapa antes de enviar nada, para que no quede en las estadísticas.
 */
export function Analitica() {
  return (
    <>
      <Analytics beforeSend={(evento) => ({ ...evento, url: urlSinToken(evento.url) })} />
      <SpeedInsights beforeSend={(evento) => ({ ...evento, url: urlSinToken(evento.url) })} />
    </>
  );
}
