/**
 * Task Gantt timeline — v2 (ADR-0031): MS-Project split layout (left task table +
 * right scroll-synced timeline), on-axis milestone diamonds, dependency connector
 * lines, and a day/week/month/quarter zoom. Read-only display (Phase-A) — the only
 * interaction is `onActivateTask` (click/Enter/Space on a bar, or Enter on a grid row).
 *
 * SPEC OVERRIDE (owner directive, 2026-06-15): bars are activatable so a
 * click/keyboard-Enter/Space fires `onActivateTask(task)`. Bars WITHOUT
 * `onActivateTask` remain inert. References docs/plans/2026-06-15-jtbd-remediation.md
 * W5-T22 and docs/plans/2026-06-16-gantt-v2-phase-a.md.
 *
 * Pure presentational — feeds buildGanttModel(tasks, milestones, today, config)
 * (pure) and paints absolute-px geometry. No hooks beyond local zoom state, no
 * network calls, no writes.
 *
 * Accessibility (NFR-GANTT-A11Y-001/002):
 *   - Wrapped in <figure role="img" aria-label={summary}> (the single role="img").
 *   - The left task table is a real role="grid" with roving tabindex + Arrow/Enter
 *     keyboard nav across rows; Enter/Space on a row fires onActivateTask.
 *   - Bars are role=button (when activatable) with a text aria-label that also names
 *     any dependency (so the relationship is never SVG-only).
 *   - Diamonds carry a text aria-label; the connector SVG is aria-hidden (decorative).
 *   - Bar status is always a text label (never color-only).
 *   - Respects prefers-reduced-motion (no bar-grow transition when set).
 */
import React, { useMemo, useRef, useState } from 'react';
import { ListState, StatusPill, Button, Icon, useIsNarrow } from '@/src/components/ui';
import { ViewToggle } from '@/src/components/ui/ViewToggle';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import {
  buildGanttModel,
  type GanttAxisTick,
  type GanttBar,
  type GanttBarBox,
  type GanttMarkerBox,
  type GanttScale,
} from '@/src/lib/gantt/ganttLayout';
import { edgePath, arrowHead } from '@/src/lib/gantt/ganttGeometry';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { workflowVariant } from '@/src/lib/status/statusVariants';

// Task-status pill comes from the single status registry (`workflowVariant`): In
// Progress = neutral grey `progress` (NOT the action-blue, per the Freed-Blue Status
// Rule). Same mapping as the Tasks tab — one source of truth.

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ProjectGanttProps {
  tasks: TaskWithRefs[];
  milestones: MilestoneWithProgress[];
  /**
   * Optional activation callback (T22 — spec override per owner directive).
   * When provided, each bar becomes a button and each table row is Enter-activatable,
   * firing this callback with the resolved TaskWithRefs. When omitted, bars/rows are inert.
   */
  onActivateTask?: (task: TaskWithRefs) => void;
  /**
   * Mobile fallback (defect D1): on viewports below the `sm` (640px) breakpoint the
   * cramped MS-Project split is replaced by a notice that points the user at a
   * better-fitting view. When provided, the notice's switch buttons fire this with
   * 'list' / 'board' (TasksTab wires it to its view state). When omitted the buttons
   * still render the notice but without a switch action (defensive — TasksTab always passes it).
   */
  onSwitchView?: (view: 'list' | 'board') => void;
}

// ── Layout geometry constants (not design tokens — like the v1 ROW_H) ─────────
// Bar block height is derived inside buildGanttModel (min(28, rowHeight-12)) and
// returned per-bar as box.h, so it is no longer a standalone const here.
const ROW_H = 40; // px — lane row height (bar + vertical padding)
const LANE_HEADER_H = 36; // px — milestone lane header height
const AXIS_H = 32; // px — time axis height
const TABLE_W = 260; // px — left task-table pane width

