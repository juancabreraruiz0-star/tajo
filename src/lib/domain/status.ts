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

export type AccionPresupuesto =
  | "enviar"
  | "copiar_enlace"
  | "marcar_aceptado"
  | "marcar_rechazado"
  | "facturar"
  | "regenerar_enlace";

export interface OpcionesAcciones {
  /** ¿Ha pasado ya el último día de validez? (isExpired) */
  vencido?: boolean;
}

/**
 * ¿Puede este usuario dar por aceptado un presupuesto enviado desde la aplicación? Solo gerencia y con la validez
 * vigente (D9); el cliente lo acepta desde el enlace. La base de datos lo comprueba también (trigger de 0004).
 */
export function canMarkAccepted(rol: Rol, vencido: boolean): boolean {
  return rol === "admin" && !vencido;
}

/** Acciones que se muestran en un presupuesto según su estado, el rol del usuario y si la validez ha vencido. */
export function nextActions(
  estado: EstadoPresupuesto,
  rol: Rol,
  { vencido = false }: OpcionesAcciones = {},
): AccionPresupuesto[] {
  // Regenerar el enlace público: solo gerencia y cuando ya existe (fuera de borrador).
  const regenerar: AccionPresupuesto[] = rol === "admin" ? ["regenerar_enlace"] : [];
  switch (estado) {
    case "borrador":
      return ["enviar"];
    case "enviado":
      return [
        "copiar_enlace",
        ...(canMarkAccepted(rol, vencido) ? (["marcar_aceptado"] as const) : []),
        "marcar_rechazado",
        ...regenerar,
      ];
    case "aceptado":
      return rol === "admin" ? ["facturar", ...regenerar] : [];
    case "rechazado":
    case "facturado":
      return regenerar;
  }
}
