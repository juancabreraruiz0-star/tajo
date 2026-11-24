import { formatPercent } from "@/lib/domain/kpis";
import type { Embudo as DatosEmbudo, EtapaEmbudoClave } from "@/lib/domain/panel";
import { cn } from "../ui/cn";

// Colores de D6: borrador gris, enviado azul, aceptado verde, facturado violeta (rechazado rojo, aparte).
const COLOR: Record<EtapaEmbudoClave, { barra: string; punto: string }> = {
  creados: { barra: "fill-stone-400", punto: "bg-stone-400" },
  enviados: { barra: "fill-blue-500", punto: "bg-blue-500" },
  aceptados: { barra: "fill-green-500", punto: "bg-green-500" },
  facturados: { barra: "fill-violet-500", punto: "bg-violet-500" },
};

const DE_LA_ANTERIOR: Record<EtapaEmbudoClave, string> = {
  creados: "",
  enviados: "de los creados",
  aceptados: "de los enviados",
  facturados: "de los aceptados",
};

const pct = (fraccion: number) => `${Number((fraccion * 100).toFixed(3))}%`;

/** Barra horizontal en SVG (ancho en porcentaje del total). Decorativa: la cifra va en texto al lado. */
function Barra({ fraccion, clase, retraso }: { fraccion: number; clase: string; retraso: number }) {
  return (
    <svg width="100%" height="10" aria-hidden="true" focusable="false" className="mt-2 block overflow-hidden rounded-full">
      <rect width="100%" height="10" className="fill-stone-100" />
      {fraccion > 0 && (
        <rect
          width={pct(fraccion)}
          height="10"
          rx="5"
          className={cn("origin-left animate-crecer-x [transform-box:fill-box]", clase)}
          style={{ animationDelay: `${retraso}ms` }}
        />
      )}
    </svg>
  );
}

/** Embudo de presupuestos: cuántos llegan a cada fase y qué parte pasa de una a la siguiente. */
export function Embudo({ embudo }: { embudo: DatosEmbudo }) {
  const { rechazados } = embudo;
  return (
    <div>
      <ol className="space-y-4">
        {embudo.etapas.map((etapa, i) => (
          <li key={etapa.clave}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-stone-800">
                <span aria-hidden="true" className={cn("size-2 rounded-full", COLOR[etapa.clave].punto)} />
                {etapa.etiqueta}
              </span>
              <span className="text-stone-500 tabular-nums">
                <span className="text-base font-semibold text-stone-950">{etapa.total}</span>
                {etapa.conversion !== null && (
                  <>
                    {" · "}
                    {formatPercent(etapa.conversion)} {DE_LA_ANTERIOR[etapa.clave]}
                  </>
                )}
              </span>
            </div>
            <Barra fraccion={etapa.fraccion} clase={COLOR[etapa.clave].barra} retraso={i * 80} />
          </li>
        ))}
      </ol>
      <p className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-dashed border-stone-200 pt-4 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-stone-800">
          <span aria-hidden="true" className="size-2 rounded-full bg-red-500" />
          Rechazados
        </span>
        <span className="text-stone-500 tabular-nums">
          <span className="text-base font-semibold text-stone-950">{rechazados.total}</span>
          {rechazados.fraccionDeEnviados !== null && <> · {formatPercent(rechazados.fraccionDeEnviados)} de los enviados</>}
        </span>
      </p>
    </div>
  );
}
