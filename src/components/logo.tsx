import { HelmetIcon } from "./icons";
import { cn } from "./ui/cn";

interface LogoProps {
  /** "dark" sobre fondo oscuro (barra lateral), "light" sobre fondo claro. */
  tone?: "light" | "dark";
  size?: "md" | "lg";
}

export function Logo({ tone = "light", size = "md" }: LogoProps) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={cn(
          "flex items-center justify-center rounded-lg bg-amber-500 text-stone-950 shadow-sm",
          lg ? "size-11" : "size-9",
        )}
      >
        <HelmetIcon className={lg ? "size-7" : "size-6"} strokeWidth={2} />
      </span>
      <span
        className={cn(
          "font-bold tracking-tight",
          lg ? "text-3xl" : "text-xl",
          tone === "dark" ? "text-white" : "text-stone-900",
        )}
      >
        Tajo
      </span>
    </span>
  );
}
