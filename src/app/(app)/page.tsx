import { AlertIcon, BoxIcon, CheckCircleIcon, DocumentIcon, PlusIcon, ReceiptIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFecha, formatFechaLarga, formatMes, ZONA_HORARIA } from "@/lib/domain/dates";
import { dbErrorMessage, type DbErrorLike } from "@/lib/domain/errors";
import { monthRange, percentChange, sumCentsInRange } from "@/lib/domain/facturacion";
import { acceptanceBreakdown, formatPercent, percentTrend } from "@/lib/domain/kpis";
import { formatEuros } from "@/lib/domain/money";
import { presupuestosHref } from "@/lib/domain/presupuestos";
import { formatQuantity } from "@/lib/domain/quantity";
import type { EstadoPresupuesto } from "@/lib/domain/status";
import { filterLowStock } from "@/lib/domain/stock";
import type { Factura, Material } from "@/lib/types";

type MaterialFila = Pick<Material, "id" | "nombre" | "unidad" | "stock" | "stock_minimo">;
type FacturaImporte = Pick<Factura, "fecha" | "total_cents">;
/** El cliente sale de la copia fija de la factura (0004). */
type FacturaReciente = Pick<Factura, "id" | "numero" | "fecha" | "cliente_nombre" | "total_cents">;

const MAX_STOCK_BAJO = 5;
const MAX_ULTIMAS_FACTURAS = 5;

const COLUMNAS_FACTURAS: Column<FacturaReciente>[] = [
  { key: "numero", header: "Número", primary: true, className: "whitespace-nowrap", cell: (f) => f.numero },
  { key: "fecha", header: "Fecha", className: "whitespace-nowrap", cell: (f) => formatFecha(f.fecha) },
  { key: "cliente", header: "Cliente", cell: (f) => f.cliente_nombre },
  {
    key: "total",
    header: "Total",
    align: "right",
    className: "whitespace-nowrap",
    cell: (f) => formatEuros(f.total_cents),
  },
];

function plural(n: number, singular: string, varios: string): string {
  return `${n} ${n === 1 ? singular : varios}`;
}

