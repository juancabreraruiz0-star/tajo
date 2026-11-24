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

const HORA = new Intl.DateTimeFormat("es-ES", { hour: "numeric", minute: "2-digit", timeZone: ZONA });

/** Fecha y hora de Madrid de un timestamp ISO: «24/11/2026 a las 10:32». */
export function formatFechaHora(valor: string): string {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error(`Fecha no válida: «${valor}».`);
  return `${FECHA.format(fecha)} a las ${HORA.format(fecha)}`;
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

// Abreviaturas fijas (sin depender de la versión de ICU del navegador o del servidor: unos dan «sept», otros «sep»).
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
const MES_LARGO = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const DIA_MADRID = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });

/** Año, mes (1-12) y día de una fecha AAAA-MM-DD (tal cual) o de un timestamp ISO (en hora de Madrid). */
function partesFecha(valor: string): { anio: number; mes: number; dia: number } {
  let texto = valor;
  if (!SOLO_FECHA.test(valor)) {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) throw new Error(`Fecha no válida: «${valor}».`);
    texto = DIA_MADRID.format(fecha);
  }
  const [anio, mes, dia] = texto.split("-").map(Number);
  if (!(mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31)) throw new Error(`Fecha no válida: «${valor}».`);
  return { anio, mes, dia };
}

/** Mes abreviado para ejes y etiquetas: "2026-09-01" → "sep". */
export function formatMesCorto(fecha: string): string {
  return MES_CORTO[partesFecha(fecha).mes - 1];
}

/** Mes y año: "2026-11-01" → "noviembre de 2026". */
export function formatMesAnio(fecha: string): string {
  const { anio, mes } = partesFecha(fecha);
  return `${MES_LARGO[mes - 1]} de ${anio}`;
}

/**
 * Fecha en letra para leerla de un vistazo: «23 de diciembre». Lleva el año solo si no es el de `hoy` (en Madrid):
 * «5 de enero de 2027». Acepta AAAA-MM-DD o un timestamp ISO (hora de Madrid).
 */
export function formatFechaEnLetra(valor: string, hoy: Date = new Date()): string {
  const { anio, mes, dia } = partesFecha(valor);
  if (Number.isNaN(hoy.getTime())) throw new Error("Fecha no válida.");
  const anioHoy = Number(DIA_MADRID.format(hoy).slice(0, 4));
  return `${dia} de ${MES_LARGO[mes - 1]}${anio === anioHoy ? "" : ` de ${anio}`}`;
}
