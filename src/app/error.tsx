"use client";

import { PantallaError } from "@/components/pantalla-error";

/** Error no controlado en una página: pantalla en español, sin el mensaje técnico. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PantallaError digest={error.digest} reset={reset} />;
}