const SCALE_OPTIONS: { value: GanttScale; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

// ── Flattened row model (shared by the table + the timeline so they align) ─────

interface LaneHeaderRow {
  kind: 'lane';
  key: string;
  label: string;
  markerIso: string | null;
}
interface TaskRow {
  kind: 'task';
  key: string;
  bar: GanttBar;
  predecessorNames: string[];
}
type FlatRow = LaneHeaderRow | TaskRow;

// ── Main component ────────────────────────────────────────────────────────────

const ProjectGantt: React.FC<ProjectGanttProps> = ({ tasks, milestones, onActivateTask, onSwitchView }) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const isNarrow = useIsNarrow();
  const [scale, setScale] = useState<GanttScale>('month');

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const model = useMemo(
    () =>
      buildGanttModel(tasks, milestones, today, {
        scale,
        rowHeight: ROW_H,
        laneHeaderHeight: LANE_HEADER_H,
      }),
    [tasks, milestones, today, scale],
  );

  // Resolve bar.id → TaskWithRefs (used by onActivateTask) and id → name (deps).
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const nameById = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks]);

  // Flatten lanes → ordered rows (lane header + task rows), matching the geometry walk.
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const lane of model.lanes) {
      rows.push({
        kind: 'lane',
        key: `lane:${lane.milestoneId ?? '__ungrouped__'}`,
        label: lane.label,
        markerIso: lane.marker?.targetIso ?? null,
      });
      for (const bar of lane.bars) {
        const predecessorNames = (taskMap.get(bar.id)?.dependencies ?? [])
          .map((d) => nameById.get(d.depends_on_id))
          .filter((n): n is string => n != null);
        rows.push({ kind: 'task', key: `task:${bar.id}`, bar, predecessorNames });
      }
    }
    return rows;
  }, [model.lanes, taskMap, nameById]);

  const taskRowKeys = useMemo(
    () => flatRows.filter((r): r is TaskRow => r.kind === 'task').map((r) => r.key),
    [flatRows],
  );

  // Roving focus across the grid's task rows.
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const activeRowKey = focusedRowKey ?? taskRowKeys[0] ?? null;

  // Geometry-indexed lookups for the timeline pane.
  const barBoxById = useMemo(() => {
    const m = new Map<string, GanttBarBox>();
    model.geometry?.bars.forEach((b) => m.set(b.id, b));
    return m;
  }, [model.geometry]);

  const moveFocus = (delta: number, fromKey: string) => {
    const idx = taskRowKeys.indexOf(fromKey);
    if (idx === -1) return;
    const next = taskRowKeys[Math.min(taskRowKeys.length - 1, Math.max(0, idx + delta))];
    setFocusedRowKey(next);
    rowRefs.current.get(next)?.focus();
  };

  // Empty state: no dated work at all
  if (model.isEmpty || !model.geometry) {
    return (
      <ListState
        variant="empty"
        icon="cal"
        title="No dated work yet"
        sub="Add start/due dates to tasks or target dates to milestones to see the timeline."
      />
    );
  }

  // D1: on narrow viewports (<640px) the MS-Project split is unusable — the 260px
  // task table eats the width and leaves the timeline a sliver. When there IS dated
  // work to show, swap the cramped Gantt for a friendly notice pointing at List/Board.
  // (Empty state still wins above — an empty project shows the honest empty state.)
  if (isNarrow) {
    return <GanttMobileNotice onSwitchView={onSwitchView} />;
  }

  const { geometry, ticks, todayLeft, undated } = model;
  const tasksCount = barBoxById.size;
  const edgeCount = geometry.edges.length;
  const summary =
    `Task Gantt timeline: ${tasksCount} task${tasksCount !== 1 ? 's' : ''} across ` +
    `${milestones.length} milestone${milestones.length !== 1 ? 's' : ''}` +
    `${todayLeft != null ? `, today at ${Math.round(todayLeft * 100)}% of the span` : ''}` +
    `, ${edgeCount} dependency connector${edgeCount !== 1 ? 's' : ''} drawn` +
    `${geometry.hiddenEdgeCount > 0 ? `, ${geometry.hiddenEdgeCount} dependency(ies) hidden (endpoint undated)` : ''}` +
    `, scale: ${scale}.`;

  const activate = onActivateTask
    ? (id: string) => {
        const task = taskMap.get(id);
        if (task) onActivateTask(task);
      }
    : undefined;

  const { contentWidth, contentHeight } = geometry;

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Toolbar: caption + zoom toggle (D6) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-[12px] text-muted-foreground">
          {tasksCount} task{tasksCount !== 1 ? 's' : ''} on the timeline
        </span>
        <ViewToggle<GanttScale>
          options={SCALE_OPTIONS}
          value={scale}
          onChange={setScale}
          ariaLabel="Timeline zoom"
        />
      </div>

      <figure
        role="img"
        aria-label={summary}
        data-scale={scale}
        className="m-0"
      >
        {/*
          ONE scroll unit (2026-06-17): a single `overflow-auto` box scrolls BOTH
          axes. The task column is frozen via per-cell `sticky left-0` and the
          axis/header via `sticky top-0`, so the table and the bars can never
          desync — they live in the same scroll box. The OLD structure used a
          left sticky-block inside `overflow-y-auto` + a right pane with its OWN
          `overflow-x-auto`, which produced two independent scroll contexts that
          desynced vertically once the task list exceeded the height cap.

          z-layering (high → low): corner (40) > sticky column cells (30) >
          axis/header band (20) > bars/gridlines (default). The sticky cells carry
          an opaque `bg-card`/`bg-secondary` so bars scroll UNDER them, not through.
        */}
        <div data-gantt-scroll className="flex max-h-[60vh] overflow-auto">
          {/* Left column — the task TABLE (role=grid). Frozen on horizontal scroll
              via sticky left-0; its own header cell freezes on vertical scroll. */}
          <div
            role="grid"
            aria-label="Task table"
            aria-rowcount={flatRows.length}
            className="sticky left-0 z-30 shrink-0 border-r border-border bg-card"
            style={{ width: TABLE_W }}
          >
            {/* Corner header cell ("Task") — frozen in BOTH directions (top-0 + the
                column's own sticky left-0), highest z so nothing scrolls over it. */}
            <div
              role="row"
              className="sticky top-0 z-40 flex items-center border-b border-border bg-card px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ height: AXIS_H }}
            >
              <span role="columnheader" className="flex-1">Task</span>
            </div>

            {flatRows.map((row) =>
              row.kind === 'lane' ? (
                <div
                  key={row.key}
                  role="row"
                  data-row-kind="lane"
                  className="flex items-center gap-2 border-b border-border/70 bg-secondary/30 px-3 text-[12px] font-semibold text-muted-foreground"
                  style={{ height: LANE_HEADER_H }}
                >
                  <span role="gridcell" className="truncate">{row.label}</span>
                </div>
              ) : (
                <TaskTableRow
                  key={row.key}
                  row={row}
                  rovingActive={row.key === activeRowKey}
                  activatable={!!activate}
                  setRef={(el) => rowRefs.current.set(row.key, el)}
                  onFocus={() => setFocusedRowKey(row.key)}
                  onArrow={(delta) => moveFocus(delta, row.key)}
                  onActivate={activate ? () => activate(row.bar.id) : undefined}
                />
              ),
            )}
          </div>

          {/* Right column — the timeline (axis frozen on vertical scroll via
              sticky top-0; content box uses absolute-px geometry, math unchanged). */}
          <div className="shrink-0" style={{ width: contentWidth + 32, padding: '0 16px' }}>
            {/* Axis — frozen on vertical scroll. Opaque bg so bars pass under it. */}
            <div className="sticky top-0 z-20 bg-card">
              <GanttAxis ticks={ticks} todayLeft={todayLeft} contentWidth={contentWidth} />
            </div>

            {/* Content box: SVG overlay (gridlines + edges) under the bars/diamonds. */}
            <div className="relative" style={{ width: contentWidth, height: contentHeight }}>
                <svg
                  aria-hidden="true"
                  width={contentWidth}
                  height={contentHeight}
                  className="pointer-events-none absolute inset-0"
                >
                  {/* Vertical gridlines at each tick */}
                  {ticks.map((t) => (
                    <line
                      key={`grid-${t.iso}`}
                      x1={t.left * contentWidth}
                      x2={t.left * contentWidth}
                      y1={0}
                      y2={contentHeight}
                      stroke="hsl(var(--border))"
                      strokeWidth={1}
                    />
                  ))}
                  {/* Today line */}
                  {todayLeft != null && (
                    <line
                      x1={todayLeft * contentWidth}
                      x2={todayLeft * contentWidth}
                      y1={0}
                      y2={contentHeight}
                      stroke="hsl(var(--primary))"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                  )}
                  {/* Dependency connectors (structural — muted-foreground, NOT action-blue) */}
                  {geometry.edges.map((e) => (
                    <g key={e.id}>
                      <path
                        d={edgePath(e)}
                        fill="none"
                        stroke="hsl(var(--muted-foreground) / 0.55)"
                        strokeWidth={1.25}
                      />
                      <polygon
                        points={arrowHead(e)}
                        fill="hsl(var(--muted-foreground) / 0.55)"
                      />
                    </g>
                  ))}
                </svg>

                {/* Milestone diamonds + vertical dotted guides (D4) */}
                {geometry.markers.map((mk) => (
                  <MilestoneDiamond
                    key={`marker-${mk.id}`}
                    marker={mk}
                    name={markerName(model.lanes, mk.id)}
                    targetIso={markerIso(model.lanes, mk.id)}
                    contentHeight={contentHeight}
                  />
                ))}

                {/* Bars */}
                {flatRows.map((row) => {
                  if (row.kind !== 'task') return null;
                  const box = barBoxById.get(row.bar.id);
                  if (!box) return null;
                  return (
                    <GanttBarBlock
                      key={`bar-${row.bar.id}`}
                      bar={row.bar}
                      box={box}
                      predecessorNames={row.predecessorNames}
                      prefersReducedMotion={prefersReducedMotion}
                      onActivate={activate ? () => activate(row.bar.id) : undefined}
                    />
                  );
                })}
            </div>
          </div>
        </div>

        {/* Undated footer (AC-GANTT-005) */}
        {undated.length > 0 && (
          <UndatedFooter
            undated={undated}
            onActivateTask={activate ? (id) => activate(id) : undefined}
          />
        )}
      </figure>
    </div>
  );
};

