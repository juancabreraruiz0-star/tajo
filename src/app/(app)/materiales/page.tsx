import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, BoxIcon, PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { formatQuantity } from "@/lib/domain/quantity";
import { filterLowStock, isLowStock } from "@/lib/domain/stock";
import type { Material } from "@/lib/types";

export const metadata: Metadata = { title: "Materiales" };

type MaterialFila = Pick<Material, "id" | "nombre" | "unidad" | "precio_cents" | "stock" | "stock_minimo">;

const COLUMNAS: Column<MaterialFila>[] = [
  {
    key: "nombre",
    header: "Material",
    primary: true,
    cell: (m) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        {m.nombre}
        {isLowStock(m) && <Badge tone="red">Stock bajo</Badge>}
      </span>
    ),
  },
  { key: "unidad", header: "Unidad", cell: (m) => m.unidad },
  { key: "precio", header: "Precio", align: "right", cell: (m) => formatEuros(m.precio_cents) },
  {
    key: "stock",
    header: "Stock",
    align: "right",
    cell: (m) => (
      <span className={cn(isLowStock(m) && "font-semibold text-red-700")}>{formatQuantity(m.stock)}</span>
    ),
  },
  { key: "minimo", header: "Stock mínimo", align: "right", cell: (m) => formatQuantity(m.stock_minimo) },
];

function filtroClases(activo: boolean) {
  return cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors",
    activo ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-100",
  );
}

interface MaterialesPageProps {
  searchParams: Promise<{ bajo?: string | string[] }>;
}

export default async function MaterialesPage({ searchParams }: MaterialesPageProps) {
  const soloBajo = (await searchParams).bajo === "1";
  const { supabase } = await getSessionProfile();

  const { data, error } = await supabase
    .from("materiales")
    .select("id, nombre, unidad, precio_cents, stock, stock_minimo")
    .order("nombre")
    .overrideTypes<MaterialFila[], { merge: false }>();

  // numeric puede llegar como texto: se normaliza para comparar y formatear.
  const materiales = (data ?? []).map((m) => ({ ...m, stock: Number(m.stock), stock_minimo: Number(m.stock_minimo) }));
  const bajos = filterLowStock(materiales);
  const filas = soloBajo ? bajos : materiales;

  const nuevo = (
    <LinkButton href="/materiales/nuevo" variant="primary">
      <PlusIcon className="size-4" />
      Nuevo material
    </LinkButton>
  );

  return (
    <>
      <PageHeader
        title="Materiales"
        description={
          error
            ? undefined
            : `${materiales.length} ${materiales.length === 1 ? "material" : "materiales"} en el almacén`
        }
        actions={nuevo}
      />

      {error ? (
        <Alert title="No se han podido cargar los materiales">{dbErrorMessage(error)}</Alert>
      ) : materiales.length === 0 ? (
        <EmptyState
          icon={<BoxIcon className="size-6" />}
          title="El almacén está vacío"
          description="Da de alta los materiales que usas (azulejo, cemento, tuberías…) para controlar su stock y usarlos en los presupuestos."
          action={nuevo}
        />
      ) : (
        <>
          <nav aria-label="Filtro de materiales" className="mb-5 flex flex-wrap gap-2">
            <Link href="/materiales" aria-current={soloBajo ? undefined : "page"} className={filtroClases(!soloBajo)}>
              Todos
            </Link>
            <Link
              href="/materiales?bajo=1"
              aria-current={soloBajo ? "page" : undefined}
              className={filtroClases(soloBajo)}
            >
              <AlertIcon className={cn("size-4", soloBajo ? "text-red-300" : "text-red-600")} />
              Solo stock bajo
              <span className={cn("tabular-nums", soloBajo ? "text-stone-300" : "text-stone-500")}>
                ({bajos.length})
              </span>
            </Link>
          </nav>

          {filas.length === 0 ? (
            <EmptyState
              icon={<BoxIcon className="size-6" />}
              title="Ningún material bajo mínimo"
              description="Todo el almacén está por encima del stock mínimo."
              action={<LinkButton href="/materiales">Ver todos</LinkButton>}
            />
          ) : (
            <Table
              caption="Materiales del almacén"
              columns={COLUMNAS}
              rows={filas}
              rowKey={(m) => m.id}
              rowHref={(m) => `/materiales/${m.id}/editar`}
              rowClassName={(m) => (isLowStock(m) ? "bg-red-50 hover:bg-red-100/70 border-red-200" : undefined)}
            />
          )}
        </>
      )}
    </>
  );
}
