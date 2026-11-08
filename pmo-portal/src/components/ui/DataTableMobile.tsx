import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Checkbox } from './Checkbox';
import { RowMenu, type RowMenuItem } from './RowMenu';
import type {
  Column,
  DataTableSelection,
} from './DataTable';
import { PrimaryCell } from './DataTableShared';
import type { GroupedRowEntry } from './DataTableShared';

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

export interface DataTableMobileProps<Row> {
  columns: Column<Row>[];
  groupedRows: GroupedRowEntry<Row>[];
  collapsedGroups: Set<string>;
  groupToggle: (key: string, count: number) => React.ReactNode;
  groupHeader?: (label: string, rows: Row[]) => React.ReactNode;
  tableInstanceId: string;
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
  mobileCardTitle?: (row: Row) => React.ReactNode;
  mobileCardDetails?: (row: Row) => React.ReactNode;
}

export function DataTableMobile<Row>({
  columns,
  groupedRows,
  collapsedGroups,
  groupToggle,
  groupHeader,
  tableInstanceId,
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
  mobileCardTitle,
  mobileCardDetails,
}: DataTableMobileProps<Row>) {
  const { t } = useTranslation('projects');

  return (
    /* ── Mobile card branch (<768px — only branch in the DOM) ─────────────
     * OD-W4-4 / AC-IXD-MOBILE-W4-C1: stacked record-card list.
     * Card anatomy (DESIGN.md tokens), #2061 TWO-LINE ROWS:
     *   - Container: bg-card, border, rounded-md (8px), p-4 (16px), gap-2 (8px) between cards
     *   - Line 1 (identity): first column = activation <button> (rowLabel accessible name),
     *     the `status` column's pill beside it; rowMenu ⋯ top-right, .touch-target
     *   - Line 2 (meta): the primary cell's secondary text, then every remaining column as
     *     one inline, dot-separated value — never a label/value stack. Column labels stay
     *     in the DOM `sr-only` so the values remain self-describing for screen readers.
     *   - Numeric columns keep tabular figures (no desktop right-alignment on cards)
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
      {selection && !state && <li className="flex items-center gap-2 border-b border-border/70 bg-secondary/30 px-4 py-2">
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selectAllChecked} onChange={toggleAllRows} label={t('table.selectAllRows', 'Select all rows')} labelledBy={`${tableInstanceId}-select-all`} disabled={visibleSelectionIds.length === 0} />
        </span>
        <span id={`${tableInstanceId}-select-all`} className="cursor-default select-none text-[12px] text-muted-foreground" onClick={() => { if (visibleSelectionIds.length > 0) toggleAllRows(selectAllChecked !== true); }}>{t('table.selectAllRows', 'Select all rows')}</span>
      </li>}
      {state ? (
        <li className="p-0">{listStateNode}</li>
      ) : (
        groupedRows.map((entry, entryIndex) => {
          if (entry.type === 'heading') return <li key={`group-${entry.label}-${entryIndex}`} className="flex min-h-[var(--table-row-min-height)] flex-wrap items-center justify-between gap-x-4 bg-secondary/40 px-[var(--table-cell-inset)] py-3 text-control font-semibold text-foreground">{groupToggle(entry.label, entry.count)}{groupHeader?.(entry.label, entry.rows.map((modelRow) => modelRow.original))}</li>;
          if (entry.group && collapsedGroups.has(entry.group)) return null;
          const modelRow = entry.modelRow;
          const row = modelRow.original;
          const key = modelRow.id;
          const targetId = rowTarget?.(row);
          const selected = key === selectedKey;
          const [titleCol, ...cardCols] = columns;
          // N10: an actions column (its own ⋯ menu) sits top-right like rowMenu, never as a trailing card line.
          const actionCols = mobileCardDetails ? [] : cardCols.filter((col) => col.kind === 'actions');
          // #2061 two-line row: the identity line carries the name AND the record's status
          // (the status column moves up beside the title); every other column reads as one
          // inline meta line under it (customer, value, progress). The primary cell's own
          // secondary line (e.g. company + project code) leads that meta line, so the row
          // is exactly two lines instead of a label/value stack.
          const statusCols = mobileCardDetails ? [] : cardCols.filter((col) => col.kind === 'status');
          const restCols = cardCols.filter((col) => !actionCols.includes(col) && !statusCols.includes(col));
          const primarySecondary = titleCol.secondaryCell?.(row);
          const hasMenu = !!rowMenu;
          const menuItems = hasMenu ? (rowMenu!(row) ?? []) : [];

          return (
            <li
              key={key}
              id={targetId}
              tabIndex={targetId ? -1 : undefined}
              className={cn(
                'relative flex min-h-[var(--table-row-min-height)] flex-col gap-2 p-[var(--table-cell-inset)] text-control transition-colors',
                onActivate && 'cursor-pointer',
                selected && 'bg-surface-selected'
              )}
            >
              {/* Line 1 — identity: the name plus the record's status pill, ⋯ pinned top-right. */}
              <div className="flex items-start justify-between gap-3">
                {/* Card title — activation button if rowLabel+onActivate supplied.
                    [&_.truncate]:block: a `truncate` cell is usually an INLINE <span>, and
                    overflow:hidden is a no-op on inline boxes — so a long title bleeds past
                    the viewport at phone widths (AC-MOBILE-OVERFLOW-001). Forcing truncate
                    descendants to block lets them clip with an ellipsis within this min-w-0
                    column, independent of text width (no font-metric-dependent 1–6px bleed). */}
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {selection && <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={modelRow.getIsSelected()}
                      onChange={(checked) => modelRow.toggleSelected(checked)}
                      label={selectionLabel(row, titleCol)}
                    />
                  </span>}
                  <div className="min-w-0 flex-1 font-semibold [&_.truncate]:block">
                    {onActivate && rowLabel ? (
                      <button
                        type="button"
                        aria-label={accessibleRowLabel(row)}
                        onClick={() => onActivate(row)}
                        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                      >
                        {mobileCardTitle ? mobileCardTitle(row) : titleCol.kind === 'primary' ? <PrimaryCell title={titleCol.cell(row)} titleText={titleCol.primaryTitle?.(row)} /> : titleCol.cell(row)}
                      </button>
                    ) : (
                      mobileCardTitle ? mobileCardTitle(row) : titleCol.kind === 'primary' ? <PrimaryCell title={titleCol.cell(row)} titleText={titleCol.primaryTitle?.(row)} /> : titleCol.cell(row)
                    )}
                  </div>
                </div>
                {/* Status pill(s) + actions + rowMenu ⋯ — top-right of the identity line.
                    rowMenu carries .touch-target for ≥44px on coarse pointer. */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {statusCols.map((col) => {
                    const content = col.cell(row);
                    // The pill renders without its column label visually (the line-1 slot is the
                    // label in a card); a sr-only header keeps the value self-describing for AT.
                    return content == null || content === false ? null : (
                      <div key={col.key} data-card-status={col.key}>
                        <span className="sr-only">{col.header} </span>
                        {content}
                      </div>
                    );
                  })}
                  {actionCols.map((col) => {
                    const content = col.cell(row);
                    return content == null || content === false ? null : <div key={col.key} data-card-actions={col.key}>{content}</div>;
                  })}
                  {hasMenu && menuItems.length > 0 && <RowMenu items={menuItems} />}
                </div>
              </div>

              {/* Line 2 — one inline meta line. The primary cell's secondary text leads it, then
                  every remaining column as a value separated by a dot. A cell that renders nothing
                  for THIS row (null/undefined/false — e.g. a fact only one record type carries) is
                  left out; its <dt> label stays in the DOM sr-only so AT hears "Customer 500".
                  A <dt> without its <dd> would be invalid, so they always ship together. */}
              {mobileCardDetails ? mobileCardDetails(row) : (restCols.length > 0 || primarySecondary != null) && (
                <dl
                  data-card-meta-line=""
                  className={cn(
                    'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] font-normal text-muted-foreground',
                    // Dot separators between values (never before the first one).
                    '[&>dd:not(:first-of-type)]:before:mr-1.5 [&>dd:not(:first-of-type)]:before:text-muted-foreground/60 [&>dd:not(:first-of-type)]:before:content-[\'·\']',
                  )}
                >
                  {primarySecondary != null && (
                    <dd className="min-w-0 max-w-full truncate [&_.truncate]:block">{primarySecondary}</dd>
                  )}
                  {restCols.map((col) => {
                    const content = col.cell(row);
                    if (content == null || content === false) return null;
                    return (
                      <React.Fragment key={col.key}>
                        <dt
                          className={cn(
                            'sr-only self-start text-[12px] font-semibold text-muted-foreground',
                            stripHiddenClasses(col.colClassName)
                          )}
                        >
                          {col.header}
                        </dt>
                        <dd
                          className={cn(
                            // [&_.truncate]:block — see the title note above: inline truncate
                            // cells (e.g. a contact email) don't clip and bleed at 360px.
                            'min-w-0 break-words text-[12.5px] text-muted-foreground [&_.truncate]:block',
                            // ONE value alignment on the meta line: money keeps its tabular
                            // figures but loses the desktop column's right alignment here.
                            col.align === 'num' && 'tabular',
                            col.align === 'center' && 'text-center',
                            stripHiddenClasses(col.colClassName),
                            // A cell whose desktop column stacks right-aligned (money cells
                            // render `flex-col items-end`) left-aligns its block on cards.
                            '[&>div]:items-start',
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
      {!state && totals?.map((total) => <li key={`total-${total.key}`} className="min-h-[var(--table-row-min-height)] border-t-[1.5px] border-border bg-secondary/40 px-[var(--table-cell-inset)] py-3 text-control font-semibold tabular">
        <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {columns.map((column, index) => {
            const value = total.values && Object.prototype.hasOwnProperty.call(total.values, column.key)
              ? total.values[column.key]
              : index === 0 ? total.label : null;
            return value == null ? null : <React.Fragment key={column.key}><dt className="text-muted-foreground">{column.header}</dt><dd className={cn('min-w-0', column.align === 'num' && 'tabular')}>{value}</dd></React.Fragment>;
          })}
        </dl>
      </li>)}
    </ul>
  );
}
