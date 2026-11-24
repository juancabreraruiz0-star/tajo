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
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-[0.6rem] bg-amber-500 text-stone-950",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(120_53_15/0.3)] ring-1 ring-amber-600/50 ring-inset",
          lg ? "size-11" : "size-9",
        )}
      >
        <HelmetIcon className={lg ? "size-7" : "size-6"} strokeWidth={2} />
      </span>
      <span
        className={cn(
          "font-bold tracking-[-0.03em]",
          lg ? "text-3xl" : "text-xl",
          tone === "dark" ? "text-white" : "text-stone-950",
        )}
      >
        Tajo
      </span>
    </span>
  );
}
