import React, { useRef } from 'react';
import type { Table } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { Checkbox } from './Checkbox';
import { RowMenu, type RowMenuItem } from './RowMenu';
import {
  columnMinSize,
  columnMaxSize,
  columnDefaultSize,
} from './useTableColumnSizing';
import type {
  Column,
  ColAlign,
  DataTableSelection,
} from './DataTable';
import { PrimaryCell } from './DataTableShared';
import type { GroupedRowEntry } from './DataTableShared';

/** Sticky row-actions column (⋯). Chromium sticky-table-cell paint quirks, pinned empirically
 *  (2026-10-08 fix round, AC-TBL-STICKY-001):
 *  1. In a `border-collapse` table the cell's collapsed `border-l` does NOT travel with a sticky
 *     cell — at the stuck position no border paints at all. The divider is an INSET box-shadow
 *     hairline, which paints with the cell's own layer in light and dark.
 *  2. A cell stuck flush (`right-0`) paints its background ~1px short of its layout edge, leaving
 *     a seam through which scrolled text shows as a glyph sliver PAST the ⋯ column. Sticking 1px
 *     PAST the scrollport edge (`-right-px`) lets the scroller's own clip cut the excess and
 *     closes the seam.
 *  3. An OUTSET box-shadow on a sticky table cell is not painted at all (clipped to the cell's
 *     box), so the left-cast separation shadow is a positioned gradient strip (ROW_MENU_SEAM_CLASS)
 *     rendered inside the cell — see DESIGN.md §6 Row actions. */
const ROW_MENU_STICKY_CLASS =
  'sticky -right-px shadow-[inset_1px_0_0_hsl(var(--border))]';
/** Left-cast separation gradient for the sticky actions column: from the `foreground` token
 *  (near-black in light, near-light in dark — the token flips the cast with the mode) fading out
 *  over 12px to the LEFT of the cell. Positioned inside the sticky cell so it travels with it. */
const ROW_MENU_SEAM_CLASS =
  'pointer-events-none absolute inset-y-0 -left-3 w-3 bg-gradient-to-l from-[hsl(var(--foreground)/0.16)] to-transparent';

