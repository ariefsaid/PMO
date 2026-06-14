/**
 * Pure date→geometry model for the read-only Task Gantt timeline (FR-GANTT-001..008).
 *
 * Mirrors sCurve.ts / monthMatrix.ts: no side-effects, no imports from the framework,
 * no network calls. All date math via UTC midnight to avoid DST drift (same as sCurve.ts
 * `daysBetween`). Local-date parsing via `parseLocalDate` from monthMatrix (D7).
 */
import { parseLocalDate, toIso } from '@/src/lib/calendar/monthMatrix';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Public types ──────────────────────────────────────────────────────────────

/** A task drawn on the axis: fraction left/width in [0,1] of the model's date span. */
export interface GanttBar {
  id: string;
  name: string;
  status: TaskWithRefs['status'];
  /** Fraction (0..1) of the span where the bar starts. */
  left: number;
  /** Fraction (0..1) width. A point/flag (one-sided date) has width 0. */
  width: number;
  /** 'bar' (both dates) | 'point' (exactly one date). */
  kind: 'bar' | 'point';
  startIso: string | null;
  endIso: string | null;
  /** Count of outgoing dependency edges (v1 surfaces presence as text, D4). */
  dependsOnCount: number;
}

/** A milestone target-date marker positioned on the axis. */
export interface GanttMarker {
  id: string;
  name: string;
  targetIso: string;
  left: number; // fraction 0..1
}

/** One lane = a milestone (or the trailing Ungrouped lane) holding its bars. */
export interface GanttLane {
  milestoneId: string | null;
  label: string; // milestone name | 'Ungrouped'
  marker: GanttMarker | null; // the lane's own target-date marker, if dated
  bars: GanttBar[];
}

export interface GanttAxisTick {
  iso: string;
  left: number;
  label: string;
}

