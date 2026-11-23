import type { ReactNode } from "react";
import { cn } from "./cn";

export const controlClasses = cn(
  "block w-full rounded-lg border bg-white px-3 text-base text-stone-900 shadow-sm sm:text-sm",
  "placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40",
  "disabled:cursor-not-allowed disabled:bg-stone-100",
);

export function controlState(error?: string) {
  return error
    ? "border-red-400 focus:border-red-500 focus:ring-red-500/30"
    : "border-stone-300 focus:border-amber-500";
}

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Etiqueta + control + ayuda + error. Los ids de ayuda y error los usa aria-describedby. */
export function Field({ id, label, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-stone-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface FieldControlProps {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  /** Clases del contenedor del campo. */
  className?: string;
}

export type WithoutControlKeys<T> = Omit<T, "name" | "className" | "id">;
