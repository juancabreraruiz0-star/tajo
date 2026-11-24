import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import { centsToEurosInput } from "@/lib/domain/money";
import { quantityToInput } from "@/lib/domain/quantity";
import { isNegativeStock } from "@/lib/domain/stock";
import { isUuid } from "@/lib/domain/validation";
import type { Material } from "@/lib/types";
import { DeleteMaterial } from "../../delete-material";
import { MaterialForm } from "../../material-form";

export const metadata: Metadata = { title: "Editar material" };

type MaterialEditable = Pick<Material, "id" | "nombre" | "unidad" | "precio_cents" | "stock" | "stock_minimo"> &
  Partial<Pick<Material, "coste_cents">>;

const COLUMNAS = "id, nombre, unidad, precio_cents, stock, stock_minimo";

export default async function EditarMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { perfil, supabase } = await getSessionProfile();
  // El coste solo lo ve y lo cambia gerencia (M2).
  const admin = isAdmin(perfil);
  const { data: material, error } = await supabase
    .from("materiales")
    .select(admin ? `${COLUMNAS}, coste_cents` : COLUMNAS)
    .eq("id", id)
    .maybeSingle<MaterialEditable>();

  if (error) {
    return <Alert title="No se ha podido cargar el material">{dbErrorMessage(error)}</Alert>;
  }
  if (!material) notFound();
  const stock = Number(material.stock);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Editar material" description={material.nombre} back={{ href: "/materiales", label: "Materiales" }} />
      <MaterialForm
        id={id}
        initial={{
          nombre: material.nombre,
          unidad: material.unidad,
          precio: centsToEurosInput(material.precio_cents),
          coste: material.coste_cents == null ? "" : centsToEurosInput(material.coste_cents),
          stock: quantityToInput(stock),
          stock_minimo: quantityToInput(Number(material.stock_minimo)),
        }}
        stockNegativo={isNegativeStock(stock)}
        conCoste={admin}
      />

      {/* Borrar: solo gerencia. La RLS (materiales_delete) lo impone también en la base de datos. */}
      {admin && (
        <Card className="mt-8 border-red-200">
          <CardHeader
            title="Borrar material"
            description="Las partidas de presupuestos que lo usan se quedan sin vínculo al almacén, pero no se borran."
          />
          <CardBody>
            <DeleteMaterial id={id} nombre={material.nombre} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
