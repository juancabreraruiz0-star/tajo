import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EstadoBadge } from "@/components/estado-badge";
import { DocumentIcon, PencilIcon, ReceiptIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { totalsByPresupuesto, type LineaDePresupuesto } from "@/lib/domain/totals";
import { isUuid } from "@/lib/domain/validation";
import type { Cliente, Factura, Presupuesto } from "@/lib/types";

export const metadata: Metadata = { title: "Cliente" };

type PresupuestoFila = Pick<Presupuesto, "id" | "numero" | "titulo" | "estado" | "iva_pct" | "created_at">;
type PresupuestoConTotal = PresupuestoFila & { totalCents: number };
type FacturaFila = Pick<Factura, "id" | "numero" | "fecha" | "total_cents">;

const COLUMNAS_PRESUPUESTOS: Column<PresupuestoConTotal>[] = [
  { key: "numero", header: "Número", primary: true, cell: (p) => p.numero },
  { key: "titulo", header: "Título", cell: (p) => p.titulo },
  { key: "estado", header: "Estado", cell: (p) => <EstadoBadge estado={p.estado} /> },
  { key: "fecha", header: "Fecha", hideOnMobile: true, cell: (p) => formatFecha(p.created_at) },
  { key: "total", header: "Total", align: "right", cell: (p) => formatEuros(p.totalCents) },
];

const COLUMNAS_FACTURAS: Column<FacturaFila>[] = [
  { key: "numero", header: "Número", primary: true, cell: (f) => f.numero },
  { key: "fecha", header: "Fecha", cell: (f) => formatFecha(f.fecha) },
  { key: "total", header: "Total", align: "right", cell: (f) => formatEuros(f.total_cents) },
];

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words text-stone-900">{children}</dd>
    </div>
  );
}

const vacio = <span className="text-stone-400">Sin indicar</span>;

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);

  const [clienteRes, presupuestosRes, facturasRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, empresa_id, nombre, telefono, email, direccion, notas, created_at")
      .eq("id", id)
      .maybeSingle<Cliente>(),
    supabase
      .from("presupuestos")
      .select("id, numero, titulo, estado, iva_pct, created_at")
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })
      .overrideTypes<PresupuestoFila[], { merge: false }>(),
    // Las facturas solo se consultan para admin (R2).
    admin
      ? supabase
          .from("facturas")
          .select("id, numero, fecha, total_cents")
          .eq("cliente_id", id)
          .order("fecha", { ascending: false })
          .order("numero", { ascending: false })
          .overrideTypes<FacturaFila[], { merge: false }>()
      : null,
  ]);

  if (clienteRes.error) {
    return <Alert title="No se ha podido cargar el cliente">{dbErrorMessage(clienteRes.error)}</Alert>;
  }
  const cliente = clienteRes.data;
  if (!cliente) notFound();

  const presupuestos = presupuestosRes.data ?? [];
  let lineasError: string | null = null;
  let lineas: LineaDePresupuesto[] = [];
  if (presupuestos.length > 0) {
    const { data, error } = await supabase
      .from("presupuesto_lineas")
      .select("presupuesto_id, cantidad, precio_cents")
      .in(
        "presupuesto_id",
        presupuestos.map((p) => p.id),
      )
      .overrideTypes<LineaDePresupuesto[], { merge: false }>();
    if (error) lineasError = dbErrorMessage(error);
    lineas = data ?? [];
  }
  const totales = totalsByPresupuesto(presupuestos, lineas);
  const filas: PresupuestoConTotal[] = presupuestos.map((p) => ({
    ...p,
    totalCents: totales.get(p.id)?.totalCents ?? 0,
  }));

  const presupuestosError = presupuestosRes.error ? dbErrorMessage(presupuestosRes.error) : lineasError;

  return (
    <>
      <PageHeader
        title={cliente.nombre}
        description={`Cliente desde el ${formatFecha(cliente.created_at)}`}
        back={{ href: "/clientes", label: "Clientes" }}
        actions={
          <>
            <LinkButton href={`/clientes/${id}/editar`}>
              <PencilIcon className="size-4" />
              Editar
            </LinkButton>
            <LinkButton href={`/presupuestos/nuevo?cliente=${id}`} variant="primary">
              Nuevo presupuesto
            </LinkButton>
          </>
        }
      />

      <Card className="mb-8 p-4 sm:p-6">
        <dl className="grid gap-5 sm:grid-cols-2">
          <Dato label="Teléfono">
            {cliente.telefono ? (
              <a href={`tel:${cliente.telefono.replace(/[^\d+]/g, "")}`} className="text-amber-700 hover:underline">
                {cliente.telefono}
              </a>
            ) : (
              vacio
            )}
          </Dato>
          <Dato label="Email">
            {cliente.email ? (
              <a href={`mailto:${cliente.email}`} className="text-amber-700 hover:underline">
                {cliente.email}
              </a>
            ) : (
              vacio
            )}
          </Dato>
          <Dato label="Dirección">{cliente.direccion ?? vacio}</Dato>
          <Dato label="Notas">
            {cliente.notas ? <span className="whitespace-pre-line">{cliente.notas}</span> : vacio}
          </Dato>
        </dl>
      </Card>

      <section aria-labelledby="presupuestos-titulo" className="mb-8">
        <h2 id="presupuestos-titulo" className="mb-3 text-lg font-semibold text-stone-900">
          Presupuestos
        </h2>
        {presupuestosError ? (
          <Alert title="No se han podido cargar los presupuestos">{presupuestosError}</Alert>
        ) : filas.length === 0 ? (
          <EmptyState
            icon={<DocumentIcon className="size-6" />}
            title="Sin presupuestos todavía"
            description="Cuando prepares un presupuesto para este cliente, aparecerá aquí con su estado y su total."
          />
        ) : (
          <Table
            caption={`Presupuestos de ${cliente.nombre}`}
            columns={COLUMNAS_PRESUPUESTOS}
            rows={filas}
            rowKey={(p) => p.id}
            rowHref={(p) => `/presupuestos/${p.id}`}
          />
        )}
      </section>

      {facturasRes && (
        <section aria-labelledby="facturas-titulo">
          <h2 id="facturas-titulo" className="mb-3 text-lg font-semibold text-stone-900">
            Facturas
          </h2>
          {facturasRes.error ? (
            <Alert title="No se han podido cargar las facturas">{dbErrorMessage(facturasRes.error)}</Alert>
          ) : (facturasRes.data ?? []).length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon className="size-6" />}
              title="Sin facturas todavía"
              description="Las facturas se crean desde un presupuesto aceptado."
            />
          ) : (
            <Table
              caption={`Facturas de ${cliente.nombre}`}
              columns={COLUMNAS_FACTURAS}
              rows={facturasRes.data ?? []}
              rowKey={(f) => f.id}
              rowHref={(f) => `/facturas/${f.id}`}
            />
          )}
        </section>
      )}
    </>
  );
}
