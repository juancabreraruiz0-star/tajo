import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { centsToEurosInput } from "@/lib/domain/money";
import { quantityToInput } from "@/lib/domain/quantity";
import { isUuid } from "@/lib/domain/validation";
import { iaConfigurada } from "@/lib/ia/config";
import type { Presupuesto, PresupuestoLinea } from "@/lib/types";
import { loadOpcionesFormulario } from "../../opciones-formulario";
import { PresupuestoForm } from "../../presupuesto-form";

export const metadata: Metadata = { title: "Editar presupuesto" };

// «Montar con IA» (D10): la Server Action se ejecuta con el límite de esta ruta y la IA puede tardar 20–60 s.
export const maxDuration = 60;

type PresupuestoEditable = Pick<
  Presupuesto,
  "id" | "numero" | "estado" | "cliente_id" | "titulo" | "iva_pct" | "validez_dias"
>;
type LineaEditable = Pick<PresupuestoLinea, "descripcion" | "cantidad" | "precio_cents" | "material_id">;

export default async function EditarPresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { supabase } = await getSessionProfile();
  const [presupuestoRes, lineasRes, opciones] = await Promise.all([
    supabase
      .from("presupuestos")
      .select("id, numero, estado, cliente_id, titulo, iva_pct, validez_dias")
      .eq("id", id)
      .maybeSingle<PresupuestoEditable>(),
    supabase
      .from("presupuesto_lineas")
      .select("descripcion, cantidad, precio_cents, material_id")
      .eq("presupuesto_id", id)
      .order("orden")
      .order("id")
      .overrideTypes<LineaEditable[], { merge: false }>(),
    loadOpcionesFormulario(supabase),
  ]);

  if (presupuestoRes.error) {
    return <Alert title="No se ha podido cargar el presupuesto">{dbErrorMessage(presupuestoRes.error)}</Alert>;
  }
  const presupuesto = presupuestoRes.data;
  if (!presupuesto) notFound();
  // Solo se edita en borrador (la base de datos también lo impide).
  if (presupuesto.estado !== "borrador") redirect(`/presupuestos/${id}`);

  const error = lineasRes.error ? dbErrorMessage(lineasRes.error) : !opciones.ok ? opciones.error : null;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Editar ${presupuesto.numero}`}
        description="Borrador: puedes cambiar cualquier dato y las partidas."
        back={{ href: `/presupuestos/${id}`, label: presupuesto.numero }}
      />
      {error || !opciones.ok ? (
        <Alert title="No se ha podido cargar el presupuesto">{error}</Alert>
      ) : (
        <PresupuestoForm
          id={id}
          clientes={opciones.clientes}
          materiales={opciones.materiales}
          cancelHref={`/presupuestos/${id}`}
          ia={iaConfigurada()}
          initial={{
            cliente_id: presupuesto.cliente_id,
            titulo: presupuesto.titulo,
            iva_pct: String(presupuesto.iva_pct),
            validez_dias: String(presupuesto.validez_dias),
            partidas: (lineasRes.data ?? []).map((l) => ({
              descripcion: l.descripcion,
              // numeric puede llegar como texto: se normaliza.
              cantidad: quantityToInput(Number(l.cantidad)),
              precio: centsToEurosInput(l.precio_cents),
              material_id: l.material_id ?? "",
            })),
          }}
        />
      )}
    </div>
  );
}
