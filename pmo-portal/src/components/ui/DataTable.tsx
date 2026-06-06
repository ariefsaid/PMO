import React, { useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { ListState } from './ListState';

export type ColAlign = 'num' | 'center';

export interface Column<Row> {
  key: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  align?: ColAlign;
  /** When set, the header is sortable and reports this key to onSort. */
  sortKey?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  /** Click/Enter on a row (drill-down). */
  onActivate?: (row: Row) => void;
  selectedKey?: string;
  sort?: SortState;
  onSort?: (key: string) => void;
  /** Async state — renders ListState in place of the body. */
  state?: 'loading' | 'empty' | 'error';
  emptyTitle?: string;
  emptySub?: string;
  emptyAction?: { label: string; onClick: () => void };
  errorTitle?: string;
  errorSub?: string;
  onRetry?: () => void;
  /** Per-row overflow menu items (hidden until row hover). */
  rowMenu?: (row: Row) => RowMenuItem[];
  className?: string;
}

function alignClass(align?: ColAlign) {
  if (align === 'num') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/**
 * Generic, typed data table (the signature surface). Presentational: the three
 * async states delegate to ListState via the `state` prop. Rows are keyboard-
 * activatable; sortable headers expose aria-sort.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onActivate,
  selectedKey,
  sort,
  onSort,
  state,
  emptyTitle = 'Nothing here yet',
  emptySub,
  emptyAction,
  errorTitle = 'Could not load',
  errorSub,
  onRetry,
  rowMenu,
  className,
}: DataTableProps<Row>) {
  const colSpan = columns.length + (rowMenu ? 1 : 0);

  return (
    <div className={cn('overflow-hidden rounded-b-lg border border-border bg-card', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              {columns.map((col) => {
                const sortable = !!col.sortKey;
                const ariaSort =
                  sort && col.sortKey === sort.key
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : sortable
                      ? 'none'
                      : undefined;
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSort}
                    className={cn(
                      'sticky top-0 z-[2] h-[38px] border-b border-border bg-card px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground whitespace-nowrap select-none',
                      alignClass(col.align)
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort?.(col.sortKey!)}
                        className="inline-flex items-center gap-1 uppercase tracking-[0.03em] hover:text-foreground [&_svg]:size-3"
                      >
                        {col.header}
                        {sort?.key === col.sortKey && (
                          <Icon name={sort.dir === 'asc' ? 'up' : 'down'} />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {rowMenu && <th className="w-10 border-b border-border bg-card" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {state ? (
              <tr>
                <td colSpan={colSpan} className="p-0">
                  {state === 'loading' && <ListState variant="loading" />}
                  {state === 'empty' && (
                    <ListState
                      variant="empty"
                      title={emptyTitle}
                      sub={emptySub}
                      action={emptyAction}
                    />
                  )}
                  {state === 'error' && (
                    <ListState
                      variant="error"
                      title={errorTitle}
                      sub={errorSub}
                      onRetry={onRetry}
                    />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const selected = key === selectedKey;
                return (
                  <tr
                    key={key}
                    tabIndex={onActivate ? 0 : undefined}
                    onClick={() => onActivate?.(row)}
                    onKeyDown={(e) => {
                      if (onActivate && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onActivate(row);
                      }
                    }}
                    className={cn(
                      'group border-b border-border/70 last:border-b-0 transition-colors',
                      onActivate && 'cursor-pointer hover:bg-accent/60',
                      selected && 'bg-primary/[0.07]',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'h-[54px] px-3 py-2 align-middle whitespace-nowrap',
                          alignClass(col.align),
                          col.align === 'num' && 'tabular'
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                    {rowMenu && (
                      <td className="px-2 align-middle">
                        <RowMenu items={rowMenu(row)} />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const RowMenu: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <span aria-hidden className="text-base leading-none">
          ⋯
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className={cn(
                'flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent',
                item.danger && 'text-destructive'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Toolbar seamed to the table top (or `standalone` fully rounded). */
export const Toolbar: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { standalone?: boolean }
> = ({ standalone = false, className, children, ...rest }) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-2 border border-border bg-card px-3 py-2.5',
      standalone ? 'mb-3.5 rounded-lg' : 'rounded-t-lg border-b-0',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

/** Borderless search field shell. */
export const SearchMini: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }
> = ({ containerClassName, className, ...rest }) => (
  <div
    className={cn(
      'flex h-8 min-w-[190px] items-center gap-[7px] rounded-lg border border-input bg-background px-2.5 [&_svg]:size-[15px] [&_svg]:text-muted-foreground',
      containerClassName
    )}
  >
    <Icon name="search" />
    <input
      type="search"
      className={cn(
        'w-full border-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground',
        className
      )}
      {...rest}
    />
  </div>
);

/** Totals footer row. */
export const TableFoot: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-4 border-t-[1.5px] border-border bg-secondary/40 px-3.5 py-[11px] text-[13px] tabular',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);