// ── Mobile fallback notice (D1) ───────────────────────────────────────────────
//
// On viewports <640px the MS-Project split is unusable, so the Timeline swaps it
// for this centered notice that points the user at List/Board. Tokens only: it
// mirrors the ListState empty-state treatment (icon chip + centered heading +
// muted sub-line + actions) so the two states read as one family.

interface GanttMobileNoticeProps {
  onSwitchView?: (view: 'list' | 'board') => void;
}

const GanttMobileNotice: React.FC<GanttMobileNoticeProps> = ({ onSwitchView }) => (
  <div
    data-testid="gantt-mobile-notice"
    className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-14 text-center"
  >
    <span className="grid size-[52px] place-items-center rounded-[14px] bg-secondary text-muted-foreground">
      <Icon name="cal" className="size-6" strokeWidth={1.75} />
    </span>
    <h3 className="text-[15px] font-semibold">Open on a larger screen</h3>
    <div className="max-w-[44ch] text-[13px] text-muted-foreground">
      The timeline is best viewed on a wider screen. Switch to a view that fits your device:
    </div>
    <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
      <Button variant="outline" size="sm" onClick={() => onSwitchView?.('list')}>
        List view
      </Button>
      <Button variant="outline" size="sm" onClick={() => onSwitchView?.('board')}>
        Board view
      </Button>
    </div>
  </div>
);

