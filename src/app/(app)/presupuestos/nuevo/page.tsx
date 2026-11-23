import type { Metadata } from "next";
import { UsersIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile } from "@/lib/auth";
import { IVA_POR_DEFECTO, VALIDEZ_POR_DEFECTO } from "@/lib/domain/presupuestos";
import { loadOpcionesFormulario } from "../opciones-formulario";
import { PresupuestoForm } from "../presupuesto-form";

export const metadata: Metadata = { title: "Nuevo presupuesto" };

interface NuevoPresupuestoPageProps {
  searchParams: Promise<{ cliente?: string | string[] }>;
}

export default async function NuevoPresupuestoPage({ searchParams }: NuevoPresupuestoPageProps) {
  const { cliente } = await searchParams;
  const { supabase } = await getSessionProfile();
  const opciones = await loadOpcionesFormulario(supabase);

  // ?cliente=<id> (desde la ficha del cliente) lo deja elegido si es uno de los clientes de la empresa.
  const preseleccionado = opciones.ok ? opciones.clientes.find((c) => c.id === cliente) : undefined;
  const volver = preseleccionado
    ? { href: `/clientes/${preseleccionado.id}`, label: preseleccionado.nombre }
    : { href: "/presupuestos", label: "Presupuestos" };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Nuevo presupuesto"
        description="Se guarda como borrador: podrás revisarlo antes de enviarlo al cliente."
        back={volver}
      />
      {!opciones.ok ? (
        <Alert title="No se han podido cargar los clientes y materiales">{opciones.error}</Alert>
      ) : opciones.clientes.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="size-6" />}
          title="Primero da de alta un cliente"
          description="Cada presupuesto es para un cliente. Crea el cliente y vuelve aquí."
          action={
            <LinkButton href="/clientes/nuevo" variant="primary">
              Nuevo cliente
            </LinkButton>
          }
        />
      ) : (
        <PresupuestoForm
          id={null}
          clientes={opciones.clientes}
          materiales={opciones.materiales}
          cancelHref={volver.href}
          initial={{
            cliente_id: preseleccionado?.id ?? "",
            titulo: "",
            iva_pct: String(IVA_POR_DEFECTO),
            validez_dias: String(VALIDEZ_POR_DEFECTO),
            partidas: [],
          }}
        />
      )}
    </div>
  );
}
