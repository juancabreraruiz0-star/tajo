import type { Metadata } from "next";
import Link from "next/link";
import { ESTADO_LABEL, EstadoBadge } from "@/components/estado-badge";
import { DocumentIcon, PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PaginaFueraDeRango, Paginacion } from "@/components/ui/paginacion";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { hrefPagina, paginacion, parsePagina } from "@/lib/domain/paginacion";
import { parseEstadoFiltro, presupuestosHref } from "@/lib/domain/presupuestos";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto } from "@/lib/domain/status";
import { leerPagina } from "@/lib/paginar";
import type { PresupuestoConTotales } from "@/lib/types";

export const metadata: Metadata = { title: "Presupuestos" };

type PresupuestoFila = Pick<
  PresupuestoConTotales,
  "id" | "numero" | "titulo" | "estado" | "created_at" | "cliente_nombre" | "total_cents"
>;

/** Totales calculados en SQL por la vista presupuestos_con_totales (0004): no se traen las partidas. */
const COLUMNAS_SELECT = "id, numero, titulo, estado, created_at, cliente_nombre, total_cents";

const COLUMNAS: Column<PresupuestoFila>[] = [
  { key: "numero", header: "Número", primary: true, className: "whitespace-nowrap tabular-nums", cell: (p) => p.numero },
  { key: "cliente", header: "Cliente", cell: (p) => p.cliente_nombre },
  { key: "titulo", header: "Título", cell: (p) => p.titulo },
  { key: "estado", header: "Estado", cell: (p) => <EstadoBadge estado={p.estado} /> },
  {
    key: "fecha",
    header: "Fecha",
    hideOnMobile: true,
    className: "whitespace-nowrap tabular-nums",
    cell: (p) => formatFecha(p.created_at),
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    className: "whitespace-nowrap",
    cell: (p) => <span className="font-medium text-stone-900">{formatEuros(p.total_cents)}</span>,
  },
];

const FILTROS: readonly (EstadoPresupuesto | null)[] = [null, ...ESTADOS_PRESUPUESTO];

function filtroClases(activo: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset transition-colors duration-150",
    activo
      ? "bg-slate-900 text-white ring-slate-900"
      : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50 hover:ring-stone-400",
  );
}

// Punto de color de cada estado en los filtros (mismos colores que las insignias, D6).
const PUNTO_ESTADO: Record<EstadoPresupuesto, string> = {
  borrador: "bg-stone-400",
  enviado: "bg-blue-500",
  aceptado: "bg-green-500",
  rechazado: "bg-red-500",
  facturado: "bg-violet-500",
};

interface PresupuestosPageProps {
  searchParams: Promise<{ estado?: string | string[]; pagina?: string | string[] }>;
}

export default async function PresupuestosPage({ searchParams }: PresupuestosPageProps) {
  const params = await searchParams;
  const filtro = parseEstadoFiltro(params.estado);
  const paginaPedida = parsePagina(params.pagina);
  const { supabase } = await getSessionProfile();

  const consulta = (head = false) => {
    let query = supabase.from("presupuestos_con_totales").select(COLUMNAS_SELECT, { count: "exact", head });
    if (filtro) query = query.eq("estado", filtro);
    // id como desempate: el orden es estable entre páginas.
    return query.order("created_at", { ascending: false }).order("id");
  };
  const { filas, total, error } = await leerPagina(
    paginaPedida,
    (desde, hasta) => consulta().range(desde, hasta).overrideTypes<PresupuestoFila[], { merge: false }>(),
    () => consulta(true),
  );

  const estado = paginacion(paginaPedida, total);
  const href = (pagina: number) => hrefPagina("/presupuestos", { estado: filtro }, pagina);

  const nuevo = (
    <LinkButton href="/presupuestos/nuevo" variant="primary">
      <PlusIcon className="size-4" />
      Nuevo presupuesto
    </LinkButton>
  );

  const resumen = filtro
    ? `${total} ${total === 1 ? "presupuesto" : "presupuestos"} en «${ESTADO_LABEL[filtro]}»`
    : `${total} ${total === 1 ? "presupuesto" : "presupuestos"}`;

  return (
    <>
      <PageHeader title="Presupuestos" description={error ? undefined : resumen} actions={nuevo} />

      <nav aria-label="Filtrar por estado" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2 pb-1">
          {FILTROS.map((estadoFiltro) => {
            const activo = estadoFiltro === filtro;
            return (
              <li key={estadoFiltro ?? "todos"}>
                <Link
                  href={presupuestosHref(estadoFiltro)}
                  aria-current={activo ? "page" : undefined}
                  className={filtroClases(activo)}
                >
                  {estadoFiltro && (
                    <span aria-hidden="true" className={cn("size-2 rounded-full", PUNTO_ESTADO[estadoFiltro])} />
                  )}
                  {estadoFiltro ? ESTADO_LABEL[estadoFiltro] : "Todos"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {error ? (
        <Alert title="No se han podido cargar los presupuestos">{dbErrorMessage(error)}</Alert>
      ) : estado.fueraDeRango ? (
        <PaginaFueraDeRango estado={estado} href={href} />
      ) : filas.length === 0 ? (
        filtro ? (
          <EmptyState
            icon={<DocumentIcon className="size-6" />}
            title={`No hay presupuestos en «${ESTADO_LABEL[filtro]}»`}
            description="Prueba con otro estado o mira todos los presupuestos."
            action={<LinkButton href="/presupuestos">Ver todos</LinkButton>}
          />
        ) : (
          <EmptyState
            icon={<DocumentIcon className="size-6" />}
            title="Todavía no hay presupuestos"
            description="Elige el cliente, añade las partidas y envíale el enlace para que lo acepte desde el móvil."
            action={
              <LinkButton href="/presupuestos/nuevo" variant="primary">
                <PlusIcon className="size-4" />
                Crear el primer presupuesto
              </LinkButton>
            }
          />
        )
      ) : (
        <>
          <Table
            caption={filtro ? `Presupuestos en estado ${ESTADO_LABEL[filtro]}` : "Listado de presupuestos"}
            columns={COLUMNAS}
            rows={filas}
            rowKey={(p) => p.id}
            rowHref={(p) => `/presupuestos/${p.id}`}
          />
          <Paginacion estado={estado} total={total} href={href} label="Páginas de presupuestos" />
        </>
      )}
    </>
  );
}
