import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EstadoBadge } from "@/components/estado-badge";
import { ConoIcon, PencilIcon } from "@/components/icons";
import { LineaTiempo } from "@/components/linea-tiempo";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { textoAceptacion, textoEnviadoPor } from "@/lib/domain/aceptacion";
import { formatFecha } from "@/lib/domain/dates";
import { lineaDeTiempo } from "@/lib/domain/linea-tiempo";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { isExpired, validUntil } from "@/lib/domain/presupuestos";
import { formatQuantity } from "@/lib/domain/quantity";
import { nextActions } from "@/lib/domain/status";
import { budgetTotals, lineTotalCents } from "@/lib/domain/totals";
import { isUuid } from "@/lib/domain/validation";
import { getRequestOrigin } from "@/lib/request-origin";
import type { Obra, Presupuesto, PresupuestoLinea } from "@/lib/types";
import { CambiarEstado, EnlacePublico, Facturar, RegenerarEnlace } from "./acciones";

export const metadata: Metadata = { title: "Presupuesto" };

/** La IP y el navegador de la aceptación (0007, D12) solo se piden para gerencia: al resto no le llegan. */
type PresupuestoDetalle = Omit<Presupuesto, "aceptado_ip" | "aceptado_user_agent"> &
  Partial<Pick<Presupuesto, "aceptado_ip" | "aceptado_user_agent">>;

const COLUMNAS_PRESUPUESTO =
  "id, empresa_id, cliente_id, numero, titulo, estado, iva_pct, validez_dias, token, created_at, enviado_at, " +
  "aceptado_at, aceptado_por, aceptado_canal, aceptado_nombre, enviado_por";
const COLUMNAS_PRESUPUESTO_GERENCIA = `${COLUMNAS_PRESUPUESTO}, aceptado_ip, aceptado_user_agent`;

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
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words text-stone-900">{children}</dd>
    </div>
  );
}

const pendiente = <span className="text-stone-500">—</span>;

