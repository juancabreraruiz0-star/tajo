import type { PostgrestError } from "@supabase/supabase-js";
import { rangoPagina } from "@/lib/domain/paginacion";

interface RespuestaPagina<T> {
  data: T[] | null;
  error: PostgrestError | null;
  count: number | null;
}

interface RespuestaConteo {
  error: PostgrestError | null;
  count: number | null;
}

export interface PaginaLeida<T> {
  filas: T[];
  /** Total de filas del listado (con sus filtros), para la navegación. */
  total: number;
  error: PostgrestError | null;
}

/**
 * Lee una página de un listado con .range() y count: "exact".
 * Si la página está más allá de la última, PostgREST responde 416 (PGRST103) sin total: entonces se pide solo el
 * total (head) para poder enlazar a la última página. pagina = null (no válida) solo cuenta.
 */
export async function leerPagina<T>(
  pagina: number | null,
  leer: (desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  contar: () => PromiseLike<RespuestaConteo>,
): Promise<PaginaLeida<T>> {
  if (pagina !== null) {
    const { desde, hasta } = rangoPagina(pagina);
    const res = await leer(desde, hasta);
    if (!res.error || res.error.code !== "PGRST103") {
      return { filas: res.data ?? [], total: res.count ?? 0, error: res.error };
    }
  }
  const conteo = await contar();
  return { filas: [], total: conteo.count ?? 0, error: conteo.error };
}
