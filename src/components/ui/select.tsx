import type { ComponentProps } from "react";
import { cn } from "./cn";
import { controlClasses, controlState, describedBy, Field, type FieldControlProps, type WithoutControlKeys } from "./field";

export interface SelectOption {
  value: string;
  label: string;
}

type SelectProps = FieldControlProps &
  WithoutControlKeys<ComponentProps<"select">> & {
    options: readonly SelectOption[];
    /** Opción vacía inicial («Elige…»). */
    placeholder?: string;
  };

export function Select({ label, name, error, hint, className, required, options, placeholder, ...props }: SelectProps) {
  const id = name;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <select
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClasses, controlState(error), "h-11 pr-8")}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