export default async function PresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { perfil, supabase } = await getSessionProfile();
  const admin = isAdmin(perfil);

  const [presupuestoRes, lineasRes] = await Promise.all([
    supabase
      .from("presupuestos")
      .select(admin ? COLUMNAS_PRESUPUESTO_GERENCIA : COLUMNAS_PRESUPUESTO)
      .eq("id", id)
      .maybeSingle<PresupuestoDetalle>(),
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

  // Gerencia puede regenerar el enlace en cualquier estado salvo borrador: también hace falta el origen.
  const necesitaOrigen = presupuesto.estado === "enviado" || (admin && presupuesto.estado !== "borrador");

  // Misma regla que aceptar_presupuesto() y que el trigger (0004): vencido, nadie puede aceptarlo.
  const vencido = presupuesto.estado === "enviado" && isExpired(presupuesto.created_at, presupuesto.validez_dias);
  // WhatsApp solo mientras el cliente puede aceptarlo: con la validez vencida no se le manda el enlace.
  const ofrecerWhatsApp = presupuesto.estado === "enviado" && !vencido;
  const conObra = presupuesto.estado === "aceptado" || presupuesto.estado === "facturado";

  // Quién lo dio por aceptado (gerencia) y quién lo envió: nombres de perfiles de la empresa.
  const perfilIds = [
    ...new Set([presupuesto.aceptado_por, presupuesto.enviado_por].filter((p): p is string => p !== null)),
  ];

  const [clienteRes, materialesRes, facturaRes, perfilesRes, origin, obraRes, empresaRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nombre, telefono")
      .eq("id", presupuesto.cliente_id)
      .maybeSingle<{ id: string; nombre: string; telefono: string | null }>(),
    materialIds.length > 0
      ? supabase
          .from("materiales")
          .select("id, unidad")
          .in("id", materialIds)
          .overrideTypes<{ id: string; unidad: string }[], { merge: false }>()
      : null,
    // La factura solo la ve gerencia (R2).
    admin && presupuesto.estado === "facturado"
      ? supabase
          .from("facturas")
          .select("id, numero, fecha")
          .eq("presupuesto_id", id)
          .maybeSingle<{ id: string; numero: string; fecha: string }>()
      : null,
    perfilIds.length > 0
      ? supabase
          .from("perfiles")
          .select("id, nombre")
          .in("id", perfilIds)
          .overrideTypes<{ id: string; nombre: string }[], { merge: false }>()
      : null,
    necesitaOrigen ? getRequestOrigin() : null,
    // La obra se crea sola al aceptar (0006).
    conObra
      ? supabase
          .from("obras")
          .select("id, estado, fecha_inicio, fecha_fin")
          .eq("presupuesto_id", id)
          .maybeSingle<Pick<Obra, "id" | "estado" | "fecha_inicio" | "fecha_fin">>()
      : null,
    // Nombre de la empresa para firmar el mensaje de WhatsApp.
    ofrecerWhatsApp
      ? supabase.from("empresas").select("nombre").eq("id", perfil.empresa_id).maybeSingle<{ nombre: string }>()
      : null,
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

  const validoHasta = validUntil(presupuesto.created_at, presupuesto.validez_dias);
  const acciones = nextActions(presupuesto.estado, perfil.rol, { vencido });
  const cliente = clienteRes.data;
  const factura = facturaRes?.data ?? null;
  const obra = obraRes?.data ?? null;
  const nombresPerfiles = new Map((perfilesRes?.data ?? []).map((p) => [p.id, p.nombre]));
  const nombrePerfil = (perfilId: string | null) => (perfilId ? (nombresPerfiles.get(perfilId) ?? null) : null);
  const aceptadoPor = nombrePerfil(presupuesto.aceptado_por);
  const enviadoPor = nombrePerfil(presupuesto.enviado_por);
  const constanciaAceptacion = textoAceptacion({
    canal: presupuesto.aceptado_canal,
    aceptadoAt: presupuesto.aceptado_at,
    aceptadoNombre: presupuesto.aceptado_nombre,
    aceptadoPor,
  });
  const constanciaEnvio = textoEnviadoPor(enviadoPor, presupuesto.enviado_at);
  // IP y navegador de la aceptación por enlace: solo llegan a gerencia.
  const evidencia =
    presupuesto.aceptado_canal === "enlace" && (presupuesto.aceptado_ip || presupuesto.aceptado_user_agent)
      ? { ip: presupuesto.aceptado_ip ?? null, navegador: presupuesto.aceptado_user_agent ?? null }
      : null;
  const hitos = lineaDeTiempo({
    estado: presupuesto.estado,
    created_at: presupuesto.created_at,
    enviado_at: presupuesto.enviado_at,
    aceptado_at: presupuesto.aceptado_at,
    aceptado_canal: presupuesto.aceptado_canal,
    aceptadoPor,
    aceptadoNombre: presupuesto.aceptado_nombre,
    enviadoPor,
    vencido,
    validoHasta: formatFecha(validoHasta),
    factura,
    obra,
  });
  const errorCarga =
    lineasRes.error ??
    clienteRes.error ??
    materialesRes?.error ??
    facturaRes?.error ??
    perfilesRes?.error ??
    obraRes?.error ??
    // Sin el nombre de la empresa, el mensaje de WhatsApp saldría sin firma: mejor avisar.
    empresaRes?.error ??
    null;

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
          ) : obra ? (
            <LinkButton href={`/obras/${obra.id}`}>
              <ConoIcon className="size-4" />
              Ver la obra
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
          La validez venció el {formatFecha(validoHasta)}: el cliente ya no puede aceptarlo desde el enlace ni se puede
          dar por aceptado. Puedes marcarlo como rechazado y preparar uno nuevo con la validez al día.
        </Alert>
      )}

      <Card className="mb-6 px-4 py-5 sm:px-6">
        <section aria-labelledby="estado-titulo">
          <h2 id="estado-titulo" className="sr-only">
            Historial del presupuesto
          </h2>
          <LineaTiempo hitos={hitos} />
        </section>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4 sm:p-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
              <Dato label="Cliente">
                {cliente ? (
                  <Link href={`/clientes/${cliente.id}`} className="font-medium text-amber-700 hover:underline">
                    {cliente.nombre}
                  </Link>
                ) : (
                  pendiente
                )}
              </Dato>
              <Dato label="Validez">
                {presupuesto.validez_dias} días
                <span className="block text-xs text-stone-500 tabular-nums">hasta el {formatFecha(validoHasta)}</span>
              </Dato>
              <Dato label="IVA">{presupuesto.iva_pct} %</Dato>
              <Dato label="Total">
                <span className="font-semibold tabular-nums">{formatEuros(totales.totalCents)}</span>
              </Dato>
            </dl>
          </Card>

          {(constanciaEnvio || constanciaAceptacion) && (
            <Card className="p-4 sm:p-6">
              <section aria-labelledby="constancia-titulo" className="space-y-2 text-sm text-stone-700">
                <h2 id="constancia-titulo" className="text-[0.9375rem] font-semibold tracking-tight text-stone-900">
                  Constancia
                </h2>
                {constanciaEnvio && <p>{constanciaEnvio}.</p>}
                {constanciaAceptacion && <p className="font-medium text-stone-900">{constanciaAceptacion}.</p>}
                {evidencia && (
                  <details className="rounded-lg bg-stone-50 px-3 py-2 text-stone-600">
                    <summary className="cursor-pointer rounded-sm text-sm font-medium text-stone-700 select-none hover:text-amber-800">
                      IP y navegador de la aceptación
                    </summary>
                    <dl className="mt-2 space-y-1.5 text-xs">
                      <div>
                        <dt className="inline font-semibold text-stone-700">IP: </dt>
                        <dd className="inline font-mono break-all">{evidencia.ip ?? "no consta"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-stone-700">Navegador: </dt>
                        <dd className="inline font-mono break-all">{evidencia.navegador ?? "no consta"}</dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs text-pretty text-stone-500">
                      Los registra el servidor de Tajo al aceptar. Son una constancia razonable, no una prueba forense:
                      el enlace es al portador.
                    </p>
                  </details>
                )}
              </section>
            </Card>
          )}

          <section aria-labelledby="partidas-titulo">
            <h2 id="partidas-titulo" className="mb-3 text-lg font-semibold tracking-tight text-stone-900">
              Partidas{" "}
              <span className="text-sm font-normal text-stone-500 tabular-nums">({lineas.length})</span>
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
                <div className="flex items-baseline justify-between gap-4 border-t border-stone-200 pt-3">
                  <dt className="font-semibold text-stone-900">Total</dt>
                  <dd className="text-xl font-semibold tracking-tight text-stone-950 tabular-nums">
                    {formatEuros(totales.totalCents)}
                  </dd>
                </div>
              </dl>
            </Card>
          </section>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
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
                {acciones.includes("copiar_enlace") && (
                  <EnlacePublico
                    token={presupuesto.token}
                    serverOrigin={origin}
                    whatsapp={
                      ofrecerWhatsApp
                        ? {
                            cliente: cliente?.nombre ?? null,
                            telefono: cliente?.telefono ?? null,
                            titulo: presupuesto.titulo,
                            empresa: empresaRes?.data?.nombre ?? null,
                          }
                        : undefined
                    }
                  />
                )}
                <p className="border-t border-stone-200 pt-4">
                  {vencido
                    ? "La validez ha vencido: ya no se puede aceptar."
                    : admin
                      ? "El cliente puede aceptarlo desde el enlace. Si te lo confirma por otra vía (teléfono, correo), puedes darlo por aceptado tú; quedará constancia de que lo hizo gerencia."
                      : "El cliente puede aceptarlo desde el enlace. Si te lo confirma por otra vía, avisa a gerencia para que lo dé por aceptado."}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  {acciones.includes("marcar_aceptado") && (
                    <CambiarEstado
                      id={id}
                      destino="aceptado"
                      label="Dar por aceptado"
                      pendingText="Guardando…"
                      confirmacion="¿Dar el presupuesto por aceptado? Quedará registrado que lo has aceptado tú (gerencia) y no el cliente desde el enlace."
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
                  <p>
                    {presupuesto.aceptado_canal === "interno"
                      ? "Gerencia lo ha dado por aceptado."
                      : "El cliente lo ha aceptado."}{" "}
                    Al facturarlo se descuenta del almacén el material de las partidas. El cliente tiene que tener NIF.
                  </p>
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

            {acciones.includes("regenerar_enlace") && (
              <div className="space-y-2 border-t border-stone-200 pt-4">
                <p>¿El enlace ha llegado a quien no debía? Genera uno nuevo: el anterior dejará de funcionar.</p>
                <RegenerarEnlace id={id} serverOrigin={origin} enlaceVisible={acciones.includes("copiar_enlace")} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
