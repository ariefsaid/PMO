import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { ListState } from './ListState';
import { useIsDesktop } from './useIsDesktop';
import { trackSearchUsed } from '@/src/lib/analytics';
import { AuthContext } from '@/src/auth/AuthContext';

/** `search_used`'s debounce idle window (2026-07-13 wiring plan) — fire once per
 * search intent, never per keystroke. */
const SEARCH_USED_DEBOUNCE_MS = 500;
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
  'sticky -right-px bg-card shadow-[inset_1px_0_0_hsl(var(--border))]';
/** Left-cast separation gradient for the sticky actions column: from the `foreground` token
 *  (near-black in light, near-light in dark — the token flips the cast with the mode) fading out
 *  over 12px to the LEFT of the cell. Positioned inside the sticky cell so it travels with it. */
const ROW_MENU_SEAM_CLASS =
  'pointer-events-none absolute inset-y-0 -left-3 w-3 bg-gradient-to-l from-[hsl(var(--foreground)/0.16)] to-transparent';

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

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Dimmed, announced disabled and unclickable — e.g. a per-row action already in flight (AC-PDF-011).
   *  WAI-ARIA menu pattern: rendered as `aria-disabled="true"`, NOT the HTML `disabled` attribute —
   *  a disabled button is unfocusable, so a disabled FIRST item would strand open-focus on the
   *  trigger (arrows/Escape dead). Staying focusable gives the roving focus a landing spot; the
   *  activate guard below makes Enter/click a no-op. */
  disabled?: boolean;
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
  /** Aligned subtotal/total rows rendered in a semantic <tfoot>; values are keyed by column key. */
  totals?: Array<{ key: string; label: React.ReactNode; values?: Record<string, React.ReactNode> }>;
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

