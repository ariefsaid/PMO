/**
 * Left task table of the Task Gantt (ADR-0031 split layout) — extracted from ProjectGantt
 * (XG03-003): the role="grid" pane with the corner header, lane-header rows and TaskTableRow,
 * plus the roving-tabindex focus state shared by those rows.
 *
 * Row alignment with the timeline comes from the shared flat-row seam (src/lib/gantt/ganttRows.ts):
 * this component renders the rows it is given and owns NO geometry of its own — it imports the
 * one row-height constant set from there.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, type RowMenuItem } from '@/src/components/ui';
import {
  GANTT_AXIS_H,
  GANTT_LANE_HEADER_H,
  GANTT_ROW_H,
  GANTT_TABLE_W,
  taskRowKeys,
  type GanttFlatRow,
  type GanttTaskRow,
} from '@/src/lib/gantt/ganttRows';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatMonthDay } from '@/src/lib/format';

/**
 * B1: convert ISO date (YYYY-MM-DD) to compact human format ("Jan 1") through the shared
 * locale-aware formatter. OE07-004: deliberately NO hand-maintained month list — the cell
 * follows the configured date locale like every other date in the app, and a non-ISO
 * (never produced by the layout model) value degrades to the em-dash placeholder instead
 * of rendering garbage.
 */
function formatCompactDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return formatMonthDay(new Date(y, m - 1, d));
}

// ── Task table row (role=row, roving tabindex, Arrow/Enter — D7) ──────────────

interface TaskTableRowProps {
  row: GanttTaskRow;
  rovingActive: boolean;
  activatable: boolean;
  setRef: (el: HTMLDivElement | null) => void;
  onFocus: () => void;
  onArrow: (delta: number) => void;
  onActivate?: () => void;
  rowMenuItems?: RowMenuItem[];
}

const TaskTableRow: React.FC<TaskTableRowProps> = ({
  row,
  rovingActive,
  activatable,
  setRef,
  onFocus,
  onArrow,
  onActivate,
  rowMenuItems,
}) => {
  const { t } = useTranslation('project');
  const [actionsOpen, setActionsOpen] = useState(false);
  const { bar } = row;
  // B1: use compact human dates ("Jan 1 – Jan 11") to prevent date string from
  // dominating the table pane and starving the name column.
  const startFmt = formatCompactDate(bar.startIso);
  const endFmt = formatCompactDate(bar.endIso);
  const dates =
    startFmt || endFmt
      ? `${startFmt ?? '—'} – ${endFmt ?? '—'}`
      : '—';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('button, summary, a, select, input')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onArrow(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onArrow(-1);
    } else if ((e.key === 'Enter' || e.key === ' ') && onActivate) {
      e.preventDefault();
      onActivate();
    }
  };

  const closeActionsOnEscape = (event: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.currentTarget.removeAttribute('open');
    setActionsOpen(false);
    event.currentTarget.querySelector('summary')?.focus();
  };

  return (
    <div
      ref={setRef}
      role="row"
      data-row-kind="task"
      tabIndex={activatable ? (rovingActive ? 0 : -1) : undefined}
      onFocus={onFocus}
      onKeyDown={activatable ? handleKeyDown : undefined}
      className={`flex items-center gap-2 border-b border-border/70 px-3${activatable ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring hover:bg-secondary/30' : ''}`}
      style={{ height: GANTT_ROW_H }}
      onClick={onActivate}
    >
      <span
        role="gridcell"
        className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
        title={bar.name}
      >
        {bar.name}
      </span>
      {/* D1: status + date columns collapse on narrow viewports so the timeline
          (the point of the view) is not squeezed off screen at 390px. */}
      <span role="gridcell" className="hidden shrink-0 sm:block">
        <StatusPill variant={workflowVariant(bar.status)}>{bar.status}</StatusPill>
      </span>
      <span
        role="gridcell"
        className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:block"
      >
        {dates}
      </span>
      {rowMenuItems && rowMenuItems.length > 0 && <span role="gridcell" className="shrink-0" onClick={(event) => event.stopPropagation()}>
        <details className="relative" onToggle={(event) => setActionsOpen(event.currentTarget.open)} onKeyDown={closeActionsOnEscape}>
          <summary role="button" aria-label={t('table.rowActions', 'Row actions')} aria-haspopup="menu" aria-expanded={actionsOpen} className="touch-target grid size-8 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">⋯</summary>
          <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
            {rowMenuItems.map((item) => <button key={item.label} role="menuitem" type="button" disabled={item.disabled} className={`block min-h-8 w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-accent disabled:opacity-50${item.danger ? ' text-destructive-text' : ''}`} onClick={(event) => {
              event.stopPropagation();
              event.currentTarget.closest('details')?.removeAttribute('open');
              item.onClick();
            }}>{item.label}</button>)}
          </div>
        </details>
      </span>}
    </div>
  );
};

