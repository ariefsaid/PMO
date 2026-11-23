/**
 * Grouped task list (XG03-005 / T-44, #2807): one table, one header row per section, the task outline under it.
 * Sections: each phase (sorted), each task group linked to it right after it (indented), the groups linked to no
 * phase, then Ungrouped; finished sections last. A task sits in the section of its top task, so a subtask always
 * follows its parent; subtasks indent to any depth and a parent folds its subtasks. A parent row shows its roll-up
 * (TaskList). Each section folds its finished top tasks behind "N done". Columns and the permission/mutation seam
 * arrive from TasksTab via `buildColumns` / `rowMenu` / `selection`: this module owns grouping and presentation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Tooltip, ProgressBar, Button, Icon, type Column, type RowMenuItem, type DataTableSelection } from '@/src/components/ui';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { TaskGroupRow, WithTaskGroup } from '@/src/lib/db/taskGroups';
import { completionPct, formatDay, formatDayRange } from '@/src/lib/format';
import { groupProgress } from '@/src/lib/delivery/milestoneRollup';
import type { TaskRollup } from '@/src/lib/tasks/taskTree';
import { daysLate, outlineRows, shownStatus } from './taskViewModel';
import type { TaskTreeView } from './TaskList';

interface MilestoneGroupedListProps {
  milestones: MilestoneWithProgress[];
  /** Active task groups of the project (#2679). */
  taskGroups?: TaskGroupRow[];
  tasks: TaskWithRefs[];
  sourceTasks: TaskWithRefs[];
  /** Roll-up of every task with a live child, over the whole project. */
  rollups?: Map<string, TaskRollup>;
  today: string;
  buildColumns: (tree: TaskTreeView) => Column<TaskWithRefs>[];
  canCreate: boolean;
  rowMenu: (task: TaskWithRefs) => RowMenuItem[];
  hashTaskId: string | null;
  selection: DataTableSelection<TaskWithRefs>;
  onAddTask: (target: { milestoneId: string | null; taskGroupId: string | null }) => void;
  onActivate: (task: TaskWithRefs) => void;
}

const EMPTY_ROLLUPS = new Map<string, TaskRollup>();
const EMPTY_GROUPS: TaskGroupRow[] = [];
const groupOf = (task: TaskWithRefs) => (task as TaskWithRefs & WithTaskGroup).task_group_id ?? null;

interface Section {
  id: string;
  label: string;
  milestone: MilestoneWithProgress | null;
  group: TaskGroupRow | null;
  /** A group listed under its phase. */
  nested: boolean;
  roots: TaskWithRefs[];
  openRoots: TaskWithRefs[];
  doneRoots: TaskWithRefs[];
  completed: boolean;
}

