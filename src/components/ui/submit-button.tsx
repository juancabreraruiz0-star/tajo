"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

interface SubmitButtonProps {
  children: React.ReactNode;
  /** Texto mientras se envía el formulario. */
  pendingText: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Botón de envío que se desactiva y cambia de texto mientras la Server Action trabaja. */
export function SubmitButton({ children, pendingText, variant, size, className }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}
