import React, { useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type Updater } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { ListState } from './ListState';
import { useIsDesktop } from './useIsDesktop';
import { AuthContext } from '@/src/auth/AuthContext';
import { RowMenu, MenuButton, type RowMenuItem } from './RowMenu';
import { Toolbar, SearchMini, type SearchMiniProps } from './TableControls';
import {
  useTableColumnSizing,
  columnMinSize,
  columnMaxSize,
  columnDefaultSize,
} from './useTableColumnSizing';
import { DataTableDesktop } from './DataTableDesktop';
import { DataTableMobile } from './DataTableMobile';
import { dropBlankColumns } from './dataTableColumns';
import type { GroupedRowEntry } from './DataTableShared';

export { RowMenu, MenuButton, type RowMenuItem };
export { Toolbar, SearchMini, type SearchMiniProps };

export type ColAlign = 'num' | 'center';

export type ColumnKind = 'primary' | 'text' | 'meta' | 'money' | 'number' | 'percent' | 'status' | 'date' | 'actions' | 'select';

export interface Column<Row> {
  key: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  /** Shared semantic presentation for common table column roles. */
  kind?: ColumnKind;
  /** Optional plain-text title for the `title` attribute when the primary cell is a React node. */
  primaryTitle?: (row: Row) => string;
  /** Render this cell as the row's accessible header rather than a data cell. */
  rowHeader?: boolean;
  /** Optional muted second line for a primary identity cell. */
  secondaryCell?: (row: Row) => React.ReactNode;
  /** One table-level explanation, referenced by a mark in this column header. */
  caveat?: { reason: React.ReactNode; remedy?: React.ReactNode };
  align?: ColAlign;
  /** When set, the header is sortable and reports this key to onSort. */
  sortKey?: string;
  /**
   * Extra Tailwind classes applied to both the `<th>` and each `<td>` in this column.
   * Use for responsive hiding, e.g. `"hidden xl:table-cell"`.
   */
  colClassName?: string;
  /**
   * Optional value used by the `.xlsx` export seam (`src/lib/export`). Returns the
   * column's DISPLAY value as a plain scalar — never a React node. Numbers stay
   * numbers (tabular), dates as ISO `YYYY-MM-DD`, status as its label. Columns
   * without `exportValue` are serialized as an empty string in the export.
   */
  exportValue?: (row: Row) => string | number | boolean;
  /** Explicit cell type for spreadsheet export ('number' | 'date' | 'text'). */
  exportType?: 'number' | 'date' | 'text';
  /** Pin this column to the left edge while the table scrolls sideways (header, cells and total rows). */
  stickyLeft?: boolean;
  /** Carried on the column list for the export seam only; never rendered (header, cell or card line). */
  exportOnly?: boolean;
  /**
   * A column whose cell is blank (nothing, or the "—" empty marker) on every loaded row is not rendered.
   * Set this to keep it anyway, e.g. a column the user expects to find even when empty. Never applied while
   * loading, empty or failed (no rows yet), nor to the first column, a `stickyLeft`/`rowHeader` column, one with a
   * `caveat` (the caveat explains its blanks), or one that a `totals` row fills.
   */
  keepWhenBlank?: boolean;
  /** Preferred width in CSS pixels for resizable desktop tables. */
  size?: number;
  /** Minimum width when resizing is enabled. */
  minSize?: number;
  /** Maximum width when resizing is enabled. */
  maxSize?: number;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableSelection<Row> {
  /** Controlled selection shared across grouped tables when needed. */
  selectedIds: ReadonlySet<string>;
  onChange: (ids: Set<string>) => void;
  /** Accessible name for each checkbox; falls back to the primary title. */
  rowLabel?: (row: Row) => string;
  /** Phone cards: show "Select all rows" only once a row is ticked, so the first card is not pushed down by a control. */
  selectAllAfterFirst?: boolean;
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
  /** Optional accessible name for the active table or mobile list structure. */
  accessibleName?: string;
  /** Compact mobile title and details for record cards that do not need a field-by-field definition list. */
  mobileCardTitle?: (row: Row) => React.ReactNode;
  mobileCardDetails?: (row: Row) => React.ReactNode;
  /** Show mobile field headings once above the cards while retaining per-value screen-reader labels. */
  mobileLabelsOnce?: boolean;
  /** Optional DOM target id for a row that a route will scroll to and focus programmatically. */
  rowTarget?: (row: Row) => string | undefined;
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
  /**
   * Per-row overflow menu items (hidden until row hover). Return `undefined`
   * (or `[]`) for "no menu for this row" — a real per-row state (e.g. an
   * archived record with nothing left to do) — the trigger is simply omitted
   * for that row.
   */
  rowMenu?: (row: Row) => RowMenuItem[] | undefined;
  className?: string;
  /** Omit the table's outer frame when it is embedded in an existing surface. */
  embedded?: boolean;
  /**
   * Opt-in (AC-TBL-CARDS-001): render the stacked record cards whenever the table's OWN width is below this many px,
   * not only below the `md` viewport. For a table in a column narrower than the viewport implies (the record layout,
   * beside the record panel), where its columns cannot fit and would otherwise scroll sideways inside a clipped box.
   */
  cardBelow?: number;
  /** Stable identity for saved column widths. */
  tableId?: string;
  /** Optional grouping key; each distinct group is introduced by an aligned in-table row. */
  groupBy?: (row: Row) => string;
  /** Optional value shown beside each group label (for example, the group's open balance). */
  groupHeader?: (label: string, rows: Row[]) => React.ReactNode;
  /** Optional heading content for a group key; when given it replaces the key AND the built-in row count. */
  groupLabel?: (key: string) => React.ReactNode;
  /** Optional fixed group order; every listed key gets a heading row even when it has no rows. */
  groupOrder?: readonly string[];
  /** Let the group heading cell span every data column instead of only the first. */
  groupHeaderSpan?: boolean;
  /** Aligned subtotal/total rows rendered in a semantic <tfoot>; values are keyed by column key. */
  totals?: Array<{ key: string; label: React.ReactNode; values?: Record<string, React.ReactNode> }>;
  /** Optional controlled multi-row selection. */
  selection?: DataTableSelection<Row>;
  /** Callback notifying when the table's inner scrollport has overflowing content on the right. */
  onOverflowChange?: (overflowing: boolean) => void;
}

/** Whether `ref`'s width is below `below` px — measured before paint, then followed with a ResizeObserver. An unmeasured
 *  width (0, e.g. no layout) reads as wide, so the table stays the default. Switching branches never changes the width
 *  (the parent column decides it), so this cannot oscillate. */
function useNarrowerThan(ref: React.RefObject<HTMLElement | null>, below: number | undefined): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!below || !el) {
      setNarrow(false);
      return;
    }
    const decide = () => {
      const w = el.getBoundingClientRect().width;
      setNarrow(w > 0 && w < below);
    };
    decide();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(decide);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}

