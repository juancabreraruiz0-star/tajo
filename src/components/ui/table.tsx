import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "../icons";
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
      <ul className="space-y-2.5 md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const contenido = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 font-semibold break-words text-stone-900">{primary.cell(row)}</div>
                {rowHref && <ChevronRightIcon className="mt-0.5 size-5 shrink-0 text-stone-400" />}
              </div>
              {rest.length > 0 && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-stone-100 pt-3 text-sm">
                  {rest.map((col) => (
                    <div key={col.key} className="contents">
                      <dt className="text-stone-500">{col.header}</dt>
                      <dd
                        className={cn(
                          "min-w-0 text-right break-words text-stone-800",
                          col.align === "right" && "font-medium tabular-nums",
                        )}
                      >
                        {col.cell(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          const clases = cn(
            "block rounded-xl border p-4 shadow-tarjeta",
            rowClassName?.(row) ?? "border-stone-200/90 bg-white",
          );
          return (
            <li key={rowKey(row)}>
              {rowHref ? (
                <Link
                  href={rowHref(row)}
                  className={cn(clases, "transition-[border-color,box-shadow] duration-150 hover:border-amber-400 active:shadow-none")}
                >
                  {contenido}
                </Link>
              ) : (
                <div className={clases}>{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Escritorio: tabla. Con rowHref, el enlace de la columna principal cubre toda la fila (clic en cualquier sitio). */}
      <div className="hidden overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-tarjeta md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-stone-200 bg-stone-50/80">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "px-5 py-3 text-[0.6875rem] font-semibold tracking-wider whitespace-nowrap text-stone-500 uppercase",
                    col.align === "right" && "text-right",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  "group transition-colors duration-150",
                  rowHref && "relative",
                  rowClassName?.(row) ?? (rowHref ? "hover:bg-amber-50/50" : undefined),
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-5 py-3.5 align-middle text-stone-700",
                      col.align === "right" && "text-right tabular-nums",
                      col === primary && "font-medium text-stone-900",
                      col.className,
                    )}
                  >
                    {col === primary && rowHref ? (
                      <Link
                        href={rowHref(row)}
                        className="rounded-sm underline-offset-2 group-hover:text-amber-800 group-hover:underline after:absolute after:inset-0 after:content-['']"
                      >
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
