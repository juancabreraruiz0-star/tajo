import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { MaterialForm } from "../material-form";

export const metadata: Metadata = { title: "Nuevo material" };

export default function NuevoMaterialPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Nuevo material" back={{ href: "/materiales", label: "Materiales" }} />
      <MaterialForm id={null} />
    </div>
  );
}
