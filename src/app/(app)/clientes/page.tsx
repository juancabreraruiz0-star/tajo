import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { normalizeSearch, toIlikeContains } from "@/lib/domain/search";
import type { Cliente } from "@/lib/types";

export const metadata: Metadata = { title: "Clientes" };

type ClienteFila = Pick<Cliente, "id" | "nombre" | "telefono" | "email" | "direccion">;

const COLUMNAS: Column<ClienteFila>[] = [
  { key: "nombre", header: "Nombre", primary: true, cell: (c) => c.nombre },
  { key: "telefono", header: "Teléfono", cell: (c) => c.telefono ?? "—" },
  { key: "email", header: "Email", cell: (c) => c.email ?? "—" },
  { key: "direccion", header: "Dirección", hideOnMobile: true, cell: (c) => c.direccion ?? "—" },
];

interface ClientesPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function ClientesPage({ searchParams }: ClientesPageProps) {
  const busqueda = normalizeSearch((await searchParams).q);
  const { supabase } = await getSessionProfile();

  let query = supabase.from("clientes").select("id, nombre, telefono, email, direccion").order("nombre");
  if (busqueda) query = query.ilike("nombre", toIlikeContains(busqueda));
  const { data, error } = await query.overrideTypes<ClienteFila[], { merge: false }>();
  const clientes = data ?? [];

  const nuevo = (
    <LinkButton href="/clientes/nuevo" variant="primary">
      <PlusIcon className="size-4" />
      Nuevo cliente
    </LinkButton>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        description={
          error ? undefined : busqueda
            ? `${clientes.length} ${clientes.length === 1 ? "resultado" : "resultados"} para «${busqueda}»`
            : `${clientes.length} ${clientes.length === 1 ? "cliente" : "clientes"}`
        }
        actions={nuevo}
      />

      <form role="search" action="/clientes" className="mb-5 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar cliente por nombre
        </label>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-stone-400" />
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={busqueda}
            placeholder="Buscar por nombre…"
            className="block h-11 w-full rounded-lg border border-stone-300 bg-white pr-3 pl-10 text-base shadow-sm placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40 focus:outline-none sm:text-sm"
          />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {error ? (
        <Alert title="No se han podido cargar los clientes">{dbErrorMessage(error)}</Alert>
      ) : clientes.length === 0 ? (
        busqueda ? (
          <EmptyState
            icon={<SearchIcon className="size-6" />}
            title={`Ningún cliente coincide con «${busqueda}»`}
            description="Prueba con otra parte del nombre o da de alta al cliente."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton href="/clientes">Ver todos</LinkButton>
                {nuevo}
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={<UsersIcon className="size-6" />}
            title="Todavía no hay clientes"
            description="Da de alta a tu primer cliente para poder hacerle presupuestos."
            action={nuevo}
          />
        )
      ) : (
        <>
          <Table
            caption="Listado de clientes"
            columns={COLUMNAS}
            rows={clientes}
            rowKey={(c) => c.id}
            rowHref={(c) => `/clientes/${c.id}`}
          />
          {busqueda && (
            <p className="mt-4 text-sm">
              <Link href="/clientes" className="font-medium text-amber-700 hover:underline">
                Quitar la búsqueda
              </Link>
            </p>
          )}
        </>
      )}
    </>
  );
}