// ── Helpers to resolve marker name/iso from lanes ─────────────────────────────

function markerName(lanes: GanttBarLanes, id: string): string {
  for (const l of lanes) if (l.marker?.id === id) return l.marker.name;
  return '';
}
function markerIso(lanes: GanttBarLanes, id: string): string {
  for (const l of lanes) if (l.marker?.id === id) return l.marker.targetIso;
  return '';
}
type GanttBarLanes = ReturnType<typeof buildGanttModel>['lanes'];

// ── Axis ──────────────────────────────────────────────────────────────────────

interface GanttAxisProps {
  ticks: GanttAxisTick[];
  todayLeft: number | null;
  contentWidth: number;
}

const GanttAxis: React.FC<GanttAxisProps> = ({ ticks, todayLeft, contentWidth }) => (
  <div
    className="relative border-b border-border"
    style={{ height: AXIS_H, width: contentWidth }}
    aria-hidden="true"
  >
    {ticks.map((tick) =>
      tick.showLabel ? (
        <span
          key={tick.iso}
          className="absolute top-0 translate-y-1/4 whitespace-nowrap text-[11px] text-muted-foreground"
          style={{ left: tick.left * contentWidth }}
        >
          {tick.label}
        </span>
      ) : null,
    )}
    {todayLeft != null && (
      <span
        className="absolute bottom-0 text-[10px] font-semibold text-primary"
        style={{ left: todayLeft * contentWidth, transform: 'translateX(-50%)' }}
      >
        Today
      </span>
    )}
  </div>
);

