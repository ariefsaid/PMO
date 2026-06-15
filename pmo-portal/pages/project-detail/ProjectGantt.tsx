/**
 * Task Gantt timeline (FR-GANTT-001..008).
 *
 * SPEC OVERRIDE (owner directive, 2026-06-15): the prior spec marked this Gantt
 * read-only by design. The owner explicitly directs making bars activatable so a
 * click/keyboard-Enter/Space fires `onActivateTask(task)`. Bars WITHOUT
 * `onActivateTask` remain inert (no button role, no cursor-pointer). This override
 * is recorded in the build commit body and references
 * docs/plans/2026-06-15-jtbd-remediation.md W5-T22.
 *
 * Pure presentational component — feeds buildGanttModel(tasks, milestones, today)
 * and maps fraction→% to paint bars. No hooks, no network calls, no writes.
 *
 * Accessibility (NFR-GANTT-A11Y-001):
 *   - Wrapped in <figure role="img" aria-label=…> (mirrors ProjectSCurve).
 *   - Bar status is always a text label (never color-only).
 *   - Today line is aria-hidden (decorative) with a visible "Today" caption.
 *   - Respects prefers-reduced-motion (no bar-grow animation when set).
 *   - When onActivateTask is provided, bars gain role=button + tabIndex=0 +
 *     focus-visible ring + cursor-pointer (keyboard accessible).
 *
 * Mobile (NFR-GANTT-RESP-001):
 *   - Outer wrapper: max-w-full overflow-hidden (no page overflow).
 *   - Inner scroll region: overflow-x-auto with scroll-fade.
 *   - Min-width 640px on the canvas so bars never crush.
 */
import React, { useMemo } from 'react';
import { ListState } from '@/src/components/ui';
import { StatusPill } from '@/src/components/ui';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import {
  buildGanttModel,
  type GanttBar,
  type GanttLane,
} from '@/src/lib/gantt/ganttLayout';
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
   * When provided, each bar/diamond becomes a button (role=button, tabIndex=0,
   * focus-visible ring, cursor-pointer) that fires this callback with the resolved
   * TaskWithRefs on click/Enter/Space. When omitted, bars remain inert.
   */
  onActivateTask?: (task: TaskWithRefs) => void;
}

// ── Bar height / row height tokens ────────────────────────────────────────────
const BAR_H = 28; // px — bar block height
const ROW_H = 40; // px — lane row height (bar + vertical padding)
const LANE_HEADER_H = 36; // px — milestone lane header height
const AXIS_H = 32; // px — time axis height

// ── Main component ────────────────────────────────────────────────────────────

const ProjectGantt: React.FC<ProjectGanttProps> = ({ tasks, milestones, onActivateTask }) => {
  const prefersReducedMotion = usePrefersReducedMotion();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const model = useMemo(
    () => buildGanttModel(tasks, milestones, today),
    [tasks, milestones, today],
  );

  // Build a lookup map for resolving bar.id → TaskWithRefs (used by onActivateTask).
  const taskMap = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  // Empty state: no dated work at all
  if (model.isEmpty) {
    return (
      <ListState
        variant="empty"
        icon="cal"
        title="No dated work yet"
        sub="Add start/due dates to tasks or target dates to milestones to see the timeline."
      />
    );
  }

  const { lanes, todayLeft, ticks, undated } = model;
  const tasksCount = lanes.reduce((n, l) => n + l.bars.length, 0);
  const summary = `Task Gantt timeline: ${tasksCount} task${tasksCount !== 1 ? 's' : ''} across ${milestones.length} milestone${milestones.length !== 1 ? 's' : ''}${todayLeft != null ? `, today at ${Math.round(todayLeft * 100)}% of the span` : ''}.`;

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Contained scroll wrapper (NFR-GANTT-RESP-001) */}
      <div className="max-w-full overflow-hidden">
        <div
          className="overflow-x-auto"
          style={{
            // Scroll-fade at right edge using mask-image
            WebkitMaskImage:
              'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
            maskImage:
              'linear-gradient(to right, black calc(100% - 24px), transparent 100%)',
          }}
        >
          <figure
            role="img"
            aria-label={summary}
            className="m-0"
            style={{ minWidth: 640, padding: '0 16px 16px' }}
          >
            {/* Time axis */}
            <GanttAxis
              ticks={ticks}
              todayLeft={todayLeft}
              axisHeight={AXIS_H}
            />

            {/* Lane rows */}
            <div className="relative">
              {lanes.map((lane) => (
                <GanttLaneRow
                  key={lane.milestoneId ?? '__ungrouped__'}
                  lane={lane}
                  prefersReducedMotion={prefersReducedMotion}
                  onActivate={onActivateTask ? (bar) => {
                    const task = taskMap.get(bar.id);
                    if (task) onActivateTask(task);
                  } : undefined}
                />
              ))}
            </div>

            {/* Undated footer (AC-GANTT-005) */}
            {/* C-PD-1: thread onActivateTask so undated chips are activatable (mirror bars). */}
            {undated.length > 0 && (
              <UndatedFooter
                undated={undated}
                onActivateTask={onActivateTask ? (id) => {
                  const task = taskMap.get(id);
                  if (task) onActivateTask(task);
                } : undefined}
              />
            )}
          </figure>
        </div>
      </div>
    </div>
  );
};

