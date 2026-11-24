import type { ReactNode } from "react";

// Cuadrícula del plano dibujada a mano (cada 8 px) dentro de la hoja delantera.
const CUADRICULA = Array.from({ length: 8 }, (_, i) => `M${36 + i * 8} 18v58`)
  .concat(Array.from({ length: 6 }, (_, i) => `M28 ${26 + i * 8}h76`))
  .join("");

/** Dos hojas de plano con una cota debajo: la ilustración común de los estados vacíos. */
export function IlustracionPlano({ icon }: { icon?: ReactNode }) {
  return (
    <div className="relative mx-auto mb-5 h-24 w-32">
      <svg viewBox="0 0 128 96" aria-hidden="true" focusable="false" className="absolute inset-0 size-full">
        <rect x="24" y="12" width="76" height="62" rx="6" transform="rotate(-7 62 43)" fill="#f7f9fb" stroke="#e1e7ed" />
        <rect x="28" y="14" width="76" height="62" rx="6" fill="#fff" stroke="#cbd4dd" />
        <path d={CUADRICULA} stroke="#e1e7ed" strokeWidth="0.75" />
        <rect x="28" y="14" width="76" height="62" rx="6" fill="none" stroke="#cbd4dd" />
        {/* Cota: línea de medida con sus topes */}
        <path d="M28 87h76M28 83.5v7M104 83.5v7" stroke="#d17712" strokeWidth="1.25" strokeLinecap="round" />
        <path d="m31 85-3 2 3 2M101 85l3 2-3 2" fill="none" stroke="#d17712" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
      {icon && (
        <div className="absolute top-[38%] left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-white text-amber-600 shadow-elevada ring-1 ring-amber-200">
          {icon}
        </div>
      )}
    </div>
  );
}
