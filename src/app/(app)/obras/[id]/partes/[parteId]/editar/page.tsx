import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile } from "@/lib/auth";
import { formatFechaEnLetra } from "@/lib/domain/dates";
import { dbErrorMessage } from "@/lib/domain/errors";
import { diaMadrid, fechaMinimaParte, partesEditables } from "@/lib/domain/obras";
import { parteEditablePor } from "@/lib/domain/obras-pantalla";
import { quantityToInput } from "@/lib/domain/quantity";
import { isUuid } from "@/lib/domain/validation";
import type { Obra, Parte, ParteMaterial } from "@/lib/types";
import { ParteForm, type MaterialAlmacen } from "../../parte-form";

export const metadata: Metadata = { title: "Editar parte" };

type ObraCabecera = Pick<Obra, "id" | "titulo" | "estado" | "fecha_inicio">;
type ParteFila = Pick<Parte, "id" | "fecha" | "autor_id" | "horas" | "notas" | "created_at">;
type MaterialFila = Pick<ParteMaterial, "material_id" | "material_nombre" | "cantidad">;

interface EditarPartePageProps {
  params: Promise<{ id: string; parteId: string }>;
}

export default async function EditarPartePage({ params }: EditarPartePageProps) {
  const { id, parteId } = await params;
  if (!isUuid(id) || !isUuid(parteId)) notFound();

  const { perfil, supabase } = await getSessionProfile();
  const [obraRes, parteRes, materialesRes, almacenRes] = await Promise.all([
    supabase.from("obras").select("id, titulo, estado, fecha_inicio").eq("id", id).maybeSingle<ObraCabecera>(),
    supabase
      .from("partes")
      .select("id, fecha, autor_id, horas, notas, created_at")
      .eq("id", parteId)
      .eq("obra_id", id)
      .maybeSingle<ParteFila>(),
    supabase
      .from("parte_materiales")
      .select("material_id, material_nombre, cantidad")
      .eq("parte_id", parteId)
      .order("material_nombre")
      .overrideTypes<MaterialFila[], { merge: false }>(),
    supabase
      .from("materiales")
      .select("id, nombre, unidad")
      .order("nombre")
      .overrideTypes<MaterialAlmacen[], { merge: false }>(),
  ]);

  const errorCarga = obraRes.error ?? parteRes.error ?? materialesRes.error;
  if (errorCarga) return <Alert title="No se ha podido cargar el parte">{dbErrorMessage(errorCarga)}</Alert>;
  const obra = obraRes.data;
  const parte = parteRes.data;
  if (!obra || !parte) notFound();

  const back = { href: `/obras/${id}`, label: obra.titulo };
  const titulo = `Parte del ${formatFechaEnLetra(parte.fecha)}`;

  if (!parteEditablePor(parte, perfil, obra.estado, new Date())) {
    return (
      <>
        <PageHeader title={titulo} back={back} />
        <Alert tone="warning">
          <p>
            {partesEditables(obra.estado)
              ? "Este parte solo lo puede cambiar su autor el mismo día en que lo apuntó, o gerencia."
              : "La obra está terminada: sus partes ya no se pueden cambiar."}
          </p>
          <LinkButton href={`/obras/${id}`} size="sm" className="mt-3">
            Volver a la obra
          </LinkButton>
        </Alert>
      </>
    );
  }

  const lineas = materialesRes.data ?? [];
  const hoy = diaMadrid(new Date());
  return (
    <>
      <PageHeader title={titulo} description={obra.titulo} back={back} />
      {almacenRes.error && (
        <Alert tone="warning" title="No se ha podido cargar el almacén" className="mb-6">
          {dbErrorMessage(almacenRes.error)}
        </Alert>
      )}
      <ParteForm
        obraId={id}
        parteId={parteId}
        almacen={almacenRes.data ?? []}
        initial={{
          fecha: parte.fecha,
          horas: quantityToInput(Number(parte.horas)),
          notas: parte.notas ?? "",
          materiales: lineas.flatMap((m) =>
            m.material_id ? [{ material_id: m.material_id, cantidad: quantityToInput(Number(m.cantidad)) }] : [],
          ),
        }}
        hoy={hoy}
        fechaMinima={fechaMinimaParte(hoy, obra.fecha_inicio, parte.fecha)}
        conservados={lineas.filter((m) => m.material_id === null).map((m) => m.material_nombre)}
        cancelHref={`/obras/${id}`}
      />
    </>
  );
}
