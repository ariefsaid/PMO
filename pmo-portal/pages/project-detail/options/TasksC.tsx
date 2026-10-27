import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, SelectField, StatusPill, TextField, useToast, ViewToggle } from '@/src/components/ui';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useTasks, useTaskMutations } from '@/src/hooks/useTasks';
import { useMilestones } from '@/src/hooks/useMilestones';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { classifyExternalError, IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { formatDateOnly } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import type { TaskInput, TaskStatus, TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
const STATUS_OPTIONS = STATUSES.map((status) => ({ value: status, label: status }));

export interface TasksCProps {
  projectId: string;
  projectName?: string;
}

interface PhaseGroup {
  id: string;
  phaseId: string | null;
  name: string;
  milestone: MilestoneWithProgress | null;
  openTasks: TaskWithRefs[];
  doneTasks: TaskWithRefs[];
  doneCount: number;
  total: number;
  percent: number;
  finished: boolean;
  late: boolean;
}

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const TasksC: React.FC<TasksCProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedScope = searchParams.get('scope');
  const scope = requestedScope === 'mine' || requestedScope === 'all'
    ? requestedScope
    : realRole === 'Engineer' ? 'mine' : 'all';
  const today = useFxOrgDay(true).day ?? localTodayIso();
  const { data, isPending, isError, refetch } = useTasks(projectId);
  const {
    data: milestones,
    isPending: milestonesPending,
    isError: milestonesError,
    refetch: refetchMilestones,
  } = useMilestones(projectId);
  const { create, updateStatus, pendingPushByTask = {} } = useTaskMutations(projectId);
  const [expandedPhasesOverride, setExpandedPhasesOverride] = useState<Set<string> | null>(null);
  const [expandedDonePhases, setExpandedDonePhases] = useState<Set<string>>(() => new Set());
  const [addingTaskTo, setAddingTaskTo] = useState<{ groupId: string; phaseId: string | null } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');

  const allTasks = useMemo(() => (data ?? []).filter((task) => task.archived_at == null), [data]);
  const visibleTasks = useMemo(
    () => scope === 'mine'
      ? allTasks.filter((task) => task.assignee_id === currentUser?.id)
      : allTasks,
    [allTasks, currentUser?.id, scope],
  );

  const groups = useMemo<PhaseGroup[]>(() => {
    const phaseList = [...(milestones ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
    const phaseGroups: PhaseGroup[] = phaseList.map((milestone) => {
      const allPhaseTasks = allTasks.filter((task) => task.milestone_id === milestone.id);
      const scopedPhaseTasks = visibleTasks.filter((task) => task.milestone_id === milestone.id);
      const doneCount = allPhaseTasks.filter((task) => task.status === 'Done').length;
      const total = allPhaseTasks.length;
      const percent = total > 0 ? Math.round((doneCount / total) * 100) : Math.round(milestone.effective_pct);
      const finished = total > 0 && doneCount === total;
      return {
        id: milestone.id,
        phaseId: milestone.id,
        name: milestone.name,
        milestone,
        openTasks: scopedPhaseTasks.filter((task) => task.status !== 'Done'),
        doneTasks: scopedPhaseTasks.filter((task) => task.status === 'Done'),
        doneCount,
        total,
        percent,
        finished,
        late: !!milestone.target_date && milestone.target_date < today && !finished,
      };
    });

    const ungroupedAll = allTasks.filter((task) => task.milestone_id == null);
    const ungroupedVisible = visibleTasks.filter((task) => task.milestone_id == null);
    if (ungroupedAll.length > 0) {
      const doneCount = ungroupedAll.filter((task) => task.status === 'Done').length;
      const total = ungroupedAll.length;
      phaseGroups.push({
        id: 'no-phase',
        phaseId: null,
        name: 'No phase',
        milestone: null,
        openTasks: ungroupedVisible.filter((task) => task.status !== 'Done'),
        doneTasks: ungroupedVisible.filter((task) => task.status === 'Done'),
        doneCount,
        total,
        percent: Math.round((doneCount / total) * 100),
        finished: doneCount === total,
        late: false,
      });
    }
    return phaseGroups;
  }, [allTasks, milestones, today, visibleTasks]);

  const defaultExpanded = useMemo(() => {
    const current = groups.find((group) => group.total > 0 && !group.finished);
    return new Set(groups.filter((group) => group.late || group.id === current?.id).map((group) => group.id));
  }, [groups]);
  const expandedPhases = expandedPhasesOverride ?? defaultExpanded;
  const externallyOwned = routeTaskWrite(projectId) === 'external';
  const canCreate = may('create', 'task');

  const setScope = (nextScope: 'mine' | 'all') => {
    const next = new URLSearchParams(searchParams);
    next.set('scope', nextScope);
    setSearchParams(next, { replace: true });
  };

  const setPhaseExpanded = (groupId: string, expanded: boolean) => {
    setExpandedPhasesOverride((current) => {
      const next = new Set(current ?? defaultExpanded);
      if (expanded) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  };

  const canSetStatus = (task: TaskWithRefs) => may('edit', 'taskStatus', {
    currentUserId: currentUser?.id ?? null,
    record: { assignee_id: task.assignee_id },
  });

  const changeStatus = async (task: TaskWithRefs, status: TaskStatus) => {
    if (status === task.status) return;
    try {
      await updateStatus.mutateAsync({ id: task.id, status });
      toast('Status updated', `${task.name} is now ${status}`, 'success');
    } catch (error) {
      const { headline, detail } = externallyOwned
        ? classifyExternalError(error)
        : classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  const addTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addingTaskTo || !newTaskName.trim()) return;
    const input: TaskInput = {
      project_id: projectId,
      name: newTaskName.trim(),
      status: 'To Do',
      assignee_id: null,
      start_date: null,
      end_date: null,
      milestone_id: addingTaskTo.phaseId,
    };
    try {
      await create.mutateAsync(input);
      toast('Task created', newTaskName.trim(), 'success');
      setAddingTaskTo(null);
      setNewTaskName('');
    } catch (error) {
      const { headline, detail } = externallyOwned
        ? classifyExternalError(error)
        : classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  const renderTask = (task: TaskWithRefs) => (
    <li key={task.id} id={`task-${task.id}`} className="flex min-w-0 flex-col gap-2 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-foreground">{task.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{task.assignee?.full_name ?? t('projectDetail.tasks.unassigned', 'Unassigned')}</span>
          <span aria-hidden="true">·</span>
          <span className={task.status !== 'Done' && task.end_date && task.end_date < today ? 'text-destructive-text' : ''}>
            {task.end_date ? formatDateOnly(task.end_date) : 'No due date'}
          </span>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
        {canSetStatus(task) ? (
          <div className="w-40 shrink-0">
            <SelectField
              hideLabel
              label={`Status for ${task.name}`}
              value={task.status}
              disabled={updateStatus.isPending}
              onChange={(value) => void changeStatus(task, value as TaskStatus)}
              options={STATUS_OPTIONS}
              fullWidth
            />
          </div>
        ) : (
          <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
        )}
        {externallyOwned && <TaskPushBadge state={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH} />}
      </div>
    </li>
  );

  if (isPending || milestonesPending) return <ListState variant="loading" rows={5} />;
  if (isError || milestonesError || !data || !milestones) {
    return (
      <ListState
        variant="error"
        title={t('projectDetail.tasks.errorTitle', "Couldn't load tasks")}
        sub={t('projectDetail.tasks.errorSub', 'The request failed. Check your connection and try again.')}
        onRetry={() => {
          void refetch();
          void refetchMilestones();
        }}
      />
    );
  }

  if (allTasks.length === 0 && groups.length === 0) {
    return (
      <ListState
        variant="empty"
        icon="check"
        title={t('projectDetail.tasks.emptyTitle', 'No tasks yet')}
        sub={t('projectDetail.tasks.emptySub', 'Break the project into tasks, assign them to the team, and track each through to Done.')}
      />
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-bold tracking-[-0.01em]">Tasks by phase</h2>
        <ViewToggle<'mine' | 'all'>
          options={[
            { value: 'mine', label: t('projectDetail.tasks.scope.mine', 'Mine') },
            { value: 'all', label: t('projectDetail.tasks.scope.all', 'All') },
          ]}
          value={scope}
          onChange={setScope}
          ariaLabel={t('projectDetail.tasks.scopeAriaLabel', 'Task scope')}
          semantics="toggle"
        />
      </div>

      {visibleTasks.length === 0 && groups.length === 0 ? (
        <ListState
          variant="empty"
          icon="check"
          title={scope === 'mine' ? 'No tasks assigned to you' : t('projectDetail.tasks.emptyTitle', 'No tasks yet')}
          sub={scope === 'mine' ? 'Choose All to review the project task list.' : t('projectDetail.tasks.emptySub', 'Break the project into tasks, assign them to the team, and track each through to Done.')}
        />
      ) : (
        <div className="border-y border-border">
          {groups.map((group) => {
            const expanded = expandedPhases.has(group.id);
            const doneExpanded = expandedDonePhases.has(group.id);
            const targetDate = group.milestone?.target_date;
            return (
              <section key={group.id} aria-labelledby={`phase-${group.id}-title`} className="border-b border-border last:border-b-0">
                <div className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <button
                    id={`phase-${group.id}-title`}
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={expanded ? `phase-${group.id}-content` : undefined}
                    onClick={() => setPhaseExpanded(group.id, !expanded)}
                    className="touch-target min-w-0 flex-1 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="block break-words font-semibold text-foreground">{group.name}</span>
                  </button>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular text-muted-foreground sm:justify-end">
                    <span>{group.doneCount}/{group.total} done · {group.percent}%</span>
                    <span>{targetDate ? formatDateOnly(targetDate) : 'No target date'}</span>
                    {group.late && <span className="font-semibold text-destructive-text">Late</span>}
                    {canCreate && (
                      <button
                        type="button"
                        className="touch-target rounded-sm text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => {
                          setPhaseExpanded(group.id, true);
                          setAddingTaskTo({ groupId: group.id, phaseId: group.phaseId });
                          setNewTaskName('');
                        }}
                      >
                        Add task
                      </button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div id={`phase-${group.id}-content`} className="pb-2">
                    {group.openTasks.length > 0 ? (
                      <ul>{group.openTasks.map(renderTask)}</ul>
                    ) : (
                      <p className="py-3 text-sm text-muted-foreground">No open tasks in this phase.</p>
                    )}
                    {group.doneTasks.length > 0 && (
                      <div className="border-t border-border/70">
                        <button
                          type="button"
                          aria-expanded={doneExpanded}
                          onClick={() => setExpandedDonePhases((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })}
                          className="touch-target flex w-full items-center justify-between rounded-sm py-3 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <span>{group.doneTasks.length} done</span>
                          <span className="text-xs font-normal text-muted-foreground">{doneExpanded ? 'Hide completed' : 'Show completed'}</span>
                        </button>
                        {doneExpanded && <ul>{group.doneTasks.map(renderTask)}</ul>}
                      </div>
                    )}
                    {addingTaskTo?.groupId === group.id && (
                      <form onSubmit={(event) => void addTask(event)} className="flex flex-col gap-3 border-t border-border/70 py-3 sm:flex-row sm:items-end">
                        <TextField
                          label="Task name"
                          value={newTaskName}
                          onChange={setNewTaskName}
                          required
                          fullWidth
                        />
                        <div className="flex shrink-0 items-center gap-2">
                          <Button type="submit" variant="outline" size="sm" disabled={!newTaskName.trim() || create.isPending} loading={create.isPending}>
                            Add task
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={create.isPending} onClick={() => setAddingTaskTo(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TasksC;
