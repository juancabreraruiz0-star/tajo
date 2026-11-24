import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BarraConsumo, ObraEstadoBadge, SemaforoDestacado, SemaforoObra } from "@/components/obra";
import { CalendarIcon, ChartIcon, ClockIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { PaginaFueraDeRango, Paginacion } from "@/components/ui/paginacion";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { formatFechaEnLetra } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import {
  accionesEstadoObra,
  admitePartesNuevos,
  camposEditablesObra,
  errorParteNuevo,
  puedeGestionarObra,
  semaforoObra,
} from "@/lib/domain/obras";
import {
  AVISO_FIN_PREVISTA_QUITADA,
  confirmacionEstadoObra,
  formatConsumido,
  formatHoras,
  parseSemaforo,
  parteEditablePor,
  textoAccionEstadoObra,
} from "@/lib/domain/obras-pantalla";
import { hrefPagina, paginacion, parsePagina } from "@/lib/domain/paginacion";
import { formatQuantity } from "@/lib/domain/quantity";
import { isUuid } from "@/lib/domain/validation";
import { leerPagina } from "@/lib/paginar";
import type { ObraResumen, Parte, ParteMaterial } from "@/lib/types";
import { AccionesEstadoObra, AsignarEncargado, BorrarParte, DatosObraForm } from "./acciones";

export const metadata: Metadata = { title: "Obra" };

type ObraDetalle = Pick<
  ObraResumen,
  | "id"
  | "presupuesto_id"
  | "cliente_id"
  | "titulo"
  | "encargado_id"
  | "estado"
  | "fecha_inicio"
  | "fecha_fin_prevista"
  | "fecha_fin"
  | "notas"
  | "cliente_nombre"
  | "presupuesto_numero"
  | "horas"
  | "num_partes"
  | "semaforo"
> &
  // % consumido e importes: solo se piden (y llegan) para gerencia.
  Partial<
    Pick<
      ObraResumen,
      | "consumido_pct"
      | "presupuestado_cents"
      | "coste_mano_obra_cents"
      | "coste_material_cents"
      | "coste_real_cents"
      | "margen_cents"
    >
  >;

const COLUMNAS =
  "id, presupuesto_id, cliente_id, titulo, encargado_id, estado, fecha_inicio, fecha_fin_prevista, fecha_fin, notas, " +
  "cliente_nombre, presupuesto_numero, horas, num_partes, semaforo";
/**
 * Gerencia ve además el % consumido y los importes. Al resto no se le piden (y la vista se los da a null, D12): solo
 * ve el semáforo, porque con la base del presupuesto y el % se reconstruiría el margen.
 */
const COLUMNAS_GERENCIA =
  `${COLUMNAS}, consumido_pct, presupuestado_cents, coste_mano_obra_cents, coste_material_cents, coste_real_cents, ` +
  "margen_cents";

type ParteFila = Pick<Parte, "id" | "fecha" | "autor_id" | "horas" | "notas" | "created_at">;
type MaterialFila = Pick<ParteMaterial, "id" | "parte_id" | "material_nombre" | "unidad" | "cantidad">;

const ETIQUETA = "text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase";

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={ETIQUETA}>{label}</dt>
      <dd className="mt-1 text-sm break-words text-stone-900">{children}</dd>
    </div>
  );
}

const sinDato = <span className="text-stone-500">—</span>;

interface ObraPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pagina?: string | string[]; aviso?: string | string[] }>;
}

