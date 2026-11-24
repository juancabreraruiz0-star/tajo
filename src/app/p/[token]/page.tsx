import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import {
  ArrowRightIcon,
  ClockIcon,
  EyeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  XCircleIcon,
} from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { formatFechaEnLetra } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { isExpired, parsePresupuestoPublico, validUntil, type PresupuestoPublico } from "@/lib/domain/presupuestos";
import { formatQuantity } from "@/lib/domain/quantity";
import type { EstadoPresupuesto } from "@/lib/domain/status";
import { isUuid } from "@/lib/domain/validation";
import { createAnonClient } from "@/lib/supabase/anon";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { Aceptar } from "./aceptar";
import { AvisoAceptado } from "./aviso-aceptado";
import { PiePublico } from "./pie";

type Carga =
  | { tipo: "ok"; datos: PresupuestoPublico }
  | { tipo: "no_disponible" }
  | { tipo: "error"; titulo: string; mensaje: string };

/** Lee el presupuesto por token con el rol anon (presupuesto_publico). Compartido por la página y los metadatos. */
const cargarPresupuesto = cache(async (token: string): Promise<Carga> => {
  // Siempre en tiempo de petición: el estado cambia cuando el cliente acepta.
  await connection();
  if (!isUuid(token)) return { tipo: "no_disponible" };
  const supabase = createAnonClient();
  // Sin configuración de Supabase no es que el presupuesto no exista: el servicio no está disponible.
  if (!supabase) {
    return {
      tipo: "error",
      titulo: "El servicio no está disponible ahora mismo",
      mensaje: "No podemos mostrar el presupuesto en este momento.",
    };
  }

  const { data, error } = await supabase.rpc("presupuesto_publico", { p_token: token });
  if (error) return { tipo: "error", titulo: "No hemos podido cargar el presupuesto", mensaje: dbErrorMessage(error) };
  const datos = parsePresupuestoPublico(data);
  return datos ? { tipo: "ok", datos } : { tipo: "no_disponible" };
});

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * ¿Quien abre el enlace tiene sesión en Tajo (gerencia o un encargado)? Se mira en el servidor con el cliente de
 * Supabase de sesión, solo para no ofrecerle el botón de aceptar. La aceptación sigue yendo con el cliente anónimo.
 */
async function abiertoPorEmpleado(): Promise<boolean> {
  if (!readSupabaseEnv()) return false;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user !== null;
}

/** Iniciales de la empresa para su sello: «Reformas Levante S.L.» → «RL». */
function iniciales(nombre: string): string {
  const palabras = nombre
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p) && !/^(s\.?l\.?u?|s\.?a\.?|sl|sa|y|de|del|la|el)$/i.test(p));
  return (palabras.length > 0 ? palabras : [nombre])
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const carga = await cargarPresupuesto((await params).token);
  if (carga.tipo === "error") return { title: { absolute: carga.titulo } };
  if (carga.tipo !== "ok") return { title: { absolute: "Presupuesto no disponible" } };
  const { empresa, presupuesto } = carga.datos;
  return { title: { absolute: `Presupuesto ${presupuesto.numero} · ${empresa.nombre}` } };
}

type EstadoCliente = { texto: string; clases: string };

/** Cómo ve el cliente el estado (no los nombres internos de la app). */
function estadoParaCliente(estado: EstadoPresupuesto, vencido: boolean): EstadoCliente {
  if (estado === "enviado") {
    return vencido
      ? { texto: "Validez vencida", clases: "bg-amber-50 text-amber-900 ring-amber-300" }
      : { texto: "Pendiente de tu respuesta", clases: "bg-blue-50 text-blue-800 ring-blue-200" };
  }
  if (estado === "aceptado") return { texto: "Aceptado", clases: "bg-green-50 text-green-800 ring-green-200" };
  if (estado === "facturado") return { texto: "Aceptado y facturado", clases: "bg-violet-50 text-violet-800 ring-violet-200" };
  return { texto: "No vigente", clases: "bg-stone-100 text-stone-700 ring-stone-300" };
}

function telHref(telefono: string): string {
  return `tel:${telefono.replace(/[^\d+]/g, "")}`;
}

