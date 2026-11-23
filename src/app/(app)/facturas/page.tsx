import type { Metadata } from "next";
import { ReceiptIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PaginaFueraDeRango, Paginacion } from "@/components/ui/paginacion";
import { Table, type Column } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { hrefPagina, paginacion, parsePagina } from "@/lib/domain/paginacion";
import { leerPagina } from "@/lib/paginar";
import type { Factura } from "@/lib/types";

export const metadata: Metadata = { title: "Facturas" };

/** El cliente sale de la copia fija de la factura (0004), no de la ficha actual del cliente. */
type FacturaFila = Pick<Factura, "id" | "numero" | "fecha" | "cliente_nombre" | "cliente_nif" | "total_cents">;

const NOWRAP = "whitespace-nowrap";

const COLUMNAS: Column<FacturaFila>[] = [
  { key: "numero", header: "Número", primary: true, className: NOWRAP, cell: (f) => f.numero },
  { key: "fecha", header: "Fecha", className: NOWRAP, cell: (f) => formatFecha(f.fecha) },
  { key: "cliente", header: "Cliente", cell: (f) => f.cliente_nombre },
  {
    key: "nif",
    header: "NIF",
    hideOnMobile: true,
    className: `${NOWRAP} font-mono text-xs`,
    cell: (f) => f.cliente_nif ?? "—",
  },
  { key: "total", header: "Total", align: "right", className: NOWRAP, cell: (f) => formatEuros(f.total_cents) },
];

interface FacturasPageProps {
  searchParams: Promise<{ pagina?: string | string[] }>;
}

export default async function FacturasPage({ searchParams }: FacturasPageProps) {
  const paginaPedida = parsePagina((await searchParams).pagina);
  const { supabase } = await requireAdmin();

  const consulta = (head = false) =>
    supabase
      .from("facturas")
      .select("id, numero, fecha, cliente_nombre, cliente_nif, total_cents", { count: "exact", head })
      .order("fecha", { ascending: false })
      .order("numero", { ascending: false });
  const { filas, total, error } = await leerPagina(
    paginaPedida,
    (desde, hasta) => consulta().range(desde, hasta).overrideTypes<FacturaFila[], { merge: false }>(),
    () => consulta(true),
  );

  const estado = paginacion(paginaPedida, total);
  const href = (pagina: number) => hrefPagina("/facturas", {}, pagina);

  return (
    <>
      <PageHeader
        title="Facturas"
        description={error ? undefined : `${total} ${total === 1 ? "factura" : "facturas"}`}
      />

      {error ? (
        <Alert title="No se han podido cargar las facturas">{dbErrorMessage(error)}</Alert>
      ) : estado.fueraDeRango ? (
        <PaginaFueraDeRango estado={estado} href={href} />
      ) : filas.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon className="size-6" />}
          title="Todavía no hay facturas"
          description="Las facturas se crean desde un presupuesto aceptado por el cliente, con el botón «Convertir en factura»."
          action={<LinkButton href="/presupuestos?estado=aceptado">Ver presupuestos aceptados</LinkButton>}
        />
      ) : (
        <>
          <Table
            caption="Listado de facturas"
            columns={COLUMNAS}
            rows={filas}
            rowKey={(f) => f.id}
            rowHref={(f) => `/facturas/${f.id}`}
          />
          <Paginacion estado={estado} total={total} href={href} label="Páginas de facturas" />
        </>
      )}
    </>
  );
}
