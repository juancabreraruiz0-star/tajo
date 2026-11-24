import type { Metadata } from "next";
import Link from "next/link";
import { BarraConsumo, ObraEstadoBadge, PUNTO_ESTADO_OBRA, SemaforoObra } from "@/components/obra";
import { ConoIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PaginaFueraDeRango, Paginacion } from "@/components/ui/paginacion";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFechaEnLetra } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { ESTADOS_OBRA, ETIQUETAS_ESTADO_OBRA, semaforoObra, type EstadoObra } from "@/lib/domain/obras";
import {
  FILTRO_TODAS,
  filtroObras,
  filtroObrasPendienteDeConteo,
  formatConsumido,
  formatHoras,
  obrasHref,
  parseSemaforo,
} from "@/lib/domain/obras-pantalla";
import { hrefPagina, paginacion, parsePagina } from "@/lib/domain/paginacion";
import { leerPagina } from "@/lib/paginar";
import type { ObraResumen } from "@/lib/types";

export const metadata: Metadata = { title: "Obras" };

type ObraFila = Pick<
  ObraResumen,
  | "id"
  | "titulo"
  | "cliente_nombre"
  | "presupuesto_numero"
  | "estado"
  | "encargado_id"
  | "fecha_inicio"
  | "horas"
  | "num_partes"
  | "ultimo_parte"
  | "semaforo"
> &
  // % consumido e importes: solo se piden (y llegan) para gerencia.
  Partial<Pick<ObraResumen, "consumido_pct" | "presupuestado_cents" | "coste_real_cents" | "margen_cents">>;

const COLUMNAS =
  "id, titulo, cliente_nombre, presupuesto_numero, estado, encargado_id, fecha_inicio, horas, num_partes, ultimo_parte, " +
  "semaforo";
/** Gerencia ve además el % consumido y los importes. Al resto no se le piden: solo ve el semáforo (D12). */
const COLUMNAS_GERENCIA = `${COLUMNAS}, consumido_pct, presupuestado_cents, coste_real_cents, margen_cents`;

const FILTROS: readonly (EstadoObra | null)[] = [null, ...ESTADOS_OBRA];

function filtroClases(activo: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset transition-colors duration-150",
    activo
      ? "bg-slate-900 text-white ring-slate-900"
      : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50 hover:ring-stone-400",
  );
}

function plural(n: number): string {
  return `${n} ${n === 1 ? "obra" : "obras"}`;
}

interface ObrasPageProps {
  searchParams: Promise<{ estado?: string | string[]; pagina?: string | string[] }>;
}

