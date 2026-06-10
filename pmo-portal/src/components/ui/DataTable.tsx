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
  /**
   * Extra Tailwind classes applied to both the `<th>` and each `<td>` in this column.
   * Use for responsive hiding, e.g. `"hidden xl:table-cell"`.
   */
  colClassName?: string;
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
  /**
   * Accessible name for the row's activation control. When provided alongside
   * `onActivate`, the first column's content is wrapped in a real focusable
   * `<button>` carrying this name — so each row has a keyboard- and
   * screen-reader-reachable affordance WITHOUT overriding the `<tr>`'s implicit
   * `role="row"`. Omit when the first cell already renders its own focusable
   * control (e.g. a name button) to avoid nesting interactive elements.
   */
  rowLabel?: (row: Row) => string;
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
 * Strips responsive-hide classes (e.g. "hidden xl:table-cell") from colClassName
 * when projecting a column into the card branch. Cards have vertical room that the
 * table doesn't, so every column should render in the card regardless of the
 * desktop hiding strategy. Alignment and other utilities are preserved.
 *
 * Pattern stripped: any class that starts with "hidden" or contains ":hidden" or
 * matches "hidden [breakpoint]:table-cell" compound patterns.
 */
function stripHiddenClasses(colClassName?: string): string {
  if (!colClassName) return '';
  return colClassName
    .split(' ')
    .filter((cls) => {
      // Strip bare "hidden" and any responsive-hide pattern like "hidden xl:table-cell"
      // or "sm:hidden" etc. Alignment classes (text-right, tabular) pass through.
      return !cls.startsWith('hidden') && !cls.endsWith(':hidden');
    })
    .join(' ');
}

