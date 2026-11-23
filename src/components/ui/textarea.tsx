import type { ComponentProps } from "react";
import { cn } from "./cn";
import { controlClasses, controlState, describedBy, Field, type FieldControlProps, type WithoutControlKeys } from "./field";

type TextareaProps = FieldControlProps & WithoutControlKeys<ComponentProps<"textarea">>;

export function Textarea({ label, name, error, hint, className, required, rows = 4, ...props }: TextareaProps) {
  const id = name;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClasses, controlState(error), "py-2.5")}
        {...props}
      />
    </Field>
  );
}
