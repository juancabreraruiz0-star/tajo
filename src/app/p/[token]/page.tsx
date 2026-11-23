import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { formatFecha } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { formatEuros } from "@/lib/domain/money";
import { isExpired, parsePresupuestoPublico, validUntil, type PresupuestoPublico } from "@/lib/domain/presupuestos";
import { formatQuantity } from "@/lib/domain/quantity";
import { isUuid } from "@/lib/domain/validation";
import { createAnonClient } from "@/lib/supabase/anon";
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const carga = await cargarPresupuesto((await params).token);
  if (carga.tipo === "error") return { title: { absolute: carga.titulo } };
  if (carga.tipo !== "ok") return { title: { absolute: "Presupuesto no disponible" } };
  const { empresa, presupuesto } = carga.datos;
  return { title: { absolute: `Presupuesto ${presupuesto.numero} · ${empresa.nombre}` } };
}

export default async function PresupuestoPublicoPage({ params }: PageProps) {
  const { token } = await params;
  const carga = await cargarPresupuesto(token);

  if (carga.tipo === "no_disponible") notFound();
  if (carga.tipo === "error") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10 text-center">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-stone-200 bg-white px-6 py-10 shadow-sm">
          <h1 className="text-xl font-semibold text-stone-900">{carga.titulo}</h1>
          <p className="mt-2 text-sm text-stone-600">{carga.mensaje}</p>
          <p className="mt-2 text-sm text-stone-600">Vuelve a abrir el enlace dentro de unos minutos.</p>
        </div>
        <PiePublico />
      </main>
    );
  }

  const { empresa, cliente, presupuesto: p, lineas } = carga.datos;
  const validoHasta = validUntil(p.created_at, p.validez_dias);
  const aceptado = p.estado === "aceptado" || p.estado === "facturado";
  // Misma regla que aceptar_presupuesto() (0003): pasado el último día de validez ya no se acepta.
  const vencido = p.estado === "enviado" && isExpired(p.created_at, p.validez_dias);

  return (
    <main className="min-h-dvh bg-stone-100 px-3 py-6 sm:px-4 sm:py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl space-y-4">
        {aceptado && <AvisoAceptado aceptadoAt={p.aceptado_at} />}
        {vencido && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900 sm:px-5">
            <p className="font-semibold">
              La validez de este presupuesto ha vencido; contacta con la empresa para actualizarlo.
            </p>
            {(empresa.telefono || empresa.email) && (
              <p className="mt-1 text-sm">
                {empresa.nombre}: {[empresa.telefono, empresa.email].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        )}
        {p.estado === "rechazado" && (
          <div role="status" className="rounded-xl border border-stone-300 bg-white px-4 py-4 text-stone-700 sm:px-5">
            <p className="font-semibold">Este presupuesto ya no está vigente.</p>
            <p className="mt-1 text-sm">Si quieres retomarlo, ponte en contacto con {empresa.nombre}.</p>
          </div>
        )}

        <article
          aria-labelledby="presupuesto-titulo"
          className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none"
        >
          <div className="h-1.5 bg-amber-500" aria-hidden="true" />

          <header className="flex flex-col gap-6 border-b border-stone-200 px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:py-8">
            <div className="min-w-0">
              <p className="text-xl font-bold tracking-tight text-stone-900">{empresa.nombre}</p>
              <address className="mt-2 space-y-0.5 text-sm text-stone-600 not-italic">
                {empresa.cif && <p>CIF {empresa.cif}</p>}
                {empresa.direccion && <p>{empresa.direccion}</p>}
                {empresa.telefono && (
                  <p>
                    <a href={`tel:${empresa.telefono.replace(/[^\d+]/g, "")}`} className="hover:text-amber-700 hover:underline">
                      {empresa.telefono}
                    </a>
                  </p>
                )}
                {empresa.email && (
                  <p className="break-all">
                    <a href={`mailto:${empresa.email}`} className="hover:text-amber-700 hover:underline">
                      {empresa.email}
                    </a>
                  </p>
                )}
              </address>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="text-xs font-semibold tracking-widest text-amber-700 uppercase">Presupuesto</p>
              <p className="mt-0.5 text-2xl font-bold text-stone-900 tabular-nums">{p.numero}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm sm:justify-end">
                <dt className="text-stone-500">Fecha</dt>
                <dd className="text-stone-900 tabular-nums">{formatFecha(p.created_at)}</dd>
                <dt className="text-stone-500">Válido hasta el</dt>
                <dd className="text-stone-900 tabular-nums">{formatFecha(validoHasta)}</dd>
              </dl>
            </div>
          </header>

          <section className="px-5 pt-6 sm:px-10 sm:pt-8">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Para</p>
            <p className="mt-0.5 text-lg font-semibold text-stone-900">{cliente.nombre}</p>
            <h1 id="presupuesto-titulo" className="mt-5 text-xl font-semibold text-balance text-stone-900 sm:text-2xl">
              {p.titulo}
            </h1>
          </section>

          <section aria-label="Partidas" className="px-5 py-6 sm:px-10">
            {lineas.length === 0 ? (
              <p className="text-sm text-stone-500">Este presupuesto no tiene partidas.</p>
            ) : (
              <>
                {/* Móvil: lista */}
                <ul className="divide-y divide-stone-200 border-y border-stone-200 sm:hidden">
                  {lineas.map((l, i) => (
                    <li key={i} className="py-3">
                      <p className="text-sm font-medium text-stone-900">{l.descripcion}</p>
                      <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-stone-500 tabular-nums">
                          {formatQuantity(l.cantidad)} × {formatEuros(l.precio_cents)}
                        </span>
                        <span className="font-semibold text-stone-900 tabular-nums">{formatEuros(l.importe_cents)}</span>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Escritorio: tabla */}
                <table className="hidden w-full text-left text-sm sm:table">
                  <caption className="sr-only">Partidas del presupuesto {p.numero}</caption>
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
                    {lineas.map((l, i) => (
                      <tr key={i}>
                        <td className="py-3 pr-4 text-stone-900">{l.descripcion}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-stone-700 tabular-nums">
                          {formatQuantity(l.cantidad)}
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

            <dl className="mt-6 ml-auto max-w-xs space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-stone-600">Base imponible</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(carga.datos.base_cents)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-600">IVA ({p.iva_pct} %)</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(carga.datos.iva_cents)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 rounded-lg bg-amber-50 px-3 py-3 ring-1 ring-amber-200 ring-inset">
                <dt className="font-semibold text-stone-900">Total</dt>
                <dd className="text-2xl font-bold text-stone-900 tabular-nums">{formatEuros(carga.datos.total_cents)}</dd>
              </div>
            </dl>
          </section>

          {p.estado === "enviado" && !vencido && (
            <section
              aria-labelledby="aceptar-titulo"
              className="border-t border-stone-200 bg-stone-50 px-5 py-6 sm:px-10 sm:py-8 print:hidden"
            >
              <h2 id="aceptar-titulo" className="text-base font-semibold text-stone-900">
                ¿Te encaja?
              </h2>
              <p className="mt-1 mb-4 text-sm text-stone-600">
                Si estás de acuerdo, acepta el presupuesto y {empresa.nombre} se pondrá en contacto contigo para
                organizar la obra.
              </p>
              <Aceptar
                token={token}
                confirmacion={`¿Aceptar el presupuesto ${p.numero} por ${formatEuros(carga.datos.total_cents)} (IVA incluido)?`}
              />
            </section>
          )}
        </article>

        <PiePublico />
      </div>
    </main>
  );
}