export default async function ObraPage({ params, searchParams }: ObraPageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { pagina, aviso } = await searchParams;
  const paginaPartes = parsePagina(pagina);

  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);

  const consultaPartes = (head = false) =>
    supabase
      .from("partes")
      .select("id, fecha, autor_id, horas, notas, created_at", { count: "exact", head })
      .eq("obra_id", id)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id");

  const [obraRes, partesRes, perfilesRes] = await Promise.all([
    supabase
      .from("obras_resumen")
      .select(admin ? COLUMNAS_GERENCIA : COLUMNAS)
      .eq("id", id)
      .maybeSingle<ObraDetalle>(),
    leerPagina(
      paginaPartes,
      (desde, hasta) => consultaPartes().range(desde, hasta).overrideTypes<ParteFila[], { merge: false }>(),
      () => consultaPartes(true),
    ),
    supabase
      .from("perfiles")
      .select("id, nombre")
      .order("nombre")
      .overrideTypes<{ id: string; nombre: string }[], { merge: false }>(),
  ]);

  if (obraRes.error) return <Alert title="No se ha podido cargar la obra">{dbErrorMessage(obraRes.error)}</Alert>;
  const obra = obraRes.data;
  if (!obra) notFound();

  const partes = partesRes.filas.map((p) => ({ ...p, horas: Number(p.horas) }));
  const materialesRes =
    partes.length > 0
      ? await supabase
          .from("parte_materiales")
          .select("id, parte_id, material_nombre, unidad, cantidad")
          .in(
            "parte_id",
            partes.map((p) => p.id),
          )
          .order("material_nombre")
          .overrideTypes<MaterialFila[], { merge: false }>()
      : null;
  const materialesPorParte = new Map<string, MaterialFila[]>();
  for (const m of materialesRes?.data ?? []) {
    materialesPorParte.set(m.parte_id, [...(materialesPorParte.get(m.parte_id) ?? []), { ...m, cantidad: Number(m.cantidad) }]);
  }

  const personas = perfilesRes.data ?? [];
  const nombres = new Map(personas.map((p) => [p.id, p.nombre]));
  const encargado = obra.encargado_id ? (nombres.get(obra.encargado_id) ?? null) : null;

  const ahora = new Date();
  const esEncargado = obra.encargado_id === perfil.id;
  const gestiona = puedeGestionarObra(perfil.rol, esEncargado);
  const acciones = accionesEstadoObra(obra.estado, perfil.rol, esEncargado).map((destino) => ({
    destino,
    label: textoAccionEstadoObra(obra.estado, destino),
    confirmacion: confirmacionEstadoObra(destino),
  }));
  const admiteParte = admitePartesNuevos(obra.estado);
  const motivoSinPartes = errorParteNuevo(obra.estado);
  // Empezar o reanudar es lo que hace falta para apuntar partes: se ofrece junto al motivo, arriba.
  const accionReanudar = acciones.filter((a) => a.destino === "en_curso");
  const accionesCabecera = acciones.filter((a) => a.destino !== "en_curso");

  const consumido = obra.consumido_pct == null ? null : Number(obra.consumido_pct);
  // El semáforo lo calcula la vista; gerencia, si no llegara, lo saca del % (misma regla). El resto no tiene el %.
  const semaforo = parseSemaforo(obra.semaforo) ?? (admin ? semaforoObra(consumido, obra.estado) : null);
  // Al empezarla se quitó la fin prevista porque ya había pasado (cambiarEstadoObra): se avisa junto a la fecha.
  const finPrevistaQuitada = aviso === AVISO_FIN_PREVISTA_QUITADA && obra.fecha_fin_prevista === null;
  const horas = Number(obra.horas);

  const estadoPaginacion = paginacion(paginaPartes, partesRes.total);
  const hrefPartes = (n: number) => `${hrefPagina(`/obras/${id}`, {}, n)}#partes`;
  const errorCarga = partesRes.error ?? perfilesRes.error ?? materialesRes?.error ?? null;

  return (
    <>
      <PageHeader
        title={obra.titulo}
        back={{ href: "/obras", label: "Obras" }}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ObraEstadoBadge estado={obra.estado} />
            <Link href={`/clientes/${obra.cliente_id}`} className="font-medium text-amber-800 hover:underline">
              {obra.cliente_nombre}
            </Link>
            <span aria-hidden="true">·</span>
            <Link href={`/presupuestos/${obra.presupuesto_id}`} className="text-stone-700 tabular-nums hover:underline">
              Presupuesto {obra.presupuesto_numero}
            </Link>
          </span>
        }
        actions={
          accionesCabecera.length > 0 || admiteParte ? (
            <>
              {admiteParte && (
                <LinkButton href={`/obras/${id}/partes/nuevo`} variant="primary" className="flex-1 sm:flex-none">
                  <PlusIcon className="size-4" />
                  Añadir parte
                </LinkButton>
              )}
              <AccionesEstadoObra obraId={id} acciones={accionesCabecera} />
            </>
          ) : undefined
        }
      />

      {errorCarga && (
        <Alert tone="warning" title="Faltan datos de la obra" className="mb-6">
          {dbErrorMessage(errorCarga)}
        </Alert>
      )}

      {!admiteParte && motivoSinPartes && (
        <Alert tone={obra.estado === "terminada" ? "info" : "warning"} className="mb-6">
          <p>{motivoSinPartes}</p>
          {accionReanudar.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <AccionesEstadoObra obraId={id} acciones={accionReanudar} />
            </div>
          ) : (
            obra.estado !== "terminada" && (
              <p className="mt-1">Pídeselo a gerencia o al encargado de la obra.</p>
            )
          )}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <section aria-labelledby="costes-titulo">
              <div className="flex items-start gap-3 border-b border-stone-100 px-4 py-3.5 sm:px-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200/70 ring-inset">
                  <ChartIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="costes-titulo" className="text-[0.9375rem] font-semibold tracking-tight text-stone-900">
                    Control de costes
                  </h2>
                  <p className="mt-0.5 text-sm text-pretty text-stone-500">
                    {admin
                      ? "Base del presupuesto (sin IVA) frente a lo gastado en mano de obra y material."
                      : "Cómo va lo gastado en mano de obra y material frente a lo presupuestado. Las cifras las ve gerencia."}
                  </p>
                </div>
              </div>
              <CardBody className="space-y-5">
                {admin &&
                obra.presupuestado_cents != null &&
                obra.coste_real_cents != null &&
                obra.margen_cents != null ? (
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                    <Dato label="Presupuestado">
                      <span className="text-lg font-semibold tracking-tight tabular-nums">
                        {formatEuros(obra.presupuestado_cents)}
                      </span>
                    </Dato>
                    <Dato label="Coste real">
                      <span className="text-lg font-semibold tracking-tight tabular-nums">
                        {formatEuros(obra.coste_real_cents)}
                      </span>
                    </Dato>
                    <div className="col-span-2 min-w-0 rounded-lg bg-stone-50 px-3 py-2 sm:col-span-1 sm:bg-transparent sm:p-0">
                      <dt className={ETIQUETA}>Margen</dt>
                      <dd
                        className={cn(
                          "mt-1 text-lg font-semibold tracking-tight tabular-nums",
                          obra.margen_cents < 0 ? "text-red-700" : "text-green-700",
                        )}
                      >
                        {formatEuros(obra.margen_cents)}
                        {obra.margen_cents < 0 && <span className="ml-1.5 text-xs font-medium">en pérdidas</span>}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                {admin && semaforo ? (
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm text-stone-600">Consumido del presupuesto</p>
                      <p
                        className={cn(
                          "text-base font-semibold tracking-tight tabular-nums",
                          semaforo === "rojo" ? "text-red-700" : semaforo === "ambar" ? "text-amber-800" : "text-stone-950",
                        )}
                      >
                        {formatConsumido(consumido)}
                      </p>
                    </div>
                    <BarraConsumo consumidoPct={consumido} semaforo={semaforo} className="mt-2 h-2.5" />
                    <SemaforoObra semaforo={semaforo} className="mt-2" />
                  </div>
                ) : semaforo ? (
                  <SemaforoDestacado semaforo={semaforo} />
                ) : (
                  <p className="text-sm text-stone-500">No se ha podido saber cómo va la obra.</p>
                )}

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-stone-100 pt-4 text-sm">
                  <div>
                    <dt className="text-stone-500">Mano de obra</dt>
                    <dd className="mt-0.5 font-medium text-stone-900 tabular-nums">
                      {formatHoras(horas)}
                      {admin && obra.coste_mano_obra_cents != null && (
                        <span className="font-normal text-stone-500"> · {formatEuros(obra.coste_mano_obra_cents)}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">{admin ? "Materiales" : "Partes"}</dt>
                    <dd className="mt-0.5 font-medium text-stone-900 tabular-nums">
                      {admin && obra.coste_material_cents != null
                        ? formatEuros(obra.coste_material_cents)
                        : `${obra.num_partes} ${obra.num_partes === 1 ? "parte" : "partes"}`}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </section>
          </Card>

          <section aria-labelledby="partes" className="scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="partes" className="scroll-mt-20 text-lg font-semibold tracking-tight text-stone-900">
                Partes de trabajo{" "}
                <span className="text-sm font-normal text-stone-500 tabular-nums">({partesRes.total})</span>
              </h2>
              {admiteParte && (
                <LinkButton href={`/obras/${id}/partes/nuevo`} size="sm" variant="secondary">
                  <PlusIcon className="size-4" />
                  Añadir parte
                </LinkButton>
              )}
            </div>

            {partesRes.error ? (
              <Alert title="No se han podido cargar los partes">{dbErrorMessage(partesRes.error)}</Alert>
            ) : estadoPaginacion.fueraDeRango ? (
              <PaginaFueraDeRango estado={estadoPaginacion} href={hrefPartes} />
            ) : partes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white/70 px-4 py-8 text-center text-sm text-stone-500">
                {admiteParte
                  ? "Aún no hay partes. Apunta el primero con las horas y el material de hoy."
                  : "Esta obra no tiene partes de trabajo."}
              </p>
            ) : (
              <>
                <ol className="space-y-3">
                  {partes.map((parte) => {
                    const materiales = materialesPorParte.get(parte.id) ?? [];
                    const editable = parteEditablePor(parte, perfil, obra.estado, ahora);
                    const autor = parte.autor_id ? (nombres.get(parte.autor_id) ?? "Usuario borrado") : "Usuario borrado";
                    return (
                      <li key={parte.id}>
                        <Card className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-stone-900">
                                <time dateTime={parte.fecha}>{formatFechaEnLetra(parte.fecha)}</time>
                              </p>
                              <p className="mt-0.5 truncate text-sm text-stone-500">
                                {autor}
                                {parte.autor_id === perfil.id && " (tú)"}
                              </p>
                            </div>
                            <p className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-sm font-semibold text-stone-900 tabular-nums">
                              <ClockIcon className="size-4 text-stone-500" />
                              {formatHoras(parte.horas)}
                            </p>
                          </div>
                          {parte.notas && (
                            <p className="mt-3 text-sm text-pretty whitespace-pre-line text-stone-700">{parte.notas}</p>
                          )}
                          {materiales.length > 0 && (
                            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Material gastado">
                              {materiales.map((m) => (
                                <li
                                  key={m.id}
                                  className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-950 ring-1 ring-amber-200/70 ring-inset"
                                >
                                  {m.material_nombre}{" "}
                                  <span className="font-semibold tabular-nums">
                                    {formatQuantity(m.cantidad)} {m.unidad}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {editable && (
                            <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-stone-100 pt-3">
                              <LinkButton
                                href={`/obras/${id}/partes/${parte.id}/editar`}
                                variant="ghost"
                                size="sm"
                                aria-label={`Editar el parte del ${formatFechaEnLetra(parte.fecha)}`}
                              >
                                <PencilIcon className="size-4" />
                                Editar
                              </LinkButton>
                              <BorrarParte obraId={id} parteId={parte.id} />
                            </div>
                          )}
                        </Card>
                      </li>
                    );
                  })}
                </ol>
                <Paginacion
                  estado={estadoPaginacion}
                  total={partesRes.total}
                  href={hrefPartes}
                  label="Páginas de partes de trabajo"
                />
              </>
            )}
          </section>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader title="Datos de la obra" />
          <CardBody className="space-y-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Dato label="Inicio">
                {obra.fecha_inicio ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="size-4 text-stone-400" />
                    {formatFechaEnLetra(obra.fecha_inicio)}
                  </span>
                ) : (
                  sinDato
                )}
                {obra.estado === "pendiente" && obra.fecha_inicio && (
                  <span className="block text-xs text-stone-500">prevista</span>
                )}
              </Dato>
              <Dato label="Fin prevista">
                {obra.fecha_fin_prevista ? formatFechaEnLetra(obra.fecha_fin_prevista) : sinDato}
                {finPrevistaQuitada && (
                  <span role="status" className="mt-1 block text-xs text-pretty text-amber-800">
                    Ya había pasado y se ha quitado al empezar la obra: pon una nueva.
                  </span>
                )}
              </Dato>
              {obra.fecha_fin && <Dato label="Fin real">{formatFechaEnLetra(obra.fecha_fin)}</Dato>}
              {!(admin && obra.estado !== "terminada") && (
                <Dato label="Encargado">{encargado ?? <span className="text-stone-500">Sin asignar</span>}</Dato>
              )}
            </dl>

            {admin && obra.estado !== "terminada" && (
              <div className="border-t border-stone-100 pt-4">
                <AsignarEncargado
                  obraId={id}
                  actual={obra.encargado_id}
                  opciones={personas.map((p) => ({ value: p.id, label: p.nombre || "Sin nombre" }))}
                />
              </div>
            )}

            <div className="border-t border-stone-100 pt-4">
              {gestiona ? (
                <DatosObraForm
                  obraId={id}
                  finPrevista={obra.fecha_fin_prevista}
                  notas={obra.notas}
                  fechaInicio={obra.fecha_inicio}
                  editaPrevista={camposEditablesObra(obra.estado).includes("fecha_fin_prevista")}
                />
              ) : (
                <dl>
                  <Dato label="Notas">
                    {obra.notas ? <span className="whitespace-pre-line">{obra.notas}</span> : sinDato}
                  </Dato>
                </dl>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