const MilestoneGroupedList: React.FC<MilestoneGroupedListProps> = ({
  milestones,
  taskGroups = EMPTY_GROUPS,
  tasks,
  sourceTasks,
  rollups = EMPTY_ROLLUPS,
  today,
  buildColumns,
  canCreate,
  rowMenu,
  hashTaskId,
  selection,
  onAddTask,
  onActivate,
}) => {
  const { t } = useTranslation('project');
  const [expandedDoneGroups, setExpandedDoneGroups] = useState<Set<string>>(() => new Set());
  // #2807: every parent starts open; the set holds the ones the person folded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const onToggle = useCallback((id: string) => setCollapsed((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);

  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [milestones],
  );
  const groupsById = useMemo(() => new Map(taskGroups.map((g) => [g.id, g])), [taskGroups]);
  const milestoneIds = useMemo(() => new Set(milestones.map((m) => m.id)), [milestones]);

  /** The section a task belongs to: its top task's group, else its top task's phase, else Ungrouped. */
  const sectionKeyIn = useCallback((list: TaskWithRefs[]) => {
    const byId = new Map(list.map((x) => [x.id, x]));
    return (task: TaskWithRefs): string => {
      let root = task;
      const seen = new Set<string>();
      while (root.parent_task_id && byId.has(root.parent_task_id) && !seen.has(root.id)) {
        seen.add(root.id);
        root = byId.get(root.parent_task_id)!;
      }
      const g = groupOf(root);
      if (g && groupsById.has(g)) return `g:${g}`;
      if (root.milestone_id && milestoneIds.has(root.milestone_id)) return `m:${root.milestone_id}`;
      return 'ungrouped';
    };
  }, [groupsById, milestoneIds]);

  const outline = useMemo(() => outlineRows(tasks, rollups, collapsed), [collapsed, rollups, tasks]);
  const keyOf = useMemo(() => sectionKeyIn(tasks), [sectionKeyIn, tasks]);
  const sourceKeyOf = useMemo(() => sectionKeyIn(sourceTasks), [sectionKeyIn, sourceTasks]);
  const sourceBySection = useMemo(() => {
    const map = new Map<string, TaskWithRefs[]>();
    for (const task of sourceTasks) {
      const key = sourceKeyOf(task);
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [sourceKeyOf, sourceTasks]);

  const sections = useMemo(() => {
    const rootsBy = new Map<string, TaskWithRefs[]>();
    for (const root of outline.roots) {
      const key = keyOf(root);
      rootsBy.set(key, [...(rootsBy.get(key) ?? []), root]);
    }
    const make = (id: string, label: string, milestone: MilestoneWithProgress | null, group: TaskGroupRow | null, nested: boolean): Section => {
      const roots = rootsBy.get(id) ?? [];
      const source = sourceBySection.get(id) ?? [];
      const completed = milestone
        ? milestone.effective_pct >= 100
        : source.length > 0 && source.every((x) => shownStatus(x, rollups) === 'Done');
      return {
        id, label, milestone, group, nested, roots, completed,
        openRoots: roots.filter((r) => shownStatus(r, rollups) !== 'Done'),
        doneRoots: roots.filter((r) => shownStatus(r, rollups) === 'Done'),
      };
    };
    const linked = (m: string) => taskGroups.filter((g) => g.milestone_id === m);
    const all: Section[] = [];
    for (const m of sortedMilestones) {
      all.push(make(`m:${m.id}`, m.name, m, null, false));
      for (const g of linked(m.id)) all.push(make(`g:${g.id}`, g.name, null, g, true));
    }
    for (const g of taskGroups) if (!g.milestone_id || !milestoneIds.has(g.milestone_id)) all.push(make(`g:${g.id}`, g.name, null, g, false));
    if ((rootsBy.get('ungrouped') ?? []).length > 0) all.push(make('ungrouped', t('projectDetail.tasks.ungrouped', 'Ungrouped'), null, null, false));
    // A finished phase moves to the end with the groups listed under it.
    const done = new Set(all.filter((s) => s.completed && !s.nested).map((s) => s.id));
    const parentDone = (s: Section) => s.nested && s.group?.milestone_id ? done.has(`m:${s.group.milestone_id}`) : s.completed;
    return [...all.filter((s) => !parentDone(s)), ...all.filter((s) => parentDone(s))];
  }, [keyOf, milestoneIds, outline.roots, rollups, sortedMilestones, sourceBySection, t, taskGroups]);

  // A completion row is folded by default, but a direct hash link is an explicit
  // request to locate that task. Expand only the target task's section in that case.
  useEffect(() => {
    if (!hashTaskId) return;
    const target = tasks.find((task) => task.id === hashTaskId);
    if (!target) return;
    const section = sections.find((s) => s.doneRoots.some((r) => outline.rowsUnder(r).some((x) => x.id === target.id)));
    if (!section) return;
    setExpandedDoneGroups((current) => current.has(section.id) ? current : new Set(current).add(section.id));
  }, [hashTaskId, outline, sections, tasks]);

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const rows = useMemo(() => sections.flatMap((s) => [
    ...s.openRoots,
    ...(expandedDoneGroups.has(s.id) ? s.doneRoots : []),
  ].flatMap((root) => outline.rowsUnder(root))), [expandedDoneGroups, outline, sections]);
  const rowSection = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) for (const r of s.roots) for (const x of outline.rowsUnder(r)) map.set(x.id, s.id);
    return map;
  }, [outline, sections]);
  const columns = useMemo(
    () => buildColumns({ depths: outline.depths, rollups, collapsed, onToggle }),
    [buildColumns, collapsed, onToggle, outline.depths, rollups],
  );
  const groupOrder = useMemo(() => sections.map((s) => s.id), [sections]);
  const toggleDone = (id: string) => setExpandedDoneGroups((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const groupMeta = (sectionId: string) => {
    const group = sectionById.get(sectionId);
    if (!group) return null;
    const expanded = expandedDoneGroups.has(group.id);
    const sectionTasks = sourceBySection.get(group.id) ?? [];
    const hasTasksOutsideFilters = group.roots.length === 0 && sectionTasks.length > 0;
    // Dates are the span of the work itself: a parent's own dates are a roll-up, so only leaves are read.
    const leaves = sectionTasks.filter((x) => !rollups.has(x.id));
    const starts = leaves.map((task) => task.start_date).filter((date): date is string => Boolean(date)).sort();
    const ends = leaves.map((task) => task.end_date).filter((date): date is string => Boolean(date)).sort();
    const dateRange = starts.length || ends.length
      ? starts.length && ends.length ? formatDayRange(starts[0], ends[ends.length - 1]) : `${starts.length ? formatDay(starts[0]) : '—'} – ${ends.length ? formatDay(ends[ends.length - 1]) : '—'}`
      : null;
    const lateDays = group.milestone?.target_date && group.milestone.target_date < today && group.milestone.effective_pct < 100
      ? daysLate(group.milestone.target_date, today)
      : null;
    const gp = group.group ? groupProgress(group.group.id, sourceTasks.map((x) => ({
      id: x.id, status: x.status, milestone_id: x.milestone_id ?? null, task_group_id: groupOf(x),
      parent_task_id: x.parent_task_id ?? null, archived_at: x.archived_at ?? null,
    }))) : null;
    const note = hasTasksOutsideFilters
      ? t('projectDetail.tasks.noFilteredTasksInGroup', 'No tasks in this phase match the current filters.')
      : !group.completed && group.roots.length === 0 ? t('projectDetail.tasks.noTasksInGroup', 'No tasks in this phase yet.') : null;
    return <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 font-normal">
      {dateRange && <Tooltip content={t('projectDetail.tasks.phaseDatesTooltip', 'Range from the earliest task start date to the latest task due date in the current task scope. Source: phase task records.')}>
        <span tabIndex={0} className="text-sm tabular text-muted-foreground">{dateRange}</span>
      </Tooltip>}
      {group.milestone?.target_date && <Tooltip content={t('projectDetail.tasks.phaseTargetTooltip', 'Target date from the project phase record.')}>
        <span tabIndex={0} className="text-sm tabular text-muted-foreground">{t('projectDetail.tasks.phaseTargetDate', 'Target {{date}}', { date: formatDay(group.milestone.target_date) })}</span>
      </Tooltip>}
      {group.milestone && <Tooltip content={t(
        'projectDetail.tasks.phaseProgressTooltip',
        'Manual progress, or calculated from the phase\'s tasks.',
      )}>
        <span tabIndex={0} className="inline-flex min-w-0 max-w-full items-center">
          <ProgressBar value={completionPct(group.milestone.effective_pct)} tone={group.milestone.effective_pct >= 100 ? 'success' : 'primary'} showValue compact className="max-w-full flex-wrap" aria-label={t('projectDetail.tasks.phaseProgress', 'Phase progress')} />
        </span>
      </Tooltip>}
      {gp && gp.calculatedPct !== null && <Tooltip content={t('projectDetail.tasks.groupProgressTooltip', '{{done}} of {{total}} tasks in this group done.', { done: gp.doneCount, total: gp.taskCount })}>
        <span tabIndex={0} className="inline-flex min-w-0 max-w-full items-center">
          <ProgressBar value={Math.round(gp.calculatedPct)} tone={gp.calculatedPct >= 100 ? 'success' : 'primary'} showValue compact className="max-w-full flex-wrap" aria-label={t('projectDetail.tasks.groupProgress', 'Group progress')} />
        </span>
      </Tooltip>}
      {lateDays !== null && <Tooltip content={t('projectDetail.tasks.phaseLateTooltip', 'Days past the phase target date, compared with today in the organization timezone. Source: milestone target date and organization day.')}>
        <span tabIndex={0} className="text-sm font-medium text-destructive-text">{t('projectDetail.tasks.daysLateCount', '{{count}}d late', { count: lateDays })}</span>
      </Tooltip>}
      <Tooltip content={t('projectDetail.tasks.openCountTooltip', 'Count of visible tasks in this phase whose status is not Done. Source: current project task list and filters.')}>
        <span tabIndex={0} className="text-sm text-muted-foreground">{t('projectDetail.tasks.openCount', '{{count}} open', { count: group.openRoots.length })}</span>
      </Tooltip>
      {group.doneRoots.length > 0 && <button
        type="button"
        aria-expanded={expanded}
        onClick={() => toggleDone(group.id)}
        className="touch-target inline-flex min-h-9 items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="chev" className={`size-3.5 transition-transform${expanded ? ' rotate-90' : ''}`} />
        {t('projectDetail.tasks.doneCount', '{{count}} done', { count: group.doneRoots.length })}
      </button>}
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
      {canCreate && <Button variant="ghost" size="sm" className="ml-auto max-w-full" onClick={() => onAddTask({
        milestoneId: group.milestone?.id ?? null,
        taskGroupId: group.group?.id ?? null,
      })}>
        <Icon name="plus" />{t('projectDetail.tasks.addTask', 'Add task')}
      </Button>}
    </div>;
  };

  return <DataTable<TaskWithRefs>
    rows={rows}
    columns={columns}
    rowKey={(task) => task.id}
    rowMenu={rowMenu}
    selection={selection}
    onActivate={onActivate}
    rowLabel={(task) => t('projectDetail.tasks.openTask', 'Open task {{name}}', { name: task.name })}
    accessibleName={t('projectDetail.tasks.listAriaLabel', 'Project tasks')}
    tableId="project-detail-tasks"
    groupBy={(task) => rowSection.get(task.id) ?? 'ungrouped'}
    groupOrder={groupOrder}
    groupLabel={(id) => {
      const s = sectionById.get(id);
      return <span className={`inline-flex items-center gap-1.5 break-words text-sm font-semibold text-foreground${s?.nested ? ' pl-6' : ''}`}>
        {s?.group && <Icon name="folder" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        {s?.label ?? id}
      </span>;
    }}
    groupHeader={(id) => groupMeta(id)}
    groupHeaderSpan
  />;
};

/**
 * #2104 — memoised on its props. TasksTab hands it stable references (memoised task list, column factory, row
 * menu, selection and callbacks), so an unrelated re-render does not re-render the whole task table.
 */
export default React.memo(MilestoneGroupedList);
