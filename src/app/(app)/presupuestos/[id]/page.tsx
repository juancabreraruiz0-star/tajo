import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EstadoBadge } from "@/components/estado-badge";
import { PencilIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { isExpired, validUntil } from "@/lib/domain/presupuestos";
import { formatQuantity } from "@/lib/domain/quantity";
import { nextActions } from "@/lib/domain/status";
import { budgetTotals, lineTotalCents } from "@/lib/domain/totals";
import { isUuid } from "@/lib/domain/validation";
import { getRequestOrigin } from "@/lib/request-origin";
import type { Presupuesto, PresupuestoLinea } from "@/lib/types";
import { CambiarEstado, EnlacePublico, Facturar } from "./acciones";

export const metadata: Metadata = { title: "Presupuesto" };

type LineaFila = Pick<PresupuestoLinea, "id" | "orden" | "descripcion" | "cantidad" | "precio_cents" | "material_id">;
type LineaDetalle = LineaFila & { unidad: string | null; importeCents: number };

const COLUMNAS: Column<LineaDetalle>[] = [
  { key: "descripcion", header: "Descripción", primary: true, cell: (l) => l.descripcion },
  {
    key: "cantidad",
    header: "Cantidad",
    align: "right",
    cell: (l) => `${formatQuantity(l.cantidad)}${l.unidad ? ` ${l.unidad}` : ""}`,
  },
  { key: "precio", header: "Precio unitario", align: "right", cell: (l) => formatEuros(l.precio_cents) },
  { key: "importe", header: "Importe", align: "right", cell: (l) => formatEuros(l.importeCents) },
];

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words text-stone-900">{children}</dd>
    </div>
  );
}

const pendiente = <span className="text-stone-400">—</span>;

