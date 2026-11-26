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
  mobileStack?: boolean;
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
  mobileStack = false,
}: PrintTableProps<T>): React.ReactElement {
  return (
    <div className={cn('overflow-x-auto my-6', className)} data-testid="print-table"
      role="group" aria-label={columns.map((column) => column.header).join(', ')} tabIndex={0}>
      <table className="w-full text-left text-sm border-collapse">
        <thead className={mobileStack ? 'max-sm:hidden print:table-header-group' : undefined}>
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
                    'py-2 px-2 sm:px-3 text-sm font-semibold text-foreground',
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
                className={cn('border-b border-border break-inside-avoid print:break-inside-avoid', mobileStack && 'max-sm:block max-sm:py-3 print:table-row print:py-0')}
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
                      data-label={col.header}
                      className={cn('py-2.5 px-2 sm:px-3 text-sm text-foreground align-top', alignClass, mobileStack && 'max-sm:flex max-sm:justify-between max-sm:gap-4 max-sm:before:content-[attr(data-label)] max-sm:before:text-muted-foreground max-sm:before:text-left print:table-cell print:before:content-none', col.align === 'right' && 'whitespace-nowrap tabular-nums')}
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
