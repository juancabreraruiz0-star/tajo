import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Embudo } from "@/components/graficas/embudo";
import { FacturacionMensual } from "@/components/graficas/facturacion-mensual";
import {
  AlertIcon,
  BoxIcon,
  ChartIcon,
  CheckCircleIcon,
  ConoIcon,
  DocumentIcon,
  PlusIcon,
  ReceiptIcon,
} from "@/components/icons";
import { BarraConsumo, SemaforoObra } from "@/components/obra";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, type Column } from "@/components/ui/table";
import { mostrarGuia } from "@/lib/actions/guia";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFecha, formatFechaLarga, formatMes, ZONA_HORARIA } from "@/lib/domain/dates";
import { dbErrorMessage, type DbErrorLike } from "@/lib/domain/errors";
import { monthRange, percentChange, sumCentsInRange } from "@/lib/domain/facturacion";
import { COOKIE_GUIA, guiaDemo, guiaOculta, inicioDelDia } from "@/lib/domain/guia-demo";
import { acceptanceBreakdown, formatPercent, percentTrend } from "@/lib/domain/kpis";
import { formatEuros } from "@/lib/domain/money";
import { diaMadrid, semaforoObra } from "@/lib/domain/obras";
import { formatConsumido, obrasHref, parseSemaforo } from "@/lib/domain/obras-pantalla";
import { embudoPresupuestos, facturacionPorMes, rangoUltimosMeses } from "@/lib/domain/panel";
import { presupuestosHref } from "@/lib/domain/presupuestos";
import { formatQuantity } from "@/lib/domain/quantity";
import type { EstadoPresupuesto } from "@/lib/domain/status";
import { filterLowStock } from "@/lib/domain/stock";
import { iaConfigurada } from "@/lib/ia/config";
import type { Factura, Material, ObraResumen } from "@/lib/types";
import { GuiaDemo } from "./guia-demo";

type MaterialFila = Pick<Material, "id" | "nombre" | "unidad" | "stock" | "stock_minimo">;
type FacturaImporte = Pick<Factura, "fecha" | "total_cents">;
/** El cliente sale de la copia fija de la factura (0004). */
type FacturaReciente = Pick<Factura, "id" | "numero" | "fecha" | "cliente_nombre" | "total_cents">;
/** semaforo (0007) lo ven todos; el % consumido, solo gerencia (D12). */
type ObraEnCurso = Pick<ObraResumen, "id" | "titulo" | "estado" | "semaforo"> & Partial<Pick<ObraResumen, "consumido_pct">>;
type ObraEnPerdidas = Pick<ObraResumen, "id" | "titulo" | "cliente_nombre"> & { margen_cents: number };

export const metadata: Metadata = { title: "Panel" };

