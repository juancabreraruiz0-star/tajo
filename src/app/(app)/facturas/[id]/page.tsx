import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Link from "next/link";
import { ArrowLeftIcon, DocumentIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { importesCuadranConBase } from "@/lib/domain/facturacion";
import { formatEuros } from "@/lib/domain/money";
import { formatQuantity } from "@/lib/domain/quantity";
import { isUuid } from "@/lib/domain/validation";
import type { Factura, FacturaLinea, Presupuesto } from "@/lib/types";
import { DescargarPdf } from "./imprimir";

type PresupuestoFactura = Pick<Presupuesto, "id" | "numero" | "titulo">;
type LineaFila = Pick<FacturaLinea, "id" | "orden" | "descripcion" | "unidad" | "cantidad" | "precio_cents" | "importe_cents">;

/**
 * La factura (solo admin) con su copia fija de cliente, empresa e IVA (0004). Compartida por la página y los
 * metadatos: una sola consulta por petición.
 */
const cargarFactura = cache(async (id: string) => {
  const { supabase } = await requireAdmin();
  return supabase
    .from("facturas")
    .select(
      "id, empresa_id, presupuesto_id, cliente_id, numero, fecha, base_cents, iva_cents, total_cents, " +
        "cliente_nombre, cliente_nif, cliente_direccion, empresa_nombre, empresa_cif, empresa_direccion, iva_pct",
    )
    .eq("id", id)
    .maybeSingle<Factura>();
});

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Factura" };
  const { data } = await cargarFactura(id);
  // El título es el nombre que el navegador propone al guardar el PDF.
  return { title: data ? `Factura ${data.numero}` : "Factura" };
}

const sinDato = <span className="text-stone-500">—</span>;

/**
 * Factura emitida. Se pinta solo con la copia que se guardó al facturar (facturas + factura_lineas): si después
 * cambian el cliente, la empresa o los materiales, la factura sigue igual. Del presupuesto solo se leen número y
 * título, que no cambian una vez enviado.
 */
