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
import { SCALE_PX_PER_DAY } from './ganttGeometry';

// ── Public types ──────────────────────────────────────────────────────────────

/** Zoom granularity for the timeline axis (ADR-0031 §5). */
export type GanttScale = 'day' | 'week' | 'month' | 'quarter';

/**
 * Optional pixel-aware layout config. When passed to `buildGanttModel`, the model
 * additionally emits a `GanttGeometry` block of absolute-px boxes + dependency edges.
 * When omitted, behaviour is byte-identical to v1 (fractions only, `geometry: null`).
 */
export interface GanttLayoutConfig {
  scale: GanttScale;
  /** Row height in px (timeline + table rows aligned). */
  rowHeight: number;
  /** Lane-header (milestone band) height in px. */
  laneHeaderHeight: number;
}

/** Absolute-px geometry for one laid-out bar within the timeline content box. */
export interface GanttBarBox {
  id: string;
  xStart: number;
  xEnd: number;
  y: number;
  h: number;
}

/** Absolute-px geometry for one milestone diamond within the timeline content box. */
export interface GanttMarkerBox {
  id: string;
  x: number;
  y: number;
}

/** A resolved finish-to-start dependency connector in absolute timeline-content px. */
export interface GanttEdge {
  /** `${fromTaskId}->${toTaskId}` — stable key. */
  id: string;
  /** Predecessor (the `depends_on_id`). */
  fromId: string;
  /** Successor (the task carrying the dependency row). */
  toId: string;
  /** Start point = predecessor bar END (right edge), vertically centred on its row. */
  x1: number;
  y1: number;
  /** End point = successor bar START (left edge), vertically centred on its row. */
  x2: number;
  y2: number;
  /** True when the successor starts at/after the predecessor's end (normal FS). */
  forward: boolean;
}

export interface GanttGeometry {
  /** Total timeline px width (spanDays * pxPerDay). */
  contentWidth: number;
  /** Total px height of all lanes/rows. */
  contentHeight: number;
  pxPerDay: number;
  bars: GanttBarBox[];
  markers: GanttMarkerBox[];
  edges: GanttEdge[];
  /** Edges that could not be drawn because an endpoint bar is undated/absent. */
  hiddenEdgeCount: number;
}

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
  /**
   * Whether the label should be rendered on the axis.
   * Always true for month/quarter/week scales.
   * For day scale: true only for the first day of each week (Monday) so
   * the axis remains legible — daily gridlines are still drawn for all ticks.
   */
  showLabel: boolean;
}

export interface GanttModel {
  /** Inclusive ISO date span [min,max] that defines the 0..1 axis, or null if nothing dated. */
  span: { startIso: string; endIso: string } | null;
  lanes: GanttLane[];
  /**
   * Today's fraction (0..1). Always non-null when data exists — the axis span is
   * extended to include today so the line always renders at its true position
   * (drift fix: previously clamped off-canvas when today was outside data dates).
   */
  todayLeft: number | null;
  /** Month-boundary ticks for the axis. */
  ticks: GanttAxisTick[];
  /** Tasks with NEITHER date — acknowledged in a footer, not plotted (D5). */
  undated: { id: string; name: string }[];
  /** True when there is nothing dated to plot at all (caller → empty state). */
  isEmpty: boolean;
  /**
   * Absolute-px geometry (bars/markers/edges). Non-null only when a `config` is
   * passed to `buildGanttModel`; otherwise null (v1 fraction-only behaviour).
   */
  geometry: GanttGeometry | null;
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
  config?: GanttLayoutConfig,
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

  // Collect all dates to determine the data span
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
      geometry: null,
    };
  }

  // Compute data span from task/milestone dates, then extend to always include today.
  // This ensures the today-line renders at its true position even when today falls
  // outside the project's data window (drift fix: previously returned todayLeft=null).
  const dataStart = allDates.reduce((a, b) => (a < b ? a : b));
  const dataEnd = allDates.reduce((a, b) => (a > b ? a : b));

  let spanStart = todayIso < dataStart ? todayIso : dataStart;
  let spanEnd = todayIso > dataEnd ? todayIso : dataEnd;

  // Pad single-date spans by ±1 day so bars always have nonzero width.
  // (After today-extension the span may already differ; padding only fires if
  //  the final window is still a single point — e.g. all data + today same date.)
  if (spanStart === spanEnd) {
    const d = parseLocalDate(spanStart);
    const dayBefore = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const dayAfter = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    spanStart = toIso(dayBefore);
    spanEnd = toIso(dayAfter);
  }

  const spanDays = daysBetween(spanStart, spanEnd);

  // Today line — always at its true fraction within the extended span.
  const todayLeft = fraction(spanStart, spanDays, todayIso);

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

  // Build axis ticks at the chosen granularity (month is the default / v1 path).
  const ticks = buildTicks(spanStart, spanEnd, spanDays, config?.scale ?? 'month');

  // Pixel-aware geometry — only when a config is supplied (v1 callers get null).
  const geometry = config
    ? buildGeometry(lanes, datedTasks, spanDays, config)
    : null;

  return {
    span: { startIso: spanStart, endIso: spanEnd },
    lanes,
    todayLeft,
    ticks,
    undated,
    isEmpty: false,
    geometry,
  };
}

// ── Pixel geometry (ADR-0031) ─────────────────────────────────────────────────

/**
 * Walks the laid-out lanes in render order, accumulating an absolute `y` per row,
 * and converts each bar's/marker's fraction position to absolute px. The axis is
 * NOT included here — these coordinates are within the timeline CONTENT box (the
 * box that begins below the axis), so the component overlays the SVG over that box.
 */