function alignClass(align?: ColAlign) {
  if (align === 'num') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/** Whether content is hidden to the right of the scrollport. Held OUTSIDE React state on purpose: the first
 *  measurement usually flips it, and as `useState` that flip re-rendered the whole table body once per mount.
 *  Only the tiny seam strips subscribe, so a flip re-renders them and nothing else. */
interface SeamStore {
  get: () => boolean;
  set: (next: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSeamStore(): SeamStore {
  let value = false;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The separation gradient, rendered only while content remains hidden to the right. useSyncExternalStore
 *  re-reads on subscribe, so a flip between render and subscription is never missed. */
function RowMenuSeam({ store }: { store: SeamStore }) {
  const visible = React.useSyncExternalStore(store.subscribe, store.get, () => false);
  return visible ? <span aria-hidden data-dt-seam className={ROW_MENU_SEAM_CLASS} /> : null;
}

function useStickyRowMenuSeam(
  scrollportRef: React.RefObject<HTMLDivElement | null>,
  tableRef: React.RefObject<HTMLTableElement | null>,
  enabled: boolean,
  onOverflowChange?: (overflowing: boolean) => void,
): SeamStore {
  const [store] = React.useState(createSeamStore);

  React.useLayoutEffect(() => {
    const scrollport = scrollportRef.current;
    const table = tableRef.current;
    const report = (overflowing: boolean) => {
      store.set(overflowing);
      scrollport?.toggleAttribute('data-dt-overflowing', overflowing);
      onOverflowChange?.(overflowing);
    };
    if (!enabled || !scrollport || !table) {
      report(false);
      return;
    }

    const measure = () => {
      report(scrollport.scrollWidth - scrollport.clientWidth - scrollport.scrollLeft > 1);
    };

    measure();
    scrollport.addEventListener('scroll', measure, { passive: true });

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(scrollport);
      observer.observe(table);
    } else {
      window.addEventListener('resize', measure);
    }

    return () => {
      scrollport.removeEventListener('scroll', measure);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [enabled, onOverflowChange, scrollportRef, tableRef, store]);

  return store;
}

export interface DataTableDesktopProps<Row> {
  columns: Column<Row>[];
  table: Table<Row>;
  groupedRows: GroupedRowEntry<Row>[];
  collapsedGroups: Set<string>;
  groupToggle: (key: string, count: number) => React.ReactNode;
  groupHeader?: (label: string, rows: Row[]) => React.ReactNode;
  groupHeaderSpan?: boolean;
  tableInstanceId: string;
  caveatId: string;
  accessibleName?: string;
  onActivate?: (row: Row) => void;
  rowLabel?: (row: Row) => string;
  accessibleRowLabel: (row: Row) => string | undefined;
  rowTarget?: (row: Row) => string | undefined;
  selectedKey?: string;
  rowMenu?: (row: Row) => RowMenuItem[] | undefined;
  selection?: DataTableSelection<Row>;
  selectAllChecked: boolean | 'mixed';
  toggleAllRows: (checked: boolean) => void;
  selectionLabel: (row: Row, primaryColumn?: Column<Row>) => string;
  visibleSelectionIds: string[];
  state?: 'loading' | 'empty' | 'error';
  listStateNode: React.ReactNode;
  totals?: Array<{ key: string; label: React.ReactNode; values?: Record<string, React.ReactNode> }>;
  onSort?: (key: string) => void;
  columnSizing: Record<string, number>;
  onOverflowChange?: (overflowing: boolean) => void;
}

export function DataTableDesktop<Row>({
  columns,
  table,
  groupedRows,
  collapsedGroups,
  groupToggle,
  groupHeader,
  groupHeaderSpan = false,
  tableInstanceId,
  caveatId,
  accessibleName,
  onActivate,
  rowLabel,
  accessibleRowLabel,
  rowTarget,
  selectedKey,
  rowMenu,
  selection,
  selectAllChecked,
  toggleAllRows,
  selectionLabel,
  visibleSelectionIds,
  state,
  listStateNode,
  totals,
  onSort,
  columnSizing,
  onOverflowChange,
}: DataTableDesktopProps<Row>) {
  const { t } = useTranslation('projects');
  const tableBranchRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const keyboardResizeStart = useRef<Record<string, number>>({});

  const modelHeaders = table.getHeaderGroups()[0]?.headers ?? [];
  const seamStore = useStickyRowMenuSeam(
    tableBranchRef,
    tableRef,
    Boolean(rowMenu) || Boolean(onOverflowChange),
    onOverflowChange,
  );

  // A column hidden with CSS (colClassName "hidden", e.g. the Age column on a project tab) must
  // not drive the table's min width: its size still sits in getTotalSize(), and counting it makes
  // the table overflow by that amount even when every visible column fits — which then trips the
  // sticky actions column's scroll shadow over content that is not actually scrolled under it.
  const hiddenColumnSize = columns
    .filter((column) => /(^|\s)hidden($|\s)/.test(column.colClassName ?? ''))
    .reduce((sum, column) => sum + (column.size ?? 0), 0);
  const colSpan = columns.length + (rowMenu ? 1 : 0) + (selection ? 1 : 0);

  return (
    /* ── Desktop table branch (≥768px — only branch in the DOM; markup byte-unchanged) ── */
    // `relative` makes this scroller the containing block for the absolutely-positioned
    // `sr-only` "Actions" header (not sticky, so it is otherwise unpositioned) — without it the
    // header escapes the clip and the whole page scrolls sideways (AC-TBL-OVERFLOW-001).
    <div
      ref={tableBranchRef}
      data-testid="dt-table-branch"
      className="relative overflow-x-auto"
    >
      <table
        ref={tableRef}
        aria-label={accessibleName}
        style={{
          ...(columns.some((column) => column.size !== undefined || column.kind === 'primary' || column.kind === 'status') ? { minWidth: Math.max(0, table.getTotalSize() - hiddenColumnSize) + (rowMenu ? 40 : 0) + (selection ? 40 : 0), tableLayout: 'fixed' as const } : {}),
        }}
        className="w-full border-collapse text-control"
      >
        <thead className={state === 'error' ? 'sr-only' : undefined}>
          <tr>
            {selection && <th scope="col" className="sticky top-0 z-[2] h-[var(--table-head-height)] w-10 border-b border-border bg-surface-table-head px-2 text-left">
              <span onClick={(event) => event.stopPropagation()}>
                <Checkbox checked={selectAllChecked} onChange={toggleAllRows} label={t('table.selectAllRows', 'Select all rows')} disabled={state !== undefined || visibleSelectionIds.length === 0} />
              </span>
            </th>}
            {modelHeaders.map((header, headerIndex) => {
              const col = columns.find((column) => column.key === header.column.id)!;
              const sortable = header.column.getCanSort();
              const currentSort = header.column.getIsSorted();
              const ariaSort = currentSort ? (currentSort === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined;
              return (
                <th
                  key={header.id}
                  id={`datatable-header-${tableInstanceId}-${col.key}`}
                  data-col-key={col.key}
                  aria-sort={ariaSort}
                  aria-labelledby={`datatable-header-label-${tableInstanceId}-${col.key}`}
                  aria-describedby={col.caveat ? caveatId : undefined}
                  style={columnSizing[col.key] !== undefined || columnDefaultSize(col) !== undefined
                    ? { width: header.getSize(), ...(columnMinSize(col) !== undefined ? { minWidth: columnMinSize(col) } : {}), ...(columnMaxSize(col) !== undefined ? { maxWidth: columnMaxSize(col) } : {}) }
                    : undefined}
                  className={cn(
                    'group relative sticky top-0 z-[2] hover:z-[5] focus-within:z-[5] h-[var(--table-head-height)] border-b border-border bg-surface-table-head px-[var(--table-cell-inset)] text-control font-semibold text-foreground break-words select-none',
                    col.stickyLeft && 'left-0 z-[3]',
                    alignClass(col.align),
                    col.colClassName
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(col.sortKey!)}
                      className="inline-flex flex-wrap items-center gap-1 break-words hover:text-foreground [&_svg]:size-3"
                    >
                      <span id={`datatable-header-label-${tableInstanceId}-${col.key}`} className="break-words">{col.header}</span>
                      {col.caveat && <span aria-hidden="true" className="ml-0.5 text-warning-foreground">*</span>}
                      {currentSort ? <Icon name={currentSort === 'asc' ? 'up' : 'down'} /> : <span data-testid="sort-cue" aria-hidden="true" className="opacity-40 [&_svg]:size-3"><Icon name="sort" /></span>}
                    </button>
                  ) : (
                    <><span id={`datatable-header-label-${tableInstanceId}-${col.key}`} className="break-words">{col.header}</span>{col.caveat && <span aria-hidden="true" className="ml-0.5 text-warning-foreground">*</span>}</>
                  )}
                  {(() => {
                    const min = columnMinSize(col) ?? 20;
                    const max = columnMaxSize(col) ?? 900;
                    if (min === max) return null;
                    return (
                      <div
                        role="separator"
                        aria-label={t('table.resizeColumn', 'Resize {{column}} column', { column: typeof col.header === 'string' ? col.header : col.key.charAt(0).toUpperCase() + col.key.slice(1) })}
                        aria-controls={`datatable-header-${tableInstanceId}-${col.key}`}
                        aria-orientation="vertical"
                        aria-valuenow={header.getSize()}
                        aria-valuemin={min}
                        aria-valuemax={max}
                        tabIndex={0}
                        onFocus={() => { keyboardResizeStart.current[col.key] = header.getSize(); }}
                        onBlur={() => { delete keyboardResizeStart.current[col.key]; }}
                        onMouseDown={(event) => {
                          const startX = event.clientX;
                          const startWidth = header.getSize();
                          const resize = (clientX: number) => table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: Math.min(max, Math.max(min, startWidth + clientX - startX)) }));
                          const move = (moveEvent: MouseEvent) => resize(moveEvent.clientX);
                          const stop = () => {
                            window.removeEventListener('mousemove', move);
                            window.removeEventListener('mouseup', stop);
                          };
                          window.addEventListener('mousemove', move);
                          window.addEventListener('mouseup', stop, { once: true });
                        }}
                        onTouchStart={(event) => {
                          const startX = event.touches[0]?.clientX;
                          if (startX === undefined) return;
                          const startWidth = header.getSize();
                          const move = (moveEvent: TouchEvent) => {
                            const clientX = moveEvent.touches[0]?.clientX;
                            if (clientX !== undefined) table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: Math.min(max, Math.max(min, startWidth + clientX - startX)) }));
                          };
                          const stop = () => {
                            window.removeEventListener('touchmove', move);
                            window.removeEventListener('touchend', stop);
                          };
                          window.addEventListener('touchmove', move, { passive: true });
                          window.addEventListener('touchend', stop, { once: true });
                        }}
                        onDoubleClick={() => header.column.resetSize()}
                        onKeyDown={(event) => {
                          const current = header.getSize();
                          let next: number | undefined;
                          if (event.key === 'ArrowLeft') next = current - (event.shiftKey ? 64 : 16);
                          if (event.key === 'ArrowRight') next = current + (event.shiftKey ? 64 : 16);
                          if (event.key === 'Home') next = min;
                          if (event.key === 'End') next = max;
                          if (next !== undefined) {
                            event.preventDefault();
                            table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: Math.min(max, Math.max(min, next!)) }));
                          } else if (event.key === 'Enter') {
                            event.preventDefault();
                            header.column.resetSize();
                            keyboardResizeStart.current[col.key] = columnDefaultSize(col) ?? header.column.getSize();
                          } else if (event.key === 'Escape') {
                            const start = keyboardResizeStart.current[col.key];
                            if (start !== undefined) {
                              event.preventDefault();
                              table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: start }));
                              keyboardResizeStart.current[col.key] = start;
                            }
                          }
                        }}
                        // The last column's handle stays inside the table, or it widens the scroll box by 12px.
                        style={{ right: headerIndex === modelHeaders.length - 1 ? 0 : -12, width: 24, height: 'var(--table-head-height)' }}
                        className="datatable-resize-handle pointer-events-auto absolute top-0 z-[4] cursor-col-resize opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      >
                        <span aria-hidden className={cn('datatable-resize-indicator pointer-events-none absolute inset-y-2 left-3 w-[2px]', header.column.getIsResizing() ? 'bg-ring' : 'bg-[hsl(var(--input))] group-hover:bg-muted-foreground/60')} />
                      </div>
                    );
                  })()}
                </th>
              );
            })}
            {rowMenu && (
              <th className={cn(ROW_MENU_STICKY_CLASS, 'top-0 z-[3] w-10 border-b border-border bg-surface-table-head')} scope="col">
                <RowMenuSeam store={seamStore} />
                <span className="sr-only">{t('table.actions', 'Actions')}</span>
              </th>
            )}
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
            groupedRows.map((entry, entryIndex) => {
              if (entry.type === 'heading') return (
                <tr key={`group-${entry.label}-${entryIndex}`} className="h-[var(--table-row-min-height)] bg-secondary">
                  {selection && <td className="px-2" />}
                  <th scope="row" colSpan={groupHeaderSpan ? columns.length : undefined} className="px-[var(--table-cell-inset)] text-left text-control font-semibold text-foreground"><div className="flex flex-wrap items-center justify-between gap-x-4">{groupToggle(entry.label, entry.count)}{groupHeader?.(entry.label, entry.rows.map((modelRow) => modelRow.original))}</div></th>
                  {!groupHeaderSpan && columns.slice(1).map((column) => <td key={column.key} className={cn('px-[var(--table-cell-inset)]', alignClass(column.align))} />)}
                  {rowMenu && <td className={cn(ROW_MENU_STICKY_CLASS, 'bg-secondary')} />}
                </tr>
              );
              if (entry.group && collapsedGroups.has(entry.group)) return null;
              const modelRow = entry.modelRow;
              const row = modelRow.original;
              const key = modelRow.id;
              const targetId = rowTarget?.(row);
              const selected = key === selectedKey;
              const stickyRowSurface = selected
                ? 'bg-surface-selected'
                : onActivate
                  ? 'bg-card group-hover:bg-surface-hover'
                  : 'bg-card';
              // The <tr> keeps its IMPLICIT role="row" (never role="link",
              // which breaks table-row semantics and hides body rows from
              // getByRole('row')). Whole-row onClick stays as a pointer
              // convenience; the keyboard/screen-reader affordance is the
              // real <button> rendered into the first cell when `rowLabel`
              // is supplied (see below).
              return (
                <tr
                  key={key}
                  id={targetId}
                  tabIndex={targetId ? -1 : undefined}
                  onClick={
                    onActivate
                      ? (e) => {
                          // Guard: ignore clicks that originate from interactive
                          // elements rendered INSIDE the row (inline selects,
                          // inputs, buttons, links, labels, etc.). This prevents
                          // an in-row <select> change from opening the edit modal.
                          // The first-cell activation <button> and the RowMenu
                          // wrapper already call e.stopPropagation() so they never
                          // reach here; this guard is defence-in-depth for any
                          // other interactive control added to a cell in the future.
                          if (
                            (e.target as HTMLElement).closest(
                              'button, a, select, input, textarea, label, [role="checkbox"], [role="menuitem"], [contenteditable]'
                            )
                          )
                            return;
                          onActivate(row);
                        }
                      : undefined
                  }
                  className={cn(
                    'group border-b border-border/70 last:border-b-0',
                    onActivate && 'cursor-pointer',
                    onActivate && !selected && 'hover:bg-surface-hover',
                    selected && 'bg-surface-selected'
                  )}
                >
                  {selection && <td className="h-[var(--table-row-min-height)] w-10 px-2 py-2 align-middle">
                    <span onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={modelRow.getIsSelected()}
                        onChange={(checked) => modelRow.toggleSelected(checked)}
                        label={selectionLabel(row, columns[0])}
                      />
                    </span>
                  </td>}
                  {modelRow.getVisibleCells().map((cell, colIndex) => {
                    const col = columns.find((column) => column.key === cell.column.id)!;
                    const activatable = onActivate && rowLabel && colIndex === 0;
                    const CellTag = col.rowHeader ? 'th' : 'td';
                    return (
                      <CellTag
                        key={col.key}
                        {...(col.rowHeader ? { scope: 'row' as const } : {})}
                        style={columnSizing[col.key] !== undefined || columnDefaultSize(col) !== undefined
                          ? { width: cell.column.getSize(), ...(columnMinSize(col) !== undefined ? { minWidth: columnMinSize(col) } : {}), ...(columnMaxSize(col) !== undefined ? { maxWidth: columnMaxSize(col) } : {}) }
                          : undefined}
                        className={cn(
                          'h-[var(--table-row-min-height)] break-words px-[var(--table-cell-inset)] py-2 align-middle [&_.truncate]:break-words [&_.truncate]:overflow-visible [&_.truncate]:text-clip [&_.truncate]:whitespace-normal',
                          col.stickyLeft && cn('sticky left-0 z-[1]', stickyRowSurface),
                          alignClass(col.align),
                          col.align === 'num' && 'tabular',
                          col.colClassName
                        )}
                      >
                        {activatable ? (
                          <button
                            type="button"
                            aria-label={accessibleRowLabel(row)}
                            onClick={(e) => {
                              // The <tr> onClick already activates; stop it so
                              // the row doesn't fire onActivate twice.
                              e.stopPropagation();
                              onActivate(row);
                            }}
                            className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                          >
                            {col.kind === 'primary' ? <PrimaryCell title={col.cell(row)} titleText={col.primaryTitle?.(row)} secondary={col.secondaryCell?.(row)} /> : col.cell(row)}
                          </button>
                        ) : (
                          col.kind === 'primary' ? <PrimaryCell title={col.cell(row)} titleText={col.primaryTitle?.(row)} secondary={col.secondaryCell?.(row)} /> : col.cell(row)
                        )}
                      </CellTag>
                    );
                  })}
                  {rowMenu && (
                    <td className={cn(ROW_MENU_STICKY_CLASS, 'z-[1] px-2 align-middle', stickyRowSurface)}>
                      <RowMenuSeam store={seamStore} />
                      {(() => {
                        const items = rowMenu(row) ?? [];
                        return items.length > 0 ? <RowMenu items={items} /> : null;
                      })()}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
        {totals && totals.length > 0 && <tfoot>
          {totals.map((total) => <tr key={total.key} className="h-[var(--table-row-min-height)] border-t-[1.5px] border-border bg-secondary font-semibold tabular">
            {selection && <td />}
            {columns.map((column, index) => <td key={column.key} className={cn('px-[var(--table-cell-inset)] py-2 align-middle', column.stickyLeft && 'sticky left-0 z-[1] bg-secondary', alignClass(column.align), column.align === 'num' && 'tabular')}>
              {total.values?.[column.key] ?? (index === 0 ? total.label : null)}
            </td>)}
            {rowMenu && <td className={cn(ROW_MENU_STICKY_CLASS, 'bg-secondary')} />}
          </tr>)}
        </tfoot>}
      </table>
    </div>
  );
}
