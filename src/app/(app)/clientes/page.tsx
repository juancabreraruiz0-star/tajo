import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PaginaFueraDeRango, Paginacion } from "@/components/ui/paginacion";
import { Table, type Column } from "@/components/ui/table";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { hrefPagina, paginacion, parsePagina } from "@/lib/domain/paginacion";
import { normalizeSearch, toIlikeContains } from "@/lib/domain/search";
import { leerPagina } from "@/lib/paginar";
import type { Cliente } from "@/lib/types";

export const metadata: Metadata = { title: "Clientes" };

type ClienteFila = Pick<Cliente, "id" | "nombre" | "nif" | "telefono" | "email" | "direccion">;

const COLUMNAS: Column<ClienteFila>[] = [
  { key: "nombre", header: "Nombre", primary: true, cell: (c) => c.nombre },
  { key: "nif", header: "NIF", className: "whitespace-nowrap font-mono text-xs", cell: (c) => c.nif ?? "—" },
  { key: "telefono", header: "Teléfono", cell: (c) => c.telefono ?? "—" },
  { key: "email", header: "Email", cell: (c) => c.email ?? "—" },
  { key: "direccion", header: "Dirección", hideOnMobile: true, cell: (c) => c.direccion ?? "—" },
];

interface ClientesPageProps {
  searchParams: Promise<{ q?: string | string[]; pagina?: string | string[] }>;
}

export default async function ClientesPage({ searchParams }: ClientesPageProps) {
  const params = await searchParams;
  const busqueda = normalizeSearch(params.q);
  const paginaPedida = parsePagina(params.pagina);
  const { supabase } = await getSessionProfile();

  const consulta = (head = false) => {
    let query = supabase
      .from("clientes")
      .select("id, nombre, nif, telefono, email, direccion", { count: "exact", head });
    if (busqueda) query = query.ilike("nombre", toIlikeContains(busqueda));
    return query.order("nombre").order("id");
  };
  const { filas: clientes, total, error } = await leerPagina(
    paginaPedida,
    (desde, hasta) => consulta().range(desde, hasta).overrideTypes<ClienteFila[], { merge: false }>(),
    () => consulta(true),
  );
  const estado = paginacion(paginaPedida, total);
  const href = (pagina: number) => hrefPagina("/clientes", { q: busqueda }, pagina);

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
            ? `${total} ${total === 1 ? "resultado" : "resultados"} para «${busqueda}»`
            : `${total} ${total === 1 ? "cliente" : "clientes"}`
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
      ) : estado.fueraDeRango ? (
        <PaginaFueraDeRango estado={estado} href={href} />
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
          <Paginacion estado={estado} total={total} href={href} label="Páginas de clientes" />
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
