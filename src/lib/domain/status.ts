export const ESTADOS_PRESUPUESTO = ["borrador", "enviado", "aceptado", "rechazado", "facturado"] as const;

export type EstadoPresupuesto = (typeof ESTADOS_PRESUPUESTO)[number];

export type Rol = "admin" | "empleado";

/** Transiciones permitidas (R9). No se pueden saltar estados. */
const TRANSICIONES: Record<EstadoPresupuesto, readonly EstadoPresupuesto[]> = {
  borrador: ["enviado"],
  enviado: ["aceptado", "rechazado"],
  aceptado: ["facturado"],
  rechazado: [],
  facturado: [],
};

export function canTransition(from: EstadoPresupuesto, to: EstadoPresupuesto): boolean {
  return TRANSICIONES[from].includes(to);
}

export type AccionPresupuesto = "enviar" | "copiar_enlace" | "marcar_aceptado" | "marcar_rechazado" | "facturar";

/** Acciones que se muestran en un presupuesto según su estado y el rol del usuario. */
export function nextActions(estado: EstadoPresupuesto, rol: Rol): AccionPresupuesto[] {
  switch (estado) {
    case "borrador":
      return ["enviar"];
    case "enviado":
      return ["copiar_enlace", "marcar_aceptado", "marcar_rechazado"];
    case "aceptado":
      return rol === "admin" ? ["facturar"] : [];
    case "rechazado":
    case "facturado":
      return [];
  }
}
