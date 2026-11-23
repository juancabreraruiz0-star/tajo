import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { lineasCuadranConBase } from "@/lib/domain/facturacion";
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

const sinDato = <span className="text-stone-400">—</span>;

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
  const cuadra =
    !lineasRes.error &&
    lineasCuadranConBase(
      lineas.map((l) => ({ cantidad: l.cantidad, precioCents: l.precio_cents })),
      factura.base_cents,
    );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <LinkButton href="/facturas">
          <span aria-hidden="true">←</span> Volver
        </LinkButton>
        <DescargarPdf />
      </div>

      {errorCarga && (
        <Alert tone="warning" title="Faltan datos de la factura" className="mb-4 print:hidden">
          {dbErrorMessage(errorCarga)}
        </Alert>
      )}
      {!errorCarga && !cuadra && (
        <Alert tone="warning" className="mb-4 print:hidden">
          La suma de las partidas no coincide con la base imponible guardada en la factura. Base, IVA y total son los
          importes con los que se emitió.
        </Alert>
      )}

      <article
        aria-labelledby="factura-titulo"
        className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
      >
        <div className="h-1.5 bg-amber-500" aria-hidden="true" />

        <header className="flex flex-col gap-6 border-b border-stone-200 px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:py-8 print:flex-row print:items-start print:justify-between print:px-0">
          <div className="min-w-0">
            <p className="text-xl font-bold tracking-tight text-stone-900">{factura.empresa_nombre}</p>
            <address className="mt-2 space-y-0.5 text-sm text-stone-600 not-italic">
              <p>CIF {factura.empresa_cif ?? "—"}</p>
              {factura.empresa_direccion && <p>{factura.empresa_direccion}</p>}
            </address>
          </div>
          <div className="shrink-0 sm:text-right print:text-right">
            <h1 id="factura-titulo" className="text-2xl font-bold whitespace-nowrap text-stone-900 tabular-nums">
              <span className="block text-xs font-semibold tracking-widest text-amber-700 uppercase">Factura</span>
              {factura.numero}
            </h1>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-stone-500">Fecha de emisión</dt>
              <dd className="text-stone-900 tabular-nums">{formatFecha(factura.fecha)}</dd>
              {presupuesto && (
                <>
                  <dt className="text-stone-500">Presupuesto</dt>
                  <dd className="whitespace-nowrap text-stone-900 tabular-nums">{presupuesto.numero}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        <section
          aria-label="Cliente"
          className="grid gap-6 px-5 pt-6 sm:grid-cols-2 sm:px-10 sm:pt-8 print:grid-cols-2 print:px-0"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Facturar a</p>
            <p className="mt-0.5 text-lg font-semibold text-stone-900">{factura.cliente_nombre}</p>
            <address className="mt-1 space-y-0.5 text-sm text-stone-600 not-italic">
              <p>NIF {factura.cliente_nif ?? sinDato}</p>
              {factura.cliente_direccion && <p>{factura.cliente_direccion}</p>}
            </address>
          </div>
          {presupuesto && (
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Concepto</p>
              <p className="mt-0.5 text-sm text-stone-900">{presupuesto.titulo}</p>
              <p className="mt-0.5 text-sm text-stone-600">Según presupuesto {presupuesto.numero}</p>
            </div>
          )}
        </section>

        <section aria-label="Partidas" className="px-5 py-6 sm:px-10 print:px-0">
          {lineas.length === 0 ? (
            <p className="text-sm text-stone-500">No se han encontrado las partidas de esta factura.</p>
          ) : (
            <>
              {/* Móvil: lista (en papel se usa siempre la tabla) */}
              <ul className="divide-y divide-stone-200 border-y border-stone-200 sm:hidden print:hidden">
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
              </ul>

              <table className="hidden w-full text-left text-sm sm:table print:table">
                <caption className="sr-only">Partidas de la factura {factura.numero}</caption>
                <thead className="border-b border-stone-300 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2 pr-4">
                      Descripción
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Cantidad
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Precio
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right">
                      Importe
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {lineas.map((l) => (
                    <tr key={l.id} className="break-inside-avoid">
                      <td className="py-3 pr-4 text-stone-900">{l.descripcion}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-stone-700 tabular-nums">
                        {formatQuantity(l.cantidad)}
                        {l.unidad ? ` ${l.unidad}` : ""}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-stone-700 tabular-nums">
                        {formatEuros(l.precio_cents)}
                      </td>
                      <td className="py-3 pl-3 text-right font-medium whitespace-nowrap text-stone-900 tabular-nums">
                        {formatEuros(l.importe_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <dl className="mt-6 ml-auto max-w-xs space-y-2 text-sm break-inside-avoid">
            <div className="flex justify-between gap-4">
              <dt className="text-stone-600">Base imponible</dt>
              <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(factura.base_cents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-stone-600">IVA ({factura.iva_pct} %)</dt>
              <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(factura.iva_cents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 rounded-lg bg-amber-50 px-3 py-3 ring-1 ring-amber-200 ring-inset">
              <dt className="font-semibold text-stone-900">Total</dt>
              <dd className="text-2xl font-bold text-stone-900 tabular-nums">{formatEuros(factura.total_cents)}</dd>
            </div>
          </dl>
        </section>

        <footer className="border-t border-stone-200 px-5 py-5 text-sm text-stone-600 sm:px-10 print:px-0">
          <p>
            <span className="font-medium text-stone-800">Forma de pago:</span> transferencia bancaria.
          </p>
        </footer>
      </article>
    </>
  );
}
