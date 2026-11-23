import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Columna principal: va enlazada en escritorio y como título de la tarjeta en móvil. */
  primary?: boolean;
  align?: "left" | "right";
  /** Ocultar en la tarjeta de móvil (p. ej. datos secundarios). */
  hideOnMobile?: boolean;
  className?: string;
}

interface TableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Si se indica, cada fila/tarjeta lleva a este enlace. */
  rowHref?: (row: T) => string;
  /** Colores de fondo/borde de una fila (p. ej. resaltar en rojo); sustituyen a los de por defecto. */
  rowClassName?: (row: T) => string | undefined;
  /** Texto para lectores de pantalla. */
  caption: string;
}

/**
 * Tabla en escritorio y lista de tarjetas en móvil.
 * Las celdas no deben llevar enlaces propios: el enlace de la fila lo pone rowHref.
 */
export function Table<T>({ columns, rows, rowKey, rowHref, rowClassName, caption }: TableProps<T>) {
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);

  return (
    <>
      {/* Móvil: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const contenido = (
            <>
              <div className="font-semibold text-stone-900">{primary.cell(row)}</div>
              {rest.length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {rest.map((col) => (
                    <div key={col.key} className="contents">
                      <dt className="text-stone-500">{col.header}</dt>
                      <dd className="min-w-0 text-right break-words text-stone-800">{col.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          const clases = cn(
            "block rounded-xl border p-4 shadow-sm",
            rowClassName?.(row) ?? "border-stone-200 bg-white",
          );
          return (
            <li key={rowKey(row)}>
              {rowHref ? (
                <Link href={rowHref(row)} className={cn(clases, "transition-colors hover:border-amber-400")}>
                  {contenido}
                </Link>
              ) : (
                <div className={clases}>{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Escritorio: tabla */}
      <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn("px-4 py-3", col.align === "right" && "text-right", col.className)}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row) ?? "hover:bg-stone-50"}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-stone-700",
                      col.align === "right" && "text-right tabular-nums",
                      col === primary && "font-medium text-stone-900",
                      col.className,
                    )}
                  >
                    {col === primary && rowHref ? (
                      <Link href={rowHref(row)} className="hover:text-amber-700 hover:underline">
                        {col.cell(row)}
                      </Link>
                    ) : (
                      col.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
