export const MAX_BUSQUEDA = 100;

/**
 * Texto de búsqueda de la URL (?q=): sin asteriscos, recortado, espacios internos colapsados y con longitud máxima.
 * El «*» se quita porque PostgREST lo trata como comodín en ilike: buscar «*» devolvería todo.
 */
export function normalizeSearch(valor: string | string[] | undefined): string {
  const texto = Array.isArray(valor) ? (valor[0] ?? "") : (valor ?? "");
  return texto.replace(/\*/g, "").trim().replace(/\s+/g, " ").slice(0, MAX_BUSQUEDA);
}

/** Patrón ILIKE «contiene» con los comodines del usuario escapados: "50%" → "%50\%%". */
export function toIlikeContains(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