export default async function PanelPage() {
  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);
  const nombre = perfil.nombre.trim().split(" ")[0];

  const ahora = new Date();
  const mesActual = monthRange(ahora, ZONA_HORARIA);
  const mesAnterior = monthRange(ahora, ZONA_HORARIA, -1);

  // Conteos sin traer filas (head + count) y una consulta por tabla para el resto.
  const contar = (estado: EstadoPresupuesto) =>
    supabase.from("presupuestos").select("id", { count: "exact", head: true }).eq("estado", estado);

  const [enviadoRes, aceptadoRes, facturadoRes, rechazadoRes, materialesRes, facturasMesRes, ultimasRes] =
    await Promise.all([
      contar("enviado"),
      contar("aceptado"),
      contar("facturado"),
      contar("rechazado"),
      supabase
        .from("materiales")
        .select("id, nombre, unidad, stock, stock_minimo")
        .order("nombre")
        .overrideTypes<MaterialFila[], { merge: false }>(),
      // Facturación solo para gerencia (R18); la RLS de facturas tampoco la deja ver al resto.
      admin
        ? supabase
            .from("facturas")
            .select("fecha, total_cents")
            .gte("fecha", mesAnterior.desde)
            .lt("fecha", mesActual.hasta)
            .overrideTypes<FacturaImporte[], { merge: false }>()
        : null,
      admin
        ? supabase
            .from("facturas")
            .select("id, numero, fecha, cliente_nombre, total_cents")
            .order("fecha", { ascending: false })
            .order("numero", { ascending: false })
            .limit(MAX_ULTIMAS_FACTURAS)
            .overrideTypes<FacturaReciente[], { merge: false }>()
        : null,
    ]);

  const facturasRecientes = ultimasRes?.data ?? [];

  // Presupuestos por estado
  const conteosError = enviadoRes.error ?? aceptadoRes.error ?? facturadoRes.error ?? rechazadoRes.error;
  const conteos = conteosError
    ? null
    : {
        enviado: enviadoRes.count ?? 0,
        aceptado: aceptadoRes.count ?? 0,
        facturado: facturadoRes.count ?? 0,
        rechazado: rechazadoRes.count ?? 0,
      };
  const aceptacion = conteos ? acceptanceBreakdown(conteos) : null;

  // Stock bajo (Postgres no compara dos columnas por la API: se filtra aquí con la regla de dominio).
  const bajos = materialesRes.error
    ? null
    : filterLowStock(
        (materialesRes.data ?? []).map((m) => ({ ...m, stock: Number(m.stock), stock_minimo: Number(m.stock_minimo) })),
      );

  // Facturación del mes (admin)
  const facturasMes = facturasMesRes && !facturasMesRes.error ? (facturasMesRes.data ?? []) : null;
  const facturadoActual = facturasMes ? sumCentsInRange(facturasMes, mesActual) : null;
  const facturadoAnterior = facturasMes ? sumCentsInRange(facturasMes, mesAnterior) : null;
  const variacion =
    facturadoActual !== null && facturadoAnterior !== null ? percentChange(facturadoActual, facturadoAnterior) : null;
  // El color sigue a la cifra que se pinta: un «0 %» redondeado no es ni subida ni bajada.
  const tendencia = variacion === null ? null : percentTrend(variacion);
  const nombreMesAnterior = formatMes(mesAnterior.desde);

  const errores: DbErrorLike[] = [
    conteosError,
    materialesRes.error,
    facturasMesRes?.error,
    ultimasRes?.error,
  ].filter((e): e is NonNullable<typeof e> => Boolean(e));

  return (
    <>
      <PageHeader
        title={nombre ? `Hola, ${nombre}` : "Panel"}
        description={formatFechaLarga(ahora)}
        actions={
          <nav aria-label="Accesos rápidos" className="flex flex-wrap gap-2">
            <LinkButton href="/presupuestos/nuevo" variant="primary">
              <PlusIcon className="size-4" />
              Nuevo presupuesto
            </LinkButton>
            <LinkButton href="/clientes/nuevo">
              <PlusIcon className="size-4" />
              Nuevo cliente
            </LinkButton>
          </nav>
        }
      />

      {errores.length > 0 && (
        <Alert tone="warning" title="Algunos datos del panel no se han podido cargar" className="mb-6">
          {dbErrorMessage(errores[0])} Las tarjetas sin dato aparecen con «—».
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          id="kpi-pendientes"
          title="Pendientes de respuesta"
          value={conteos ? String(conteos.enviado) : "—"}
          icon={<DocumentIcon className="size-5" />}
          detail={
            conteos
              ? conteos.enviado === 0
                ? "Ningún presupuesto esperando al cliente."
                : `${conteos.enviado === 1 ? "Presupuesto enviado" : "Presupuestos enviados"} sin aceptar ni rechazar.`
              : undefined
          }
          link={{ href: presupuestosHref("enviado"), label: "Ver enviados" }}
        />

        <StatCard
          id="kpi-aceptacion"
          title="Tasa de aceptación"
          value={aceptacion && aceptacion.tasa !== null ? formatPercent(aceptacion.tasa) : "—"}
          icon={<CheckCircleIcon className="size-5" />}
          detail={
            aceptacion
              ? aceptacion.tasa === null
                ? "Sin dato: aún no hay presupuestos enviados."
                : `${plural(aceptacion.aceptados, "aceptado", "aceptados")} (con los facturados) de ${plural(aceptacion.enviados, "enviado", "enviados")}.`
              : undefined
          }
        />

        <StatCard
          id="kpi-stock"
          title="Stock bajo"
          value={bajos ? String(bajos.length) : "—"}
          tone={bajos && bajos.length > 0 ? "danger" : "default"}
          icon={<BoxIcon className="size-5" />}
          detail={
            bajos
              ? bajos.length === 0
                ? "Todo el almacén está por encima del mínimo."
                : `${bajos.length === 1 ? "Material" : "Materiales"} por debajo del stock mínimo.`
              : undefined
          }
          link={{ href: "/materiales?bajo=1", label: "Ver materiales bajo mínimo" }}
        >
          {bajos && bajos.length > 0 && (
            <ul className="space-y-1.5 text-sm" aria-label="Primeros materiales bajo mínimo">
              {bajos.slice(0, MAX_STOCK_BAJO).map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-stone-800">
                    <AlertIcon className="size-4 shrink-0 self-center text-red-600" />
                    <span className="truncate">{m.nombre}</span>
                  </span>
                  <span className="shrink-0 text-red-700 tabular-nums">
                    {formatQuantity(m.stock)}
                    <span className="text-stone-500">
                      {" "}
                      / {formatQuantity(m.stock_minimo)} {m.unidad}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </StatCard>

        {admin ? (
          <StatCard
            id="kpi-facturado"
            title="Facturado este mes"
            value={facturadoActual !== null ? formatEuros(facturadoActual) : "—"}
            icon={<ReceiptIcon className="size-5" />}
            detail={
              facturadoAnterior === null ? undefined : variacion === null ? (
                `Sin facturas en ${nombreMesAnterior} para comparar.`
              ) : (
                <>
                  <span
                    className={cn(
                      "font-semibold",
                      tendencia === "sube" && "text-green-700",
                      tendencia === "baja" && "text-red-700",
                    )}
                  >
                    {formatPercent(variacion, { signo: true })}
                  </span>{" "}
                  frente a todo {nombreMesAnterior} ({formatEuros(facturadoAnterior)}).
                </>
              )
            }
            link={{ href: "/facturas", label: "Ver facturas" }}
          />
        ) : (
          <StatCard
            id="kpi-por-facturar"
            title="Aceptados pendientes de facturar"
            value={conteos ? String(conteos.aceptado) : "—"}
            icon={<ReceiptIcon className="size-5" />}
            detail={
              conteos
                ? conteos.aceptado === 0
                  ? "No hay presupuestos aceptados esperando factura."
                  : "Gerencia los convierte en factura."
                : undefined
            }
            link={{ href: presupuestosHref("aceptado"), label: "Ver aceptados" }}
          />
        )}
      </div>

      {admin && (
        <section aria-labelledby="ultimas-facturas" className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="ultimas-facturas" className="text-lg font-semibold text-stone-900">
              Últimas facturas
            </h2>
            {facturasRecientes.length > 0 && (
              <LinkButton href="/facturas" size="sm" variant="ghost">
                Ver todas <span aria-hidden="true">→</span>
              </LinkButton>
            )}
          </div>
          {ultimasRes?.error ? (
            <Alert title="No se han podido cargar las facturas">{dbErrorMessage(ultimasRes.error)}</Alert>
          ) : facturasRecientes.length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon className="size-6" />}
              title="Todavía no hay facturas"
              description="Cuando conviertas un presupuesto aceptado en factura, aparecerá aquí."
            />
          ) : (
            <Table
              caption="Últimas facturas emitidas"
              columns={COLUMNAS_FACTURAS}
              rows={facturasRecientes}
              rowKey={(f) => f.id}
              rowHref={(f) => `/facturas/${f.id}`}
            />
          )}
        </section>
      )}
    </>
  );
}