export default async function FacturaPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { supabase } = await requireAdmin();
  const facturaRes = await cargarFactura(id);
  if (facturaRes.error) {
    return <Alert title="No se ha podido cargar la factura">{dbErrorMessage(facturaRes.error)}</Alert>;
  }
  const factura = facturaRes.data;
  if (!factura) notFound();

  const [presupuestoRes, lineasRes] = await Promise.all([
    supabase
      .from("presupuestos")
      .select("id, numero, titulo")
      .eq("id", factura.presupuesto_id)
      .maybeSingle<PresupuestoFactura>(),
    supabase
      .from("factura_lineas")
      .select("id, orden, descripcion, unidad, cantidad, precio_cents, importe_cents")
      .eq("factura_id", factura.id)
      .order("orden")
      .overrideTypes<LineaFila[], { merge: false }>(),
  ]);

  // numeric de Postgres puede llegar como texto.
  const lineas = (lineasRes.data ?? []).map((l) => ({ ...l, cantidad: Number(l.cantidad) }));
  const presupuesto = presupuestoRes.data;
  const errorCarga = presupuestoRes.error ?? lineasRes.error;
  // Se suman los importes guardados en factura_lineas (copia fija), sin recalcular cantidad × precio.
  const cuadra = !lineasRes.error && importesCuadranConBase(lineas, factura.base_cents);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/facturas"
          className="group -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-stone-500 transition-colors hover:text-stone-900"
        >
          <ArrowLeftIcon className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
          Facturas
        </Link>
        <div className="flex flex-wrap gap-2">
          {presupuesto && (
            <LinkButton href={`/presupuestos/${presupuesto.id}`}>
              <DocumentIcon className="size-4" />
              Ver presupuesto
            </LinkButton>
          )}
          <DescargarPdf />
        </div>
      </div>

      {errorCarga && (
        <Alert tone="warning" title="Faltan datos de la factura" className="mb-4 print:hidden">
          {dbErrorMessage(errorCarga)}
        </Alert>
      )}
      {!errorCarga && !cuadra && (
        <Alert tone="warning" className="mb-4 print:hidden">
          La suma de los importes de las partidas no coincide con la base imponible guardada en la factura. Base, IVA y
          total son los importes con los que se emitió.
        </Alert>
      )}

      <article
        aria-labelledby="factura-titulo"
        className="mx-auto max-w-[52rem] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-elevada print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
      >
        <div className="h-1 bg-amber-500" aria-hidden="true" />

        <div className="px-5 py-7 sm:px-12 sm:py-10 print:px-0 print:py-0">
          {/* Emisor y número */}
          <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between">
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-tight text-stone-950">{factura.empresa_nombre}</p>
              <address className="mt-1.5 space-y-0.5 text-sm text-stone-600 not-italic">
                <p>CIF {factura.empresa_cif ?? "—"}</p>
                {factura.empresa_direccion && <p>{factura.empresa_direccion}</p>}
              </address>
            </div>
            <h1 id="factura-titulo" className="shrink-0 sm:text-right print:text-right">
              <span className="block text-3xl font-semibold tracking-tight text-stone-950">Factura</span>
              <span className="mt-1 block text-base font-medium whitespace-nowrap text-stone-600 tabular-nums">
                {factura.numero}
              </span>
            </h1>
          </header>

          {/* Datos de la factura */}
          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 text-sm sm:grid-cols-3 print:grid-cols-3">
            <div className="bg-stone-50 px-4 py-3">
              <dt className="text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">Fecha de emisión</dt>
              <dd className="mt-0.5 font-medium text-stone-900 tabular-nums">{formatFecha(factura.fecha)}</dd>
            </div>
            <div className="bg-stone-50 px-4 py-3">
              <dt className="text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">Presupuesto</dt>
              <dd className="mt-0.5 font-medium whitespace-nowrap text-stone-900 tabular-nums">
                {presupuesto?.numero ?? sinDato}
              </dd>
            </div>
            <div className="col-span-2 bg-stone-50 px-4 py-3 sm:col-span-1 print:col-span-1">
              <dt className="text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">Forma de pago</dt>
              <dd className="mt-0.5 font-medium text-stone-900">Transferencia bancaria</dd>
            </div>
          </dl>

          {/* Cliente y concepto */}
          <section aria-label="Cliente y concepto" className="mt-8 grid gap-6 sm:grid-cols-2 print:grid-cols-2">
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">Facturar a</p>
              <p className="mt-1 text-base font-semibold text-stone-950">{factura.cliente_nombre}</p>
              <address className="mt-1 space-y-0.5 text-sm text-stone-600 not-italic">
                <p>NIF {factura.cliente_nif ?? sinDato}</p>
                {factura.cliente_direccion && <p>{factura.cliente_direccion}</p>}
              </address>
            </div>
            {presupuesto && (
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">Concepto</p>
                <p className="mt-1 text-sm font-medium text-pretty text-stone-900">{presupuesto.titulo}</p>
                <p className="mt-0.5 text-sm text-stone-600">Según presupuesto {presupuesto.numero}</p>
              </div>
            )}
          </section>

          {/* Partidas */}
          <section aria-label="Partidas" className="mt-8">
            {lineas.length === 0 ? (
              <p className="text-sm text-stone-500">No se han encontrado las partidas de esta factura.</p>
            ) : (
              <>
                {/* Móvil: lista (en papel se usa siempre la tabla) */}
                <ol className="divide-y divide-stone-200 border-y border-stone-200 sm:hidden print:hidden">
                  {lineas.map((l) => (
                    <li key={l.id} className="py-3">
                      <p className="text-sm font-medium text-stone-900">{l.descripcion}</p>
                      <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-stone-500 tabular-nums">
                          {formatQuantity(l.cantidad)}
                          {l.unidad ? ` ${l.unidad}` : ""} × {formatEuros(l.precio_cents)}
                        </span>
                        <span className="font-semibold text-stone-900 tabular-nums">{formatEuros(l.importe_cents)}</span>
                      </div>
                    </li>
                  ))}
                </ol>

                <table className="hidden w-full text-left text-sm sm:table print:table">
                  <caption className="sr-only">Partidas de la factura {factura.numero}</caption>
                  <thead>
                    <tr className="border-y border-stone-300 bg-stone-50 text-[0.6875rem] font-semibold tracking-wider text-stone-600 uppercase">
                      <th scope="col" className="w-10 py-2.5 pl-3 text-left">
                        <span className="sr-only">Número de partida</span>
                        <span aria-hidden="true">#</span>
                      </th>
                      <th scope="col" className="py-2.5 pr-4">
                        Descripción
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right">
                        Cantidad
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right">
                        Precio
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right">
                        Importe
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {lineas.map((l, i) => (
                      <tr key={l.id} className="break-inside-avoid">
                        <td className="py-3 pl-3 align-top text-xs text-stone-500 tabular-nums">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="py-3 pr-4 align-top text-stone-900">{l.descripcion}</td>
                        <td className="px-3 py-3 text-right align-top whitespace-nowrap text-stone-700 tabular-nums">
                          {formatQuantity(l.cantidad)}
                          {l.unidad ? ` ${l.unidad}` : ""}
                        </td>
                        <td className="px-3 py-3 text-right align-top whitespace-nowrap text-stone-700 tabular-nums">
                          {formatEuros(l.precio_cents)}
                        </td>
                        <td className="px-3 py-3 text-right align-top font-medium whitespace-nowrap text-stone-900 tabular-nums">
                          {formatEuros(l.importe_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Totales */}
            <dl className="mt-6 ml-auto max-w-xs text-sm break-inside-avoid">
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-stone-600">Base imponible</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(factura.base_cents)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-stone-600">IVA ({factura.iva_pct} %)</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(factura.iva_cents)}</dd>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-stone-900 pt-3">
                <dt className="font-semibold text-stone-950">Total factura</dt>
                <dd className="text-2xl font-semibold tracking-tight text-stone-950 tabular-nums">
                  {formatEuros(factura.total_cents)}
                </dd>
              </div>
            </dl>
          </section>

        </div>
      </article>
    </>
  );
}