// ── Axis ──────────────────────────────────────────────────────────────────────

interface GanttAxisProps {
  ticks: { iso: string; left: number; label: string }[];
  todayLeft: number | null;
  axisHeight: number;
}

const GanttAxis: React.FC<GanttAxisProps> = ({ ticks, todayLeft, axisHeight }) => (
  <div
    className="relative border-b border-border"
    style={{ height: axisHeight }}
    aria-hidden="true"
  >
    {/* Month ticks */}
    {ticks.map((tick) => (
      <span
        key={tick.iso}
        className="absolute top-0 translate-y-1/4 text-[11px] text-muted-foreground"
        style={{ left: `${tick.left * 100}%` }}
      >
        {tick.label}
      </span>
    ))}

    {/* Today indicator on axis */}
    {todayLeft != null && (
      <span
        className="absolute bottom-0 text-[10px] font-semibold text-primary"
        style={{ left: `${todayLeft * 100}%`, transform: 'translateX(-50%)' }}
      >
        Today
      </span>
    )}
  </div>
);

// ── Lane row ──────────────────────────────────────────────────────────────────

interface GanttLaneRowProps {
  lane: GanttLane;
  prefersReducedMotion: boolean;
  /** When provided, each bar is activatable (see GanttBarRowProps.onActivate). */
  onActivate?: (bar: GanttBar) => void;
}

const GanttLaneRow: React.FC<GanttLaneRowProps> = ({ lane, prefersReducedMotion, onActivate }) => (
  <section aria-label={lane.label} className="mb-1">
    {/* Lane header */}
    <div
      className="flex items-center gap-2 px-2 text-[12px] font-semibold text-muted-foreground"
      style={{ height: LANE_HEADER_H }}
    >
      <span>{lane.label}</span>
      {lane.marker && (
        <span
          className="ml-auto text-[11px] text-primary"
          title={`Target: ${lane.marker.targetIso}`}
        >
          ⬥ {lane.marker.targetIso}
        </span>
      )}
    </div>

    {/* Bar rows */}
    {lane.bars.length === 0 ? (
      <div
        className="px-2 text-[12px] text-muted-foreground"
        style={{ height: ROW_H, display: 'flex', alignItems: 'center' }}
      >
        No tasks in this group.
      </div>
    ) : (
      <div>
        {lane.bars.map((bar) => (
          <GanttBarRow
            key={bar.id}
            bar={bar}
            prefersReducedMotion={prefersReducedMotion}
            onActivate={onActivate ? () => onActivate(bar) : undefined}
          />
        ))}
      </div>
    )}
  </section>
);

