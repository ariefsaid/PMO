/**
 * Flat row model for the Task Gantt (ADR-0031) — the shared seam between the left task
 * table (GanttTaskTable) and the right timeline (GanttTimeline): ONE flattening of the
 * laid-out lanes into ordered rows, and the ONE row-geometry constant set both panes
 * render against (no second scroll owner, no independent row-height source — XG03-003).
 *
 * Pure module (mirrors ganttLayout.ts): no side-effects, no framework imports.
 */
import type { GanttBar, GanttLane } from './ganttLayout';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

// ── Layout geometry constants (not design tokens — like the v1 ROW_H) ─────────
// Bar block height is derived inside buildGanttModel (min(28, rowHeight-12)) and
// returned per-bar as box.h, so it is not a standalone const here.
export const GANTT_ROW_H = 40; // px — lane row height (bar + vertical padding)
export const GANTT_LANE_HEADER_H = 36; // px — milestone lane header height
export const GANTT_AXIS_H = 32; // px — time axis height
export const GANTT_TABLE_W = 360; // px — left task-name pane needs room for readable labels

/** A milestone (or trailing Ungrouped) band heading row in the flat row list. */
export interface GanttLaneHeaderRow {
  kind: 'lane';
  key: string;
  label: string;
  markerIso: string | null;
}

/** One plotted task row; `bar` carries the fraction geometry, names feed the aria-label. */
export interface GanttTaskRow {
  kind: 'task';
  key: string;
  bar: GanttBar;
  predecessorNames: string[];
}

export type GanttFlatRow = GanttLaneHeaderRow | GanttTaskRow;

/**
 * Flatten lanes → ordered rows (lane header + task rows), matching the geometry walk in
 * `buildGeometry`, so the table and the timeline stay row-aligned by construction.
 * Predecessor names resolve through the task list (unknown dependency ids drop silently —
 * the same contract the renderer always applied).
 */
export function flattenGanttRows(lanes: GanttLane[], tasks: TaskWithRefs[]): GanttFlatRow[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const nameById = new Map(tasks.map((t) => [t.id, t.name]));
  const rows: GanttFlatRow[] = [];
  for (const lane of lanes) {
    rows.push({
      kind: 'lane',
      key: `lane:${lane.milestoneId ?? '__ungrouped__'}`,
      label: lane.label,
      markerIso: lane.marker?.targetIso ?? null,
    });
    for (const bar of lane.bars) {
      const source = taskById.get(bar.id);
      const predecessorNames = (source?.dependencies ?? [])
        .map((d) => nameById.get(d.depends_on_id))
        .filter((n): n is string => n != null);
      rows.push({ kind: 'task', key: `task:${bar.id}`, bar, predecessorNames });
    }
  }
  return rows;
}

/** The focusable task-row keys in flat order (roving-tabindex sequence). */
export function taskRowKeys(rows: GanttFlatRow[]): string[] {
  return rows.filter((r): r is GanttTaskRow => r.kind === 'task').map((r) => r.key);
}
