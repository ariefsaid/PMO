import React from 'react';
import { cn } from '@/src/components/ui';

export interface PrintTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: T, index: number) => React.ReactNode;
}

export interface PrintTableProps<T> {
  columns: PrintTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  className?: string;
  emptyText?: string;
  /** Footer rows (totals) drawn under the same columns, so each total sits under the figures it sums. */
  footer?: React.ReactNode;
}

/**
 * Generic printable line-items table (#2687, #2688).
 * Enforces page-break avoidance per row and clear print contrast.
 */
export function PrintTable<T>({
  columns,
  data,
  keyExtractor,
  className,
  emptyText = 'No items',
  footer,
}: PrintTableProps<T>): React.ReactElement {
  return (
    <div className={cn('overflow-x-auto my-6', className)} data-testid="print-table">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-foreground bg-muted/40 print:bg-transparent">
            {columns.map((col) => {
              const alignClass =
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                    ? 'text-center'
                    : 'text-left';
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'py-2 px-3 text-xs font-semibold text-foreground',
                    alignClass,
                  )}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-8 text-center text-muted-foreground text-sm"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={keyExtractor(row, index)}
                className="border-b border-border break-inside-avoid print:break-inside-avoid"
                data-testid={`print-table-row-${index}`}
              >
                {columns.map((col) => {
                  const alignClass =
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                        ? 'text-center'
                        : 'text-left';
                  return (
                    <td
                      key={col.key}
                      className={cn('py-2.5 px-3 text-sm text-foreground align-top', alignClass)}
                    >
                      {col.render(row, index)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className="border-t-2 border-foreground">{footer}</tfoot>}
      </table>
    </div>
  );
}
