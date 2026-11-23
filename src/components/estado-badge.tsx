import type { EstadoPresupuesto } from "@/lib/domain/status";
import { Badge, type BadgeTone } from "./ui/badge";

export const ESTADO_LABEL: Record<EstadoPresupuesto, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
  facturado: "Facturado",
};

// D6: borrador gris, enviado azul, aceptado verde, rechazado rojo, facturado violeta.
const ESTADO_TONE: Record<EstadoPresupuesto, BadgeTone> = {
  borrador: "gray",
  enviado: "blue",
  aceptado: "green",
  rechazado: "red",
  facturado: "violet",
};

export function EstadoBadge({ estado }: { estado: EstadoPresupuesto }) {
  return <Badge tone={ESTADO_TONE[estado]}>{ESTADO_LABEL[estado]}</Badge>;
}
