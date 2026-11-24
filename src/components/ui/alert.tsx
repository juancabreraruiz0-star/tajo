import type { ReactNode } from "react";
import { AlertIcon, InfoIcon, XCircleIcon } from "../icons";
import { cn } from "./cn";

type AlertTone = "error" | "info" | "warning";

const TONES: Record<AlertTone, { caja: string; icono: string }> = {
  error: { caja: "border-red-200 bg-red-50 text-red-900", icono: "text-red-600" },
  info: { caja: "border-blue-200 bg-blue-50 text-blue-900", icono: "text-blue-600" },
  warning: { caja: "border-amber-300/70 bg-amber-50 text-amber-950", icono: "text-amber-600" },
};

const ICONOS: Record<AlertTone, typeof InfoIcon> = {
  error: XCircleIcon,
  info: InfoIcon,
  warning: AlertIcon,
};

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Aviso en bloque. Los de error se anuncian a los lectores de pantalla. */
export function Alert({ tone = "error", title, children, className }: AlertProps) {
  const Icono = ICONOS[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", TONES[tone].caja, className)}
    >
      <Icono className={cn("mt-px size-5 shrink-0", TONES[tone].icono)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn("text-pretty", title && "mt-1")}>{children}</div>
      </div>
    </div>
  );
}
