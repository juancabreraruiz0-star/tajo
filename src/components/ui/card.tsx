import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-stone-200/90 bg-white shadow-tarjeta", className)} {...props} />;
}

interface CardHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function CardHeader({ title, description, actions }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-stone-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-pretty text-stone-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}
