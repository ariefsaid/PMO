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
 * Composition (XG03-003): this file is the VIEW owner — the single scroll container,
 * the toolbar, the mobile notice and the undated footer — composing the two extracted
 * panes, GanttTaskTable (role=grid table + roving focus) and GanttTimeline (axis +
 * connector SVG + diamonds + bars). The shared flattened rows (src/lib/gantt/ganttRows.ts)
 * and the model's geometry are the seam: no second scroll owner, no independent
 * row-height source.
 *
 * Accessibility (NFR-GANTT-A11Y-001/002):
 *   - Wrapped in a labelled <figure>; interactive descendants stay independently reachable.
 *   - The left task table is a real role="grid" with roving tabindex + Arrow/Enter
 *     keyboard nav across rows; Enter/Space on a row fires onActivateTask.
 *   - Bars are role=button (when activatable) with a text aria-label that also names
 *     any dependency (so the relationship is never SVG-only).
 *   - Diamonds carry a text aria-label; the connector SVG is aria-hidden (decorative).
 *   - Bar status is always a text label (never color-only).
 *   - Respects prefers-reduced-motion (no bar-grow transition when set).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, Button, useIsNarrow, type RowMenuItem } from '@/src/components/ui';
import { ViewToggle } from '@/src/components/ui/ViewToggle';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { buildGanttModel, type GanttScale } from '@/src/lib/gantt/ganttLayout';
import {
  flattenGanttRows,
  GANTT_LANE_HEADER_H,
  GANTT_ROW_H,
  GANTT_TABLE_W,
} from '@/src/lib/gantt/ganttRows';
import GanttTaskTable from './GanttTaskTable';
import GanttTimeline from './GanttTimeline';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ProjectGanttProps {
  tasks: TaskWithRefs[];
  milestones: MilestoneWithProgress[];
  /**
   * Optional activation callback (T22 — spec override per owner directive).
   * When provided, each bar becomes a button and each table row is Enter-activatable,
   * firing this callback with the resolved TaskWithRefs. When omitted, bars/rows are inert.
   */
  onActivateTask?: (task: TaskWithRefs) => void;
  /** Optional per-task actions surfaced on each row in the task pane. */
  rowMenu?: (task: TaskWithRefs) => RowMenuItem[];
  /**
   * Mobile fallback (defect D1): on viewports below the `sm` (640px) breakpoint the
   * cramped MS-Project split is replaced by a notice that points the user at a
   * better-fitting view. The notice's switch buttons fire this with 'list' / 'board'
   * (TasksTab wires it to its view state). Required — OE07-002: the sole production
   * caller always supplies it, and an inert switch button is a defect, not a mode.
   */
  onSwitchView: (view: 'list' | 'board') => void;
}

// ── Main component ────────────────────────────────────────────────────────────