const MAX_STOCK_BAJO = 5;
const MAX_ULTIMAS_FACTURAS = 5;
const MAX_OBRAS_PANEL = 3;
const COLUMNAS_OBRA_PANEL = "id, titulo, estado, semaforo";

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
  // Gráfica de facturación: los 6 últimos meses (incluyen este mes y el anterior de la tarjeta).
  const seisMeses = rangoUltimosMeses(ahora, ZONA_HORARIA);

  // Conteos sin traer filas (head + count) y una consulta por tabla para el resto.
  const contar = (estado: EstadoPresupuesto) =>
    supabase.from("presupuestos").select("id", { count: "exact", head: true }).eq("estado", estado);

  // Guía de la demo: oculta con «Ya lo conozco» (cookie). Si se ve, sus pasos se marcan con conteos de hoy (Madrid).
  const verGuia = !guiaOculta((await cookies()).get(COOKIE_GUIA)?.value);
  const hoy = diaMadrid(ahora);
  const inicioHoy = inicioDelDia(hoy, ZONA_HORARIA);
  const existe = async (consulta: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count, error } = await consulta;
    return !error && (count ?? 0) > 0;
  };
  const cuenta = (tabla: "presupuestos" | "facturas" | "partes") =>
    supabase.from(tabla).select("id", { count: "exact", head: true });
  const hechosGuia = verGuia
    ? Promise.all([
        existe(cuenta("presupuestos").gte("created_at", inicioHoy)),
        existe(cuenta("presupuestos").gte("enviado_at", inicioHoy)),
        existe(cuenta("presupuestos").eq("aceptado_canal", "enlace").gte("aceptado_at", inicioHoy)),
        admin ? existe(cuenta("facturas").eq("fecha", hoy)) : false,
        existe(cuenta("partes").eq("autor_id", perfil.id).gte("created_at", inicioHoy)),
      ])
    : null;

  // Obras en curso: el número y las que peor van. Gerencia las ordena por % consumido; el resto no tiene el % (D12)
  // y las ordena por el semáforo: primero en pérdidas y ajustadas (rojo > ámbar por orden alfabético inverso) y, si
  // quedan huecos, las que van bien. Sin importes: también las ve el encargado.
  const obrasEnCursoQuery = () =>
    supabase
      .from("obras_resumen")
      .select(admin ? `${COLUMNAS_OBRA_PANEL}, consumido_pct` : COLUMNAS_OBRA_PANEL, { count: "exact" })
      .eq("estado", "en_curso");
  const obrasEnCursoPanel = async () => {
    if (admin) {
      return obrasEnCursoQuery()
        .order("consumido_pct", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(MAX_OBRAS_PANEL)
        .overrideTypes<ObraEnCurso[], { merge: false }>();
    }
    const [enRiesgo, bien] = await Promise.all([
      obrasEnCursoQuery()
        .in("semaforo", ["rojo", "ambar"])
        .order("semaforo", { ascending: false })
        .order("id")
        .limit(MAX_OBRAS_PANEL)
        .overrideTypes<ObraEnCurso[], { merge: false }>(),
      obrasEnCursoQuery()
        .eq("semaforo", "verde")
        .order("id")
        .limit(MAX_OBRAS_PANEL)
        .overrideTypes<ObraEnCurso[], { merge: false }>(),
    ]);
    return {
      data: [...(enRiesgo.data ?? []), ...(bien.data ?? [])].slice(0, MAX_OBRAS_PANEL),
      count: (enRiesgo.count ?? 0) + (bien.count ?? 0),
      error: enRiesgo.error ?? bien.error,
    };
  };

  const [
    borradorRes,
    enviadoRes,
    aceptadoRes,
    facturadoRes,
    rechazadoRes,
    materialesRes,
    facturasMesRes,
    ultimasRes,
    obrasEnCursoRes,
    perdidasRes,
    hechos,
  ] = await Promise.all([
      contar("borrador"),
      contar("enviado"),
      contar("aceptado"),
      contar("facturado"),
      contar("rechazado"),
      supabase
        .from("materiales")
        .select("id, nombre, unidad, stock, stock_minimo")
        .order("nombre")
        .overrideTypes<MaterialFila[], { merge: false }>(),
      // Facturación solo para gerencia (R18); la RLS de facturas tampoco la deja ver al resto. Solo fecha e importe.
      admin
        ? supabase
            .from("facturas")
            .select("fecha, total_cents")
            .gte("fecha", seisMeses.desde)
            .lt("fecha", seisMeses.hasta)
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
      obrasEnCursoPanel(),
      // Obras en pérdidas (margen < 0, exacto; no por el semáforo, que va redondeado). Solo gerencia ve importes.
      admin
        ? supabase
            .from("obras_resumen")
            .select("id, titulo, cliente_nombre, margen_cents", { count: "exact" })
            .lt("margen_cents", 0)
            .order("margen_cents")
            .order("id")
            .limit(MAX_OBRAS_PANEL)
            .overrideTypes<ObraEnPerdidas[], { merge: false }>()
        : null,
      hechosGuia,
    ]);

  const facturasRecientes = ultimasRes?.data ?? [];

  // Presupuestos por estado
  const conteosError =
    borradorRes.error ?? enviadoRes.error ?? aceptadoRes.error ?? facturadoRes.error ?? rechazadoRes.error;
  const conteos = conteosError
    ? null
    : {
        borrador: borradorRes.count ?? 0,
        enviado: enviadoRes.count ?? 0,
        aceptado: aceptadoRes.count ?? 0,
        facturado: facturadoRes.count ?? 0,
        rechazado: rechazadoRes.count ?? 0,
      };
  const aceptacion = conteos ? acceptanceBreakdown(conteos) : null;
  const embudo = conteos ? embudoPresupuestos(conteos) : null;

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
  const serieMeses = facturasMes ? facturacionPorMes(facturasMes, ahora, ZONA_HORARIA) : null;
  const totalSeisMeses = serieMeses ? serieMeses.reduce((suma, mes) => suma + mes.totalCents, 0) : null;
  const variacion =
    facturadoActual !== null && facturadoAnterior !== null ? percentChange(facturadoActual, facturadoAnterior) : null;
  // El color sigue a la cifra que se pinta: un «0 %» redondeado no es ni subida ni bajada.
  const tendencia = variacion === null ? null : percentTrend(variacion);
  const nombreMesAnterior = formatMes(mesAnterior.desde);

  // Obras
  const obrasEnCurso = (obrasEnCursoRes.data ?? []).map((o) => {
    const consumido = o.consumido_pct == null ? null : Number(o.consumido_pct);
    return {
      ...o,
      consumido_pct: consumido,
      // El semáforo lo calcula la vista; gerencia, si no llegara, lo saca del % (misma regla). El resto no tiene el %.
      semaforo: parseSemaforo(o.semaforo) ?? (admin ? semaforoObra(consumido, o.estado) : null),
    };
  });
  const numEnCurso = obrasEnCursoRes.error ? null : (obrasEnCursoRes.count ?? 0);
  const perdidas = perdidasRes && !perdidasRes.error ? (perdidasRes.data ?? []) : null;
  const numPerdidas = perdidasRes && !perdidasRes.error ? (perdidasRes.count ?? 0) : null;

  const guia = hechos
    ? guiaDemo(
        {
          presupuestoCreado: hechos[0],
          presupuestoEnviado: hechos[1],
          aceptadoPorEnlace: hechos[2],
          facturado: hechos[3],
          parteApuntado: hechos[4],
        },
        { ia: iaConfigurada(), admin },
      )
    : null;
  // Remate de la guía: la primera obra en curso que va en rojo (la que más lleva consumido, para gerencia).
  const obraEnRojo = obrasEnCurso.find((o) => o.semaforo === "rojo") ?? null;

  const errores: DbErrorLike[] = [
    conteosError,
    materialesRes.error,
    facturasMesRes?.error,
    ultimasRes?.error,
    obrasEnCursoRes.error,
    perdidasRes?.error,
  ].filter((e): e is NonNullable<typeof e> => Boolean(e));

  return (
    <>
      <PageHeader
        title={nombre ? `Hola, ${nombre}` : "Panel"}
        description={
          <>
            {formatFechaLarga(ahora)}
            {!verGuia && (
              <form action={mostrarGuia} className="inline">
                <span aria-hidden="true"> · </span>
                <button
                  type="submit"
                  className="rounded-sm font-medium text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-amber-800 hover:decoration-amber-400"
                >
                  Ver la guía de la demo
                </button>
              </form>
            )}
          </>
        }
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

      {guia && <GuiaDemo guia={guia} obraEnRojo={obraEnRojo} />}

      <div className="escalonado grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <ul className="divide-y divide-stone-100 text-sm" aria-label="Primeros materiales bajo mínimo">
              {bajos.slice(0, MAX_STOCK_BAJO).map((m) => (
                <li key={m.id} className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
                  <AlertIcon className="mt-0.5 size-4 shrink-0 text-red-600" />
                  <span className="min-w-0">
                    <span className="block truncate text-stone-800">{m.nombre}</span>
                    <span className="block text-xs text-stone-500 tabular-nums">
                      <span className="font-semibold text-red-700">{formatQuantity(m.stock)}</span> de{" "}
                      {formatQuantity(m.stock_minimo)} {m.unidad} mínimo
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

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <StatCard
          id="kpi-obras"
          title="Obras en curso"
          value={numEnCurso === null ? "—" : String(numEnCurso)}
          icon={<ConoIcon className="size-5" />}
          className={admin ? undefined : "lg:col-span-2"}
          detail={
            numEnCurso === null
              ? undefined
              : numEnCurso === 0
                ? "Ninguna obra en marcha ahora mismo."
                : admin
                  ? "Las que más llevan gastado de lo presupuestado:"
                  : "Primero, las que van en pérdidas o ajustadas:"
          }
          link={{ href: obrasHref("en_curso"), label: "Ver obras en curso" }}
        >
          {obrasEnCurso.length > 0 && (
            <ul className="space-y-3 text-sm" aria-label="Obras en curso que peor van">
              {obrasEnCurso.map((o) => {
                const { semaforo } = o;
                if (!admin) {
                  return (
                    <li key={o.id}>
                      <Link href={`/obras/${o.id}`} className="group flex items-baseline justify-between gap-3 rounded-sm">
                        <span className="min-w-0 truncate text-stone-800 group-hover:text-amber-800 group-hover:underline">
                          {o.titulo}
                        </span>
                        {semaforo && <SemaforoObra semaforo={semaforo} className="shrink-0" />}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={o.id}>
                    <Link href={`/obras/${o.id}`} className="group block rounded-sm">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-stone-800 group-hover:text-amber-800 group-hover:underline">
                          {o.titulo}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-xs font-semibold tabular-nums",
                            semaforo === "rojo" ? "text-red-700" : semaforo === "ambar" ? "text-amber-800" : "text-stone-600",
                          )}
                        >
                          {formatConsumido(o.consumido_pct)}
                        </span>
                      </span>
                      {semaforo && (
                        <BarraConsumo consumidoPct={o.consumido_pct} semaforo={semaforo} className="mt-1.5 h-1.5" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </StatCard>

        {admin && (
          <StatCard
            id="kpi-perdidas"
            title="Obras en pérdidas"
            value={numPerdidas === null ? "—" : String(numPerdidas)}
            tone={numPerdidas ? "danger" : "default"}
            icon={<ChartIcon className="size-5" />}
            detail={
              numPerdidas === null
                ? undefined
                : numPerdidas === 0
                  ? "Ninguna obra cuesta más de lo presupuestado."
                  : "Han costado más que la base de su presupuesto (sin IVA)."
            }
            link={{ href: obrasHref(null), label: "Ver todas las obras" }}
          >
            {perdidas && perdidas.length > 0 && (
              <ul className="divide-y divide-stone-100 text-sm" aria-label="Obras con margen negativo">
                {perdidas.map((o) => (
                  <li key={o.id} className="py-1.5 first:pt-0 last:pb-0">
                    <Link href={`/obras/${o.id}`} className="group flex items-start justify-between gap-3 rounded-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-stone-800 group-hover:text-amber-800 group-hover:underline">
                          {o.titulo}
                        </span>
                        <span className="block truncate text-xs text-stone-500">{o.cliente_nombre}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-red-700 tabular-nums">
                        {formatEuros(o.margen_cents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </StatCard>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        {admin && (
          <Card className="lg:col-span-3">
            <section aria-labelledby="grafica-facturacion">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <h2 id="grafica-facturacion" className="text-[0.9375rem] font-semibold tracking-tight text-stone-900">
                    Facturación de los últimos 6 meses
                  </h2>
                  <p className="mt-0.5 text-sm text-stone-500">Total con IVA de las facturas emitidas cada mes.</p>
                </div>
                {totalSeisMeses !== null && (
                  <p className="sm:text-right">
                    <span className="block text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">
                      Total 6 meses
                    </span>
                    <span className="text-lg font-semibold tracking-tight text-stone-950 tabular-nums">
                      {formatEuros(totalSeisMeses)}
                    </span>
                  </p>
                )}
              </div>
              <CardBody className="pt-5">
                {serieMeses ? (
                  <>
                    <FacturacionMensual id="facturacion-meses" serie={serieMeses} />
                    {totalSeisMeses === 0 && (
                      <p className="mt-3 text-sm text-stone-500">
                        Todavía no hay facturas en estos meses. Aparecerán aquí al convertir presupuestos aceptados en
                        factura.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="py-10 text-center text-sm text-stone-500">No se ha podido cargar la facturación.</p>
                )}
              </CardBody>
            </section>
          </Card>
        )}

        <Card className={admin ? "lg:col-span-2" : "lg:col-span-5"}>
          <section aria-labelledby="embudo-presupuestos">
            <div className="border-b border-stone-100 px-4 py-3.5 sm:px-5">
              <h2 id="embudo-presupuestos" className="text-[0.9375rem] font-semibold tracking-tight text-stone-900">
                Embudo de presupuestos
              </h2>
              <p className="mt-0.5 text-sm text-pretty text-stone-500">
                Cuántos llegan a cada fase. Un facturado cuenta también como enviado y aceptado.
              </p>
            </div>
            <CardBody className="pt-5">
              {embudo ? (
                embudo.total === 0 ? (
                  <p className="py-6 text-center text-sm text-stone-500">
                    Aún no hay presupuestos. Cuando crees el primero, verás aquí cómo avanzan.
                  </p>
                ) : (
                  <Embudo embudo={embudo} />
                )
              ) : (
                <p className="py-10 text-center text-sm text-stone-500">No se han podido cargar los presupuestos.</p>
              )}
            </CardBody>
          </section>
        </Card>
      </div>

      {admin && (
        <section aria-labelledby="ultimas-facturas" className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="ultimas-facturas" className="text-lg font-semibold tracking-tight text-stone-900">
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
