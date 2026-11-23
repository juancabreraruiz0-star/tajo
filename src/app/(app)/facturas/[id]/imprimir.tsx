"use client";

import { Button } from "@/components/ui/button";

/** D5: el PDF se genera con el diálogo de impresión del navegador («Guardar como PDF»). */
export function DescargarPdf() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      Descargar PDF
    </Button>
  );
}
