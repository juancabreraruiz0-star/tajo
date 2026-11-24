import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  // Ámbar de obra con un brillo interior arriba y un filo más oscuro abajo: se lee como pieza, no como plantilla.
  primary:
    "bg-amber-500 text-stone-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(139_71_22/0.25)] ring-1 ring-amber-600/40 ring-inset hover:bg-amber-400 active:bg-amber-500",
  secondary:
    "bg-white text-stone-800 shadow-tarjeta ring-1 ring-stone-300 ring-inset hover:bg-stone-50 hover:ring-stone-400 active:bg-stone-100",
  danger:
    "bg-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(127_29_29/0.25)] hover:bg-red-700 active:bg-red-800",
  ghost: "text-stone-700 hover:bg-stone-900/5 hover:text-stone-900 active:bg-stone-900/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none",
    "transition-[background-color,box-shadow,color,transform] duration-150 ease-out active:translate-y-px",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600",
    "disabled:pointer-events-none disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}

interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Enlace con aspecto de botón (navegación, no acciones). */
export function LinkButton({ variant = "secondary", size, className, ...props }: LinkButtonProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