// ── Milestone diamond (on the axis — D4) ──────────────────────────────────────

interface MilestoneDiamondProps {
  marker: GanttMarkerBox;
  name: string;
  targetIso: string;
  contentHeight: number;
}

const MilestoneDiamond: React.FC<MilestoneDiamondProps> = ({
  marker,
  name,
  targetIso,
  contentHeight,
}) => (
  <>
    {/* Vertical dotted guide from the diamond through the lane band */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: marker.x,
        top: marker.y,
        height: Math.max(0, contentHeight - marker.y),
        borderLeft: '1px dashed hsl(var(--violet) / 0.3)',
      }}
    />
    {/* The diamond glyph (rotated square) — labelled, no role (keeps role="img" singular) */}
    <span
      aria-label={`${name} milestone — target ${targetIso}`}
      title={`${name} — target ${targetIso}`}
      className="absolute"
      style={{
        left: marker.x,
        top: marker.y,
        width: 10,
        height: 10,
        transform: 'translate(-50%, -50%) rotate(45deg)',
        background: 'hsl(var(--violet))',
        borderRadius: 2,
      }}
    />
  </>
);

// ── Bar block (absolute-positioned via geometry) ──────────────────────────────

interface GanttBarBlockProps {
  bar: GanttBar;
  box: GanttBarBox;
  predecessorNames: string[];
  prefersReducedMotion: boolean;
  onActivate?: () => void;
}