export default async function PresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);

  const [presupuestoRes, lineasRes] = await Promise.all([
    supabase
      .from("presupuestos")
      .select("id, empresa_id, cliente_id, numero, titulo, estado, iva_pct, validez_dias, token, created_at, enviado_at, aceptado_at")
      .eq("id", id)
      .maybeSingle<Presupuesto>(),
    supabase
      .from("presupuesto_lineas")
      .select("id, orden, descripcion, cantidad, precio_cents, material_id")
      .eq("presupuesto_id", id)
      .order("orden")
      .order("id")
      .overrideTypes<LineaFila[], { merge: false }>(),
  ]);

  if (presupuestoRes.error) {
    return <Alert title="No se ha podido cargar el presupuesto">{dbErrorMessage(presupuestoRes.error)}</Alert>;
  }
  const presupuesto = presupuestoRes.data;
  if (!presupuesto) notFound();

  const lineasBase = (lineasRes.data ?? []).map((l) => ({ ...l, cantidad: Number(l.cantidad) }));
  const materialIds = [...new Set(lineasBase.flatMap((l) => (l.material_id ? [l.material_id] : [])))];

  const [clienteRes, materialesRes, facturaRes, origin] = await Promise.all([
    supabase.from("clientes").select("id, nombre").eq("id", presupuesto.cliente_id).maybeSingle<{ id: string; nombre: string }>(),
    materialIds.length > 0
      ? supabase
          .from("materiales")
          .select("id, unidad")
          .in("id", materialIds)
          .overrideTypes<{ id: string; unidad: string }[], { merge: false }>()
      : null,
    // La factura solo la ve gerencia (R2).
    admin && presupuesto.estado === "facturado"
      ? supabase.from("facturas").select("id, numero").eq("presupuesto_id", id).maybeSingle<{ id: string; numero: string }>()
      : null,
    presupuesto.estado === "enviado" ? getRequestOrigin() : null,
  ]);

  const unidades = new Map((materialesRes?.data ?? []).map((m) => [m.id, m.unidad]));
  const lineas: LineaDetalle[] = lineasBase.map((l) => ({
    ...l,
    unidad: l.material_id ? (unidades.get(l.material_id) ?? null) : null,
    importeCents: lineTotalCents({ cantidad: l.cantidad, precioCents: l.precio_cents }),
  }));
  const totales = budgetTotals(
    lineas.map((l) => ({ cantidad: l.cantidad, precioCents: l.precio_cents })),
    presupuesto.iva_pct,
  );

  const acciones = nextActions(presupuesto.estado, perfil.rol);
  const cliente = clienteRes.data;
  const factura = facturaRes?.data ?? null;
  const errorCarga = lineasRes.error ?? clienteRes.error ?? materialesRes?.error ?? facturaRes?.error ?? null;
  const validoHasta = validUntil(presupuesto.created_at, presupuesto.validez_dias);
  // Misma regla que aceptar_presupuesto() (0003) y que la página pública: vencido, el cliente ya no puede aceptar.
  const vencido = presupuesto.estado === "enviado" && isExpired(presupuesto.created_at, presupuesto.validez_dias);

  return (
    <>
      <PageHeader
        title={presupuesto.numero}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EstadoBadge estado={presupuesto.estado} />
            <span className="text-stone-700">{presupuesto.titulo}</span>
          </span>
        }
        back={{ href: "/presupuestos", label: "Presupuestos" }}
        actions={
          presupuesto.estado === "borrador" ? (
            <LinkButton href={`/presupuestos/${id}/editar`}>
              <PencilIcon className="size-4" />
              Editar
            </LinkButton>
          ) : undefined
        }
      />

      {errorCarga && (
        <Alert tone="warning" title="Faltan datos del presupuesto" className="mb-6">
          {dbErrorMessage(errorCarga)}
        </Alert>
      )}
      {vencido && (
        <Alert tone="warning" className="mb-6">
          La validez venció el {formatFecha(validoHasta)}: el cliente ya no puede aceptarlo desde el enlace. Puedes
          marcarlo como aceptado o rechazado manualmente.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4 sm:p-6">
            <dl className="grid gap-5 sm:grid-cols-3">
              <Dato label="Cliente">
                {cliente ? (
                  <Link href={`/clientes/${cliente.id}`} className="font-medium text-amber-700 hover:underline">
                    {cliente.nombre}
                  </Link>
                ) : (
                  pendiente
                )}
              </Dato>
              <Dato label="Creado">{formatFecha(presupuesto.created_at)}</Dato>
              <Dato label="Validez">
                {presupuesto.validez_dias} días · hasta el {formatFecha(validoHasta)}
              </Dato>
              <Dato label="Enviado">{presupuesto.enviado_at ? formatFecha(presupuesto.enviado_at) : pendiente}</Dato>
              <Dato label="Aceptado">{presupuesto.aceptado_at ? formatFecha(presupuesto.aceptado_at) : pendiente}</Dato>
              <Dato label="IVA">{presupuesto.iva_pct} %</Dato>
            </dl>
          </Card>

          <section aria-labelledby="partidas-titulo">
            <h2 id="partidas-titulo" className="mb-3 text-lg font-semibold text-stone-900">
              Partidas
            </h2>
            {lineas.length === 0 ? (
              <Alert tone="info">
                Este presupuesto no tiene partidas.
                {presupuesto.estado === "borrador" && " Edítalo para añadirlas antes de enviarlo."}
              </Alert>
            ) : (
              <Table caption={`Partidas de ${presupuesto.numero}`} columns={COLUMNAS} rows={lineas} rowKey={(l) => l.id} />
            )}

            <Card className="mt-4 p-4 sm:p-5">
              <dl className="ml-auto max-w-xs space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-600">Base imponible</dt>
                  <dd className="font-medium tabular-nums">{formatEuros(totales.baseCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-600">IVA ({presupuesto.iva_pct} %)</dt>
                  <dd className="font-medium tabular-nums">{formatEuros(totales.ivaCents)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-stone-200 pt-2 text-base">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-bold tabular-nums">{formatEuros(totales.totalCents)}</dd>
                </div>
              </dl>
            </Card>
          </section>
        </div>

        <Card className="h-fit">
          <CardHeader title="Siguiente paso" />
          <CardBody className="space-y-4 text-sm text-stone-600">
            {presupuesto.estado === "borrador" && (
              <>
                {lineas.length === 0 ? (
                  <p>Añade al menos una partida antes de enviarlo. Pulsa «Editar» para completarlo.</p>
                ) : (
                  <p>Revisa las partidas. Al marcarlo como enviado tendrás el enlace para el cliente y ya no se podrá editar.</p>
                )}
                {acciones.includes("enviar") && lineas.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <CambiarEstado
                      id={id}
                      destino="enviado"
                      variant="primary"
                      label="Marcar como enviado"
                      pendingText="Enviando…"
                      confirmacion="¿Marcar como enviado? Después ya no podrás editar el presupuesto."
                    />
                  </div>
                )}
              </>
            )}

            {presupuesto.estado === "enviado" && (
              <>
                {acciones.includes("copiar_enlace") && <EnlacePublico token={presupuesto.token} serverOrigin={origin} />}
                <p className="border-t border-stone-200 pt-4">
                  {vencido ? "El enlace ya no deja aceptar." : "El cliente puede aceptarlo desde el enlace."} Si te
                  responde por otra vía, márcalo aquí:
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  {acciones.includes("marcar_aceptado") && (
                    <CambiarEstado
                      id={id}
                      destino="aceptado"
                      label="Marcar como aceptado"
                      pendingText="Guardando…"
                      confirmacion="¿Marcar el presupuesto como aceptado por el cliente?"
                    />
                  )}
                  {acciones.includes("marcar_rechazado") && (
                    <CambiarEstado
                      id={id}
                      destino="rechazado"
                      variant="danger"
                      label="Marcar como rechazado"
                      pendingText="Guardando…"
                      confirmacion="¿Marcar el presupuesto como rechazado? El cliente ya no podrá aceptarlo y no se puede deshacer."
                    />
                  )}
                </div>
              </>
            )}

            {presupuesto.estado === "aceptado" &&
              (acciones.includes("facturar") ? (
                <>
                  <p>El cliente lo ha aceptado. Al facturarlo se descuenta del almacén el material de las partidas.</p>
                  <div className="flex flex-wrap gap-2">
                    <Facturar id={id} />
                  </div>
                </>
              ) : (
                <p className="font-medium text-stone-800">Pendiente de facturar por gerencia.</p>
              ))}

            {presupuesto.estado === "facturado" &&
              (admin ? (
                factura ? (
                  <LinkButton href={`/facturas/${factura.id}`} variant="primary">
                    Ver factura {factura.numero}
                  </LinkButton>
                ) : (
                  <p>Presupuesto facturado. No se ha encontrado su factura.</p>
                )
              ) : (
                <p>Presupuesto facturado.</p>
              ))}

            {presupuesto.estado === "rechazado" && <p>El cliente lo ha rechazado. Ya no se puede aceptar ni facturar.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
