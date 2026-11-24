// Piezas de interfaz de las obras (D11): insignia de estado, semáforo y barra de presupuestado frente a coste real.

import { ETIQUETAS_ESTADO_OBRA, type EstadoObra, type Semaforo } from "@/lib/domain/obras";
import { barraConsumo, DETALLE_SEMAFORO, TEXTO_SEMAFORO } from "@/lib/domain/obras-pantalla";
import { Badge, type BadgeTone } from "./ui/badge";
import { cn } from "./ui/cn";

// Ámbar para lo que está en marcha (el color de las obras, D6); verde, terminada; azul, a la espera (parada).
const TONO_ESTADO: Record<EstadoObra, BadgeTone> = {
  pendiente: "gray",
  en_curso: "amber",
  parada: "blue",
  terminada: "green",
};

/** Punto de color de cada estado (filtros del listado): los mismos colores que la insignia. */
export const PUNTO_ESTADO_OBRA: Record<EstadoObra, string> = {
  pendiente: "bg-stone-400",
  en_curso: "bg-amber-500",
  parada: "bg-blue-500",
  terminada: "bg-green-500",
};

export function ObraEstadoBadge({ estado }: { estado: EstadoObra }) {
  return <Badge tone={TONO_ESTADO[estado]}>{ETIQUETAS_ESTADO_OBRA[estado]}</Badge>;
}

const COLOR_SEMAFORO: Record<
  Semaforo,
  { punto: string; texto: string; barra: string; exceso: string; fondo: string }
> = {
  verde: { punto: "bg-green-500", texto: "text-green-800", barra: "bg-green-500", exceso: "", fondo: "bg-green-50 ring-green-200" },
  ambar: { punto: "bg-amber-500", texto: "text-amber-800", barra: "bg-amber-500", exceso: "", fondo: "bg-amber-50 ring-amber-200" },
  rojo: {
    punto: "bg-red-500",
    texto: "text-red-700",
    fondo: "bg-red-50 ring-red-200",
    barra: "bg-red-500",
    exceso: "bg-[repeating-linear-gradient(-45deg,var(--color-red-500)_0_4px,var(--color-red-300)_4px_8px)]",
  },
};

/** Semáforo con su texto (no solo el color): «Va bien», «Ajustada», «En pérdidas». */
export function SemaforoObra({ semaforo, className }: { semaforo: Semaforo; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", COLOR_SEMAFORO[semaforo].texto, className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", COLOR_SEMAFORO[semaforo].punto)} />
      {TEXTO_SEMAFORO[semaforo]}
    </span>
  );
}

/**
 * Semáforo grande con su explicación, sin cifras: lo que ve del coste de la obra quien no es gerencia (D12). No lleva
 * barra proporcional: con ella y la base del presupuesto se podría calcular el margen.
 */
export function SemaforoDestacado({ semaforo }: { semaforo: Semaforo }) {
  const color = COLOR_SEMAFORO[semaforo];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl px-4 py-3.5 ring-1 ring-inset", color.fondo)}>
      <span aria-hidden="true" className={cn("mt-1 size-3.5 shrink-0 rounded-full", color.punto)} />
      <div className="min-w-0">
        <p className={cn("text-lg leading-tight font-semibold tracking-tight", color.texto)}>{TEXTO_SEMAFORO[semaforo]}</p>
        <p className="mt-1 text-sm text-pretty text-stone-700">{DETALLE_SEMAFORO[semaforo]}</p>
      </div>
    </div>
  );
}

interface BarraConsumoProps {
  consumidoPct: number | null;
  semaforo: Semaforo;
  className?: string;
}

/**
 * Barra de coste real frente a presupuestado. Hasta el 100 % se rellena en proporción; si se pasa, la barra entera
 * es lo gastado, una raya marca dónde estaba el 100 % y lo que sobra va rayado. Decorativa: la cifra va en texto.
 */
export function BarraConsumo({ consumidoPct, semaforo, className }: BarraConsumoProps) {
  const { relleno, exceso, marca } = barraConsumo(consumidoPct);
  const color = COLOR_SEMAFORO[semaforo];
  return (
    <div aria-hidden="true" className={cn("relative h-2 overflow-hidden rounded-full bg-stone-100", className)}>
      <div className="flex h-full origin-left animate-crecer-x">
        {relleno > 0 && <div className={cn("h-full", color.barra)} style={{ width: `${relleno * 100}%` }} />}
        {exceso > 0 && <div className={cn("h-full", color.exceso)} style={{ width: `${exceso * 100}%` }} />}
      </div>
      {exceso > 0 && (
        <div className="absolute inset-y-0 w-0.5 bg-stone-950" style={{ left: `calc(${marca * 100}% - 1px)` }} />
      )}
    </div>
  );
}