/**
 * Generic, typed data table (the signature surface). Presentational: the three
 * async states delegate to ListState via the `state` prop. Rows are keyboard-
 * activatable; sortable headers expose aria-sort.
 *
 * Mobile reflow (OD-W4-4, AC-IXD-MOBILE-W4-C1) — SINGLE render:
 * - `useIsDesktop()` reads `(min-width: 768px)` synchronously at first paint and
 *   re-renders on viewport change. EXACTLY ONE branch is in the DOM at a time:
 *   - At `md`+ (≥768px): the same desktop `<table>` branch and behaviors.
 *   - Below `md` (<768px): a stacked card list — each row maps to a card with the
 *     first column as the activation title and the remaining columns as a <dl>
 *     label:value list. All data is shown (no column dropped).
 * - Because only one branch renders, each cell's content (text + interactive
 *   controls) appears exactly ONCE in the DOM/AT tree — no duplication, no
 *   aria-hidden, no `hidden`/`md:hidden` CSS toggle, and no dup-match test tax.
 */
export function DataTable<Row>({
  rows,
  columns: allColumns,
  rowKey,
  onActivate,
  rowLabel,
  rowTarget,
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
  embedded = false,
  cardBelow,
  accessibleName,
  mobileCardTitle,
  mobileCardDetails,
  mobileLabelsOnce = false,
  tableId,
  groupBy,
  groupHeader,
  groupLabel,
  groupOrder,
  groupHeaderSpan = false,
  totals,
  selection,
  onOverflowChange,
}: DataTableProps<Row>) {
  const { t } = useTranslation('projects');
  const columns = useMemo(
    () => dropBlankColumns(allColumns.filter((column) => !column.exportOnly), rows, totals, !state),
    [allColumns, rows, totals, state],
  );
  const userId = useContext(AuthContext)?.currentUser?.id;
  const { columnSizing, onColumnSizingChange } = useTableColumnSizing(
    tableId,
    userId,
    columns as Column<unknown>[],
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const tableInstanceId = useId().replace(/:/g, '');
  const caveatId = `datatable-caveat-${tableInstanceId}`;
  const caveats = columns.flatMap((column) => column.caveat ? [column.caveat] : []);
  const rootRef = useRef<HTMLDivElement>(null);
  const accessibleRowLabel = (row: Row) => {
    const label = rowLabel?.(row);
    const openLabel = label?.match(/^Open (.+)$/);
    return openLabel
      ? t('table.openRow', 'Open {{name}}', { name: openLabel[1] })
      : label;
  };
  const wideViewport = useIsDesktop();
  const narrowTable = useNarrowerThan(rootRef, cardBelow);
  const isDesktop = wideViewport && !narrowTable;
  // Overflow-lifecycle contract: whenever the branch decision is NOT desktop, report
  // `onOverflowChange?.(false)` so the consumer's scroll mask (DataTableWidget's
  // `data-table-widget-scroll-mask`) never stays painted over the mobile cards — at the
  // initial mobile render and whenever the viewport leaves desktop. The desktop module
  // owns the seam hook and unmounts on that transition, so this report lives at the
  // owner level, which stays mounted across the switch and never fires on a whole-table
  // unmount (identical to the pre-extraction component's disabled-branch report).
  useLayoutEffect(() => {
    if (!isDesktop) onOverflowChange?.(false);
  }, [isDesktop, onOverflowChange]);
  const tableColumns = useMemo<ColumnDef<Row>[]>(() => columns.map((column) => {
    return {
      id: column.key,
      accessorFn: (row) => row,
      enableSorting: Boolean(column.sortKey),
      header: () => column.header,
      ...(columnDefaultSize(column) !== undefined ? { size: columnDefaultSize(column) } : {}),
      ...(columnMinSize(column) !== undefined ? { minSize: columnMinSize(column) } : {}),
      ...(columnMaxSize(column) !== undefined ? { maxSize: columnMaxSize(column) } : {}),
    };
  }), [columns]);
  const currentRowIds = useMemo(() => rows.map((row, index) => rowKey(row) || String(index)), [rowKey, rows]);
  const rowSelectionState = useMemo<RowSelectionState>(
    () => Object.fromEntries([...(selection?.selectedIds ?? [])].map((id) => [id, true])),
    [selection?.selectedIds],
  );
  const updateSelection = (updater: Updater<RowSelectionState>) => {
    if (!selection) return;
    const nextState = typeof updater === 'function' ? updater(rowSelectionState) : updater;
    const visibleIds = new Set(currentRowIds);
    const nextIds = new Set([...selection.selectedIds].filter((id) => !visibleIds.has(id)));
    for (const [id, isSelected] of Object.entries(nextState)) {
      if (isSelected) nextIds.add(id);
    }
    selection.onChange(nextIds);
  };
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getRowId: (_row, index) => currentRowIds[index] ?? String(index),
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    columnResizeMode: 'onChange',
    enableColumnResizing: isDesktop,
    enableRowSelection: Boolean(selection),
    state: {
      sorting: sort ? [{ id: columns.find((column) => column.sortKey === sort.key)?.key ?? sort.key, desc: sort.dir === 'desc' }] : [],
      columnSizing,
      rowSelection: rowSelectionState,
    },
    onRowSelectionChange: updateSelection,
    onColumnSizingChange,
  });
  const modelRows = table.getRowModel().rows;
  const toggleGroup = (group: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });
  const groupedRows: GroupedRowEntry<Row>[] = useMemo(() => {
    if (!groupBy) return modelRows.map((modelRow) => ({ type: 'data' as const, modelRow, group: undefined }));
    const groups = new Map<string, typeof modelRows>((groupOrder ?? []).map((key) => [key, []]));
    for (const modelRow of modelRows) {
      const group = groupBy(modelRow.original);
      const grouped = groups.get(group);
      if (grouped) grouped.push(modelRow);
      else groups.set(group, [modelRow]);
    }
    return Array.from(groups, ([label, groupRows]) => ({ type: 'group' as const, label, rows: groupRows }))
      .flatMap((group) => [{ type: 'heading' as const, label: group.label, count: group.rows.length, rows: group.rows }, ...group.rows.map((modelRow) => ({ type: 'data' as const, modelRow, group: group.label }))]);
  }, [groupBy, groupOrder, modelRows]);
  const groupToggle = (key: string, count: number) => (
    <button type="button" aria-expanded={!collapsedGroups.has(key)} onClick={() => toggleGroup(key)}>
      {groupLabel ? groupLabel(key) : <>{key}<span className="ml-2 font-normal text-muted-foreground">{count}</span></>}
    </button>
  );
  const colSpan = columns.length + (rowMenu ? 1 : 0) + (selection ? 1 : 0);
  // Select-all acts on the rows the user can see: a collapsed group's rows, and rows outside `rows`, keep their state.
  const visibleSelectionIds = groupedRows.flatMap((entry) =>
    entry.type !== 'data' || (entry.group && collapsedGroups.has(entry.group)) ? [] : [entry.modelRow.id]);
  const visibleSelectionCount = visibleSelectionIds.filter((id) => selection?.selectedIds.has(id)).length;
  const selectAllChecked: boolean | 'mixed' = visibleSelectionCount === 0
    ? false
    : visibleSelectionCount === visibleSelectionIds.length ? true : 'mixed';
  const toggleAllRows = (checked: boolean) => {
    table.setRowSelection((current) => {
      const next = { ...current };
      for (const id of visibleSelectionIds) {
        if (checked) next[id] = true;
        else delete next[id];
      }
      return next;
    });
  };
  const selectionLabel = (row: Row, primaryColumn?: Column<Row>) => selection?.rowLabel?.(row)
    ?? t('table.selectRow', 'Select {{row}}', { row: rowLabel?.(row)?.replace(/^Open\s+/i, '') ?? primaryColumn?.primaryTitle?.(row) ?? rowKey(row) });

  // Shared ListState node — rendered once and reused in both branches via a
  // local variable so the async-state code is one source of truth.
  const listStateNode = state ? (
    <>
      {state === 'loading' && <ListState variant="loading" shape="table" columns={Math.min(colSpan, 8)} rows={6} />}
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
    <div ref={rootRef} className={cn(
      !embedded && 'rounded-b-lg border border-border bg-card',
      !embedded && (mobileLabelsOnce ? 'overflow-visible md:overflow-hidden' : 'overflow-hidden'),
      className,
    )}>
      {isDesktop ? (
        <DataTableDesktop
          columns={columns}
          table={table}
          groupedRows={groupedRows}
          collapsedGroups={collapsedGroups}
          groupToggle={groupToggle}
          groupHeader={groupHeader}
          groupHeaderSpan={groupHeaderSpan}
          tableInstanceId={tableInstanceId}
          caveatId={caveatId}
          accessibleName={accessibleName}
          onActivate={onActivate}
          rowLabel={rowLabel}
          accessibleRowLabel={accessibleRowLabel}
          rowTarget={rowTarget}
          selectedKey={selectedKey}
          rowMenu={rowMenu}
          selection={selection}
          selectAllChecked={selectAllChecked}
          toggleAllRows={toggleAllRows}
          selectionLabel={selectionLabel}
          visibleSelectionIds={visibleSelectionIds}
          state={state}
          listStateNode={listStateNode}
          totals={totals}
          onSort={onSort}
          columnSizing={columnSizing}
          onOverflowChange={onOverflowChange}
        />
      ) : (
        <DataTableMobile
          columns={columns}
          groupedRows={groupedRows}
          collapsedGroups={collapsedGroups}
          groupToggle={groupToggle}
          groupHeader={groupHeader}
          tableInstanceId={tableInstanceId}
          accessibleName={accessibleName}
          onActivate={onActivate}
          rowLabel={rowLabel}
          accessibleRowLabel={accessibleRowLabel}
          rowTarget={rowTarget}
          selectedKey={selectedKey}
          rowMenu={rowMenu}
          selection={selection}
          selectAllChecked={selectAllChecked}
          toggleAllRows={toggleAllRows}
          selectionLabel={selectionLabel}
          visibleSelectionIds={visibleSelectionIds}
          state={state}
          listStateNode={listStateNode}
          totals={totals}
          mobileCardTitle={mobileCardTitle}
          mobileCardDetails={mobileCardDetails}
          mobileLabelsOnce={mobileLabelsOnce}
        />
      )}
      {caveats.length > 0 && <p id={caveatId} className="border-t border-border/70 px-[var(--table-cell-inset)] py-2 text-control text-muted-foreground">
        {caveats.map((caveat, index) => <React.Fragment key={index}>{index > 0 && ' '}<span className="text-warning-foreground">*</span> {caveat.reason}{caveat.remedy && <> {caveat.remedy}</>}</React.Fragment>)}
      </p>}
    </div>
  );
}
