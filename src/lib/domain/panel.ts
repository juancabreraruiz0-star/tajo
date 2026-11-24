// Datos de las gráficas del panel (D10): facturación por meses y embudo de presupuestos. Puro.

import { monthRange, sumCentsInRange, type RangoFechas } from "./facturacion";
import type { ConteoPorEstado } from "./kpis";

export const MESES_GRAFICA = 6;

/** Un mes de la gráfica de facturación. */
export interface MesFacturacion {
  /** Primer día del mes, AAAA-MM-DD. */
  desde: string;
  /** Suma de `total_cents` de las facturas del mes (0 si no hubo ninguna). */
  totalCents: number;
  /** ¿Es el mes en curso (en la zona horaria indicada)? */
  actual: boolean;
}

function comprobarMeses(meses: number): void {
  if (!Number.isInteger(meses) || meses < 1) throw new Error("El número de meses debe ser un entero mayor que 0.");
}

/**
 * Rango que cubre los últimos `meses` meses naturales hasta el actual incluido (en la zona horaria indicada).
 * Es el filtro de la consulta: 23/11/2026 y 6 meses → { desde: "2026-06-01", hasta: "2026-12-01" }.
 */
export function rangoUltimosMeses(ahora: Date, timeZone: string, meses = MESES_GRAFICA): RangoFechas {
  comprobarMeses(meses);
  return { desde: monthRange(ahora, timeZone, -(meses - 1)).desde, hasta: monthRange(ahora, timeZone).hasta };
}

/**
 * Facturación de los últimos `meses` meses, del más antiguo al actual. Los meses sin facturas salen con 0 y las
 * facturas fuera del rango no cuentan. «Mes actual» es el de `ahora` en la zona horaria indicada (Madrid).
 */
export function facturacionPorMes(
  facturas: readonly { fecha: string; total_cents: number }[],
  ahora: Date,
  timeZone: string,
  meses = MESES_GRAFICA,
): MesFacturacion[] {
  comprobarMeses(meses);
  const resultado: MesFacturacion[] = [];
  for (let desplazamiento = -(meses - 1); desplazamiento <= 0; desplazamiento++) {
    const rango = monthRange(ahora, timeZone, desplazamiento);
    resultado.push({
      desde: rango.desde,
      totalCents: sumCentsInRange(facturas, rango),
      actual: desplazamiento === 0,
    });
  }
  return resultado;
}

/** Importe más alto de la serie (0 si está vacía): la barra más alta de la gráfica ocupa toda la altura. */
export function maximoMensual(serie: readonly MesFacturacion[]): number {
  return serie.reduce((max, mes) => Math.max(max, mes.totalCents), 0);
}

/** Media mensual de la serie, redondeada al céntimo (0 si está vacía). */
export function mediaMensual(serie: readonly MesFacturacion[]): number {
  if (serie.length === 0) return 0;
  return Math.round(serie.reduce((suma, mes) => suma + mes.totalCents, 0) / serie.length);
}

/** Fracción entre 0 y 1 de `valor` sobre `maximo` (0 si el máximo es 0). Para la altura o el ancho de una barra. */
export function proporcion(valor: number, maximo: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(maximo)) throw new Error("Las cifras deben ser números.");
  if (maximo <= 0 || valor <= 0) return 0;
  return Math.min(1, valor / maximo);
}

// ----------------------------------------------------------------------------
// Embudo de presupuestos
// ----------------------------------------------------------------------------

export type EtapaEmbudoClave = "creados" | "enviados" | "aceptados" | "facturados";

export interface EtapaEmbudo {
  clave: EtapaEmbudoClave;
  etiqueta: string;
  /** Presupuestos que han llegado al menos a esta fase (los que siguieron adelante también cuentan). */
  total: number;
  /** total / creados (0 si no hay ninguno): el ancho de la barra. */
  fraccion: number;
  /** total / total de la etapa anterior, o null en la primera o si la anterior es 0. */
  conversion: number | null;
}

export interface Embudo {
  etapas: EtapaEmbudo[];
  rechazados: {
    total: number;
    /** rechazados / enviados, o null si no se ha enviado ninguno. */
    fraccionDeEnviados: number | null;
  };
  /** Todos los presupuestos, borradores incluidos. */
  total: number;
}

/**
 * Embudo borrador → enviado → aceptado → facturado a partir de los conteos por estado actual. Cada etapa cuenta los
 * presupuestos que llegaron a ella: un facturado también se envió y se aceptó. Los rechazados se enviaron pero no
 * siguen; se cuentan aparte.
 */
export function embudoPresupuestos(conteos: ConteoPorEstado): Embudo {
  const { borrador = 0, enviado = 0, aceptado = 0, rechazado = 0, facturado = 0 } = conteos;
  for (const n of [borrador, enviado, aceptado, rechazado, facturado]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Los conteos deben ser enteros iguales o mayores que 0.");
  }

  const alcanzados: [EtapaEmbudoClave, string, number][] = [
    ["creados", "Creados", borrador + enviado + aceptado + rechazado + facturado],
    ["enviados", "Enviados", enviado + aceptado + rechazado + facturado],
    ["aceptados", "Aceptados", aceptado + facturado],
    ["facturados", "Facturados", facturado],
  ];
  const total = alcanzados[0][2];
  const enviados = alcanzados[1][2];

  return {
    etapas: alcanzados.map(([clave, etiqueta, n], i) => {
      const anterior = i > 0 ? alcanzados[i - 1][2] : 0;
      return {
        clave,
        etiqueta,
        total: n,
        fraccion: total === 0 ? 0 : n / total,
        conversion: i === 0 || anterior === 0 ? null : n / anterior,
      };
    }),
    rechazados: { total: rechazado, fraccionDeEnviados: enviados === 0 ? null : rechazado / enviados },
    total,
  };
}
