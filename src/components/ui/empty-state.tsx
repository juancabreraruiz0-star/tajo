import type { ReactNode } from "react";
import { IlustracionPlano } from "../ilustracion-plano";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Botón o enlace para salir del estado vacío (p. ej. «Nuevo cliente»). */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-stone-300 bg-white/70 px-6 py-12 text-center sm:py-14">
      <IlustracionPlano icon={icon} />
      <h3 className="text-base font-semibold tracking-tight text-balance text-stone-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-pretty text-stone-500">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
