import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { isUuid } from "@/lib/domain/validation";
import type { Cliente } from "@/lib/types";
import { ClienteForm } from "../../cliente-form";

export const metadata: Metadata = { title: "Editar cliente" };

type ClienteEditable = Pick<Cliente, "id" | "nombre" | "nif" | "telefono" | "email" | "direccion" | "notas">;

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { supabase } = await getSessionProfile();
  const { data: cliente, error } = await supabase
    .from("clientes")
    .select("id, nombre, nif, telefono, email, direccion, notas")
    .eq("id", id)
    .maybeSingle<ClienteEditable>();

  if (error) {
    return <Alert title="No se ha podido cargar el cliente">{dbErrorMessage(error)}</Alert>;
  }
  if (!cliente) notFound();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Editar cliente" back={{ href: `/clientes/${id}`, label: cliente.nombre }} />
      <ClienteForm
        id={id}
        cancelHref={`/clientes/${id}`}
        initial={{
          nombre: cliente.nombre,
          nif: cliente.nif ?? "",
          telefono: cliente.telefono ?? "",
          email: cliente.email ?? "",
          direccion: cliente.direccion ?? "",
          notas: cliente.notas ?? "",
        }}
      />
    </div>
  );
}