function useStickyRowMenuSeam(
  scrollportRef: React.RefObject<HTMLDivElement | null>,
  tableRef: React.RefObject<HTMLTableElement | null>,
  enabled: boolean,
): boolean {
  const [hasHiddenRightContent, setHasHiddenRightContent] = useState(false);

  useLayoutEffect(() => {
    const scrollport = scrollportRef.current;
    const table = tableRef.current;
    if (!enabled || !scrollport || !table) {
      setHasHiddenRightContent(false);
      return;
    }

    const measure = () => {
      const overflowing = scrollport.scrollWidth - scrollport.clientWidth - scrollport.scrollLeft > 1;
      setHasHiddenRightContent((current) => current === overflowing ? current : overflowing);
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
  }, [enabled, scrollportRef, tableRef]);

  return hasHiddenRightContent;
}

function alignClass(align?: ColAlign) {
  if (align === 'num') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

function columnMinSize<Row>(column: Column<Row>): number | undefined {
  const contractMin = column.kind === 'primary' ? 240 : column.kind === 'status' ? 112 : undefined;
  return contractMin === undefined ? column.minSize : Math.max(contractMin, column.minSize ?? contractMin);
}

function columnMaxSize<Row>(column: Column<Row>): number | undefined {
  const contractMax = column.kind === 'primary' ? 640 : column.kind === 'status' ? 220 : undefined;
  const maximum = column.maxSize ?? contractMax;
  const minimum = columnMinSize(column);
  return maximum === undefined ? undefined : Math.max(maximum, minimum ?? 0);
}

function columnDefaultSize<Row>(column: Column<Row>): number | undefined {
  return column.size ?? (column.kind === 'primary' ? 320 : column.kind === 'status' ? 140 : undefined);
}

function readColumnSizing(tableId: string | undefined, userId: string | undefined, columns: Column<unknown>[]): Record<string, number> {
  if (!tableId || !userId || typeof window === 'undefined') return {};
  try {
    const saved = window.localStorage.getItem(`pmo.table.${tableId}.widths.v1:${userId}`);
    if (!saved) return {};
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const known = new Map(columns.map((column) => [column.key, column]));
    return Object.fromEntries(Object.entries(value).flatMap(([key, width]) => {
      const column = known.get(key);
      if (!column || typeof width !== 'number' || !Number.isFinite(width)) return [];
      const min = columnMinSize(column) ?? 20;
      const max = columnMaxSize(column) ?? 900;
      return [[key, Math.min(max, Math.max(min, width))]];
    }));
  } catch {
    return {};
  }
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
 * Mobile reflow (OD-W4-4, AC-IXD-MOBILE-W4-C1) — SINGLE render:
 * - `useIsDesktop()` reads `(min-width: 768px)` synchronously at first paint and
 *   re-renders on viewport change. EXACTLY ONE branch is in the DOM at a time:
 *   - At `md`+ (≥768px): the desktop `<table>` branch (markup byte-unchanged).
 *   - Below `md` (<768px): a stacked card list — each row maps to a card with the
 *     first column as the activation title and the remaining columns as a <dl>
 *     label:value list. All data is shown (no column dropped).
 * - Because only one branch renders, each cell's content (text + interactive
 *   controls) appears exactly ONCE in the DOM/AT tree — no duplication, no
 *   aria-hidden, no `hidden`/`md:hidden` CSS toggle, and no dup-match test tax.
 */
export function DataTable<Row>({
  rows,
  columns,
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
  cardBelow,
  accessibleName,
  tableId,
  groupBy,
  totals,
}: DataTableProps<Row>) {
  const { t } = useTranslation();
  const userId = useContext(AuthContext)?.currentUser?.id;
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>(() => readColumnSizing(tableId, userId, columns as Column<unknown>[]));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const widthIdentity = `${tableId ?? ''}:${userId ?? ''}`;
  const previousWidthIdentity = useRef(widthIdentity);
  useEffect(() => {
    if (previousWidthIdentity.current === widthIdentity) return;
    previousWidthIdentity.current = widthIdentity;
    setColumnSizing(readColumnSizing(tableId, userId, columns as Column<unknown>[]));
  }, [tableId, userId, widthIdentity, columns]);
  const caveatId = `datatable-caveat-${useId().replace(/:/g, '')}`;
  const caveats = columns.flatMap((column) => column.caveat ? [column.caveat] : []);
  const rootRef = useRef<HTMLDivElement>(null);
  const tableBranchRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
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
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getRowId: (row, index) => rowKey(row) || String(index),
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    columnResizeMode: 'onChange',
    enableColumnResizing: isDesktop,
    state: {
      sorting: sort ? [{ id: columns.find((column) => column.sortKey === sort.key)?.key ?? sort.key, desc: sort.dir === 'desc' }] : [],
      columnSizing,
    },
    onColumnSizingChange: (updater) => {
      setColumnSizing((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (tableId && userId && typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(`pmo.table.${tableId}.widths.v1:${userId}`, JSON.stringify(next));
          } catch {
            // Storage is an enhancement; live resizing remains available when it is denied.
          }
        }
        return next;
      });
    },
  });
  const modelRows = table.getRowModel().rows;
  const toggleGroup = (group: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });
  const groupedRows = useMemo(() => {
    if (!groupBy) return modelRows.map((modelRow) => ({ type: 'data' as const, modelRow, group: undefined }));
    const groups = new Map<string, typeof modelRows>();
    for (const modelRow of modelRows) {
      const group = groupBy(modelRow.original);
      const grouped = groups.get(group);
      if (grouped) grouped.push(modelRow);
      else groups.set(group, [modelRow]);
    }
    return Array.from(groups, ([label, groupRows]) => ({ type: 'group' as const, label, rows: groupRows }))
      .flatMap((group) => [{ type: 'heading' as const, label: group.label, count: group.rows.length }, ...group.rows.map((modelRow) => ({ type: 'data' as const, modelRow, group: group.label }))]);
  }, [groupBy, modelRows]);
  const modelHeaders = table.getHeaderGroups()[0]?.headers ?? [];
  // Resize handles sit outside the header cells (so they are not part of a header's name);
  // place them on the RENDERED column edges, not TanStack's notional sizes.
  const [columnEdges, setColumnEdges] = useState<{ edges: Record<string, number>; width: number }>({ edges: {}, width: 0 });
  const measureColumnEdges = useCallback(() => {
    const tableEl = tableRef.current;
    if (!tableEl) return;
    const edges: Record<string, number> = {};
    tableEl.querySelectorAll<HTMLTableCellElement>('thead th[data-col-key]').forEach((th) => {
      if (th.offsetWidth > 0) edges[th.dataset.colKey!] = th.offsetLeft + th.offsetWidth;
    });
    setColumnEdges({ edges, width: tableEl.offsetWidth });
  }, []);
  // ponytail: re-measure on render, window resize and header hover/focus; a container-only resize
  // is caught on the next hover/focus (handles are invisible until then and clamped inside the table).
  useLayoutEffect(() => {
    if (!isDesktop) return;
    measureColumnEdges();
    window.addEventListener('resize', measureColumnEdges);
    return () => window.removeEventListener('resize', measureColumnEdges);
  }, [isDesktop, columns, columnSizing, rows.length, measureColumnEdges]);
  const hasHiddenRightContent = useStickyRowMenuSeam(tableBranchRef, tableRef, isDesktop && Boolean(rowMenu));
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
    <div ref={rootRef} className={cn('overflow-hidden rounded-b-lg border border-border bg-card', className)}>
      {isDesktop ? (
      /* ── Desktop table branch (≥768px — only branch in the DOM; markup byte-unchanged) ── */
      // `relative` makes this scroller the containing block for the absolutely-positioned
      // `sr-only` "Actions" header (not sticky, so it is otherwise unpositioned) — without it the
      // header escapes the clip and the whole page scrolls sideways (AC-TBL-OVERFLOW-001).
      <div
        ref={tableBranchRef}
        data-testid="dt-table-branch"
        data-dt-overflowing={hasHiddenRightContent ? '' : undefined}
        className="relative overflow-x-auto"
      >
        <table
          ref={tableRef}
          aria-label={accessibleName}
          style={{
            ...(columns.some((column) => column.size !== undefined || column.kind === 'primary' || column.kind === 'status') ? { minWidth: table.getTotalSize() + (rowMenu ? 40 : 0), tableLayout: 'fixed' as const } : {}),
          }}
          className="w-full border-collapse text-[13.5px]"
        >
          <thead onMouseEnter={isDesktop ? measureColumnEdges : undefined}>
            <tr>
              {modelHeaders.map((header) => {
                const col = columns.find((column) => column.key === header.column.id)!;
                const sortable = header.column.getCanSort();
                const currentSort = header.column.getIsSorted();
                const ariaSort = currentSort ? (currentSort === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined;
                return (
                  <th
                    key={header.id}
                    data-col-key={col.key}
                    aria-sort={ariaSort}
                    aria-describedby={col.caveat ? caveatId : undefined}
                    style={columnSizing[col.key] !== undefined || columnDefaultSize(col) !== undefined
                      ? { width: header.getSize(), ...(columnMinSize(col) !== undefined ? { minWidth: columnMinSize(col) } : {}), ...(columnMaxSize(col) !== undefined ? { maxWidth: columnMaxSize(col) } : {}) }
                      : undefined}
                    className={cn(
                      'group relative sticky top-0 z-[2] h-[38px] border-b border-border bg-card px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground whitespace-nowrap select-none',
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
                        {col.caveat && <span aria-hidden="true" className="ml-0.5 text-warning-foreground">*</span>}
                        {currentSort ? <Icon name={currentSort === 'asc' ? 'up' : 'down'} /> : <span data-testid="sort-cue" aria-hidden="true" className="inline-flex flex-col opacity-40 [&_svg]:size-3"><Icon name="up" /><Icon name="down" /></span>}
                      </button>
                    ) : (
                      <>{col.header}{col.caveat && <span aria-hidden="true" className="ml-0.5 text-warning-foreground">*</span>}</>
                    )}

                  </th>
                );
              })}
              {rowMenu && (
                <th className={cn(ROW_MENU_STICKY_CLASS, 'top-0 z-[3] w-10 border-b border-border')} scope="col">
                  {hasHiddenRightContent && <span aria-hidden data-dt-seam className={ROW_MENU_SEAM_CLASS} />}
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
                  <tr key={`group-${entry.label}-${entryIndex}`} className="h-[38px] bg-secondary/40">
                    <th scope="row" className="px-3 text-left text-[13.5px] font-semibold text-foreground"><button type="button" aria-expanded={!collapsedGroups.has(entry.label)} onClick={() => toggleGroup(entry.label)}>{entry.label}<span className="ml-2 font-normal text-muted-foreground">{entry.count}</span></button></th>
                    {columns.slice(1).map((column) => <td key={column.key} className={cn('px-3', alignClass(column.align))} />)}
                    {rowMenu && <td className={ROW_MENU_STICKY_CLASS} />}
                  </tr>
                );
                if (entry.group && collapsedGroups.has(entry.group)) return null;
                const modelRow = entry.modelRow;
                const row = modelRow.original;
                const key = modelRow.id;
                const targetId = rowTarget?.(row);
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
                                'button, a, select, input, textarea, label, [role="menuitem"], [contenteditable]'
                              )
                            )
                              return;
                            onActivate(row);
                          }
                        : undefined
                    }
                    className={cn(
                      'group border-b border-border/70 last:border-b-0 transition-colors',
                      onActivate && 'cursor-pointer hover:bg-accent/60',
                      selected && 'bg-primary/[0.07]'
                    )}
                  >
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
                            'h-[54px] px-3 py-2 align-middle',
                            (col.kind === 'money' || col.kind === 'date' || col.kind === 'status' || col.align === 'num') && 'whitespace-nowrap',
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
                      <td className={cn(ROW_MENU_STICKY_CLASS, 'z-[1] px-2 align-middle')}>
                        {hasHiddenRightContent && <span aria-hidden data-dt-seam className={ROW_MENU_SEAM_CLASS} />}
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
            {totals.map((total) => <tr key={total.key} className="h-11 border-t-[1.5px] border-border bg-secondary/40 font-semibold tabular">
              {columns.map((column, index) => <td key={column.key} className={cn('px-3 py-2 align-middle', alignClass(column.align), column.align === 'num' && 'tabular')}>
                {total.values?.[column.key] ?? (index === 0 ? total.label : null)}
              </td>)}
              {rowMenu && <td className={cn(ROW_MENU_STICKY_CLASS, 'bg-secondary/40')} />}
            </tr>)}
          </tfoot>}
        </table>
        {isDesktop && (
          <div className="pointer-events-none absolute left-0 top-0 z-[4] h-[38px]" onFocusCapture={measureColumnEdges}>
            {modelHeaders.map((header) => {
              const col = columns.find((column) => column.key === header.column.id)!;
              const measured = Object.keys(columnEdges.edges).length > 0;
              const edge = measured ? columnEdges.edges[col.key] : header.getStart() + header.getSize();
              if (edge === undefined) return null; // column hidden at this width
              const left = measured ? Math.max(0, Math.min(edge - 12, columnEdges.width - 24)) : edge - 12;
              // Same kind-contract bounds as the column def, cell styles and the pointer drag.
              const min = columnMinSize(col) ?? 20;
              const max = columnMaxSize(col) ?? 900;
              return (
                <div
                  key={header.id}
                  role="separator"
                  title={t('table.resizeColumn', 'Resize {{column}} column', { column: typeof col.header === 'string' ? col.header : col.key })}
                  aria-orientation="vertical"
                  aria-valuenow={header.getSize()}
                  aria-valuemin={min}
                  aria-valuemax={max}
                  tabIndex={0}
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                  onDoubleClick={() => header.column.resetSize()}
                  onKeyDown={(event) => {
                    const current = header.getSize();
                    let next: number | undefined;
                    if (event.key === 'ArrowLeft') next = current - 16;
                    if (event.key === 'ArrowRight') next = current + 16;
                    if (event.key === 'Home') next = min;
                    if (event.key === 'End') next = max;
                    if (next !== undefined) {
                      event.preventDefault();
                      table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: Math.min(max, Math.max(min, next!)) }));
                    }
                  }}
                  style={{ left, width: 24, height: 38 }}
                  className="pointer-events-auto absolute top-0 cursor-col-resize opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <span aria-hidden className="pointer-events-none absolute inset-y-2 right-0 w-px bg-border" />
                </div>
              );
            })}
          </div>
        )}
      </div>
      ) : (
      /* ── Mobile card branch (<768px — only branch in the DOM) ─────────────
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
       * AT scoping: at <768px this card branch is the ONLY structure rendered, so it
       * is fully AT-readable. No aria-hidden is needed (or wanted — it would hide the
       * sole row data from a mobile screen-reader user); the table branch simply isn't
       * in the DOM at this viewport.
       */
      <ul
        data-testid="dt-card-branch"
        data-dt-cards=""
        role="list"
        aria-label={accessibleName}
        className="divide-y divide-border/70"
      >
        {state ? (
          <li className="p-0">{listStateNode}</li>
        ) : (
          groupedRows.map((entry, entryIndex) => {
            if (entry.type === 'heading') return <li key={`group-${entry.label}-${entryIndex}`} className="bg-secondary/40 px-4 py-2 text-[13.5px] font-semibold text-foreground"><button type="button" aria-expanded={!collapsedGroups.has(entry.label)} onClick={() => toggleGroup(entry.label)}>{entry.label}<span className="ml-2 font-normal text-muted-foreground">{entry.count}</span></button></li>;
            if (entry.group && collapsedGroups.has(entry.group)) return null;
            const modelRow = entry.modelRow;
            const row = modelRow.original;
            const key = modelRow.id;
            const targetId = rowTarget?.(row);
            const selected = key === selectedKey;
            const [titleCol, ...restCols] = columns;
            const hasMenu = !!rowMenu;
            const menuItems = hasMenu ? (rowMenu!(row) ?? []) : [];

            return (
              <li
                key={key}
                id={targetId}
                tabIndex={targetId ? -1 : undefined}
                className={cn(
                  'relative flex flex-col gap-2 p-4 text-[13.5px] transition-colors',
                  onActivate && 'cursor-pointer',
                  selected && 'bg-primary/[0.07]'
                )}
              >
                {/* Title row: first column + rowMenu ⋯ pinned top-right */}
                <div className="flex items-start justify-between gap-3">
                  {/* Card title — activation button if rowLabel+onActivate supplied.
                      [&_.truncate]:block: a `truncate` cell is usually an INLINE <span>, and
                      overflow:hidden is a no-op on inline boxes — so a long title bleeds past
                      the viewport at phone widths (AC-MOBILE-OVERFLOW-001). Forcing truncate
                      descendants to block lets them clip with an ellipsis within this min-w-0
                      column, independent of text width (no font-metric-dependent 1–6px bleed). */}
                  <div className="min-w-0 flex-1 font-semibold [&_.truncate]:block">
                    {onActivate && rowLabel ? (
                      <button
                        type="button"
                        aria-label={accessibleRowLabel(row)}
                        onClick={() => onActivate(row)}
                        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                      >
                        {titleCol.kind === 'primary' ? <PrimaryCell title={titleCol.cell(row)} titleText={titleCol.primaryTitle?.(row)} secondary={titleCol.secondaryCell?.(row)} /> : titleCol.cell(row)}
                      </button>
                    ) : (
                      titleCol.kind === 'primary' ? <PrimaryCell title={titleCol.cell(row)} secondary={titleCol.secondaryCell?.(row)} /> : titleCol.cell(row)
                    )}
                  </div>
                  {/* rowMenu ⋯ — top-right of the card, .touch-target for ≥44px on coarse pointer */}
                  {hasMenu && menuItems.length > 0 && (
                    <div className="shrink-0">
                      <RowMenu items={menuItems} />
                    </div>
                  )}
                </div>

                {/* Remaining columns as a definition list. A cell that renders nothing for THIS row
                    (null/undefined/false — e.g. a fact that only one record type carries) is left out of
                    the card: a label with no value is noise, and a <dt> without its <dd> is invalid. */}
                {restCols.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    {restCols.map((col) => {
                      const content = col.cell(row);
                      if (content == null || content === false) return null;
                      return (
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
                              // [&_.truncate]:block — see the title note above: inline truncate
                              // cells (e.g. a contact email) don't clip and bleed at 360px.
                              'min-w-0 break-words text-[13.5px] text-foreground [&_.truncate]:block',
                              col.align === 'num' && 'tabular text-right',
                              col.align === 'center' && 'text-center',
                              stripHiddenClasses(col.colClassName)
                            )}
                          >
                            {content}
                          </dd>
                        </React.Fragment>
                      );
                    })}
                  </dl>
                )}
              </li>
            );
          })
        )}
        {!state && totals?.map((total) => <li key={`total-${total.key}`} className="border-t-[1.5px] border-border bg-secondary/40 px-4 py-3 text-[13px] font-semibold tabular">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            {columns.map((column, index) => {
              const value = total.values?.[column.key] ?? (index === 0 ? total.label : null);
              return value == null ? null : <React.Fragment key={column.key}><dt className="text-muted-foreground">{column.header}</dt><dd className={cn('min-w-0', column.align === 'num' && 'text-right tabular')}>{value}</dd></React.Fragment>;
            })}
          </dl>
        </li>)}
      </ul>
      )}
      {caveats.length > 0 && <p id={caveatId} className="border-t border-border/70 px-3 py-2 text-[12px] text-muted-foreground">
        {caveats.map((caveat, index) => <React.Fragment key={index}>{index > 0 && ' '}<span className="text-warning-foreground">*</span> {caveat.reason}{caveat.remedy && <> {caveat.remedy}</>}</React.Fragment>)}
      </p>}
    </div>
  );
}

