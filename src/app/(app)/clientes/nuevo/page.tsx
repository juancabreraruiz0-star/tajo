import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ClienteForm } from "../cliente-form";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default function NuevoClientePage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Nuevo cliente" back={{ href: "/clientes", label: "Clientes" }} />
      <ClienteForm id={null} cancelHref="/clientes" />
    </div>
  );
}
