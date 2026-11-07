/**
 * Project task Gantt (#1980): the ReUI gantt (src/components/reui/gantt, owned source) behind the
 * same props the old hand-rolled timeline took, plus drag / edge-resize rescheduling.
 *
 * Writes go through `onReschedule` (TasksTab → the task repository). The bar moves at once from a
 * local override and snaps back if the save fails; the override is dropped as soon as the refetched
 * task carries the saved dates. `canReschedule` is the per-task gate (same answer as editing a
 * task); RLS stays the authority. Pure mapping lives in src/lib/gantt/reuiModel.ts.
 *
 * a11y: the figure is labelled with a screen-reader summary; bars are native buttons (Enter/Space
 * activate); undated tasks are listed in a footer rather than plotted; status is text in the tree.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, Button, StatusPill, useIsNarrow, type RowMenuItem } from '@/src/components/ui';
import { Gantt } from '@/src/components/reui/gantt/gantt';
import { GanttNav, GanttNavNext, GanttNavPrev, GanttNavToday, GanttScaleSwitcher, GanttTitle } from '@/src/components/reui/gantt/gantt-nav';
import { GanttView } from '@/src/components/reui/gantt/gantt-view';
import type { GanttProposedUpdate, GanttScale } from '@/src/components/reui/gantt/gantt-types';
import type { GanttColumn, GanttColumnContext } from '@/src/components/reui/gantt/gantt';
import type { GanttI18nOverrides } from '@/src/components/reui/gantt/gantt-i18n';
import { RowMenu } from '@/src/components/ui/RowMenu';
import { ContextMenuItem } from '@/src/components/shadcn/context-menu';
import { TooltipProvider } from '@/src/components/shadcn/tooltip';
import { buildReuiGanttModel, taskPatchFromRange, type GanttTaskData } from '@/src/lib/gantt/reuiModel';
import { getDateFnsLocale } from '@/src/lib/locale/activeLocale';
import { formatMonthDay } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import type { TaskPatch, TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ProjectGanttProps {
  tasks: TaskWithRefs[];
  milestones: MilestoneWithProgress[];
  /** Click / Enter / Space on a bar or a tree row. When omitted, bars and rows stay inert. */
  onActivateTask?: (task: TaskWithRefs) => void;
  /** Optional per-task actions, offered on right-click of a bar or a row. */
  rowMenu?: (task: TaskWithRefs) => RowMenuItem[];
  /**
   * Mobile fallback (defect D1): below the `sm` (640px) breakpoint the timeline is replaced by a
   * notice pointing at List/Board. Required: an inert switch button is a defect, not a mode.
   */
  onSwitchView: (view: 'list' | 'board') => void;
  /** May the viewer move this task's dates? Same gate as editing the task. Omit = read-only. */
  canReschedule?: (task: TaskWithRefs) => boolean;
  /** Saves the new dates. Resolves false when the write failed (the bar then snaps back). */
  onReschedule?: (task: TaskWithRefs, patch: TaskPatch) => Promise<boolean>;
}

interface Override {
  start: Date;
  end: Date;
}

const UTC = 'UTC';
const DAY_MINUTES = 1440;
// The gantt needs a bounded box to scroll in; the tree panel and the track share it.
const FRAME_CLASS = 'h-[60vh] min-h-[24rem] border-b border-border';

// ── Main component ────────────────────────────────────────────────────────────