const ProjectGantt: React.FC<ProjectGanttProps> = ({ tasks, milestones, onActivateTask, rowMenu, onSwitchView }) => {
  const { t } = useTranslation('project');
  const isNarrow = useIsNarrow();
  const [scale, setScale] = useState<GanttScale>('month');
  const [scrollport, setScrollport] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ scrollLeft: 0, viewportWidth: 1 });

  useEffect(() => {
    if (!scrollport) return;
    const update = () => {
      const next = {
        scrollLeft: Math.max(0, scrollport.scrollLeft - 16),
        viewportWidth: Math.max(1, scrollport.clientWidth - GANTT_TABLE_W),
      };
      setViewport((old) => old.scrollLeft === next.scrollLeft && old.viewportWidth === next.viewportWidth ? old : next);
    };
    update();
    scrollport.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scrollport);
    window.addEventListener('resize', update);
    return () => {
      scrollport.removeEventListener('scroll', update);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [scrollport]);

  const today = useOrgToday();

  const scaleOptions = useMemo(
    () => [
      { value: 'day' as GanttScale, label: t('projectDetail.gantt.scale.day', 'Day') },
      { value: 'week' as GanttScale, label: t('projectDetail.gantt.scale.week', 'Week') },
      { value: 'month' as GanttScale, label: t('projectDetail.gantt.scale.month', 'Month') },
      { value: 'quarter' as GanttScale, label: t('projectDetail.gantt.scale.quarter', 'Quarter') },
    ],
    [t],
  );

  const model = useMemo(
    () =>
      buildGanttModel(tasks, milestones, today, {
        scale,
        rowHeight: GANTT_ROW_H,
        laneHeaderHeight: GANTT_LANE_HEADER_H,
        viewport,
      }),
    [tasks, milestones, today, scale, viewport],
  );

  // Resolve bar.id → TaskWithRefs (used by onActivateTask / rowMenu).
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // ONE flattening shared by the table and the timeline (the row seam).
  const flatRows = useMemo(() => flattenGanttRows(model.lanes, tasks), [model.lanes, tasks]);

  // Empty state: no dated work at all
  if (model.isEmpty || !model.geometry) {
    return (
      <ListState
        variant="empty"
        icon="cal"
        title={t('projectDetail.gantt.emptyTitle', 'No dated work yet')}
        sub={t(
          'projectDetail.gantt.emptySub',
          'Add start/due dates to tasks or target dates to phases to see the timeline.',
        )}
      />
    );
  }

  // D1: on narrow viewports (<640px) the MS-Project split is unusable — the task
  // table eats the width and leaves the timeline a sliver. When there IS dated
  // work to show, swap the cramped Gantt for a friendly notice pointing at List/Board.
  // (Empty state still wins above — an empty project shows the honest empty state.)
  if (isNarrow) {
    return <GanttMobileNotice onSwitchView={onSwitchView} />;
  }

  const { geometry, ticks, todayLeft, undated } = model;
  const tasksCount = geometry.bars.length;
  const edgeCount = geometry.edges.length;
  // ⚑ The note that used to sit here said plurals could not be translated because an
  // `Intl.PluralRules` helper "does not exist yet". Nothing needed to be built: i18next resolves
  // `_one`/`_other` THROUGH `Intl.PluralRules` itself, so DD-I18N-1's requirement is met by the
  // library the same ruling already chose. Verified against i18next 25 rather than assumed, and
  // Bahasa collapses both forms to one, which is what DD-I18N-1 leans on (#575).
  //
  // ⚑ This is the SCREEN-READER summary. Leaving it English while the visible text is translated
  // gives a sighted Indonesian user a translated screen and a screen-reader user an English one —
  // the gate never flagged it, because it checks JSX text and this is a template literal.
  // ⚑ i18next binds ONE `count` per key, and this sentence has four independent counts plus two
  // conditional clauses — so it cannot be one key in the chosen library. Each t() returns a
  // COMPLETE, independently orderable clause; that is what keeps this from being #571's
  // fragment-glue, where a value could not move relative to its words.
  //
  // ⚑ The ", " separator is joined HERE, not carried in the catalogue values. Translation tooling
  // trims leading punctuation as a matter of course, and a trimmed ", " welds two clauses into
  // "1 milestone1 konektor" with every gate still green.
  const summaryClauses = [
    t('projectDetail.gantt.summary.head', 'Task Gantt timeline: {{tasks}} across {{phases}}', {
      tasks: t('projectDetail.gantt.summary.tasks', {
        count: tasksCount,
        defaultValue_one: '{{count}} task',
        defaultValue_other: '{{count}} tasks',
      }),
      phases: t('projectDetail.gantt.summary.milestones', {
        count: milestones.length,
        defaultValue_one: '{{count}} phase',
        defaultValue_other: '{{count}} phases',
      }),
    }),
    todayLeft != null
      ? t('projectDetail.gantt.summary.today', 'today at {{pct}}% of the span', {
          pct: Math.round(todayLeft * 100),
        })
      : null,
    t('projectDetail.gantt.summary.connectors', {
      count: edgeCount,
      defaultValue_one: '{{count}} dependency connector drawn',
      defaultValue_other: '{{count}} dependency connectors drawn',
    }),
    geometry.hiddenEdgeCount > 0
      ? t('projectDetail.gantt.summary.hidden', {
          count: geometry.hiddenEdgeCount,
          defaultValue_one: '{{count}} dependency hidden (endpoint undated)',
          defaultValue_other: '{{count}} dependencies hidden (endpoint undated)',
        })
      : null,
    // ⚑ The scale's LABEL, not the raw `GanttScale` enum. The visible toggle already reads
    // "Bulan"; interpolating `scale` put "skala: month" in the Indonesian sentence — the same
    // untranslated-enum defect this change exists to fix, left inside the string it rewrote.
    t('projectDetail.gantt.summary.scale', 'scale: {{scale}}', {
      scale: scaleOptions.find((o) => o.value === scale)?.label ?? scale,
    }),
  ].filter(Boolean);
  const summary = `${summaryClauses.join(', ')}.`;

  const activate = onActivateTask
    ? (id: string) => {
        const task = taskMap.get(id);
        if (task) onActivateTask(task);
      }
    : undefined;

  return (
    <div className="min-w-0">
      {/* Toolbar: caption + zoom toggle (D6) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-[12px] text-muted-foreground">
          {t('projectDetail.gantt.tasksOnTimeline', {
            count: tasksCount,
            defaultValue_one: '{{count}} task on the timeline',
            defaultValue_other: '{{count}} tasks on the timeline',
          })}
        </span>
        <ViewToggle<GanttScale>
          options={scaleOptions}
          value={scale}
          onChange={setScale}
          ariaLabel={t('projectDetail.gantt.zoomAriaLabel', 'Timeline zoom')}
        />
      </div>

      <figure
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
        <div ref={setScrollport} data-gantt-scroll className="flex max-h-[60vh] overflow-auto">
          {/* Left column — the task TABLE (role=grid), with its roving focus. */}
          <GanttTaskTable
            rows={flatRows}
            tasksById={taskMap}
            activatable={!!activate}
            onRowActivate={activate}
            rowMenu={rowMenu}
          />

          {/* Right column — the timeline (axis frozen on vertical scroll via
              sticky top-0; content box uses absolute-px geometry, math unchanged). */}
          <GanttTimeline
            lanes={model.lanes}
            geometry={geometry}
            ticks={ticks}
            todayLeft={todayLeft}
            rows={flatRows}
            edges={geometry.edges}
            onBarActivate={activate}
          />
        </div>

        {/* Undated footer (AC-GANTT-005) */}
        {undated.length > 0 && (
          <UndatedFooter
            undated={undated}
            onActivateTask={activate}
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
  onSwitchView: (view: 'list' | 'board') => void;
}

const GanttMobileNotice: React.FC<GanttMobileNoticeProps> = ({ onSwitchView }) => {
  const { t } = useTranslation('project');
  return (
  <div
    data-testid="gantt-mobile-notice"
    className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center"
  >
    <h3 className="text-[15px] font-semibold">
      {t('projectDetail.gantt.mobileTitle', 'Open on a larger screen')}
    </h3>
    <div className="max-w-[44ch] text-[13px] text-muted-foreground">
      {t(
        'projectDetail.gantt.mobileSub',
        'The timeline is best viewed on a wider screen. Switch to a view that fits your device:',
      )}
    </div>
    <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
      <Button variant="outline" size="sm" onClick={() => onSwitchView('list')}>
        {t('projectDetail.gantt.listView', 'List view')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => onSwitchView('board')}>
        {t('projectDetail.gantt.boardView', 'Board view')}
      </Button>
    </div>
  </div>
  );
};

// ── Undated footer (AC-GANTT-005) ─────────────────────────────────────────────

interface UndatedFooterProps {
  undated: { id: string; name: string }[];
  onActivateTask?: (id: string) => void;
}

const UndatedFooter: React.FC<UndatedFooterProps> = ({ undated, onActivateTask }) => {
  const { t } = useTranslation('project');
  return (
  <div className="border-t border-border px-4 py-3">
    <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
      {`${t('projectDetail.gantt.undated', 'Undated')} (${undated.length})`}
    </div>
    <ul className="flex flex-wrap gap-2">
      {undated.map((u) => (
        <li key={u.id}>
          {onActivateTask ? (
            <button
              type="button"
              aria-label={`${t('projectDetail.gantt.openTask', 'Open')} ${u.name}`}
              onClick={() => onActivateTask(u.id)}
              className="rounded border border-border bg-secondary/40 px-2 py-0.5 text-left text-[12px] text-muted-foreground cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring hover:bg-secondary/60"
            >
              {u.name}
            </button>
          ) : (
            <span className="rounded border border-border bg-secondary/40 px-2 py-0.5 text-[12px] text-muted-foreground">{u.name}</span>
          )}
        </li>
      ))}
    </ul>
  </div>
  );
};

export default ProjectGantt;
