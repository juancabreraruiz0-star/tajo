import type { Metadata } from "next";
import { ReceiptIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import type { Factura } from "@/lib/types";

export const metadata: Metadata = { title: "Facturas" };

type FacturaFila = Pick<Factura, "id" | "numero" | "fecha" | "cliente_id" | "presupuesto_id" | "total_cents">;
type FacturaListado = FacturaFila & { cliente: string; presupuesto: string };

const COLUMNAS: Column<FacturaListado>[] = [
  { key: "numero", header: "Número", primary: true, cell: (f) => f.numero },
  { key: "fecha", header: "Fecha", cell: (f) => formatFecha(f.fecha) },
  { key: "cliente", header: "Cliente", cell: (f) => f.cliente },
  { key: "presupuesto", header: "Presupuesto", hideOnMobile: true, cell: (f) => f.presupuesto },
  { key: "total", header: "Total", align: "right", cell: (f) => formatEuros(f.total_cents) },
];

export default async function FacturasPage() {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("facturas")
    .select("id, numero, fecha, cliente_id, presupuesto_id, total_cents")
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false })
    .overrideTypes<FacturaFila[], { merge: false }>();
  const facturas = data ?? [];

  let errorDetalle: string | null = null;
  const clientes = new Map<string, string>();
  const presupuestos = new Map<string, string>();
  if (facturas.length > 0) {
    const [clientesRes, presupuestosRes] = await Promise.all([
      supabase
        .from("clientes")
        .select("id, nombre")
        .in("id", [...new Set(facturas.map((f) => f.cliente_id))])
        .overrideTypes<{ id: string; nombre: string }[], { merge: false }>(),
      supabase
        .from("presupuestos")
        .select("id, numero")
        .in(
          "id",
          facturas.map((f) => f.presupuesto_id),
        )
        .overrideTypes<{ id: string; numero: string }[], { merge: false }>(),
    ]);
    if (clientesRes.error) errorDetalle = dbErrorMessage(clientesRes.error);
    if (presupuestosRes.error) errorDetalle = dbErrorMessage(presupuestosRes.error);
    for (const c of clientesRes.data ?? []) clientes.set(c.id, c.nombre);
    for (const p of presupuestosRes.data ?? []) presupuestos.set(p.id, p.numero);
  }

  const filas: FacturaListado[] = facturas.map((f) => ({
    ...f,
    cliente: clientes.get(f.cliente_id) ?? "—",
    presupuesto: presupuestos.get(f.presupuesto_id) ?? "—",
  }));

  return (
    <>
      <PageHeader
        title="Facturas"
        description={error ? undefined : `${filas.length} ${filas.length === 1 ? "factura" : "facturas"}`}
      />

      {error ? (
        <Alert title="No se han podido cargar las facturas">{dbErrorMessage(error)}</Alert>
      ) : filas.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon className="size-6" />}
          title="Todavía no hay facturas"
          description="Las facturas se crean desde un presupuesto aceptado por el cliente, con el botón «Convertir en factura»."
          action={<LinkButton href="/presupuestos?estado=aceptado">Ver presupuestos aceptados</LinkButton>}
        />
      ) : (
        <>
          {errorDetalle && (
            <Alert tone="warning" title="Faltan datos del listado" className="mb-4">
              {errorDetalle} Los nombres de cliente o los números de presupuesto pueden no estar completos.
            </Alert>
          )}
          <Table
            caption="Listado de facturas"
            columns={COLUMNAS}
            rows={filas}
            rowKey={(f) => f.id}
            rowHref={(f) => `/facturas/${f.id}`}
          />
        </>
      )}
    </>
  );
}