export default async function ObrasPage({ searchParams }: ObrasPageProps) {
  const params = await searchParams;
  const paginaPedida = parsePagina(params.pagina);
  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);

  // Sin filtro en la URL: «En curso» si hay alguna obra en curso; si no, todas.
  let hayEnCurso = false;
  if (filtroObrasPendienteDeConteo(params.estado)) {
    const { count } = await supabase.from("obras").select("id", { count: "exact", head: true }).eq("estado", "en_curso");
    hayEnCurso = (count ?? 0) > 0;
  }
  const filtro = filtroObras(params.estado, hayEnCurso);

  const consulta = (head = false) => {
    let query = supabase.from("obras_resumen").select(admin ? COLUMNAS_GERENCIA : COLUMNAS, { count: "exact", head });
    if (filtro) query = query.eq("estado", filtro);
    // id como desempate: el orden es estable entre páginas.
    return query.order("created_at", { ascending: false }).order("id");
  };

  const [pagina, perfilesRes] = await Promise.all([
    leerPagina(
      paginaPedida,
      (desde, hasta) => consulta().range(desde, hasta).overrideTypes<ObraFila[], { merge: false }>(),
      () => consulta(true),
    ),
    supabase.from("perfiles").select("id, nombre").overrideTypes<{ id: string; nombre: string }[], { merge: false }>(),
  ]);
  const { filas, total, error } = pagina;
  const nombres = new Map((perfilesRes.data ?? []).map((p) => [p.id, p.nombre]));

  const estado = paginacion(paginaPedida, total);
  const href = (n: number) => hrefPagina("/obras", { estado: filtro ?? FILTRO_TODAS }, n);
  const resumen = filtro ? `${plural(total)} en «${ETIQUETAS_ESTADO_OBRA[filtro]}»` : plural(total);

  return (
    <>
      <PageHeader
        title="Obras"
        description={
          error
            ? undefined
            : `${resumen}. Cada presupuesto aceptado es una obra: aquí se ve lo que lleva gastado frente a lo presupuestado.`
        }
      />

      <nav aria-label="Filtrar por estado" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2 pb-1">
          {FILTROS.map((estadoFiltro) => {
            const activo = estadoFiltro === filtro;
            return (
              <li key={estadoFiltro ?? FILTRO_TODAS}>
                <Link
                  href={obrasHref(estadoFiltro)}
                  aria-current={activo ? "page" : undefined}
                  className={filtroClases(activo)}
                >
                  {estadoFiltro && (
                    <span aria-hidden="true" className={cn("size-2 rounded-full", PUNTO_ESTADO_OBRA[estadoFiltro])} />
                  )}
                  {estadoFiltro ? ETIQUETAS_ESTADO_OBRA[estadoFiltro] : "Todas"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {error ? (
        <Alert title="No se han podido cargar las obras">{dbErrorMessage(error)}</Alert>
      ) : estado.fueraDeRango ? (
        <PaginaFueraDeRango estado={estado} href={href} />
      ) : filas.length === 0 ? (
        filtro ? (
          <EmptyState
            icon={<ConoIcon className="size-6" />}
            title={`No hay obras en «${ETIQUETAS_ESTADO_OBRA[filtro]}»`}
            description="Prueba con otro estado o mira todas las obras."
            action={<LinkButton href={obrasHref(null)}>Ver todas</LinkButton>}
          />
        ) : (
          <EmptyState
            icon={<ConoIcon className="size-6" />}
            title="Todavía no hay obras"
            description="Cuando un cliente acepte un presupuesto, su obra aparecerá aquí."
            action={<LinkButton href="/presupuestos?estado=enviado">Ver presupuestos enviados</LinkButton>}
          />
        )
      ) : (
        <>
          <ul
            aria-label={filtro ? `Obras en estado ${ETIQUETAS_ESTADO_OBRA[filtro]}` : "Listado de obras"}
            className="escalonado grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {filas.map((obra) => (
              <li key={obra.id} className="min-w-0">
                <TarjetaObra obra={obra} encargado={obra.encargado_id ? (nombres.get(obra.encargado_id) ?? null) : null} admin={admin} />
              </li>
            ))}
          </ul>
          <Paginacion estado={estado} total={total} href={href} label="Páginas de obras" />
        </>
      )}
    </>
  );
}

function TarjetaObra({ obra, encargado, admin }: { obra: ObraFila; encargado: string | null; admin: boolean }) {
  const consumido = obra.consumido_pct == null ? null : Number(obra.consumido_pct);
  // El semáforo lo calcula la vista; gerencia, si no llegara, lo saca del % (misma regla). El resto no tiene el %.
  const semaforo = parseSemaforo(obra.semaforo) ?? (admin ? semaforoObra(consumido, obra.estado) : null);
  const horas = Number(obra.horas);
  const presupuestado = obra.presupuestado_cents ?? null;
  const costeReal = obra.coste_real_cents ?? null;
  const margen = obra.margen_cents ?? null;
  const sinEmpezar = obra.estado === "pendiente";

  return (
    <Link
      href={`/obras/${obra.id}`}
      className="group flex h-full flex-col rounded-xl border border-stone-200/90 bg-white p-4 shadow-tarjeta transition-[border-color,box-shadow] duration-150 hover:border-amber-400 hover:shadow-elevada active:shadow-none sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold tracking-tight break-words text-stone-900 group-hover:text-amber-800">
            {obra.titulo}
          </h2>
          <p className="mt-0.5 flex min-w-0 gap-1 text-sm text-stone-500">
            <span className="truncate">{obra.cliente_nombre}</span>
            <span className="shrink-0 tabular-nums">· {obra.presupuesto_numero}</span>
          </p>
        </div>
        <ObraEstadoBadge estado={obra.estado} />
      </div>

      <div className="mt-4 flex-1">
        {sinEmpezar && horas === 0 ? (
          <p className="rounded-lg bg-stone-50 px-3 py-2.5 text-sm text-stone-600">
            Sin empezar
            {obra.fecha_inicio ? ` · prevista para el ${formatFechaEnLetra(obra.fecha_inicio)}` : " · aún no tiene partes"}
          </p>
        ) : !semaforo ? null : !admin ? (
          // Quien no es gerencia ve solo el semáforo: ni importes, ni % ni barra proporcional (D12).
          <p className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2.5 text-sm">
            <span className="text-stone-600">Cómo va</span>
            <SemaforoObra semaforo={semaforo} className="text-sm" />
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {costeReal !== null && presupuestado !== null ? (
                <span className="min-w-0 text-stone-600">
                  <span className="font-semibold text-stone-900 tabular-nums">{formatEuros(costeReal)}</span> de{" "}
                  <span className="tabular-nums">{formatEuros(presupuestado)}</span>
                </span>
              ) : (
                <span className="text-stone-600">Consumido del presupuesto</span>
              )}
              <span
                className={cn(
                  "shrink-0 font-semibold tabular-nums",
                  semaforo === "rojo" ? "text-red-700" : semaforo === "ambar" ? "text-amber-800" : "text-stone-900",
                )}
              >
                {formatConsumido(consumido)}
              </span>
            </div>
            <BarraConsumo consumidoPct={consumido} semaforo={semaforo} className="mt-2" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <SemaforoObra semaforo={semaforo} />
              {margen !== null && (
                <span className="text-xs text-stone-500">
                  Margen{" "}
                  <span className={cn("font-semibold tabular-nums", margen < 0 ? "text-red-700" : "text-green-700")}>
                    {formatEuros(margen)}
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-stone-100 pt-3 text-xs">
        <div className="min-w-0">
          <dt className="text-stone-500">Encargado</dt>
          <dd className="mt-0.5 truncate font-medium text-stone-800">{encargado ?? "Sin asignar"}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Horas</dt>
          <dd className="mt-0.5 font-medium text-stone-800 tabular-nums">{formatHoras(horas)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-stone-500">Último parte</dt>
          <dd className="mt-0.5 truncate font-medium text-stone-800">
            {obra.ultimo_parte ? formatFechaEnLetra(obra.ultimo_parte) : "Ninguno"}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
