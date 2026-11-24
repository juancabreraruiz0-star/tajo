import { HelmetIcon } from "@/components/icons";

/** Pie discreto de las páginas públicas. */
export function PiePublico() {
  return (
    <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-stone-500 print:mt-6">
      <HelmetIcon className="size-4 text-amber-600" />
      Presupuesto preparado con <span className="font-semibold text-stone-600">Tajo</span>
    </p>
  );
}
