import { formatMesAnio, formatMesCorto } from "@/lib/domain/dates";
import { formatEuros, formatEurosCorto } from "@/lib/domain/money";
import { maximoMensual, mediaMensual, proporcion, type MesFacturacion } from "@/lib/domain/panel";

// Geometría en píxeles. El SVG no lleva viewBox: el ancho se reparte en porcentajes y el texto no se escala, así
// se lee igual en un móvil de 375 px que en escritorio.
const ARRIBA = 28; // hueco para la cifra encima de la barra más alta
const ALTO_BARRAS = 168;
const ABAJO = 30; // nombres de los meses
const ALTO = ARRIBA + ALTO_BARRAS + ABAJO;

const pct = (n: number) => `${Number(n.toFixed(3))}%`;

interface FacturacionMensualProps {
  /** Id único en la página (título de la gráfica y tabla para lectores de pantalla). */
  id: string;
  serie: readonly MesFacturacion[];
}

/**
 * Gráfica de barras de la facturación por meses (SVG propio, sin librerías). El mes en curso va en ámbar. Para
 * lectores de pantalla, el SVG tiene un título y los importes exactos van en una tabla oculta.
 */
export function FacturacionMensual({ id, serie }: FacturacionMensualProps) {
  const maximo = maximoMensual(serie);
  const media = mediaMensual(serie);
  const columna = 100 / Math.max(serie.length, 1);
  const anchoBarra = columna * 0.58;
  const primero = serie[0];
  const ultimo = serie.at(-1);
  const titulo =
    primero && ultimo
      ? `Facturación por meses, de ${formatMesAnio(primero.desde)} a ${formatMesAnio(ultimo.desde)}. Los importes exactos están en la tabla siguiente.`
      : "Facturación por meses";

  return (
    <figure>
      <svg width="100%" height={ALTO} role="img" aria-labelledby={`${id}-titulo`} className="block overflow-visible">
        <title id={`${id}-titulo`}>{titulo}</title>

        {/* Barras: el SVG anidado recorta por abajo, así las esquinas redondeadas solo se ven arriba. */}
        <svg y={ARRIBA} width="100%" height={ALTO_BARRAS}>
          {[0.25, 0.5, 0.75].map((linea) => (
            <line
              key={linea}
              x1="0"
              x2="100%"
              y1={pct(linea * 100)}
              y2={pct(linea * 100)}
              stroke="#eef2f5"
              strokeWidth="1"
            />
          ))}
          {serie.map((mes, i) => {
            const p = proporcion(mes.totalCents, maximo);
            if (p === 0) return null;
            return (
              <rect
                key={mes.desde}
                x={pct(i * columna + (columna - anchoBarra) / 2)}
                y={pct((1 - p) * 100)}
                width={pct(anchoBarra)}
                height="100%"
                rx="6"
                className={
                  mes.actual
                    ? "origin-bottom animate-crecer-y fill-amber-500 transition-[fill] [transform-box:fill-box] hover:fill-amber-400"
                    : "origin-bottom animate-crecer-y fill-slate-300 transition-[fill] [transform-box:fill-box] hover:fill-slate-400"
                }
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <title>{`${formatMesAnio(mes.desde)}: ${formatEuros(mes.totalCents)}`}</title>
              </rect>
            );
          })}
        </svg>

        {/* Media y cifras, sin recortar */}
        <svg y={ARRIBA} width="100%" height={ALTO_BARRAS} className="overflow-visible" aria-hidden="true">
          {media > 0 && (
            <line
              x1="0"
              x2="100%"
              y1={pct((1 - proporcion(media, maximo)) * 100)}
              y2={pct((1 - proporcion(media, maximo)) * 100)}
              stroke="#5d6c80"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}
          <line x1="0" x2="100%" y1="100%" y2="100%" stroke="#cbd4dd" strokeWidth="1" />
          {serie.map((mes, i) => (
            <text
              key={mes.desde}
              x={pct((i + 0.5) * columna)}
              y={pct((1 - proporcion(mes.totalCents, maximo)) * 100)}
              dy="-9"
              textAnchor="middle"
              // Halo blanco: la cifra se lee aunque la cruce la línea de la media.
              stroke="#fff"
              strokeWidth="4"
              strokeLinejoin="round"
              paintOrder="stroke"
              className={
                mes.actual
                  ? "fill-stone-950 text-[0.8125rem] font-semibold tabular-nums"
                  : "fill-stone-600 text-xs font-medium tabular-nums"
              }
            >
              {formatEurosCorto(mes.totalCents)}
            </text>
          ))}
        </svg>

        {/* Meses */}
        {serie.map((mes, i) => (
          <text
            key={mes.desde}
            x={pct((i + 0.5) * columna)}
            y={ALTO - 8}
            textAnchor="middle"
            aria-hidden="true"
            className={
              mes.actual
                ? "fill-amber-800 text-xs font-semibold tracking-wide uppercase"
                : "fill-stone-500 text-xs font-medium tracking-wide uppercase"
            }
          >
            {formatMesCorto(mes.desde)}
          </text>
        ))}
      </svg>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-stone-600">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-amber-500" />
          Mes en curso
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-slate-300" />
          Meses anteriores
        </span>
        {media > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="w-4 border-t border-dashed border-stone-500" />
            Media mensual: <span className="font-medium text-stone-800 tabular-nums">{formatEuros(media)}</span>
          </span>
        )}
      </figcaption>

      {/* La tabla va dentro de un div sr-only: una tabla con sr-only directamente sigue ocupando su ancho. */}
      <div className="sr-only">
        <table>
          <caption>Facturación por meses (total con IVA de las facturas emitidas)</caption>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Facturado</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((mes) => (
              <tr key={mes.desde}>
                <th scope="row">
                  {formatMesAnio(mes.desde)}
                  {mes.actual ? " (mes en curso)" : ""}
                </th>
                <td>{formatEuros(mes.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
