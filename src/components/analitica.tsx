"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics (sin cookies). El enlace público del presupuesto lleva el token en la ruta, que da acceso al
 * presupuesto: se sustituye por «[token]» antes de enviar la visita, para que no quede en las estadísticas.
 */
function ocultarToken(evento: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(evento.url);
  url.pathname = url.pathname.replace(/^\/p\/[^/]+/, "/p/[token]");
  url.search = "";
  return { ...evento, url: url.toString() };
}

export function Analitica() {
  return <Analytics beforeSend={ocultarToken} />;
}