function PrimaryCell({ title, titleText, secondary }: { title: React.ReactNode; titleText?: string; secondary?: React.ReactNode }) {
  const accessibleTitle = titleText ?? (typeof title === 'string' ? title : undefined);
  return <span className="block min-w-0">
    <span title={accessibleTitle} className="block line-clamp-2 break-words font-semibold text-foreground">{title}</span>
    {secondary != null && <span className="block truncate text-[12px] font-normal text-muted-foreground">{secondary}</span>}
  </span>;
}

/**
 * Per-row overflow (⋯) menu.
 *
 * Clip-escape (AC-W6-IXD-MENU): the open `role="menu"` is PORTALED to
 * `document.body` and positioned `fixed` against the trigger's bounding box —
 * so it can never be clipped by the table branch's `overflow-x-auto` or the
 * card wrapper's `overflow-hidden` (the recurring "tests green, render clipped"
 * defect). It is right-aligned to the trigger, flips UP when the trigger sits
 * within the menu's height of the viewport bottom, and is clamped horizontally
 * to the `max-[921px]:px-4` (16px) gutter so it never bleeds off-screen at 375.
 *
 * a11y: focus moves to the first menuitem on open and returns to the trigger on
 * every close (Esc / click-outside / item-activate / toggle-off / Tab);
 * ArrowDown/Up rove (wrap), Home/End jump, Enter/Space activate; the menu is
 * `aria-orientation="vertical"`. Items inherit the global :focus-visible ring.
 *
 * stopPropagation (load-bearing, guards PR-B): the trigger wrapper AND the
 * portaled menu both stopPropagation so neither the ⋯ nor a menu item ever
 * fires the row's onActivate.
 */
