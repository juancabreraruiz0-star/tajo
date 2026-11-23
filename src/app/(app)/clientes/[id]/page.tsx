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
import { PaginaFueraDeRango, Paginacion } from "@/components/ui/paginacion";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { hrefPagina, paginacion, parsePagina } from "@/lib/domain/paginacion";
import { isUuid } from "@/lib/domain/validation";
import { leerPagina } from "@/lib/paginar";
import type { Cliente, Factura, PresupuestoConTotales } from "@/lib/types";

export const metadata: Metadata = { title: "Cliente" };

type PresupuestoFila = Pick<PresupuestoConTotales, "id" | "numero" | "titulo" | "estado" | "created_at" | "total_cents">;
type FacturaFila = Pick<Factura, "id" | "numero" | "fecha" | "total_cents">;

const NOWRAP = "whitespace-nowrap";

const COLUMNAS_PRESUPUESTOS: Column<PresupuestoFila>[] = [
  { key: "numero", header: "Número", primary: true, className: NOWRAP, cell: (p) => p.numero },
  { key: "titulo", header: "Título", cell: (p) => p.titulo },
  { key: "estado", header: "Estado", cell: (p) => <EstadoBadge estado={p.estado} /> },
  { key: "fecha", header: "Fecha", hideOnMobile: true, className: NOWRAP, cell: (p) => formatFecha(p.created_at) },
  { key: "total", header: "Total", align: "right", className: NOWRAP, cell: (p) => formatEuros(p.total_cents) },
];

const COLUMNAS_FACTURAS: Column<FacturaFila>[] = [
  { key: "numero", header: "Número", primary: true, className: NOWRAP, cell: (f) => f.numero },
  { key: "fecha", header: "Fecha", className: NOWRAP, cell: (f) => formatFecha(f.fecha) },
  { key: "total", header: "Total", align: "right", className: NOWRAP, cell: (f) => formatEuros(f.total_cents) },
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

type Param = string | string[] | undefined;

function primero(valor: Param): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

interface ClientePageProps {
  params: Promise<{ id: string }>;
  /** pagina: historial de presupuestos; pagina_facturas: historial de facturas (cada uno pagina por su cuenta). */
  searchParams: Promise<{ pagina?: Param; pagina_facturas?: Param }>;
}

export default async function ClientePage({ params, searchParams }: ClientePageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const paginaPresupuestos = parsePagina(query.pagina);
  const paginaFacturas = parsePagina(query.pagina_facturas);

  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);

  // Totales calculados en SQL por la vista presupuestos_con_totales (0004): no se traen las partidas.
  const consultaPresupuestos = (head = false) =>
    supabase
      .from("presupuestos_con_totales")
      .select("id, numero, titulo, estado, created_at, total_cents", { count: "exact", head })
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })
      .order("id");
  const consultaFacturas = (head = false) =>
    supabase
      .from("facturas")
      .select("id, numero, fecha, total_cents", { count: "exact", head })
      .eq("cliente_id", id)
      .order("fecha", { ascending: false })
      .order("numero", { ascending: false });

  const [clienteRes, presupuestosRes, facturasRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, empresa_id, nombre, nif, telefono, email, direccion, notas, created_at")
      .eq("id", id)
      .maybeSingle<Cliente>(),
    leerPagina(
      paginaPresupuestos,
      (desde, hasta) =>
        consultaPresupuestos().range(desde, hasta).overrideTypes<PresupuestoFila[], { merge: false }>(),
      () => consultaPresupuestos(true),
    ),
    // Las facturas solo se consultan para admin (R2).
    admin
      ? leerPagina(
          paginaFacturas,
          (desde, hasta) => consultaFacturas().range(desde, hasta).overrideTypes<FacturaFila[], { merge: false }>(),
          () => consultaFacturas(true),
        )
      : null,
  ]);

  if (clienteRes.error) {
    return <Alert title="No se ha podido cargar el cliente">{dbErrorMessage(clienteRes.error)}</Alert>;
  }
  const cliente = clienteRes.data;
  if (!cliente) notFound();

  const presupuestos = presupuestosRes.filas;
  const estadoPresupuestos = paginacion(paginaPresupuestos, presupuestosRes.total);
  const hrefPresupuestos = (pagina: number) =>
    `${hrefPagina(`/clientes/${id}`, { pagina_facturas: primero(query.pagina_facturas) }, pagina)}#presupuestos-titulo`;

  const estadoFacturas = facturasRes ? paginacion(paginaFacturas, facturasRes.total) : null;
  const hrefFacturas = (pagina: number) =>
    `${hrefPagina(`/clientes/${id}`, { pagina: primero(query.pagina) }, pagina, "pagina_facturas")}#facturas-titulo`;

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
          <Dato label="NIF">
            {cliente.nif ? (
              <span className="font-mono">{cliente.nif}</span>
            ) : (
              <span className="text-stone-400">Sin indicar (hace falta para facturar)</span>
            )}
          </Dato>
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
        <h2 id="presupuestos-titulo" className="mb-3 scroll-mt-20 text-lg font-semibold text-stone-900">
          Presupuestos
        </h2>
        {presupuestosRes.error ? (
          <Alert title="No se han podido cargar los presupuestos">{dbErrorMessage(presupuestosRes.error)}</Alert>
        ) : estadoPresupuestos.fueraDeRango ? (
          <PaginaFueraDeRango estado={estadoPresupuestos} href={hrefPresupuestos} />
        ) : presupuestos.length === 0 ? (
          <EmptyState
            icon={<DocumentIcon className="size-6" />}
            title="Sin presupuestos todavía"
            description="Cuando prepares un presupuesto para este cliente, aparecerá aquí con su estado y su total."
          />
        ) : (
          <>
            <Table
              caption={`Presupuestos de ${cliente.nombre}`}
              columns={COLUMNAS_PRESUPUESTOS}
              rows={presupuestos}
              rowKey={(p) => p.id}
              rowHref={(p) => `/presupuestos/${p.id}`}
            />
            <Paginacion
              estado={estadoPresupuestos}
              total={presupuestosRes.total}
              href={hrefPresupuestos}
              label={`Páginas de presupuestos de ${cliente.nombre}`}
            />
          </>
        )}
      </section>

      {facturasRes && estadoFacturas && (
        <section aria-labelledby="facturas-titulo">
          <h2 id="facturas-titulo" className="mb-3 scroll-mt-20 text-lg font-semibold text-stone-900">
            Facturas
          </h2>
          {facturasRes.error ? (
            <Alert title="No se han podido cargar las facturas">{dbErrorMessage(facturasRes.error)}</Alert>
          ) : estadoFacturas.fueraDeRango ? (
            <PaginaFueraDeRango estado={estadoFacturas} href={hrefFacturas} />
          ) : facturasRes.filas.length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon className="size-6" />}
              title="Sin facturas todavía"
              description="Las facturas se crean desde un presupuesto aceptado."
            />
          ) : (
            <>
              <Table
                caption={`Facturas de ${cliente.nombre}`}
                columns={COLUMNAS_FACTURAS}
                rows={facturasRes.filas}
                rowKey={(f) => f.id}
                rowHref={(f) => `/facturas/${f.id}`}
              />
              <Paginacion
                estado={estadoFacturas}
                total={facturasRes.total}
                href={hrefFacturas}
                label={`Páginas de facturas de ${cliente.nombre}`}
              />
            </>
          )}
        </section>
      )}
    </>
  );
}