const ProjectGantt: React.FC<ProjectGanttProps> = ({
  tasks,
  milestones,
  onActivateTask,
  rowMenu,
  onSwitchView,
  canReschedule,
  onReschedule,
}) => {
  const { t } = useTranslation('project');
  const isNarrow = useIsNarrow();
  const [scale, setScale] = useState<GanttScale>('month');
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());

  const writable = !!onReschedule && !!canReschedule;
  const model = useMemo(
    () =>
      buildReuiGanttModel(
        tasks,
        milestones,
        {
          ungrouped: t('projectDetail.gantt.ungrouped', 'Ungrouped'),
          milestoneTarget: t('projectDetail.gantt.milestoneTarget', 'Target date'),
          dependsOn: (names: string[]) =>
            `${t('projectDetail.gantt.dependsOn', 'depends on')} ${names.join(', ')}`,
        },
        writable ? canReschedule : undefined,
      ),
    [tasks, milestones, t, writable, canReschedule],
  );
  const taskMap = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);

  // Drop an override once the refetched task already carries those dates (or the task is gone).
  useEffect(() => {
    setOverrides((cur) => {
      if (cur.size === 0) return cur;
      const next = new Map(cur);
      for (const [id, o] of cur) {
        const task = taskMap.get(id);
        if (!task || taskPatchFromRange(task, o.start, o.end) === null) next.delete(id);
      }
      return next.size === cur.size ? cur : next;
    });
  }, [taskMap]);

  // Open on today when the work spans it, else on the first dated item (never an empty month).
  // The gantt reads this once, at mount.
  const defaultDate = useMemo(() => {
    if (model.events.length === 0) return undefined;
    const now = Date.now();
    const first = Math.min(...model.events.map((e) => e.start.getTime()));
    const last = Math.max(...model.events.map((e) => e.end.getTime()));
    return now >= first && now <= last ? undefined : new Date(first);
  }, [model.events]);

  const events = useMemo(
    () => model.events.map((e) => (overrides.has(e.id) ? { ...e, ...overrides.get(e.id) } : e)),
    [model.events, overrides],
  );

  const scaleLabels = useMemo<Record<GanttScale, string>>(
    () => ({
      day: t('projectDetail.gantt.scale.day', 'Day'),
      week: t('projectDetail.gantt.scale.week', 'Week'),
      month: t('projectDetail.gantt.scale.month', 'Month'),
      quarter: t('projectDetail.gantt.scale.quarter', 'Quarter'),
      year: t('projectDetail.gantt.scale.year', 'Year'),
    }),
    [t],
  );

  const i18n = useMemo<GanttI18nOverrides>(
    () => ({
      labels: {
        today: t('projectDetail.gantt.today', 'Today'),
        previous: t('projectDetail.gantt.previous', 'Previous'),
        next: t('projectDetail.gantt.next', 'Next'),
        resources: t('projectDetail.gantt.taskColumn', 'Task'),
        goToDate: t('projectDetail.gantt.goToDate', 'Go to date'),
        selectView: t('projectDetail.gantt.zoomAriaLabel', 'Timeline zoom'),
        zoomIn: t('projectDetail.gantt.zoomIn', 'Zoom in'),
        zoomOut: t('projectDetail.gantt.zoomOut', 'Zoom out'),
        resizePanel: t('projectDetail.gantt.resizePanel', 'Resize task panel'),
        loading: t('projectDetail.gantt.loading', 'Loading'),
        continues: t('projectDetail.gantt.continues', 'continues'),
        milestone: t('projectDetail.gantt.milestoneWord', 'phase'),
        jumpToBar: (title: string) => t('projectDetail.gantt.jumpToBar', 'Scroll to "{{title}}"', { title }),
        progress: (percent: number) => t('projectDetail.gantt.progress', '{{percent}}% complete', { percent }),
        durationDays: (days: number) =>
          t('projectDetail.gantt.durationDays', { count: days, defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days' }),
        scales: scaleLabels,
      },
    }),
    [t, scaleLabels],
  );

  const activateById = useCallback(
    (id: string) => {
      const task = taskMap.get(id);
      if (task && onActivateTask) onActivateTask(task);
    },
    [taskMap, onActivateTask],
  );

  const onEventUpdate = useCallback(
    (update: GanttProposedUpdate<GanttTaskData>) => {
      const task = update.event.data?.task;
      if (!task || !onReschedule || !canReschedule?.(task)) return false;
      const patch = taskPatchFromRange(task, update.start, update.end);
      if (!patch) return false;
      const id = task.id;
      const mine: Override = { start: update.start, end: update.end };
      setOverrides((cur) => new Map(cur).set(id, mine));
      // Roll back only this drag's own override: a newer drag on the same task keeps its bar.
      const rollback = () =>
        setOverrides((cur) => {
          if (cur.get(id) !== mine) return cur;
          const next = new Map(cur);
          next.delete(id);
          return next;
        });
      onReschedule(task, patch).then((ok) => ok || rollback(), rollback);
    },
    [onReschedule, canReschedule],
  );

  const columns = useMemo<GanttColumn[]>(
    () => [
      {
        id: 'status',
        title: t('projectDetail.gantt.statusColumn', 'Status'),
        width: 104,
        render: ({ resource }: GanttColumnContext) => {
          const task = taskMap.get(resource.id);
          return task ? <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill> : null;
        },
      },
      {
        id: 'dates',
        title: t('projectDetail.gantt.datesColumn', 'Dates'),
        width: 128,
        render: ({ resource }: GanttColumnContext) => {
          const task = taskMap.get(resource.id);
          if (!task) return null;
          const fmt = (iso: string | null) => (iso ? formatMonthDay(new Date(`${iso}T00:00:00`)) : '—');
          return `${fmt(task.start_date)} – ${fmt(task.end_date)}`;
        },
      },
      ...(rowMenu
        ? [
            {
              id: 'actions',
              title: '',
              width: 40,
              render: ({ resource }: GanttColumnContext) => {
                const task = taskMap.get(resource.id);
                return task ? (
                  <RowMenu items={rowMenu(task)} />
                ) : null;
              },
            },
          ]
        : []),
    ],
    [t, taskMap, rowMenu],
  );

  const menuItems = useCallback(
    (task: TaskWithRefs | undefined) =>
      task && rowMenu
        ? rowMenu(task).map((item) => (
            <ContextMenuItem
              key={item.label}
              variant={item.danger ? 'destructive' : 'default'}
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {item.label}
            </ContextMenuItem>
          ))
        : null,
    [rowMenu],
  );

  if (model.isEmpty) {
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

  // D1: below 640px the tree + track split is unusable; point at List/Board instead. (The empty
  // state above still wins: an empty project shows the honest empty state.)
  if (isNarrow) return <GanttMobileNotice onSwitchView={onSwitchView} />;

  // ⚑ SCREEN-READER summary, one independently translatable clause per count (#575): i18next binds
  // one `count` per key, and the ", " joiner lives here, not in the catalogue, because translation
  // tooling trims leading punctuation and would weld clauses together.
  const summary = `${[
    t('projectDetail.gantt.summary.head', 'Task Gantt timeline: {{tasks}} across {{phases}}', {
      tasks: t('projectDetail.gantt.summary.tasks', {
        count: model.barCount,
        defaultValue_one: '{{count}} task',
        defaultValue_other: '{{count}} tasks',
      }),
      phases: t('projectDetail.gantt.summary.milestones', {
        count: milestones.length,
        defaultValue_one: '{{count}} phase',
        defaultValue_other: '{{count}} phases',
      }),
    }),
    t('projectDetail.gantt.summary.connectors', {
      count: model.edgeCount,
      defaultValue_one: '{{count}} dependency connector drawn',
      defaultValue_other: '{{count}} dependency connectors drawn',
    }),
    model.hiddenEdgeCount > 0
      ? t('projectDetail.gantt.summary.hidden', {
          count: model.hiddenEdgeCount,
          defaultValue_one: '{{count}} dependency hidden (endpoint undated)',
          defaultValue_other: '{{count}} dependencies hidden (endpoint undated)',
        })
      : null,
    // The scale's translated LABEL, never the raw enum.
    t('projectDetail.gantt.summary.scale', 'scale: {{scale}}', { scale: scaleLabels[scale] }),
  ]
    .filter(Boolean)
    .join(', ')}.`;

  return (
    <div className="min-w-0">
      <figure aria-label={summary} data-scale={scale} className="m-0">
        <TooltipProvider>
          <Gantt<GanttTaskData>
            className={FRAME_CLASS}
            timeZone={UTC}
            locale={getDateFnsLocale()}
            i18n={i18n}
            events={events}
            resources={model.resources}
            defaultDate={defaultDate}
            treePanel={{ width: rowMenu ? 480 : 440, nameColumnWidth: 208 }}
            scale={scale}
            onScaleChange={setScale}
            interactions={{ drag: writable, resize: writable, selectSlot: false }}
            snapDuration={DAY_MINUTES}
            slotDuration={DAY_MINUTES}
            scheduleMode="single"
            barLabel="auto"
            rowCheckboxes={false}
            columns={columns}
            onEventUpdate={onEventUpdate}
            onEventClick={onActivateTask ? (occ) => occ.event.data?.task && activateById(occ.event.id) : undefined}
            onResourceClick={onActivateTask ? ({ resource }) => activateById(resource.id) : undefined}
            renderEventMenu={rowMenu ? ({ occurrence }) => menuItems(occurrence.event.data?.task ?? undefined) : undefined}
            renderResourceMenu={rowMenu ? ({ resource }) => menuItems(taskMap.get(resource.id)) : undefined}
          >
            <GanttNav>
              <GanttNavToday />
              <GanttScaleSwitcher />
              <div className="flex items-center">
                <GanttNavPrev />
                <GanttNavNext />
              </div>
              <GanttTitle />
              <div className="grow" />
              <span className="text-[12px] text-muted-foreground">
                {t('projectDetail.gantt.tasksOnTimeline', {
                  count: model.barCount,
                  defaultValue_one: '{{count}} task on the timeline',
                  defaultValue_other: '{{count}} tasks on the timeline',
                })}
              </span>
            </GanttNav>
            <GanttView />
          </Gantt>
        </TooltipProvider>

        {/* Undated footer (AC-GANTT-005) */}
        {model.undated.length > 0 && (
          <UndatedFooter undated={model.undated} onActivateTask={onActivateTask ? activateById : undefined} />
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