// ── The grid pane ─────────────────────────────────────────────────────────────

interface GanttTaskTableProps {
  rows: GanttFlatRow[];
  /** bar/task id → task, for row-menu resolution and activation. */
  tasksById: Map<string, TaskWithRefs>;
  activatable: boolean;
  onRowActivate?: (id: string) => void;
  rowMenu?: (task: TaskWithRefs) => RowMenuItem[];
}

const GanttTaskTable: React.FC<GanttTaskTableProps> = ({
  rows,
  tasksById,
  activatable,
  onRowActivate,
  rowMenu,
}) => {
  const { t } = useTranslation('project');

  const keys = useMemo(() => taskRowKeys(rows), [rows]);

  // Roving focus across the grid's task rows. PGB-020: if the focused row was removed
  // or filtered out, fall back to the first available task row so keyboard users can still tab in.
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const currentRowKeys = useRef(keys);
  const restoreFocus = useRef(false);
  currentRowKeys.current = keys;

  useLayoutEffect(() => {
    if (restoreFocus.current && document.activeElement === document.body &&
        !document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) {
      const first = keys[0];
      if (first) rowRefs.current.get(first)?.focus();
    }
    restoreFocus.current = false;
  });

  const activeRowKey =
    focusedRowKey && keys.includes(focusedRowKey)
      ? focusedRowKey
      : (keys[0] ?? null);

  const moveFocus = (delta: number, fromKey: string) => {
    const idx = keys.indexOf(fromKey);
    if (idx === -1) return;
    const next = keys[Math.min(keys.length - 1, Math.max(0, idx + delta))];
    setFocusedRowKey(next);
    rowRefs.current.get(next)?.focus();
  };

  const setRowRef = (key: string) => (el: HTMLDivElement | null) => {
    const previous = rowRefs.current.get(key);
    if (!el && previous && !currentRowKeys.current.includes(key) &&
        previous.contains(document.activeElement)) restoreFocus.current = true;
    rowRefs.current.set(key, el);
  };

  return (
    <div
      role="grid"
      aria-label={t('projectDetail.gantt.taskTableAriaLabel', 'Task table')}
      aria-rowcount={rows.length}
      className="sticky left-0 z-30 shrink-0 border-r border-border bg-card"
      style={{ width: GANTT_TABLE_W }}
    >
      {/* Corner header cell ("Task") — frozen in BOTH directions (top-0 + the
          column's own sticky left-0), highest z so nothing scrolls over it. */}
      <div
        role="row"
        className="sticky top-0 z-40 flex items-center border-b border-border bg-card px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        style={{ height: GANTT_AXIS_H }}
      >
        <span role="columnheader" className="flex-1">
          {t('projectDetail.gantt.taskColumn', 'Task')}
        </span>
      </div>

      {rows.map((row) =>
        row.kind === 'lane' ? (
          <div
            key={row.key}
            role="row"
            data-row-kind="lane"
            className="flex items-center gap-2 border-b border-border/70 bg-secondary/30 px-3 text-[12px] font-semibold text-muted-foreground"
            style={{ height: GANTT_LANE_HEADER_H }}
          >
            <span role="gridcell" className="truncate">{row.label}</span>
          </div>
        ) : (
          <TaskTableRow
            key={row.key}
            row={row}
            rovingActive={row.key === activeRowKey}
            activatable={activatable}
            setRef={setRowRef(row.key)}
            onFocus={() => setFocusedRowKey(row.key)}
            onArrow={(delta) => moveFocus(delta, row.key)}
            onActivate={onRowActivate ? () => onRowActivate(row.bar.id) : undefined}
            rowMenuItems={rowMenu ? rowMenu(tasksById.get(row.bar.id)!) : undefined}
          />
        ),
      )}
    </div>
  );
};

export default GanttTaskTable;
