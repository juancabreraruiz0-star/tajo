import { MarcaTajo } from "@/components/logo";

/** Pie discreto de las páginas públicas. */
export function PiePublico() {
  return (
    <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-stone-500 print:mt-6">
      <MarcaTajo className="h-4 w-4" />
      Presupuesto preparado con <span className="font-semibold text-stone-600">Tajo</span>
    </p>
  );
}
