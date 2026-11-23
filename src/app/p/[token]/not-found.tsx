import type { Metadata } from "next";
import { DocumentIcon } from "@/components/icons";
import { PiePublico } from "./pie";

export const metadata: Metadata = { title: { absolute: "Presupuesto no disponible" } };

export default function PresupuestoNoDisponible() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10 text-center">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white px-6 py-10 shadow-sm">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <DocumentIcon className="size-7" />
        </div>
        <h1 className="text-xl font-semibold text-stone-900">Este presupuesto no está disponible</h1>
        <p className="mt-2 text-sm text-stone-600">
          Puede que el enlace esté incompleto o que el presupuesto ya no se pueda consultar. Si crees que es un error,
          ponte en contacto con la empresa que te lo envió.
        </p>
      </div>
      <PiePublico />
    </main>
  );
}
