import type { Metadata } from "next";
import type { ReactNode } from "react";

// Enlaces públicos de presupuesto: fuera de buscadores y sin enviar el token como referer a otras webs.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PublicoLayout({ children }: { children: ReactNode }) {
  return children;
}
