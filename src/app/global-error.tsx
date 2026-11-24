"use client";

import { PantallaError } from "@/components/pantalla-error";
import "./globals.css";

/**
 * Error en el propio layout raíz: sustituye a todo el documento, así que lleva su html, body y estilos. Misma
 * pantalla que error.tsx.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <head>
        <title>Algo ha fallado · Tajo</title>
      </head>
      <body className="bg-stone-50 font-sans text-stone-900 antialiased">
        <PantallaError digest={error.digest} reset={reset} />
      </body>
    </html>
  );
}
