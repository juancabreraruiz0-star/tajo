import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "gray" | "blue" | "green" | "red" | "violet" | "amber";

// Texto -700/-800 sobre fondo -50: contraste AA. El punto lleva el color del estado (D6).
const TONES: Record<BadgeTone, { badge: string; punto: string }> = {
  gray: { badge: "bg-stone-100 text-stone-700 ring-stone-300/70", punto: "bg-stone-400" },
  blue: { badge: "bg-blue-50 text-blue-800 ring-blue-200", punto: "bg-blue-500" },
  green: { badge: "bg-green-50 text-green-800 ring-green-200", punto: "bg-green-500" },
  red: { badge: "bg-red-50 text-red-800 ring-red-200", punto: "bg-red-500" },
  violet: { badge: "bg-violet-50 text-violet-800 ring-violet-200", punto: "bg-violet-500" },
  amber: { badge: "bg-amber-50 text-amber-900 ring-amber-300/70", punto: "bg-amber-500" },
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "gray", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[tone].badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONES[tone].punto)} />
      {children}
    </span>
  );
}