const GUTTER = 16; // matches the `max-[921px]:px-4` shell gutter (DESIGN.md spacing.4)
const MENU_GAP = 4; // `mt-1` equivalent between trigger and menu (DESIGN.md spacing.1)

const RowMenu: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // -1 until the menu opens; open() lands focus on index 0.
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // The flat list of menuitem indices (separators are not focusable stops).
  const itemCount = items.length;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setActive(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Position the portaled menu against the trigger: right-aligned, flip-up near
  // the viewport bottom, clamped within the gutters. Runs before paint so the
  // menu never flashes at (0,0).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const compute = () => {
      const t = triggerRef.current;
      const menu = menuRef.current;
      if (!t || !menu) return;
      const r = t.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Right-align the menu's right edge to the trigger's right edge.
      let left = r.right - mw;
      // Clamp horizontally within the gutters.
      left = Math.min(left, vw - GUTTER - mw);
      left = Math.max(left, GUTTER);

      // Open downward by default; flip up if it would overflow the bottom,
      // then clamp when neither direction has enough room. maxHeight below
      // keeps the menu scrollable on unusually short viewports.
      const below = r.bottom + MENU_GAP;
      const above = r.top - MENU_GAP - mh;
      const flipUp = below + mh > vh - GUTTER && above >= GUTTER;
      const preferredTop = flipUp ? above : below;
      const top = Math.max(GUTTER, Math.min(preferredTop, vh - GUTTER - mh));

      setPos({ top, left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  // On open, move focus to the first menuitem.
  useEffect(() => {
    if (!open) return;
    setActive(0);
  }, [open]);

  // Keep the DOM focus on the active menuitem as the roving index changes.
  useEffect(() => {
    if (!open || active < 0) return;
    const el = menuRef.current?.querySelector<HTMLButtonElement>(
      `[data-menuitem-index="${active}"]`,
    );
    el?.focus();
  }, [open, active]);

  // Close on outside pointer-down (not on the trigger — that toggles).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false); // outside click: don't yank focus back to the trigger
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + itemCount) % itemCount);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(itemCount - 1);
    } else if (e.key === 'Tab') {
      // Menus are not internal tab-stops: Tab/Shift+Tab close + restore focus.
      close();
    }
    // Enter/Space activate the focused <button> natively (no handler needed).
  };

  const activate = (item: RowMenuItem) => {
    // Load-bearing since the aria-disabled switch: an aria-disabled <button> still fires
    // click (there is no HTML `disabled` to swallow it) — this guard is the no-op.
    if (item.disabled) return;
    item.onClick();
    close();
  };

  return (
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('table.rowActions', 'Row actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
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
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              // The fixed toast stack is z-[1000] and may overlap the bottom row;
              // keep row actions above it so the toast cannot intercept menu clicks.
              zIndex: 1010,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="min-w-[160px] max-h-[calc(100vh-32px)] overflow-y-auto rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
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
                    aria-disabled={item.disabled || undefined}
                    tabIndex={i === active ? 0 : -1}
                    data-menuitem-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(item)}
                    className={cn(
                      'flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent',
                      item.danger && 'text-destructive',
                      item.disabled && 'cursor-not-allowed text-muted-foreground hover:bg-transparent'
                    )}
                  >
                    {item.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body
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

export interface SearchMiniProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
  /**
   * `search_used` analytics (2026-07-13 wiring plan) — a stable id for this search
   * surface (e.g. 'companies-list'). Tracking is opt-in: omit `searchSurface` or
   * `module` to skip it entirely. Fires once per search intent (500ms idle, or
   * immediately on Enter) — never per keystroke, and NEVER the query text itself.
   */
  searchSurface?: string;
  /** See `searchSurface`. The module this search surface belongs to. */
  module?: string;
  /** The current result count AFTER filtering by `value` — read only at fire time. */
  resultCount?: number;
}

/** Borderless search field shell. */
export const SearchMini: React.FC<SearchMiniProps> = ({
  containerClassName,
  className,
  searchSurface,
  module,
  resultCount,
  value,
  onKeyDown,
  ...rest
}) => {
  // `resultCount` changes every keystroke (the parent's filtered list recomputes) but
  // must never itself restart/duplicate the debounce — read the latest value via a ref
  // at fire time instead of putting it in the effect's dependency list.
  const resultCountRef = useRef(resultCount);
  resultCountRef.current = resultCount;
  const timerRef = useRef<number | undefined>(undefined);

  const fire = useCallback(() => {
    if (!searchSurface || !module) return;
    trackSearchUsed(searchSurface, resultCountRef.current ?? 0, module);
  }, [searchSurface, module]);

  useEffect(() => {
    if (!searchSurface || !module) return undefined;
    const str = typeof value === 'string' ? value : '';
    if (!str.trim()) return undefined;
    timerRef.current = window.setTimeout(() => {
      fire();
      timerRef.current = undefined;
    }, SEARCH_USED_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fire` reads searchSurface/module/resultCountRef; only `value` should restart the debounce.
  }, [value, searchSurface, module]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      const str = typeof value === 'string' ? value : '';
      if (str.trim()) fire();
    }
    onKeyDown?.(e);
  };

  return (
    <div
      className={cn(
        'flex h-8 min-w-[190px] items-center gap-[7px] rounded-lg border border-input bg-background px-2.5 [&_svg]:size-[15px] [&_svg]:text-muted-foreground',
        containerClassName
      )}
    >
      <Icon name="search" />
      <input
        type="search"
        value={value}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full border-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground',
          className
        )}
        {...rest}
      />
    </div>
  );
};

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
