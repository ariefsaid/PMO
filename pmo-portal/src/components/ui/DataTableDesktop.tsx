import React, { memo, useMemo, useRef } from 'react';
import type { Table, Row as TableRow } from '@tanstack/react-table';
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

/** Column keys become CSS custom-property suffixes on `<table>`; only name-safe characters survive. */
function cssVarKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** A body cell's width reads a custom property set once on `<table>` (#2102): a column resize
 *  updates one variable instead of N×M inline styles, so the memoised body never re-renders
 *  while the user drags. A variable that is absent (never-sized column) resolves to `auto` —
 *  exactly the rendering of the absent inline width it replaces. */
function columnWidthVar(key: string): string {
  return `var(--dt-w-${cssVarKey(key)})`;
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

interface DataTableRowProps<Row> {
  row: Row;
  rowId: string;
  modelRow: TableRow<Row>;
  columns: Column<Row>[];
  targetId?: string;
  selected: boolean;
  isSelected: boolean;
  accessibleRowLabel: (row: Row) => string | undefined;
  onActivate?: (row: Row) => void;
  canActivate: boolean;
  rowMenu?: (row: Row) => RowMenuItem[] | undefined;
  selection?: DataTableSelection<Row>;
  selectionLabel: (row: Row, primaryColumn?: Column<Row>) => string;
  seamStore: SeamStore;
  fingerprint: string;
}

/** Row memo (#2102): keyed on the row DATA plus the flags that change what a row paints.
 *  `columns` is compared by IDENTITY, never content: closures capture page state (query
 *  status, permissions, currency), and only a new array can mean new closure semantics —
 *  a content fingerprint cannot see inside a function, and freezing one froze a money
 *  "Unavailable" past its recovery. Pages that memoise their columns (the heavy tables)
 *  get the full skip; a parent re-render with unchanged rows and unchanged columns re-renders
 *  no row. A locale switch changes `fingerprint` (the table's own t()-built labels). */
function dataTableRowPropsEqual<Row>(a: Readonly<DataTableRowProps<Row>>, b: Readonly<DataTableRowProps<Row>>): boolean {
  return a.row === b.row
    && a.rowId === b.rowId
    && a.targetId === b.targetId
    && a.selected === b.selected
    && a.isSelected === b.isSelected
    && a.seamStore === b.seamStore
    && a.columns === b.columns
    && a.fingerprint === b.fingerprint;
}

function DataTableRowInner<Row>({
  row,
  rowId,
  modelRow,
  columns,
  targetId,
  selected,
  isSelected,
  accessibleRowLabel,
  onActivate,
  canActivate,
  rowMenu,
  selection,
  selectionLabel,
  seamStore,
}: DataTableRowProps<Row>) {
  const stickyRowSurface = selected
    ? 'bg-surface-selected'
    : onActivate
      ? 'bg-card group-hover:bg-surface-hover'
      : 'bg-card';
  return (
    // The <tr> keeps its IMPLICIT role="row" (never role="link",
    // which breaks table-row semantics and hides body rows from
    // getByRole('row')). Whole-row onClick stays as a pointer
    // convenience; the keyboard/screen-reader affordance is the
    // real <button> rendered into the first cell when `rowLabel`
    // is supplied (see below).
    <tr
      key={rowId}
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
        'group border-b border-border/70 last:border-b-0 transition-colors',
        onActivate && 'cursor-pointer',
        onActivate && !selected && 'hover:bg-surface-hover',
        selected && 'bg-surface-selected'
      )}
    >
      {selection && <td className="h-[var(--table-row-min-height)] w-10 px-2 py-2 align-middle">
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onChange={(checked) => modelRow.toggleSelected(checked)}
            label={selectionLabel(row, columns[0])}
          />
        </span>
      </td>}
      {columns.map((col, colIndex) => {
        const CellTag = col.rowHeader ? 'th' : 'td';
        return (
          <CellTag
            key={col.key}
            {...(col.rowHeader ? { scope: 'row' as const } : {})}
            style={{
              width: columnWidthVar(col.key),
              ...(columnMinSize(col) !== undefined ? { minWidth: columnMinSize(col) } : {}),
              ...(columnMaxSize(col) !== undefined ? { maxWidth: columnMaxSize(col) } : {}),
            }}
            className={cn(
              'h-[var(--table-row-min-height)] px-[var(--table-cell-inset)] py-2 align-middle',
              col.stickyLeft && cn('sticky left-0 z-[1]', stickyRowSurface),
              (col.kind === 'money' || col.kind === 'date' || col.kind === 'status' || col.align === 'num') && 'whitespace-nowrap',
              alignClass(col.align),
              col.align === 'num' && 'tabular',
              col.colClassName
            )}
          >
            {colIndex === 0 && canActivate && onActivate ? (
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
}

const DataTableRow = memo(DataTableRowInner, dataTableRowPropsEqual) as typeof DataTableRowInner;

interface DataTableTableBodyProps<Row> {
  columns: Column<Row>[];
  groupedRows: GroupedRowEntry<Row>[];
  collapsedGroups: Set<string>;
  groupToggle: (key: string, count: number) => React.ReactNode;
  groupHeader?: (label: string, rows: Row[]) => React.ReactNode;
  groupHeaderSpan: boolean;
  rowTarget?: (row: Row) => string | undefined;
  selectedKey?: string;
  accessibleRowLabel: (row: Row) => string | undefined;
  onActivate?: (row: Row) => void;
  rowMenu?: (row: Row) => RowMenuItem[] | undefined;
  selection?: DataTableSelection<Row>;
  selectionLabel: (row: Row, primaryColumn?: Column<Row>) => string;
  state?: 'loading' | 'empty' | 'error';
  listStateNode: React.ReactNode;
  colSpan: number;
  canActivate: boolean;
  seamStore: SeamStore;
  fingerprint: string;
  isResizingColumn: boolean;
  selectedVisibleSignature: string;
}

/** Entry-wise equivalence of the row list: a group heading's identity (label/count/its rows'
 *  data) or a data row's id + row data. Ignores the per-render row-model identity — two
 *  table-state updates that yield the same rows must not re-render the body. */
function groupEntriesShallowEqual<Row>(a: GroupedRowEntry<Row>[], b: GroupedRowEntry<Row>[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.type !== y.type) return false;
    if (x.type === 'heading' && y.type === 'heading') {
      if (x.label !== y.label || x.count !== y.count || x.rows.length !== y.rows.length) return false;
      for (let j = 0; j < x.rows.length; j += 1) {
        if (x.rows[j]!.original !== y.rows[j]!.original) return false;
      }
    } else if (x.type === 'data' && y.type === 'data') {
      if (x.group !== y.group || x.modelRow.id !== y.modelRow.id || x.modelRow.original !== y.modelRow.original) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** The memoised tbody (#2102, TanStack's documented resize pattern): while
 *  `columnSizingInfo.isResizingColumn` is set, the body ALWAYS skips — widths reach it via
 *  CSS variables on `<table>`, and freezing it is what turns a per-move render of N×M cells
 *  into a per-move render of ~M header cells. Outside a drag it skips whenever the row list
 *  (ids + row data), the selected row, the visible selection, the collapsed groups and the
 *  columns identity are all unchanged — a parent re-render that changes none of them
 *  re-renders nothing below the head. */
function tableBodyPropsEqual<Row>(a: Readonly<DataTableTableBodyProps<Row>>, b: Readonly<DataTableTableBodyProps<Row>>): boolean {
  if (b.isResizingColumn) return true;
  return a.state === b.state
    && a.selectedKey === b.selectedKey
    && a.selectedVisibleSignature === b.selectedVisibleSignature
    && a.collapsedGroups === b.collapsedGroups
    && a.colSpan === b.colSpan
    && a.groupHeaderSpan === b.groupHeaderSpan
    && a.canActivate === b.canActivate
    && a.listStateNode === b.listStateNode
    && a.seamStore === b.seamStore
    && a.columns === b.columns
    && a.fingerprint === b.fingerprint
    && groupEntriesShallowEqual(a.groupedRows, b.groupedRows);
}

function DataTableTableBodyInner<Row>({
  columns,
  groupedRows,
  collapsedGroups,
  groupToggle,
  groupHeader,
  groupHeaderSpan,
  rowTarget,
  selectedKey,
  accessibleRowLabel,
  onActivate,
  rowMenu,
  selection,
  selectionLabel,
  state,
  listStateNode,
  colSpan,
  canActivate,
  seamStore,
  fingerprint,
}: DataTableTableBodyProps<Row>) {
  return (
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
          return (
            <DataTableRow
              key={modelRow.id}
              row={modelRow.original}
              rowId={modelRow.id}
              modelRow={modelRow}
              columns={columns}
              targetId={rowTarget?.(modelRow.original)}
              selected={modelRow.id === selectedKey}
              isSelected={modelRow.getIsSelected()}
              accessibleRowLabel={accessibleRowLabel}
              onActivate={onActivate}
              canActivate={canActivate}
              rowMenu={rowMenu}
              selection={selection}
              selectionLabel={selectionLabel}
              seamStore={seamStore}
              fingerprint={fingerprint}
            />
          );
        })
      )}
    </tbody>
  );
}

const DataTableTableBody = memo(DataTableTableBodyInner, tableBodyPropsEqual) as typeof DataTableTableBodyInner;

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
  /** Defers the widths persistence to the gesture end (#2102): called once on mouseup/touchend
   *  (and at each discrete keyboard step) instead of per move. */
  persistColumnSizing: () => void;
  /** True between a pointer resize's down and up — freezes the memoised body. */
  isResizingColumn: boolean;
  /** Sorted visible selected ids — lets the frozen-comparison body see selection toggles. */
  selectedVisibleSignature: string;
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
  persistColumnSizing,
  isResizingColumn,
  selectedVisibleSignature,
  onOverflowChange,
}: DataTableDesktopProps<Row>) {
  const { t, i18n } = useTranslation('projects');
  const tableBranchRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const keyboardResizeStart = useRef<Record<string, number>>({});

  const modelHeaders = table.getHeaderGroups()[0]?.headers ?? [];
  // Width variables live once on <table> (#2102): body cells reference them, so a live resize
  // paints through CSS without touching the memoised body. Sized = user-resized or kind default.
  const columnSizeVars = useMemo(() => {
    const style: Record<string, string> = {};
    for (const column of columns) {
      const width = columnSizing[column.key] ?? columnDefaultSize(column);
      if (width !== undefined) style[`--dt-w-${cssVarKey(column.key)}`] = `${width}px`;
    }
    return style;
  }, [columns, columnSizing]);
  // Locale stamp for the table's own t()-built row labels (aria-labels); semantic column
  // changes propagate through the `columns` identity comparison instead.
  const canActivate = Boolean(onActivate && rowLabel);
  const rowFingerprint = i18n.language;
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
          ...columnSizeVars,
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
                    ? { width: columnWidthVar(col.key), ...(columnMinSize(col) !== undefined ? { minWidth: columnMinSize(col) } : {}), ...(columnMaxSize(col) !== undefined ? { maxWidth: columnMaxSize(col) } : {}) }
                    : undefined}
                  className={cn(
                    'group relative sticky top-0 z-[2] hover:z-[5] focus-within:z-[5] h-[var(--table-head-height)] border-b border-border bg-surface-table-head px-[var(--table-cell-inset)] text-control font-semibold text-foreground whitespace-nowrap select-none',
                    col.stickyLeft && 'left-0 z-[3]',
                    alignClass(col.align),
                    col.colClassName
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(col.sortKey!)}
                      className="inline-flex items-center gap-1 hover:text-foreground [&_svg]:size-3"
                    >
                      <span id={`datatable-header-label-${tableInstanceId}-${col.key}`}>{col.header}</span>
                      {col.caveat && <span aria-hidden="true" className="ml-0.5 text-warning-foreground">*</span>}
                      {currentSort ? <Icon name={currentSort === 'asc' ? 'up' : 'down'} /> : <span data-testid="sort-cue" aria-hidden="true" className="opacity-40 [&_svg]:size-3"><Icon name="sort" /></span>}
                    </button>
                  ) : (
                    <><span id={`datatable-header-label-${tableInstanceId}-${col.key}`}>{col.header}</span>{col.caveat && <span aria-hidden="true" className="ml-0.5 text-warning-foreground">*</span>}</>
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
                          // TanStack resize pattern (#2102): flag the drag so the memoised body
                          // freezes; widths still paint live through the <table> CSS variables.
                          table.setColumnSizingInfo((info) => ({ ...info, isResizingColumn: header.column.id }));
                          const resize = (clientX: number) => table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: Math.min(max, Math.max(min, startWidth + clientX - startX)) }));
                          const move = (moveEvent: MouseEvent) => resize(moveEvent.clientX);
                          const stop = () => {
                            window.removeEventListener('mousemove', move);
                            window.removeEventListener('mouseup', stop);
                            table.setColumnSizingInfo((info) => ({ ...info, isResizingColumn: false }));
                            // One persisted write per gesture, here on release — never per move.
                            persistColumnSizing();
                          };
                          window.addEventListener('mousemove', move);
                          window.addEventListener('mouseup', stop, { once: true });
                        }}
                        onTouchStart={(event) => {
                          const startX = event.touches[0]?.clientX;
                          if (startX === undefined) return;
                          const startWidth = header.getSize();
                          table.setColumnSizingInfo((info) => ({ ...info, isResizingColumn: header.column.id }));
                          const move = (moveEvent: TouchEvent) => {
                            const clientX = moveEvent.touches[0]?.clientX;
                            if (clientX !== undefined) table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: Math.min(max, Math.max(min, startWidth + clientX - startX)) }));
                          };
                          const stop = () => {
                            window.removeEventListener('touchmove', move);
                            window.removeEventListener('touchend', stop);
                            table.setColumnSizingInfo((info) => ({ ...info, isResizingColumn: false }));
                            // One persisted write per gesture, here on release — never per move.
                            persistColumnSizing();
                          };
                          window.addEventListener('touchmove', move, { passive: true });
                          window.addEventListener('touchend', stop, { once: true });
                        }}
                        onDoubleClick={() => {
                          header.column.resetSize();
                          // Double-click reset is a discrete step like a keypress: persist now.
                          persistColumnSizing();
                        }}
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
                            // A keypress is a complete, discrete resize step — persist it now.
                            persistColumnSizing();
                          } else if (event.key === 'Enter') {
                            event.preventDefault();
                            header.column.resetSize();
                            keyboardResizeStart.current[col.key] = columnDefaultSize(col) ?? header.column.getSize();
                            persistColumnSizing();
                          } else if (event.key === 'Escape') {
                            const start = keyboardResizeStart.current[col.key];
                            if (start !== undefined) {
                              event.preventDefault();
                              table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: start }));
                              keyboardResizeStart.current[col.key] = start;
                              persistColumnSizing();
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
        <DataTableTableBody
          columns={columns}
          groupedRows={groupedRows}
          collapsedGroups={collapsedGroups}
          groupToggle={groupToggle}
          groupHeader={groupHeader}
          groupHeaderSpan={groupHeaderSpan}
          rowTarget={rowTarget}
          selectedKey={selectedKey}
          accessibleRowLabel={accessibleRowLabel}
          onActivate={onActivate}
          rowMenu={rowMenu}
          selection={selection}
          selectionLabel={selectionLabel}
          state={state}
          listStateNode={listStateNode}
          colSpan={colSpan}
          canActivate={canActivate}
          seamStore={seamStore}
          fingerprint={rowFingerprint}
          isResizingColumn={isResizingColumn}
          selectedVisibleSignature={selectedVisibleSignature}
        />
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
