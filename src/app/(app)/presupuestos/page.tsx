import type { Metadata } from "next";
import Link from "next/link";
import { ESTADO_LABEL, EstadoBadge } from "@/components/estado-badge";
import { DocumentIcon, PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { parseEstadoFiltro, presupuestosHref } from "@/lib/domain/presupuestos";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto } from "@/lib/domain/status";
import { totalsByPresupuesto, type LineaDePresupuesto } from "@/lib/domain/totals";
import type { Presupuesto } from "@/lib/types";

export const metadata: Metadata = { title: "Presupuestos" };

type PresupuestoFila = Pick<
  Presupuesto,
  "id" | "numero" | "titulo" | "estado" | "iva_pct" | "created_at" | "cliente_id"
>;
type PresupuestoListado = PresupuestoFila & { cliente: string; totalCents: number };

const COLUMNAS: Column<PresupuestoListado>[] = [
  { key: "numero", header: "Número", primary: true, cell: (p) => p.numero },
  { key: "cliente", header: "Cliente", cell: (p) => p.cliente },
  { key: "titulo", header: "Título", cell: (p) => p.titulo },
  { key: "estado", header: "Estado", cell: (p) => <EstadoBadge estado={p.estado} /> },
  { key: "fecha", header: "Fecha", hideOnMobile: true, cell: (p) => formatFecha(p.created_at) },
  { key: "total", header: "Total", align: "right", cell: (p) => formatEuros(p.totalCents) },
];

const FILTROS: readonly (EstadoPresupuesto | null)[] = [null, ...ESTADOS_PRESUPUESTO];

function filtroClases(activo: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors",
    activo ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-100",
  );
}

interface PresupuestosPageProps {
  searchParams: Promise<{ estado?: string | string[] }>;
}

export default async function PresupuestosPage({ searchParams }: PresupuestosPageProps) {
  const filtro = parseEstadoFiltro((await searchParams).estado);
  const { supabase } = await getSessionProfile();

  let query = supabase
    .from("presupuestos")
    .select("id, numero, titulo, estado, iva_pct, created_at, cliente_id")
    .order("created_at", { ascending: false });
  if (filtro) query = query.eq("estado", filtro);
  const { data, error } = await query.overrideTypes<PresupuestoFila[], { merge: false }>();
  const presupuestos = data ?? [];

  let errorDetalle: string | null = null;
  let lineas: LineaDePresupuesto[] = [];
  const nombres = new Map<string, string>();
  if (presupuestos.length > 0) {
    const [lineasRes, clientesRes] = await Promise.all([
      supabase
        .from("presupuesto_lineas")
        .select("presupuesto_id, cantidad, precio_cents")
        .in(
          "presupuesto_id",
          presupuestos.map((p) => p.id),
        )
        .overrideTypes<LineaDePresupuesto[], { merge: false }>(),
      supabase
        .from("clientes")
        .select("id, nombre")
        .in("id", [...new Set(presupuestos.map((p) => p.cliente_id))])
        .overrideTypes<{ id: string; nombre: string }[], { merge: false }>(),
    ]);
    if (lineasRes.error) errorDetalle = dbErrorMessage(lineasRes.error);
    if (clientesRes.error) errorDetalle = dbErrorMessage(clientesRes.error);
    lineas = lineasRes.data ?? [];
    for (const c of clientesRes.data ?? []) nombres.set(c.id, c.nombre);
  }

  const totales = totalsByPresupuesto(presupuestos, lineas);
  const filas: PresupuestoListado[] = presupuestos.map((p) => ({
    ...p,
    cliente: nombres.get(p.cliente_id) ?? "—",
    totalCents: totales.get(p.id)?.totalCents ?? 0,
  }));

  const nuevo = (
    <LinkButton href="/presupuestos/nuevo" variant="primary">
      <PlusIcon className="size-4" />
      Nuevo presupuesto
    </LinkButton>
  );

  const resumen = filtro
    ? `${filas.length} ${filas.length === 1 ? "presupuesto" : "presupuestos"} en «${ESTADO_LABEL[filtro]}»`
    : `${filas.length} ${filas.length === 1 ? "presupuesto" : "presupuestos"}`;

  return (
    <>
      <PageHeader title="Presupuestos" description={error ? undefined : resumen} actions={nuevo} />

      <nav aria-label="Filtrar por estado" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2 pb-1">
          {FILTROS.map((estado) => {
            const activo = estado === filtro;
            return (
              <li key={estado ?? "todos"}>
                <Link
                  href={presupuestosHref(estado)}
                  aria-current={activo ? "page" : undefined}
                  className={filtroClases(activo)}
                >
                  {estado ? ESTADO_LABEL[estado] : "Todos"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {error ? (
        <Alert title="No se han podido cargar los presupuestos">{dbErrorMessage(error)}</Alert>
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
            description="Crea el primero: elige el cliente, añade las partidas y envíale el enlace para que lo acepte."
            action={nuevo}
          />
        )
      ) : (
        <>
          {errorDetalle && (
            <Alert tone="warning" title="Faltan datos del listado" className="mb-4">
              {errorDetalle} Los totales o los nombres de cliente pueden no estar completos.
            </Alert>
          )}
          <Table
            caption={filtro ? `Presupuestos en estado ${ESTADO_LABEL[filtro]}` : "Listado de presupuestos"}
            columns={COLUMNAS}
            rows={filas}
            rowKey={(p) => p.id}
            rowHref={(p) => `/presupuestos/${p.id}`}
          />
        </>
      )}
    </>
  );
}