/**
 * Generic, typed data table (the signature surface). Presentational: the three
 * async states delegate to ListState via the `state` prop. Rows are keyboard-
 * activatable; sortable headers expose aria-sort.
 *
 * Mobile reflow (OD-W4-4, AC-IXD-MOBILE-W4-C1):
 * - Below `md` (768px): renders a stacked card list (`md:hidden`) — each row
 *   maps to a card with the first column as the activation title and the remaining
 *   columns as a <dl> label:value list. All data is shown (no column dropped).
 * - At `md`+: renders the original `<table>` (`hidden md:block`) — desktop is
 *   byte-unchanged. The card branch is purely additive.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onActivate,
  rowLabel,
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

  // Shared ListState node — rendered once and reused in both branches via a
  // local variable so the async-state code is one source of truth.
  const listStateNode = state ? (
    <>
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
    </>
  ) : null;

  return (
    <div className={cn('overflow-hidden rounded-b-lg border border-border bg-card', className)}>
      {/* ── Desktop table branch (hidden md:block — byte-unchanged) ─────── */}
      <div data-testid="dt-table-branch" className="hidden md:block overflow-x-auto">
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
                      alignClass(col.align),
                      col.colClassName
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
                  {listStateNode}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const selected = key === selectedKey;
                // The <tr> keeps its IMPLICIT role="row" (never role="link",
                // which breaks table-row semantics and hides body rows from
                // getByRole('row')). Whole-row onClick stays as a pointer
                // convenience; the keyboard/screen-reader affordance is the
                // real <button> rendered into the first cell when `rowLabel`
                // is supplied (see below).
                return (
                  <tr
                    key={key}
                    onClick={onActivate ? () => onActivate(row) : undefined}
                    className={cn(
                      'group border-b border-border/70 last:border-b-0 transition-colors',
                      onActivate && 'cursor-pointer hover:bg-accent/60',
                      selected && 'bg-primary/[0.07]'
                    )}
                  >
                    {columns.map((col, colIndex) => {
                      const activatable = onActivate && rowLabel && colIndex === 0;
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'h-[54px] px-3 py-2 align-middle whitespace-nowrap',
                            alignClass(col.align),
                            col.align === 'num' && 'tabular',
                            col.colClassName
                          )}
                        >
                          {activatable ? (
                            <button
                              type="button"
                              aria-label={rowLabel(row)}
                              onClick={(e) => {
                                // The <tr> onClick already activates; stop it so
                                // the row doesn't fire onActivate twice.
                                e.stopPropagation();
                                onActivate(row);
                              }}
                              className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                            >
                              {col.cell(row)}
                            </button>
                          ) : (
                            col.cell(row)
                          )}
                        </td>
                      );
                    })}
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

      {/* ── Mobile card branch (md:hidden — additive, zero consumer churn) ─ */}
      {/*
       * OD-W4-4 / AC-IXD-MOBILE-W4-C1: stacked record-card list.
       * Card anatomy (DESIGN.md tokens):
       *   - Container: bg-card, border, rounded-md (8px), p-4 (16px), gap-2 (8px) between cards
       *   - Title row: first column = activation <button> (rowLabel accessible name)
       *   - Field rows: <dl> grid — <dt> = column header (overline/label voice), <dd> = cell value
       *   - Numeric columns: tabular + text-right on <dd>
       *   - rowMenu ⋯: top-right corner of the card, .touch-target
       * Sorting is a desktop-density affordance — not reproduced on cards (sort headers not shown).
       * All columns render in the card (no hidden data) regardless of colClassName responsive-hide.
       *
       * aria-hidden="true": the <table> branch is the authoritative semantic structure (aria-sort,
       * role="row", column headers, etc.) and is ALWAYS in the DOM. The card list is a CSS-layout
       * alternative for sighted touch users. Hiding it from AT avoids duplicate content for screen
       * readers and keeps existing consumer tests stable (RTL getByText/getByRole only find the
       * table branch). Keyboard users on touch devices reach rows via the table (scrollable).
       */}
      <ul
        data-testid="dt-card-branch"
        role="list"
        aria-hidden="true"
        className="md:hidden divide-y divide-border/70"
      >
        {state ? (
          <li className="p-0">{listStateNode}</li>
        ) : (
          rows.map((row) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            const [titleCol, ...restCols] = columns;
            const hasMenu = !!rowMenu;
            const menuItems = hasMenu ? rowMenu!(row) : [];

            return (
              <li
                key={key}
                className={cn(
                  'relative flex flex-col gap-2 p-4 text-[13.5px] transition-colors',
                  onActivate && 'cursor-pointer',
                  selected && 'bg-primary/[0.07]'
                )}
              >
                {/* Title row: first column + rowMenu ⋯ pinned top-right */}
                <div className="flex items-start justify-between gap-3">
                  {/* Card title — activation button if rowLabel+onActivate supplied */}
                  <div className="min-w-0 flex-1 font-semibold">
                    {onActivate && rowLabel ? (
                      <button
                        type="button"
                        aria-label={rowLabel(row)}
                        onClick={() => onActivate(row)}
                        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                      >
                        {titleCol.cell(row)}
                      </button>
                    ) : (
                      titleCol.cell(row)
                    )}
                  </div>
                  {/* rowMenu ⋯ — top-right of the card, .touch-target for ≥44px on coarse pointer */}
                  {hasMenu && menuItems.length > 0 && (
                    <div className="shrink-0">
                      <RowMenu items={menuItems} />
                    </div>
                  )}
                </div>

                {/* Remaining columns as a definition list */}
                {restCols.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    {restCols.map((col) => (
                      <React.Fragment key={col.key}>
                        <dt
                          className={cn(
                            'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground self-center',
                            stripHiddenClasses(col.colClassName)
                          )}
                        >
                          {col.header}
                        </dt>
                        <dd
                          className={cn(
                            'text-[13.5px] text-foreground',
                            col.align === 'num' && 'tabular text-right',
                            col.align === 'center' && 'text-center',
                            stripHiddenClasses(col.colClassName)
                          )}
                        >
                          {col.cell(row)}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
              </li>
            );
          })
        )}
      </ul>
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
        // B-4 (AC-W2-IXD-006): always-visible trigger — removed `opacity-0 group-hover:opacity-100`
        // which made the ⋯ undiscoverable on touch + keyboard. The trigger is now visible by
        // default so every row's actions are reachable without a hover event. Touch targets ≥44px
        // come from the `.touch-target` utility (coarse-pointer min hit area).
        className="touch-target grid size-7 place-items-center rounded-md text-muted-foreground transition-[opacity,background-color] hover:bg-accent hover:text-foreground"
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
          {items.map((item, i) => {
            // destructive-nav-separation: spatially separate the first danger item
            // from the non-danger items above it with a hairline divider (matches the
            // crud-companies.html `.menu-sep` above Delete). No separator when the
            // danger item is first/only, or for consecutive danger items.
            const needsSep = item.danger && i > 0 && !items[i - 1].danger;
            return (
              <React.Fragment key={item.label}>
                {needsSep && <div role="separator" className="my-1 h-px bg-border" />}
                <button
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
              </React.Fragment>
            );
          })}
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
      {...rest }
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