const GanttBarBlock: React.FC<GanttBarBlockProps> = ({
  bar,
  box,
  predecessorNames,
  prefersReducedMotion,
  onActivate,
}) => {
  const isPoint = bar.kind === 'point';
  const depsSuffix =
    predecessorNames.length > 0 ? `, depends on ${predecessorNames.join(', ')}` : '';
  const datesPart = `${bar.startIso ?? ''}${bar.startIso && bar.endIso ? '–' : ''}${bar.endIso ?? ''}`;
  // Accessible name: keep the task name FIRST so getByRole('button', {name}) matches it.
  const label = `${bar.name}: ${bar.status}${datesPart ? `, ${datesPart}` : ''}${depsSuffix}`;

  const handleKeyDown = onActivate
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }
    : undefined;

  const width = Math.max(0, box.xEnd - box.xStart);
  /** A3: suppress the in-bar label when the bar is too narrow to show text legibly. */
  const showInBarLabel = width >= 40;

  if (isPoint) {
    return (
      <span
        role={onActivate ? 'button' : undefined}
        tabIndex={onActivate ? 0 : undefined}
        aria-label={label}
        onClick={onActivate}
        onKeyDown={handleKeyDown}
        title={label}
        className={`absolute -translate-x-1/2 -translate-y-1/2 text-[14px] text-violet${onActivate ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring' : ''}`}
        style={{ left: box.xStart, top: box.y + box.h / 2 }}
      >
        ◆
      </span>
    );
  }

  return (
    <div
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? label : undefined}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      title={label}
      className={`absolute flex items-center overflow-hidden rounded px-2${onActivate ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring' : ''}`}
      style={{
        left: box.xStart,
        width,
        top: box.y,
        height: box.h,
        background: 'hsl(var(--secondary) / 0.78)',
        border: '1px solid hsl(var(--border))',
        boxShadow: 'inset 3px 0 0 hsl(var(--violet))',
        transition: prefersReducedMotion ? 'none' : 'opacity 150ms ease',
      }}
    >
      {showInBarLabel && (
        <span className="truncate text-[11.5px] font-semibold leading-none text-foreground">
          {bar.name}
        </span>
      )}
    </div>
  );
};

// ── Task table row (role=row, roving tabindex, Arrow/Enter — D7) ──────────────

interface TaskTableRowProps {
  row: TaskRow;
  rovingActive: boolean;
  activatable: boolean;
  setRef: (el: HTMLDivElement | null) => void;
  onFocus: () => void;
  onArrow: (delta: number) => void;
  onActivate?: () => void;
}

/** B1: convert ISO date (YYYY-MM-DD) to compact human format ("Jan 1"). */
function formatCompactDate(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}

const TaskTableRow: React.FC<TaskTableRowProps> = ({
  row,
  rovingActive,
  activatable,
  setRef,
  onFocus,
  onArrow,
  onActivate,
}) => {
  const { bar } = row;
  // B1: use compact human dates ("Jan 1 – Jan 11") to prevent date string from
  // dominating the 260px table pane and starving the name column.
  const startFmt = formatCompactDate(bar.startIso);
  const endFmt = formatCompactDate(bar.endIso);
  const dates =
    startFmt || endFmt
      ? `${startFmt ?? '—'} – ${endFmt ?? '—'}`
      : '—';

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div
      ref={setRef}
      role="row"
      data-row-kind="task"
      tabIndex={activatable ? (rovingActive ? 0 : -1) : undefined}
      onFocus={onFocus}
      onKeyDown={activatable ? handleKeyDown : undefined}
      className={`flex items-center gap-2 border-b border-border/70 px-3${activatable ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring hover:bg-secondary/30' : ''}`}
      style={{ height: ROW_H }}
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
        className="hidden shrink-0 whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground sm:block"
      >
        {dates}
      </span>
    </div>
  );
};

// ── Undated footer (AC-GANTT-005) ─────────────────────────────────────────────

interface UndatedFooterProps {
  undated: { id: string; name: string }[];
  onActivateTask?: (id: string) => void;
}

const UndatedFooter: React.FC<UndatedFooterProps> = ({ undated, onActivateTask }) => (
  <div className="border-t border-border px-4 py-3">
    <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
      Undated ({undated.length})
    </div>
    <ul className="flex flex-wrap gap-2">
      {undated.map((u) => (
        <li
          key={u.id}
          role={onActivateTask ? 'button' : undefined}
          tabIndex={onActivateTask ? 0 : undefined}
          aria-label={onActivateTask ? `Open ${u.name}` : undefined}
          onClick={onActivateTask ? () => onActivateTask(u.id) : undefined}
          onKeyDown={
            onActivateTask
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onActivateTask(u.id);
                  }
                }
              : undefined
          }
          className={`rounded border border-border bg-secondary/40 px-2 py-0.5 text-[12px] text-muted-foreground${onActivateTask ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring hover:bg-secondary/60' : ''}`}
        >
          {u.name}
        </li>
      ))}
    </ul>
  </div>
);

export default ProjectGantt;