export interface GanttModel {
  /** Inclusive ISO date span [min,max] that defines the 0..1 axis, or null if nothing dated. */
  span: { startIso: string; endIso: string } | null;
  lanes: GanttLane[];
  /** Today's fraction (0..1) if within span, else null (don't draw the line). */
  todayLeft: number | null;
  /** Month-boundary ticks for the axis. */
  ticks: GanttAxisTick[];
  /** Tasks with NEITHER date — acknowledged in a footer, not plotted (D5). */
  undated: { id: string; name: string }[];
  /** True when there is nothing dated to plot at all (caller → empty state). */
  isEmpty: boolean;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Days between two 'YYYY-MM-DD' dates (b - a), via UTC midnight to avoid DST drift. */
const daysBetween = (a: string, b: string): number => {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return ms / 86_400_000;
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Convert a fraction [0,1] to a left% position clamped to the axis. */
const fraction = (spanStart: string, spanDays: number, iso: string): number => {
  if (spanDays <= 0) return 0;
  return clamp01(daysBetween(spanStart, iso) / spanDays);
};

// ── Main export ───────────────────────────────────────────────────────────────

export function buildGanttModel(
  tasks: TaskWithRefs[],
  milestones: MilestoneWithProgress[],
  todayIso: string,
): GanttModel {
  // Classify tasks
  const datedTasks: TaskWithRefs[] = [];
  const undated: { id: string; name: string }[] = [];

  for (const t of tasks) {
    if (t.start_date || t.end_date) {
      datedTasks.push(t);
    } else {
      undated.push({ id: t.id, name: t.name });
    }
  }

  // Collect all dates to determine the span
  const allDates: string[] = [];
  for (const t of datedTasks) {
    if (t.start_date) allDates.push(t.start_date);
    if (t.end_date) allDates.push(t.end_date);
  }
  for (const m of milestones) {
    if (m.target_date) allDates.push(m.target_date);
  }

  // If nothing is dated, return empty model
  if (allDates.length === 0) {
    return {
      span: null,
      lanes: [],
      todayLeft: null,
      ticks: [],
      undated,
      isEmpty: true,
    };
  }

  // Compute span
  let spanStart = allDates.reduce((a, b) => (a < b ? a : b));
  let spanEnd = allDates.reduce((a, b) => (a > b ? a : b));

  // Pad single-date spans by ±1 day so bars always have nonzero width
  if (spanStart === spanEnd) {
    const d = parseLocalDate(spanStart);
    const dayBefore = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const dayAfter = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    spanStart = toIso(dayBefore);
    spanEnd = toIso(dayAfter);
  }

  const spanDays = daysBetween(spanStart, spanEnd);

  // Today line
  const todayLeft =
    todayIso >= spanStart && todayIso <= spanEnd
      ? fraction(spanStart, spanDays, todayIso)
      : null;

  // Build a map: milestoneId → sorted index for grouping
  // Sort milestones by sort_order then name (mirrors MilestoneGroupedList)
  const sortedMilestones = [...milestones].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  // Build lanes for each milestone
  const laneMap = new Map<string | null, GanttLane>();

  for (const ms of sortedMilestones) {
    const marker: GanttMarker | null = ms.target_date
      ? {
          id: ms.id,
          name: ms.name,
          targetIso: ms.target_date,
          left: fraction(spanStart, spanDays, ms.target_date),
        }
      : null;

    laneMap.set(ms.id, {
      milestoneId: ms.id,
      label: ms.name,
      marker,
      bars: [],
    });
  }

  // Ungrouped lane (always last)
  const ungroupedLane: GanttLane = {
    milestoneId: null,
    label: 'Ungrouped',
    marker: null,
    bars: [],
  };

  // Map tasks to bars and distribute to lanes
  for (const t of datedTasks) {
    const hasBoth = t.start_date != null && t.end_date != null;
    const dateIso = hasBoth
      ? t.start_date!
      : (t.start_date ?? t.end_date)!;

    const barLeft = fraction(spanStart, spanDays, dateIso);
    const barWidth = hasBoth
      ? clamp01(daysBetween(t.start_date!, t.end_date!) / spanDays)
      : 0;

    const bar: GanttBar = {
      id: t.id,
      name: t.name,
      status: t.status,
      left: barLeft,
      width: barWidth,
      kind: hasBoth ? 'bar' : 'point',
      startIso: t.start_date,
      endIso: t.end_date,
      dependsOnCount: t.dependencies.length,
    };

    const targetLane =
      t.milestone_id != null ? laneMap.get(t.milestone_id) : undefined;

    if (targetLane) {
      targetLane.bars.push(bar);
    } else {
      ungroupedLane.bars.push(bar);
    }
  }

  // Collect lanes: sorted milestones first, then ungrouped
  const lanes: GanttLane[] = [...laneMap.values()];

  // Only add ungrouped lane if it has bars OR there are tasks without milestone assignment
  // (always add it when there are undated-milestone tasks that landed there)
  if (ungroupedLane.bars.length > 0) {
    lanes.push(ungroupedLane);
  }

  // If no milestone lanes exist and there are undated tasks too, still show ungrouped
  if (lanes.length === 0 && ungroupedLane.bars.length === 0 && datedTasks.length > 0) {
    lanes.push(ungroupedLane);
  }

  // Build month-boundary axis ticks
  const ticks = buildMonthTicks(spanStart, spanEnd, spanDays);

  return {
    span: { startIso: spanStart, endIso: spanEnd },
    lanes,
    todayLeft,
    ticks,
    undated,
    isEmpty: false,
  };
}

// ── Axis tick generation ──────────────────────────────────────────────────────

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Generates month-start ticks within the span.
 * Each tick is the first day of a month that falls within [spanStart, spanEnd].
 */
function buildMonthTicks(
  spanStart: string,
  spanEnd: string,
  spanDays: number,
): GanttAxisTick[] {
  const ticks: GanttAxisTick[] = [];

  // Start from the span start month
  const startDate = parseLocalDate(spanStart);
  const endDate = parseLocalDate(spanEnd);

  // Iterate months
  let y = startDate.getFullYear();
  let m = startDate.getMonth(); // 0-based

  while (true) {
    const tickDate = new Date(y, m, 1);
    if (tickDate > endDate) break;

    const iso = toIso(tickDate);
    // Only include if within or at span boundaries
    if (iso >= spanStart && iso <= spanEnd) {
      const left = fraction(spanStart, spanDays, iso);
      ticks.push({
        iso,
        left,
        label: `${MONTH_ABBREVS[m]} ${y}`,
      });
    }

    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  return ticks;
}
