/** Zona horaria de la empresa: fechas, «hoy» y meses de facturación. */
export const ZONA_HORARIA = "Europe/Madrid";
const ZONA = ZONA_HORARIA;

const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: ZONA,
});

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Fecha en formato español dd/mm/aaaa.
 * Acepta una fecha "AAAA-MM-DD" (se pinta tal cual, sin zona horaria) o un timestamp ISO (hora de Madrid).
 */
export function formatFecha(valor: string): string {
  const soloFecha = SOLO_FECHA.exec(valor);
  if (soloFecha) return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error(`Fecha no válida: «${valor}».`);
  return FECHA.format(fecha);
}

const FECHA_LARGA = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: ZONA,
});

/** Fecha larga en español y hora de Madrid, con mayúscula inicial: «Lunes, 23 de noviembre de 2026». */
export function formatFechaLarga(fecha: Date): string {
  if (Number.isNaN(fecha.getTime())) throw new Error("Fecha no válida.");
  const texto = FECHA_LARGA.format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const NOMBRE_MES = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" });

/** Nombre del mes de una fecha AAAA-MM-DD: "2026-10-01" → "octubre". */
export function formatMes(fecha: string): string {
  const partes = SOLO_FECHA.exec(fecha);
  if (!partes) throw new Error(`Fecha no válida: «${fecha}».`);
  return NOMBRE_MES.format(new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, 1)));
}
