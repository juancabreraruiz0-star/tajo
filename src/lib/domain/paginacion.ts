// Paginación de los listados (D9): 25 filas por página con ?pagina=. Puro: sin Next ni Supabase.

export const POR_PAGINA = 25;

/** Página más alta que se acepta en la URL (evita desplazamientos absurdos en la consulta). */
const MAX_PAGINA = 100_000;

/**
 * Página pedida en la URL (?pagina=). Sin parámetro (o vacío) → 1. Un número entero ≥ 1 → ese número.
 * Cualquier otra cosa ("0", "-1", "2,5", "abc", "1e3") → null: la página no existe.
 */
export function parsePagina(valor: string | string[] | undefined): number | null {
  const texto = (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
  if (texto === "") return 1;
  if (!/^\d{1,6}$/.test(texto)) return null;
  const pagina = Number(texto);
  return pagina >= 1 && pagina <= MAX_PAGINA ? pagina : null;
}

/** Filas de la página para .range(desde, hasta) de Supabase (ambos incluidos, desde 0). */
export function rangoPagina(pagina: number, porPagina = POR_PAGINA): { desde: number; hasta: number } {
  const desde = (pagina - 1) * porPagina;
  return { desde, hasta: desde + porPagina - 1 };
}

/** Número de páginas para un total de filas. Sin filas hay una página (vacía). */
export function totalPaginas(total: number, porPagina = POR_PAGINA): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

export interface EstadoPaginacion {
  pagina: number;
  totalPaginas: number;
  /** Página anterior o null si es la primera. */
  anterior: number | null;
  /** Página siguiente o null si es la última. */
  siguiente: number | null;
  /** La página pedida está más allá de la última (o es 0, negativa o no es un número). */
  fueraDeRango: boolean;
}

/** Navegación «Anterior / Siguiente» para la página pedida (null = no válida) y el total de filas. */
export function paginacion(pagina: number | null, total: number, porPagina = POR_PAGINA): EstadoPaginacion {
  const paginas = totalPaginas(total, porPagina);
  if (pagina === null || pagina > paginas) {
    return { pagina: pagina ?? 0, totalPaginas: paginas, anterior: null, siguiente: null, fueraDeRango: true };
  }
  return {
    pagina,
    totalPaginas: paginas,
    anterior: pagina > 1 ? pagina - 1 : null,
    siguiente: pagina < paginas ? pagina + 1 : null,
    fueraDeRango: false,
  };
}

/**
 * Enlace a una página del listado conservando el resto de parámetros (filtros, búsqueda).
 * Los parámetros vacíos se quitan y la página 1 no se escribe: hrefPagina("/presupuestos", { estado: "enviado" }, 2)
 * → "/presupuestos?estado=enviado&pagina=2". `clave` cambia el nombre del parámetro si hay dos listados en la página.
 */
export function hrefPagina(
  ruta: string,
  parametros: Readonly<Record<string, string | null | undefined>>,
  pagina: number,
  clave = "pagina",
): string {
  const query = new URLSearchParams();
  for (const [nombre, valor] of Object.entries(parametros)) {
    if (nombre !== clave && valor) query.set(nombre, valor);
  }
  if (pagina > 1) query.set(clave, String(pagina));
  const texto = query.toString();
  return texto ? `${ruta}?${texto}` : ruta;
}

/** «Del 26 al 50 de 120» para la página indicada. */
export function resumenPagina(pagina: number, total: number, porPagina = POR_PAGINA): string {
  const { desde } = rangoPagina(pagina, porPagina);
  const hasta = Math.min(desde + porPagina, total);
  return `Del ${desde + 1} al ${hasta} de ${total}`;
}