// ── Individual bar ────────────────────────────────────────────────────────────

interface GanttBarRowProps {
  bar: GanttBar;
  prefersReducedMotion: boolean;
  /**
   * Optional activation callback (T22 — spec override per owner directive).
   * When provided, bar/diamond gains role=button + tabIndex=0 + keyboard support
   * (Enter/Space) + focus-visible ring + cursor-pointer. When omitted, inert.
   */
  onActivate?: () => void;
}

const GanttBarRow: React.FC<GanttBarRowProps> = ({ bar, prefersReducedMotion, onActivate }) => {
  const isPoint = bar.kind === 'point';

  const handleKeyDown = onActivate
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }
    : undefined;

  return (
    <div
      className="relative"
      style={{ height: ROW_H }}
      title={`${bar.name} — ${bar.status}${bar.startIso ? ` | Start: ${bar.startIso}` : ''}${bar.endIso ? ` | End: ${bar.endIso}` : ''}`}
    >
      {isPoint ? (
        /* Diamond marker for one-sided date (D5) */
        <span
          role={onActivate ? 'button' : undefined}
          tabIndex={onActivate ? 0 : undefined}
          aria-label={`${bar.name}: ${bar.status} (${bar.startIso ? 'start only' : 'due only'})`}
          onClick={onActivate}
          onKeyDown={handleKeyDown}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[14px] text-primary${onActivate ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring' : ''}`}
          style={{ left: `${bar.left * 100}%` }}
        >
          ◆
          <span className="sr-only">{bar.name}</span>
          <span className="sr-only">{bar.status}</span>
        </span>
      ) : (
        /* Bar block */
        <div
          role={onActivate ? 'button' : undefined}
          tabIndex={onActivate ? 0 : undefined}
          aria-label={onActivate ? `${bar.name}` : undefined}
          onClick={onActivate}
          onKeyDown={handleKeyDown}
          className={`absolute top-1/2 -translate-y-1/2 flex items-center overflow-hidden rounded px-2${onActivate ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring' : ''}`}
          style={{
            left: `${bar.left * 100}%`,
            // Belt-and-suspenders: bar.width is already clamped to [0,1] by clamp01 in
            // ganttLayout (reversed end<start ranges resolve to 0); guard the CSS width too.
            width: `${Math.max(0, bar.width) * 100}%`,
            height: BAR_H,
            // Use token-aligned bg (primary/15 analogous to the s-curve's primary)
            background: 'hsl(var(--primary) / 0.15)',
            border: '1px solid hsl(var(--primary) / 0.35)',
            // Respect prefers-reduced-motion: skip transition
            transition: prefersReducedMotion ? 'none' : 'opacity 150ms ease',
          }}
        >
          <span className="truncate text-[11.5px] font-semibold leading-none text-foreground">
            {bar.name}
          </span>
          <span className="ml-1.5 shrink-0">
            <StatusPill variant={workflowVariant(bar.status)}>
              {bar.status}
            </StatusPill>
          </span>
          {bar.dependsOnCount > 0 && (
            <span
              className="ml-1.5 shrink-0 rounded border border-border bg-background px-1 text-[10.5px] text-muted-foreground"
              title={`Depends on ${bar.dependsOnCount} task${bar.dependsOnCount !== 1 ? 's' : ''}`}
            >
              depends on {bar.dependsOnCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ── Undated footer (AC-GANTT-005) ─────────────────────────────────────────────

interface UndatedFooterProps {
  undated: { id: string; name: string }[];
  /**
   * C-PD-1 fix: when provided, each undated chip becomes role=button/keyboard/focus-ring
   * activatable (mirrors GanttBarRow). Resolves bar.id→TaskWithRefs via taskMap and fires
   * onActivateTask(task). Inert when callback is omitted.
   */
  onActivateTask?: (id: string) => void;
}

const UndatedFooter: React.FC<UndatedFooterProps> = ({ undated, onActivateTask }) => (
  <div className="mt-4 border-t border-border pt-3">
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
