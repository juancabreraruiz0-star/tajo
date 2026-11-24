import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { admitePartesNuevos, diaMadrid, errorParteNuevo, fechaMinimaParte } from "@/lib/domain/obras";
import { isUuid } from "@/lib/domain/validation";
import type { Obra } from "@/lib/types";
import { ParteForm, type MaterialAlmacen } from "../parte-form";

export const metadata: Metadata = { title: "Nuevo parte" };

type ObraCabecera = Pick<Obra, "id" | "titulo" | "estado" | "fecha_inicio">;

export default async function NuevoPartePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { supabase } = await getSessionProfile();
  const [obraRes, almacenRes] = await Promise.all([
    supabase.from("obras").select("id, titulo, estado, fecha_inicio").eq("id", id).maybeSingle<ObraCabecera>(),
    supabase
      .from("materiales")
      .select("id, nombre, unidad")
      .order("nombre")
      .overrideTypes<MaterialAlmacen[], { merge: false }>(),
  ]);

  if (obraRes.error) return <Alert title="No se ha podido cargar la obra">{dbErrorMessage(obraRes.error)}</Alert>;
  const obra = obraRes.data;
  if (!obra) notFound();

  const back = { href: `/obras/${id}`, label: obra.titulo };

  if (!admitePartesNuevos(obra.estado)) {
    return (
      <>
        <PageHeader title="Nuevo parte" back={back} />
        <Alert tone="warning">
          <p>{errorParteNuevo(obra.estado)}</p>
          <LinkButton href={`/obras/${id}`} size="sm" className="mt-3">
            Volver a la obra
          </LinkButton>
        </Alert>
      </>
    );
  }

  const hoy = diaMadrid(new Date());
  return (
    <>
      <PageHeader title="Nuevo parte" description={obra.titulo} back={back} />
      {almacenRes.error && (
        <Alert tone="warning" title="No se ha podido cargar el almacén" className="mb-6">
          {dbErrorMessage(almacenRes.error)} Puedes guardar el parte sin material.
        </Alert>
      )}
      <ParteForm
        obraId={id}
        parteId={null}
        almacen={almacenRes.data ?? []}
        initial={{ fecha: hoy, horas: "", notas: "", materiales: [] }}
        hoy={hoy}
        fechaMinima={fechaMinimaParte(hoy, obra.fecha_inicio)}
        conservados={[]}
        cancelHref={`/obras/${id}`}
      />
    </>
  );
}
