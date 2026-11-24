import type { Metadata } from "next";
import { IlustracionPlano } from "@/components/ilustracion-plano";
import { DocumentIcon } from "@/components/icons";
import { PiePublico } from "./pie";

export const metadata: Metadata = { title: { absolute: "Presupuesto no disponible" } };

export default function PresupuestoNoDisponible() {
  return (
    <main className="fondo-plano flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div aria-hidden="true" className="franja-obra fixed inset-x-0 top-0 h-1.5" />
      <div className="w-full max-w-md animate-entrada rounded-2xl bg-white px-6 py-12 text-center shadow-elevada">
        <IlustracionPlano icon={<DocumentIcon className="size-6" />} />
        <h1 className="text-lg font-semibold tracking-tight text-stone-950">Este presupuesto no está disponible</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-pretty text-stone-500">
          Puede que el enlace esté incompleto o que el presupuesto ya no se pueda consultar. Si crees que es un error,
          ponte en contacto con la empresa que te lo envió.
        </p>
      </div>
      <PiePublico />
    </main>
  );
}
