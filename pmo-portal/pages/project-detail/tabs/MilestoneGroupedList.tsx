/**
 * Milestone-grouped task list (XG03-005 / T-44) — the list view's grouped table, extracted
 * from TasksTab. Groups tasks by phase (sorted milestones, then Ungrouped, completed groups
 * last), folds each group's Done tasks behind a per-group disclosure, and renders the phase
 * meta (date range, target, progress, lateness) in the group header. The per-group depth
 * map comes from the hierarchy walk; column definitions and the permission/mutation seam
 * arrive from TasksTab via `buildColumns` / `rowMenu` / `selection` — this module owns
 * grouping and presentation only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Tooltip, ProgressBar, Button, Icon, type Column, type RowMenuItem, type DataTableSelection } from '@/src/components/ui';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { completionPct, formatDay } from '@/src/lib/format';
import { buildTaskRenderOrder } from '@/src/lib/tasks/taskTree';
import { orderedTasks, daysLate } from './taskViewModel';

interface MilestoneGroupedListProps {
  milestones: MilestoneWithProgress[];
  tasks: TaskWithRefs[];
  sourceTasks: TaskWithRefs[];
  today: string;
  buildColumns: (depths: Map<string, number>) => Column<TaskWithRefs>[];
  canCreate: boolean;
  rowMenu: (task: TaskWithRefs) => RowMenuItem[];
  hashTaskId: string | null;
  selection: DataTableSelection<TaskWithRefs>;
  onAddTask: (milestoneId: string | null) => void;
  onActivate: (task: TaskWithRefs) => void;
}

const MilestoneGroupedList: React.FC<MilestoneGroupedListProps> = ({
  milestones,
  tasks,
  sourceTasks,
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
  const tasksByMilestone = useMemo(() => {
    const map = new Map<string | null, TaskWithRefs[]>();
    for (const task of tasks) {
      const key = task.milestone_id ?? null;
      const rows = map.get(key) ?? [];
      rows.push(task);
      map.set(key, rows);
    }
    return map;
  }, [tasks]);
  const sourceByMilestone = useMemo(() => {
    const map = new Map<string | null, TaskWithRefs[]>();
    for (const task of sourceTasks) {
      const key = task.milestone_id ?? null;
      const rows = map.get(key) ?? [];
      rows.push(task);
      map.set(key, rows);
    }
    return map;
  }, [sourceTasks]);
  const groups = useMemo(() => {
    const phaseGroups = [...milestones]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((milestone) => {
        const rows = orderedTasks(tasksByMilestone.get(milestone.id) ?? []);
        return {
          id: milestone.id,
          milestone,
          label: milestone.name,
          tasks: rows,
          openTasks: rows.filter((task) => task.status !== 'Done'),
          doneTasks: rows.filter((task) => task.status === 'Done'),
          completed: milestone.effective_pct >= 100,
        };
      });
    const ungroupedRows = orderedTasks(tasksByMilestone.get(null) ?? []);
    const sourceUngroupedRows = sourceByMilestone.get(null) ?? [];
    const ungrouped = ungroupedRows.length > 0 ? [{
      id: 'ungrouped',
      milestone: null,
      label: t('projectDetail.tasks.ungrouped', 'Ungrouped'),
      tasks: ungroupedRows,
      openTasks: ungroupedRows.filter((task) => task.status !== 'Done'),
      doneTasks: ungroupedRows.filter((task) => task.status === 'Done'),
      completed: sourceUngroupedRows.length > 0 && sourceUngroupedRows.every((task) => task.status === 'Done'),
    }] : [];
    const allGroups = [...phaseGroups, ...ungrouped];
    return [...allGroups.filter((group) => !group.completed), ...allGroups.filter((group) => group.completed)];
  }, [milestones, sourceByMilestone, t, tasksByMilestone]);

  // A completion row is folded by default, but a direct hash link is an explicit
  // request to locate that task. Expand only the target task's phase in that case.
  useEffect(() => {
    if (!hashTaskId) return;
    const target = tasks.find((task) => task.id === hashTaskId && task.status === 'Done');
    if (!target) return;
    const groupId = target.milestone_id ?? 'ungrouped';
    setExpandedDoneGroups((current) => current.has(groupId) ? current : new Set(current).add(groupId));
  }, [hashTaskId, tasks]);

  // B7: one task table for every phase (one column header). Each phase is a heading row; its open tasks follow,
  // then its Done tasks only once that phase's "N done" fold is open.
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const rows = useMemo(() => groups.flatMap((group) => [
    ...group.openTasks,
    ...(expandedDoneGroups.has(group.id) ? group.doneTasks : []),
  ]), [expandedDoneGroups, groups]);
  const columns = useMemo(() => buildColumns(new Map(groups.flatMap((group) =>
    buildTaskRenderOrder(group.tasks).map((entry) => [entry.task.id, entry.depth] as const)))), [buildColumns, groups]);
  const groupOrder = useMemo(() => groups.map((group) => group.id), [groups]);
  const toggleDone = (groupId: string) => setExpandedDoneGroups((current) => {
    const next = new Set(current);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    return next;
  });

  const groupMeta = (groupId: string) => {
    const group = groupById.get(groupId);
    if (!group) return null;
    const expanded = expandedDoneGroups.has(group.id);
    const phaseTasks = sourceByMilestone.get(group.milestone?.id ?? null) ?? [];
    const hasTasksOutsideFilters = group.tasks.length === 0 && phaseTasks.length > 0;
    const starts = phaseTasks.map((task) => task.start_date).filter((date): date is string => Boolean(date)).sort();
    const ends = phaseTasks.map((task) => task.end_date).filter((date): date is string => Boolean(date)).sort();
    const dateRange = starts.length || ends.length
      ? `${starts.length ? formatDay(starts[0]) : '—'} – ${ends.length ? formatDay(ends[ends.length - 1]) : '—'}`
      : null;
    const lateDays = group.milestone?.target_date && group.milestone.target_date < today && group.milestone.effective_pct < 100
      ? daysLate(group.milestone.target_date, today)
      : null;
    const note = hasTasksOutsideFilters
      ? t('projectDetail.tasks.noFilteredTasksInGroup', 'No tasks in this phase match the current filters.')
      : !group.completed && group.tasks.length === 0 ? t('projectDetail.tasks.noTasksInGroup', 'No tasks in this phase yet.') : null;
    return <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 font-normal">
      {dateRange && <Tooltip content={t('projectDetail.tasks.phaseDatesTooltip', 'Range from the earliest task start date to the latest task due date in the current task scope. Source: phase task records.')}>
        <span tabIndex={0} className="text-sm tabular text-muted-foreground">{dateRange}</span>
      </Tooltip>}
      {group.milestone?.target_date && <Tooltip content={t('projectDetail.tasks.phaseTargetTooltip', 'Target date from the project phase record.')}>
        <span tabIndex={0} className="text-sm tabular text-muted-foreground">{t('projectDetail.tasks.phaseTargetDate', 'Target {{date}}', { date: formatDay(group.milestone.target_date) })}</span>
      </Tooltip>}
      {group.milestone && <Tooltip content={t(
        'projectDetail.tasks.phaseProgressTooltip',
        'Manual phase progress when set; otherwise Done phase tasks divided by the phase task count. Source: get_project_milestones.',
      )}>
        <span tabIndex={0} className="inline-flex min-w-0 max-w-full items-center">
          <ProgressBar value={completionPct(group.milestone.effective_pct)} tone={group.milestone.effective_pct >= 100 ? 'success' : 'primary'} showValue compact className="max-w-full flex-wrap" aria-label={t('projectDetail.tasks.phaseProgress', 'Phase progress')} />
        </span>
      </Tooltip>}
      {lateDays !== null && <Tooltip content={t('projectDetail.tasks.phaseLateTooltip', 'Days past the phase target date, compared with today in the organization timezone. Source: milestone target date and organization day.')}>
        <span tabIndex={0} className="text-sm font-medium text-destructive-text">{t('projectDetail.tasks.daysLateCount', '{{count}}d late', { count: lateDays })}</span>
      </Tooltip>}
      <Tooltip content={t('projectDetail.tasks.openCountTooltip', 'Count of visible tasks in this phase whose status is not Done. Source: current project task list and filters.')}>
        <span tabIndex={0} className="text-sm text-muted-foreground">{t('projectDetail.tasks.openCount', '{{count}} open', { count: group.openTasks.length })}</span>
      </Tooltip>
      {group.doneTasks.length > 0 && <button
        type="button"
        aria-expanded={expanded}
        onClick={() => toggleDone(group.id)}
        className="touch-target inline-flex min-h-9 items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="chev" className={`size-3.5 transition-transform${expanded ? ' rotate-90' : ''}`} />
        {t('projectDetail.tasks.doneCount', '{{count}} done', { count: group.doneTasks.length })}
      </button>}
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
      {canCreate && <Button variant="ghost" size="sm" className="ml-auto max-w-full" onClick={() => onAddTask(group.milestone?.id ?? null)}>
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
    groupBy={(task) => task.milestone_id && groupById.has(task.milestone_id) ? task.milestone_id : 'ungrouped'}
    groupOrder={groupOrder}
    groupLabel={(groupId) => <span className="break-words text-sm font-semibold text-foreground">{groupById.get(groupId)?.label ?? groupId}</span>}
    groupHeader={(groupId) => groupMeta(groupId)}
    groupHeaderSpan
  />;
};

export default MilestoneGroupedList;
