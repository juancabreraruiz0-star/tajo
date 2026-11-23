import type { EstadoPresupuesto } from "./status";

export type ConteoPorEstado = Partial<Record<EstadoPresupuesto, number>>;

/**
 * Tasa de aceptación (R17) como fracción entre 0 y 1:
 * (aceptados + facturados) / (enviados + aceptados + facturados + rechazados).
 * Los borradores no cuentan. Devuelve null si no hay ninguno enviado todavía.
 */
export function acceptanceRate(conteos: ConteoPorEstado): number | null {
  const { enviado = 0, aceptado = 0, facturado = 0, rechazado = 0 } = conteos;
  const denominador = enviado + aceptado + facturado + rechazado;
  if (denominador === 0) return null;
  return (aceptado + facturado) / denominador;
}

export interface DesgloseAceptacion {
  /** Aceptados + facturados. */
  aceptados: number;
  /** Enviados alguna vez: enviados + aceptados + facturados + rechazados (el denominador de R17). */
  enviados: number;
  /** aceptados / enviados, o null si no hay ninguno enviado. */
  tasa: number | null;
}

/** Numerador, denominador y tasa de aceptación (R17), para pintar «3 de 8». */
export function acceptanceBreakdown(conteos: ConteoPorEstado): DesgloseAceptacion {
  const { enviado = 0, aceptado = 0, facturado = 0, rechazado = 0 } = conteos;
  return {
    aceptados: aceptado + facturado,
    enviados: enviado + aceptado + facturado + rechazado,
    tasa: acceptanceRate(conteos),
  };
}

const PORCENTAJE = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0 });
const PORCENTAJE_CON_SIGNO = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

/** Fracción como porcentaje en español: 0.5 → "50 %"; con signo: 0.12 → "+12 %", -0.3 → "-30 %". */
export function formatPercent(fraccion: number, { signo = false }: { signo?: boolean } = {}): string {
  return (signo ? PORCENTAJE_CON_SIGNO : PORCENTAJE).format(fraccion);
}

export type Tendencia = "sube" | "baja" | "igual";

/**
 * Sentido de una variación tal como se ve en pantalla, redondeada al entero igual que `formatPercent`:
 * 0,004 se pinta «0 %» y es "igual" (no se colorea); 0,005 se pinta «+1 %» y es "sube".
 */
export function percentTrend(fraccion: number): Tendencia {
  if (!Number.isFinite(fraccion)) throw new Error("La variación debe ser un número.");
  const puntos = Math.round(Math.abs(fraccion) * 100);
  if (puntos === 0) return "igual";
  return fraccion > 0 ? "sube" : "baja";
}
