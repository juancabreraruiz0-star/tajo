import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionProfile, isAdmin } from "@/lib/auth";
import { MaterialForm } from "../material-form";

export const metadata: Metadata = { title: "Nuevo material" };

export default async function NuevoMaterialPage() {
  const { perfil } = await getSessionProfile();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Nuevo material" back={{ href: "/materiales", label: "Materiales" }} />
      {/* El coste solo lo ve y lo pone gerencia (M2). */}
      <MaterialForm id={null} conCoste={isAdmin(perfil)} />
    </div>
  );
}