function buildGeometry(
  lanes: GanttLane[],
  datedTasks: TaskWithRefs[],
  spanDays: number,
  config: GanttLayoutConfig,
): GanttGeometry {
  const pxPerDay = SCALE_PX_PER_DAY[config.scale];
  const contentWidth = spanDays * pxPerDay;
  // Bar height: a touch shorter than the row so there is breathing room (≤28 like v1).
  const barH = Math.min(28, config.rowHeight - 12);

  const bars: GanttBarBox[] = [];
  const markers: GanttMarkerBox[] = [];

  let y = 0;
  for (const lane of lanes) {
    // The lane-header band sits at the top of each lane group.
    const headerMidY = y + config.laneHeaderHeight / 2;
    if (lane.marker) {
      markers.push({
        id: lane.marker.id,
        x: lane.marker.left * contentWidth,
        y: headerMidY,
      });
    }
    y += config.laneHeaderHeight;

    for (const bar of lane.bars) {
      const xStart = bar.left * contentWidth;
      const xEnd = (bar.left + bar.width) * contentWidth;
      const barY = y + (config.rowHeight - barH) / 2;
      bars.push({ id: bar.id, xStart, xEnd, y: barY, h: barH });
      y += config.rowHeight;
    }
  }

  const contentHeight = y;

  const { edges, hiddenEdgeCount } = buildEdges(bars, datedTasks);

  return { contentWidth, contentHeight, pxPerDay, bars, markers, edges, hiddenEdgeCount };
}

/**
 * Resolves finish-to-start dependency connectors over the laid-out bars (ADR-0031 §3).
 * An edge runs from the predecessor (`depends_on_id`) bar END to the successor bar
 * START, vertically centred on each row. Edges whose predecessor or successor bar is
 * absent (undated / filtered out) are SKIPPED and counted in `hiddenEdgeCount`.
 */
function buildEdges(
  bars: GanttBarBox[],
  datedTasks: TaskWithRefs[],
): { edges: GanttEdge[]; hiddenEdgeCount: number } {
  const barById = new Map<string, GanttBarBox>(bars.map((b) => [b.id, b]));
  const edges: GanttEdge[] = [];
  let hiddenEdgeCount = 0;

  for (const t of datedTasks) {
    for (const dep of t.dependencies) {
      const p = barById.get(dep.depends_on_id); // predecessor
      const s = barById.get(t.id); // successor
      if (!p || !s) {
        hiddenEdgeCount += 1;
        continue;
      }
      const x1 = p.xEnd;
      const y1 = p.y + p.h / 2;
      const x2 = s.xStart;
      const y2 = s.y + s.h / 2;
      edges.push({
        id: `${dep.depends_on_id}->${t.id}`,
        fromId: dep.depends_on_id,
        toId: t.id,
        x1,
        y1,
        x2,
        y2,
        forward: x2 >= x1,
      });
    }
  }

  edges.sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2);
  return { edges, hiddenEdgeCount };
}

// ── Axis tick generation ──────────────────────────────────────────────────────

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


/**
 * Dispatches axis-tick generation by scale (ADR-0031 §5):
 *   - `month`   → first day of each month (v1 behaviour, verbatim).
 *   - `quarter` → first day of each quarter month (Jan/Apr/Jul/Oct).
 *   - `week`    → every Monday in the span.
 *   - `day`     → every day (all ticks = daily gridlines), but `showLabel`
 *                 is true only for Mondays so the axis stays legible.
 * Every tick keeps `{iso, left (fraction), label, showLabel}`.
 */
function buildTicks(
  spanStart: string,
  spanEnd: string,
  spanDays: number,
  scale: GanttScale,
): GanttAxisTick[] {
  switch (scale) {
    case 'month':
      return buildMonthTicks(spanStart, spanEnd, spanDays);
    case 'quarter':
      // Reuse the month walk, keeping only quarter-start months (0,3,6,9).
      return buildMonthTicks(spanStart, spanEnd, spanDays).filter((t) => {
        const month = Number(t.iso.split('-')[1]); // 1-based
        return month === 1 || month === 4 || month === 7 || month === 10;
      });
    case 'week':
      return buildDayStepTicks(spanStart, spanEnd, spanDays, {
        keep: (d) => d.getDay() === 1, // Mondays only
        showLabel: () => true,
        label: (d) => `${MONTH_ABBREVS[d.getMonth()]} ${d.getDate()}`,
      });
    case 'day':
      // Every day emits a tick (→ daily gridline), but label is shown only on
      // Mondays to prevent collision at typical zoom levels (28px/day).
      return buildDayStepTicks(spanStart, spanEnd, spanDays, {
        keep: () => true,
        showLabel: (d) => d.getDay() === 1, // Monday
        label: (d) => `${MONTH_ABBREVS[d.getMonth()]} ${d.getDate()}`,
      });
  }
}

/**
 * Generic day-stepping tick generator: walks each day in [spanStart, spanEnd] and
 * emits a tick for every day for which `keep(date)` is true.
 * `showLabel` controls whether the axis renders a visible text label for the tick;
 * all ticks still drive gridlines regardless of `showLabel`.
 */
function buildDayStepTicks(
  spanStart: string,
  spanEnd: string,
  spanDays: number,
  opts: {
    keep: (d: Date) => boolean;
    showLabel: (d: Date) => boolean;
    label: (d: Date) => string;
  },
): GanttAxisTick[] {
  const ticks: GanttAxisTick[] = [];
  const start = parseLocalDate(spanStart);
  const end = parseLocalDate(spanEnd);

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= end) {
    if (opts.keep(cursor)) {
      const iso = toIso(cursor);
      ticks.push({
        iso,
        left: fraction(spanStart, spanDays, iso),
        label: opts.label(cursor),
        showLabel: opts.showLabel(cursor),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return ticks;
}

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
        showLabel: true,
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
