import { cn } from "./ui/cn";

interface LogoProps {
  /** "dark" sobre fondo oscuro (barra lateral, login), "light" sobre fondo claro. */
  tone?: "light" | "dark";
  size?: "md" | "lg";
}

interface MarcaProps {
  /** Sobre fondo oscuro, lo que en el logo es azul marino se pinta en blanco. */
  tone?: "light" | "dark";
  className?: string;
}

/**
 * La casa del logo de Tajo (docs/marca/logo-tajo.png): tejado a dos aguas, azul marino a la izquierda y naranja a la
 * derecha, con un pilar y un bloque debajo. Colores de la marca: #071B2C y #EC931C.
 */
export function MarcaTajo({ tone = "light", className }: MarcaProps) {
  const base = tone === "dark" ? "#ffffff" : "#071b2c";
  return (
    <svg viewBox="0 0 450 460" aria-hidden="true" className={className}>
      <rect x="77" y="230" width="99" height="228" fill={base} />
      <rect x="270" y="231" width="180" height="174" fill={base} />
      <path d="M0 140 230 0v108L0 255Z" fill={base} />
      <path d="M230 0 450 140v108L230 108Z" fill="#ec931c" />
    </svg>
  );
}

export function Logo({ tone = "light", size = "md" }: LogoProps) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2.5">
      <MarcaTajo tone={tone} className={cn("shrink-0", lg ? "h-10 w-10" : "h-8 w-8")} />
      <span
        className={cn(
          "leading-none font-extrabold tracking-[-0.035em]",
          lg ? "text-[2rem]" : "text-[1.4rem]",
          tone === "dark" ? "text-white" : "text-stone-950",
        )}
      >
        Tajo
      </span>
    </span>
  );
}