/** Botones para llamar o escribir a la empresa (avisos de vencido y rechazado). */
function ContactoEmpresa({ telefono, email }: { telefono: string | null; email: string | null }) {
  if (!telefono && !email) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {telefono && (
        <a href={telHref(telefono)} className={buttonClasses("secondary", "md", "flex-1 sm:flex-none")}>
          <PhoneIcon className="size-4" />
          Llamar al {telefono}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={buttonClasses("secondary", "md", "flex-1 sm:flex-none")}>
          <MailIcon className="size-4" />
          Escribir un correo
        </a>
      )}
    </div>
  );
}

const ETIQUETA = "text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase";

export default async function PresupuestoPublicoPage({ params }: PageProps) {
  const { token } = await params;
  const carga = await cargarPresupuesto(token);

  if (carga.tipo === "no_disponible") notFound();
  if (carga.tipo === "error") {
    return (
      <main className="fondo-plano flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10 text-center">
        <div aria-hidden="true" className="franja-obra fixed inset-x-0 top-0 h-1.5" />
        <div role="alert" className="w-full max-w-md rounded-2xl bg-white px-6 py-10 shadow-elevada">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
            <ClockIcon className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-stone-950">{carga.titulo}</h1>
          <p className="mt-2 text-sm text-stone-600">{carga.mensaje}</p>
          <p className="mt-1 text-sm text-stone-600">Vuelve a abrir el enlace dentro de unos minutos.</p>
        </div>
        <PiePublico />
      </main>
    );
  }

  const { empresa, cliente, presupuesto: p, lineas } = carga.datos;
  // La validez cuenta desde el envío (0008, D13).
  const validoHasta = validUntil(p, p.validez_dias);
  const aceptado = p.estado === "aceptado" || p.estado === "facturado";
  // Misma regla que aceptar_presupuesto() (0008): pasado el último día de validez ya no se acepta.
  const vencido = p.estado === "enviado" && isExpired(p, p.validez_dias);
  const sePuedeAceptar = p.estado === "enviado" && !vencido;
  const empleado = sePuedeAceptar && (await abiertoPorEmpleado());
  const estadoCliente = estadoParaCliente(p.estado, vencido);
  const total = formatEuros(carga.datos.total_cents);

  return (
    <main className="min-h-dvh bg-stone-100 print:bg-white">
      <div aria-hidden="true" className="franja-obra h-1.5 print:hidden" />
      <div className="fondo-plano px-3 py-6 sm:px-4 sm:py-12 print:bg-none print:p-0">
        <div className="mx-auto max-w-3xl space-y-4">
          {aceptado && (
            <AvisoAceptado aceptadoAt={p.aceptado_at} empresa={empresa.nombre} facturado={p.estado === "facturado"} />
          )}
          {vencido && (
            <div
              role="status"
              className="animate-entrada rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-5 text-amber-950 sm:px-6 print:hidden"
            >
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-stone-950">
                  <ClockIcon className="size-5" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-base font-semibold">La validez terminó el {formatFechaEnLetra(validoHasta)}</p>
                  <p className="mt-1 text-sm text-pretty text-amber-900">
                    Ya no se puede aceptar desde aquí. Habla con {empresa.nombre} para que te lo actualicen.
                  </p>
                </div>
              </div>
              <ContactoEmpresa telefono={empresa.telefono} email={empresa.email} />
            </div>
          )}
          {p.estado === "rechazado" && (
            <div
              role="status"
              className="animate-entrada rounded-2xl border border-stone-300 bg-white px-5 py-5 text-stone-800 sm:px-6 print:hidden"
            >
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-700">
                  <XCircleIcon className="size-5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-base font-semibold">Este presupuesto ya no está vigente</p>
                  <p className="mt-1 text-sm text-pretty text-stone-600">
                    {empresa.nombre} puede prepararte uno nuevo si quieres retomarlo.
                  </p>
                </div>
              </div>
              <ContactoEmpresa telefono={empresa.telefono} email={empresa.email} />
            </div>
          )}

          <article
            aria-labelledby="presupuesto-titulo"
            className="animate-entrada overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-elevada print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
          >
            {/* Empresa y número */}
            <header className="flex flex-col gap-6 border-b border-stone-200 px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:py-8 print:flex-row print:justify-between print:px-0">
              <div className="flex min-w-0 items-start gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-base font-bold tracking-tight text-amber-400 print:border print:border-stone-300"
                >
                  {iniciales(empresa.nombre)}
                </span>
                <div className="min-w-0">
                  <p className="text-lg leading-tight font-semibold tracking-tight text-stone-950">{empresa.nombre}</p>
                  {empresa.cif && <p className="mt-0.5 text-sm text-stone-500">CIF {empresa.cif}</p>}
                  <address className="mt-3 space-y-1.5 text-sm text-stone-600 not-italic">
                    {empresa.direccion && (
                      <p className="flex items-start gap-2">
                        <MapPinIcon className="mt-0.5 size-4 shrink-0 text-stone-400" />
                        {empresa.direccion}
                      </p>
                    )}
                    {empresa.telefono && (
                      <p className="flex items-center gap-2">
                        <PhoneIcon className="size-4 shrink-0 text-stone-400" />
                        <a
                          href={telHref(empresa.telefono)}
                          className="rounded-sm underline-offset-2 hover:text-amber-800 hover:underline"
                        >
                          {empresa.telefono}
                        </a>
                      </p>
                    )}
                    {empresa.email && (
                      <p className="flex items-center gap-2">
                        <MailIcon className="size-4 shrink-0 text-stone-400" />
                        <a
                          href={`mailto:${empresa.email}`}
                          className="min-w-0 rounded-sm break-all underline-offset-2 hover:text-amber-800 hover:underline"
                        >
                          {empresa.email}
                        </a>
                      </p>
                    )}
                  </address>
                </div>
              </div>
              <div className="shrink-0 sm:text-right print:text-right">
                <p className={ETIQUETA}>Presupuesto</p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-stone-950 tabular-nums">{p.numero}</p>
                <p
                  className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${estadoCliente.clases}`}
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  {estadoCliente.texto}
                </p>
              </div>
            </header>

            {/* Para quién, qué y cuándo */}
            <section aria-label="Datos del presupuesto" className="px-5 pt-7 sm:px-10 sm:pt-9 print:px-0">
              <p className={ETIQUETA}>Para</p>
              <p className="mt-1 text-base font-semibold text-stone-900">{cliente.nombre}</p>
              <h1
                id="presupuesto-titulo"
                className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance text-stone-950 sm:text-[1.875rem]"
              >
                {p.titulo}
              </h1>
              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 text-sm sm:grid-cols-3 print:grid-cols-3">
                <div className="bg-stone-50 px-4 py-3">
                  <dt className={ETIQUETA}>Fecha</dt>
                  {/* Fecha de envío: de ahí cuenta la validez (la de creación solo si no consta el envío). */}
                  <dd className="mt-1 font-medium text-stone-900">{formatFechaEnLetra(p.enviado_at ?? p.created_at)}</dd>
                </div>
                <div className="bg-stone-50 px-4 py-3">
                  <dt className={ETIQUETA}>{vencido ? "Venció el" : "Válido hasta el"}</dt>
                  <dd className={vencido ? "mt-1 font-semibold text-amber-800" : "mt-1 font-medium text-stone-900"}>
                    {formatFechaEnLetra(validoHasta)}
                  </dd>
                </div>
                <div className="col-span-2 bg-stone-50 px-4 py-3 sm:col-span-1 print:col-span-1">
                  <dt className={ETIQUETA}>Total con IVA</dt>
                  <dd className="mt-1 font-semibold text-stone-950 tabular-nums">{total}</dd>
                </div>
              </dl>
            </section>

            {/* Partidas */}
            <section aria-labelledby="partidas-titulo" className="px-5 py-7 sm:px-10 sm:py-9 print:px-0">
              <h2 id="partidas-titulo" className="mb-3 text-sm font-semibold text-stone-900">
                Partidas{" "}
                <span className="font-normal text-stone-500">
                  ({lineas.length} {lineas.length === 1 ? "partida" : "partidas"})
                </span>
              </h2>
              {lineas.length === 0 ? (
                <p className="text-sm text-stone-500">Este presupuesto no tiene partidas.</p>
              ) : (
                <>
                  {/* Móvil: lista */}
                  <ol className="divide-y divide-stone-200 border-y border-stone-200 sm:hidden print:hidden">
                    {lineas.map((l, i) => (
                      <li key={i} className="flex gap-3 py-3.5">
                        <span aria-hidden="true" className="w-5 shrink-0 pt-px text-xs text-stone-500 tabular-nums">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium break-words text-stone-900">{l.descripcion}</p>
                          <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                            <span className="text-stone-500 tabular-nums">
                              {formatQuantity(l.cantidad)} × {formatEuros(l.precio_cents)}
                            </span>
                            <span className="font-semibold text-stone-900 tabular-nums">
                              {formatEuros(l.importe_cents)}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {/* Escritorio e impresión: tabla */}
                  <table className="hidden w-full text-left text-sm sm:table print:table">
                    <caption className="sr-only">Partidas del presupuesto {p.numero}</caption>
                    <thead>
                      <tr className="border-y border-stone-200 bg-stone-50 text-[0.6875rem] font-semibold tracking-wider text-stone-500 uppercase">
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
                        <tr key={i} className="break-inside-avoid">
                          <td className="py-3.5 pl-3 align-top text-xs text-stone-500 tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td className="py-3.5 pr-4 align-top text-stone-900">{l.descripcion}</td>
                          <td className="px-3 py-3.5 text-right align-top whitespace-nowrap text-stone-600 tabular-nums">
                            {formatQuantity(l.cantidad)}
                          </td>
                          <td className="px-3 py-3.5 text-right align-top whitespace-nowrap text-stone-600 tabular-nums">
                            {formatEuros(l.precio_cents)}
                          </td>
                          <td className="px-3 py-3.5 text-right align-top font-medium whitespace-nowrap text-stone-950 tabular-nums">
                            {formatEuros(l.importe_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Totales */}
              <dl className="mt-6 ml-auto max-w-sm text-sm break-inside-avoid">
                <div className="flex justify-between gap-4 px-1 py-1.5">
                  <dt className="text-stone-600">Base imponible</dt>
                  <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(carga.datos.base_cents)}</dd>
                </div>
                <div className="flex justify-between gap-4 px-1 py-1.5">
                  <dt className="text-stone-600">IVA ({p.iva_pct} %)</dt>
                  <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(carga.datos.iva_cents)}</dd>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4 rounded-xl bg-stone-950 px-4 py-4 text-white print:border-2 print:border-stone-900 print:bg-white print:text-stone-950">
                  <dt className="pb-1 text-sm font-medium">
                    Total
                    <span className="block text-xs font-normal text-stone-400 print:text-stone-500">IVA incluido</span>
                  </dt>
                  <dd className="text-3xl font-semibold tracking-tight tabular-nums">{total}</dd>
                </div>
              </dl>
            </section>

            {/* Responder (solo mientras se puede aceptar) */}
            {sePuedeAceptar && (
              <section
                aria-labelledby="aceptar-titulo"
                className="relative overflow-hidden bg-slate-900 px-5 py-8 text-white sm:px-10 sm:py-10 print:hidden"
              >
                <div aria-hidden="true" className="franja-obra absolute inset-x-0 top-0 h-1" />
                <div
                  aria-hidden="true"
                  className="fondo-plano pointer-events-none absolute inset-0 [--plano-linea:rgb(148_163_184/0.06)]"
                />
                {empleado ? (
                  <div className="relative flex items-start gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-amber-300">
                      <EyeIcon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 id="aceptar-titulo" className="text-lg font-semibold tracking-tight">
                        Vista del cliente
                      </h2>
                      <p role="status" className="mt-1 text-sm text-pretty text-slate-300">
                        Estás viendo la vista del cliente; la aceptación la hace el cliente desde su enlace.
                      </p>
                      <Link
                        href="/presupuestos?estado=enviado"
                        className="mt-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-amber-300 hover:text-amber-200 hover:underline focus-visible:outline-amber-300"
                      >
                        Volver a los presupuestos enviados
                        <ArrowRightIcon className="size-4" />
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="relative space-y-6">
                    <div className="min-w-0">
                      <h2 id="aceptar-titulo" className="text-xl font-semibold tracking-tight text-balance">
                        ¿Te encaja? Acéptalo desde aquí
                      </h2>
                      <p className="mt-2 max-w-xl text-sm text-pretty text-slate-300">
                        Aceptar significa que encargas a {empresa.nombre} esta obra con estas partidas y este importe (
                        <span className="font-semibold whitespace-nowrap text-white">{total}</span> con IVA). Lo verán al
                        momento y se pondrán en contacto contigo para organizarla.
                      </p>
                      <p className="mt-2 max-w-xl text-xs text-pretty text-slate-400">
                        Puedes aceptarlo hasta el {formatFechaEnLetra(validoHasta)}. Si quieres cambiar algo, habla antes
                        con ellos{empresa.telefono ? ` en el ${empresa.telefono}` : ""}.
                      </p>
                    </div>
                    <Aceptar token={token} empresa={empresa.nombre} resumen={`${p.numero} por ${total}`} />
                  </div>
                )}
              </section>
            )}
          </article>

          <PiePublico />
        </div>
      </div>
    </main>
  );
}
