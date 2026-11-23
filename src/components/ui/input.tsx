import type { ComponentProps } from "react";
import { cn } from "./cn";
import { controlClasses, controlState, describedBy, Field, type FieldControlProps, type WithoutControlKeys } from "./field";

type InputProps = FieldControlProps & WithoutControlKeys<ComponentProps<"input">>;

export function Input({ label, name, error, hint, className, required, ...props }: InputProps) {
  const id = name;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <input
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClasses, controlState(error), "h-11")}
        {...props}
      />
    </Field>
  );
}
