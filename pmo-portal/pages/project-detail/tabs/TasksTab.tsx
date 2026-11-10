import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ListState,
  Card,
  ConfirmDialog,
  useToast,
  type RowMenuItem,
  type DataTableSelection,
} from '@/src/components/ui';
import { ProjectIntegrationsCard } from '@/src/components/projects/ProjectIntegrationsCard';
import { useLocation, useSearchParams } from 'react-router';
import { scrollBehavior } from '@/src/lib/motion';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useTasks, useTaskMutations, useAssignableProfiles } from '@/src/hooks/useTasks';
import { useMilestones } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { classifyExternalError } from '@/src/lib/adapterSeam/pendingPush';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useTaskRouteState } from '@/src/hooks/useOwnershipCacheSync';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs, TaskStatus, TaskPatch } from '@/src/lib/db/tasks';
import ProjectGantt from '../ProjectGantt';

// The ReUI calendar is ~100 KB; only the Calendar view pays for it.
const TaskCalendarView = React.lazy(() => import('./TaskCalendarView').then((m) => ({ default: m.TaskCalendarView })));
import TaskBoard from './TaskBoard';
import TaskFormModal from './TaskFormModal';
import MilestoneGroupedList from './MilestoneGroupedList';
import { useProjectTaskColumns } from './TaskList';
import TaskRecordDrawer from './TaskRecordDrawer';
import TasksToolbar from './TasksToolbar';
import type { ViewMode, TaskScope, BulkAction } from './taskViewModel';

function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

interface TasksTabProps {
  projectId: string;
  projectName?: string;
  onCountChange?: (count: number | null) => void;
}

const TasksTab: React.FC<TasksTabProps> = (props) => {
  return <TasksWorkspace {...props} />;
};

/**
 * Project Tasks tab — the per-project task register (crud-components §9.7,
 * rbac-visibility §F). Create / edit / assign / status / delete + dependency
 * add/remove, all gated via `can()` on the REAL JWT role. The single carefully
 * gated split: an Engineer may change the status of their OWN assigned task
 * only (the status control is the one editable affordance; everything else is
 * static), enforced by the column-pinned RLS (migration 0016) — the FE is the
 * clarity projection, RLS is the authority.
 *
 * Composition (XG03-005 / T-44): this workspace owns permissions, task selection and
 * mutation callbacks, and exposes the SAME status-action interface to every view — the
 * list columns (TaskList), the board (TaskBoard), the grouped list (MilestoneGroupedList)
 * and the form (TaskFormModal). Shared view vocabulary lives in taskViewModel; the
 * toolbar (TasksToolbar) and the record drawer (TaskRecordDrawer) sit beside this file.
 */
const TasksWorkspace: React.FC<TasksTabProps> = ({ projectId, projectName = '', onCountChange }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const organizationDay = useFxOrgDay(true).day;
  const today = organizationDay ?? localTodayIso();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useTasks(projectId);
  useEffect(() => {
    onCountChange?.(isPending || isError || data == null ? null : data.length);
  }, [data, isError, isPending, onCountChange]);
  const { data: assignableProfiles } = useAssignableProfiles();
  const { create, update, updateStatus, remove, archive, addDependency, removeDependency, pendingPushByTask = {} } =
    useTaskMutations(projectId);
  const { data: milestones } = useMilestones(projectId);
  const location = useLocation();

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: ViewMode = requestedView === 'board' || requestedView === 'timeline' || requestedView === 'calendar' ? requestedView : 'list';
  const hashTaskId = location.hash.startsWith('#task-') ? location.hash.slice('#task-'.length) : null;
  const requestedScope = searchParams.get('scope');
  const scope: TaskScope = requestedScope === 'mine' || requestedScope === 'all'
    ? requestedScope
    : realRole === 'Engineer' ? 'mine' : 'all';
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const setTaskView = (nextView: ViewMode) => {
    setSelectedTaskIds(new Set());
    setBulkAction(null);
    const next = new URLSearchParams(searchParams);
    next.set('scope', scope);
    next.set('view', nextView);
    setSearchParams(next, { replace: true });
  };
  const setTaskScope = (nextScope: TaskScope) => {
    setSelectedTaskIds(new Set());
    setBulkAction(null);
    const next = new URLSearchParams(searchParams);
    next.set('scope', nextScope);
    next.set('view', view);
    setSearchParams(next, { replace: true });
  };
  // Project task links promise a scroll target. A saved view in the URL should not
  // strand a hash deep link on a board or timeline where the list anchor is absent.
  useEffect(() => {
    if (!hashTaskId || view === 'list') return;
    const next = new URLSearchParams(searchParams);
    next.set('view', 'list');
    setSearchParams(next, { replace: true });
  }, [hashTaskId, searchParams, setSearchParams, view]);
  const openTask = (task: TaskWithRefs) => {
    const next = new URLSearchParams(searchParams);
    next.set('open', task.id);
    setSearchParams(next);
  };
  const closeTask = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  };
  // defaultMilestoneId — pre-populated when clicking "Add task" within a group.
  const [formTarget, setFormTarget] = useState<{ task: TaskWithRefs | null; defaultMilestoneId?: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskWithRefs | null>(null);
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkDueDate, setBulkDueDate] = useState('');
  const [bulkClearDueDate, setBulkClearDueDate] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const integrationsRef = useRef<HTMLDivElement>(null);

  // T25 — hash-anchor scroll & transient highlight.
  // When the URL contains #task-<id>, scroll that row into view and apply a
  // brief highlight ring so the user immediately sees which task MyTasks linked to.
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const scrolledRef = useRef<string | null>(null);

  useEffect(() => {
    setHighlightedTaskId(null);
  }, [location.hash]);

  useEffect(() => {
    if (!highlightedTaskId) return;
    const timerId = setTimeout(() => setHighlightedTaskId(null), 2000);
    return () => clearTimeout(timerId);
  }, [highlightedTaskId]);

  useEffect(() => {
    const hash = location.hash; // e.g. "#task-abc-123"
    if (!hash.startsWith('#task-')) {
      scrolledRef.current = null;
      return;
    }
    const taskId = hash.slice('#task-'.length);
    // Only scroll once per hash (avoid infinite re-scroll on re-renders).
    if (scrolledRef.current === taskId) return;
    // Attempt to scroll — the element may not yet be rendered (data still loading).
    // requestAnimationFrame gives the list one paint cycle.
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById(`task-${taskId}`);
      if (el) {
        scrolledRef.current = taskId;
        el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        setHighlightedTaskId(taskId);
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  // Re-run when data loads (in case the element wasn't mounted on initial render).
  }, [location.hash, data, view]);

  // Structure write = the row's creator or a delivery manager. `canEditTask` is the per-row answer.
  // ⚑ The first wiring called
  // `may('edit','task')` with NO ctx — the record-scoped predicate fails closed on missing
  // identity, so an Engineer could create a task and then not edit it: the exact incoherence the
  // ruling exists to prevent, invisible to every non-rendered test (3-lens review, C1).
  const route = useTaskRouteState(projectId);
  const routeKnown = route !== 'unknown';
  const canCreate = routeKnown && may('create', 'task');
  const externallyOwned = route === 'external';
  const canEditTask = (task: TaskWithRefs): boolean =>
    routeKnown && may('edit', 'task', {
      currentUserId,
      record: { created_by: task.created_by, assignee_id: task.assignee_id, externallyOwned },
    });
  const canDelete = routeKnown && may('delete', 'task');

  // ADR-0056: the per-task pending-push badge wires in ONLY when task writes route externally
  // (ClickUp-owned). PMO-owned orgs stay byte-for-byte — no badge chrome at all (AC-CUA-061).
  const canArchive = routeKnown && may('archive', 'task');

  // Review fix #5 — one headline for one event: an externally-routed write fails through the SAME
  // vocabulary the badge renders (classifyExternalError), so the toast and the badge never disagree.
  // PMO-owned writes keep the Postgres-code classifier (classifyMutationError).
  const classifyWriteError = (err: unknown) =>
    externallyOwned ? classifyExternalError(err) : classifyMutationError(err);

  const all = useMemo(() => data ?? [], [data]);
  const milestoneList = useMemo(() => milestones ?? [], [milestones]);

  // Archived rows stay out of the working list unless the toolbar disclosure is enabled.
  const visibleTasks = useMemo(
    () => (showArchived ? all : all.filter((t) => t.archived_at == null)),
    [all, showArchived],
  );
  const scopedTasks = useMemo(
    () => scope === 'mine' ? visibleTasks.filter((task) => task.assignee_id === currentUserId) : visibleTasks,
    [currentUserId, scope, visibleTasks],
  );
  const filteredTasks = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    return scopedTasks.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      if (assigneeFilter === 'unassigned' ? task.assignee_id != null : assigneeFilter !== 'all' && task.assignee_id !== assigneeFilter) return false;
      if (!query) return true;
      return task.name.toLocaleLowerCase().includes(query) || task.id.toLocaleLowerCase().includes(query);
    });
  }, [assigneeFilter, scopedTasks, searchText, statusFilter]);
  const selectedTaskId = searchParams.get('open');
  const selectedTask = selectedTaskId ? all.find((task) => task.id === selectedTaskId) ?? null : null;

  /** May the current viewer set THIS task's status? Managers: any; Engineer: own only. */
  const canSetStatus = (t: TaskWithRefs): boolean =>
    routeKnown && may('edit', 'taskStatus', { currentUserId, record: { assignee_id: t.assignee_id } });
  useEffect(() => {
    const taskIds = new Set(all.map((task) => task.id));
    setSelectedTaskIds((current) => {
      const next = new Set([...current].filter((id) => taskIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [all]);
  const selectedTasks = useMemo(() => all.filter((task) => selectedTaskIds.has(task.id)), [all, selectedTaskIds]);
  const canBulkStatus = selectedTasks.length > 0 && selectedTasks.every(canSetStatus);
  const canBulkEdit = selectedTasks.length > 0 && selectedTasks.every(canEditTask);
  const canBulkArchive = canArchive && !externallyOwned && selectedTasks.some((task) => task.archived_at == null);
  const canApplyBulk = bulkAction === 'status' ? canBulkStatus
    : bulkAction === 'archive' ? canBulkArchive
      : canBulkEdit;
  const taskSelection: DataTableSelection<TaskWithRefs> = {
    selectedIds: selectedTaskIds,
    onChange: (ids) => {
      setSelectedTaskIds(ids);
      if (ids.size === 0) setBulkAction(null);
    },
    rowLabel: (task) => t('projectDetail.tasks.selectTask', 'Select task {{name}}', { name: task.name }),
  };

  // When milestones exist, show the grouped layout even when there are no tasks yet
  // so users can see the "Add task" affordance within each group (AC-DEL-011).
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0 && milestoneList.length === 0
        ? 'empty'
        : undefined;

  // ── Mutations ───────────────────────────────────────────────────────────
  // Resolves true when the write landed, false when it was skipped or failed (the board drop rolls back on false).
  const onStatusChange = async (task: TaskWithRefs, status: TaskStatus): Promise<boolean> => {
    if (status === task.status || !canSetStatus(task)) return false;
    try {
      await updateStatus.mutateAsync({ id: task.id, status });
      toast(
        t('projectDetail.tasks.toast.statusUpdated', 'Status updated'),
        t('projectDetail.tasks.toast.statusDetail', '{{task}} is now {{status}}', {
          task: task.name,
          status,
        }),
        'success',
      );
      return true;
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
      return false;
    }
  };

  // Timeline drag / edge-resize (#1980): same gate as editing the task, same classifier as every
  // other task write. Resolves false on failure so the bar snaps back.
  const onReschedule = async (task: TaskWithRefs, patch: TaskPatch): Promise<boolean> => {
    if (!canEditTask(task)) return false;
    try {
      await update.mutateAsync({ id: task.id, patch });
      return true;
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
      return false;
    }
  };

  const onArchive = async (task: TaskWithRefs) => {
    if (!canArchive || externallyOwned) return;
    try {
      await archive.mutateAsync({ id: task.id, archived: task.archived_at == null });
      toast(
        task.archived_at == null
          ? t('projectDetail.tasks.toast.archived', 'Task archived')
          : t('projectDetail.tasks.toast.restored', 'Task restored'),
        task.name,
        'success',
      );
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget || !canDelete) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast(t('projectDetail.tasks.toast.deleted', 'Task deleted'), target.name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  const applyBulkAction = async () => {
    if (!bulkAction || !selectedTasks.length || bulkPending) return;
    if ((bulkAction === 'assignee' || bulkAction === 'due') && !canBulkEdit) return;
    if (bulkAction === 'archive' && !canBulkArchive) return;
    if (bulkAction === 'status' && (!bulkStatus || !canBulkStatus)) return;
    if (bulkAction === 'assignee' && !bulkAssignee) return;
    if (bulkAction === 'due' && !bulkDueDate && !bulkClearDueDate) return;

    const targets = bulkAction === 'archive'
      ? selectedTasks.filter((task) => task.archived_at == null)
      : selectedTasks;
    if (!targets.length) return;

    setBulkPending(true);
    try {
      const results = await Promise.allSettled(targets.map((task) => {
        if (bulkAction === 'status') return updateStatus.mutateAsync({ id: task.id, status: bulkStatus as TaskStatus });
        if (bulkAction === 'assignee') return update.mutateAsync({ id: task.id, patch: { assignee_id: bulkAssignee === '__unassigned__' ? null : bulkAssignee } });
        if (bulkAction === 'due') return update.mutateAsync({ id: task.id, patch: { end_date: bulkClearDueDate ? null : bulkDueDate || null } });
        return archive.mutateAsync({ id: task.id, archived: true });
      }));
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed.length) {
        const { headline, detail } = classifyWriteError(failed[0].reason);
        const succeeded = results.length - failed.length;
        toast(headline, `${t('projectDetail.tasks.bulk.toast.partial', '{{succeeded}} updated; {{failed}} failed. Review the selected tasks and retry.', { succeeded, failed: failed.length })}${detail ? ` ${detail}` : ''}`, 'warning');
        return;
      }
      toast(
        t('projectDetail.tasks.bulk.toast.updated', 'Tasks updated'),
        t('projectDetail.tasks.bulk.toast.detail', '{{count}} tasks updated.', { count: targets.length }),
        'success',
      );
      setSelectedTaskIds(new Set());
      setBulkAction(null);
      setBulkStatus('');
      setBulkAssignee('');
      setBulkDueDate('');
      setBulkClearDueDate(false);
    } finally {
      setBulkPending(false);
    }
  };

  // The task row stays TaskWithRefs end to end; hierarchy is only reflected in the primary cell.
  const buildColumns = useProjectTaskColumns({
    today,
    highlightedTaskId,
    canSetStatus,
    statusBusy: updateStatus.isPending,
    onStatusChange: (row, status) => void onStatusChange(row, status),
    pendingPushByTask,
  });

  const rowMenu = (task: TaskWithRefs): RowMenuItem[] => {
    const items: RowMenuItem[] = [{
      label: t('comments.open', 'Comments'),
      onClick: () => openTask(task),
    }];
    // Merge of #568 (per-row creator gate) and #547 (extraction): the gate decides, the label is
    // translated, and the row param is `task` — `t` belongs to i18next in this scope.
    if (canEditTask(task))
      items.push({
        label: t('projectDetail.tasks.action.edit', 'Edit'),
        onClick: () => setFormTarget({ task }),
      });
    if (canArchive && !externallyOwned) {
      items.push({
        label:
          task.archived_at == null
            ? t('projectDetail.tasks.action.archive', 'Archive')
            : t('projectDetail.tasks.action.unarchive', 'Unarchive'),
        onClick: () => void onArchive(task),
      });
    }
    if (canDelete)
      items.push({
        label: t('projectDetail.tasks.action.delete', 'Delete'),
        onClick: () => setDeleteTarget(task),
        danger: true,
      });
    return items;
  };

  return (
    <div>
      <Card variant={view === 'board' ? 'bare' : undefined} className="min-w-0 overflow-hidden">
      <TasksToolbar
        heading={t('projectDetail.tasks.heading', 'Tasks')}
        toolbarMenuOpen={toolbarMenuOpen}
        setToolbarMenuOpen={setToolbarMenuOpen}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        onClearSelection={() => { setSelectedTaskIds(new Set()); setBulkAction(null); }}
        integrationsRef={integrationsRef}
        canCreate={canCreate}
        onNewTask={() => setFormTarget({ task: null })}
        scope={scope}
        setTaskScope={setTaskScope}
        statusFilter={statusFilter}
        onStatusFilter={(value) => { setStatusFilter(value); setSelectedTaskIds(new Set()); setBulkAction(null); }}
        assigneeFilter={assigneeFilter}
        onAssigneeFilter={(value) => { setAssigneeFilter(value); setSelectedTaskIds(new Set()); setBulkAction(null); }}
        searchText={searchText}
        onSearchText={(value) => { setSearchText(value); setSelectedTaskIds(new Set()); setBulkAction(null); }}
        view={view}
        setTaskView={setTaskView}
        state={state}
        assignableProfiles={assignableProfiles ?? []}
        selectedCount={selectedTasks.length}
        canBulkStatus={canBulkStatus}
        canBulkEdit={canBulkEdit}
        canBulkArchive={canBulkArchive}
        bulkAction={bulkAction}
        setBulkAction={setBulkAction}
        canApplyBulk={canApplyBulk}
        bulkStatus={bulkStatus}
        setBulkStatus={setBulkStatus}
        bulkAssignee={bulkAssignee}
        setBulkAssignee={setBulkAssignee}
        bulkDueDate={bulkDueDate}
        setBulkDueDate={setBulkDueDate}
        bulkClearDueDate={bulkClearDueDate}
        setBulkClearDueDate={setBulkClearDueDate}
        bulkPending={bulkPending}
        onApplyBulk={() => void applyBulkAction()}
        selectedActiveCount={selectedTasks.filter((task) => task.archived_at == null).length}
      />

      {state === 'loading' && (
        <ListState variant="loading" rows={5} className="px-[var(--panel-inset)] pb-[var(--panel-inset)]" />
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('projectDetail.tasks.errorTitle', "Couldn't load tasks")}
          sub={t('projectDetail.tasks.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="check"
          title={t('projectDetail.tasks.emptyTitle', 'No tasks yet')}
          sub={t(
            'projectDetail.tasks.emptySub',
            'Break the project into tasks, assign them to the team, and track each through to Done.',
          )}
        />
      )}

        {state === undefined && all.length > 0 && filteredTasks.length === 0 && <ListState
        variant="empty"
        icon="search"
        title={t('projectDetail.tasks.filteredEmptyTitle', 'No tasks match these filters')}
        sub={t('projectDetail.tasks.filteredEmptySub', 'Try another status, assignee, or search term.')}
        action={{ label: t('projectDetail.tasks.clearFilters', 'Clear filters'), onClick: () => { setStatusFilter('all'); setAssigneeFilter('all'); setSearchText(''); setSelectedTaskIds(new Set()); setBulkAction(null); } }}
      />}

      {state === undefined && (filteredTasks.length > 0 || milestoneList.length > 0) && view === 'list' && (
        <MilestoneGroupedList
          milestones={milestoneList}
          tasks={filteredTasks}
          sourceTasks={scopedTasks}
          today={today}
          buildColumns={buildColumns}
          canCreate={canCreate}
          rowMenu={rowMenu}
          hashTaskId={hashTaskId}
          selection={taskSelection}
          onAddTask={(milestoneId) => setFormTarget({ task: null, defaultMilestoneId: milestoneId })}
          onActivate={openTask}
        />
      )}

      {state === undefined && view === 'board' && (
        <TaskBoard
          tasks={filteredTasks}
          canSetStatus={canSetStatus}
          onStatusChange={onStatusChange}
          onActivate={openTask}
          rowMenu={rowMenu}
          today={today}
          statusBusy={updateStatus.isPending}
          externallyOwned={externallyOwned}
          pendingPushByTask={pendingPushByTask}
          orgId={currentUser?.org_id}
          projectId={projectId}
        />
      )}

      {state === undefined && view === 'timeline' && (
        <ProjectGantt
          tasks={filteredTasks}
          milestones={milestoneList}
          onSwitchView={setTaskView}
          onActivateTask={openTask}
          rowMenu={rowMenu}
          canReschedule={canEditTask}
          onReschedule={onReschedule}
        />
      )}

      {state === undefined && view === 'calendar' && (
        <React.Suspense fallback={null}>
        <TaskCalendarView
          projectId={projectId}
          tasks={filteredTasks}
          milestones={milestoneList}
          canEditTask={canEditTask}
          onMove={(id, patch) => update.mutateAsync({ id, patch })}
          onMoveError={(err) => {
            const { headline, detail } = classifyWriteError(err);
            toast(headline, detail, 'warning');
          }}
          onOpenTask={openTask}
        />
        </React.Suspense>
      )}
      </Card>

      {/* Setup stays available after the task register so it does not block daily task work. */}
      <div ref={integrationsRef}>
        <ProjectIntegrationsCard projectId={projectId} projectName={projectName} />
      </div>

      <TaskRecordDrawer
        task={selectedTask}
        allTasks={all}
        projectId={projectId}
        canEdit={selectedTask ? canEditTask(selectedTask) : false}
        canArchive={selectedTask ? canArchive && !externallyOwned : false}
        canDelete={selectedTask ? canDelete : false}
        externallyOwned={externallyOwned}
        pendingPush={selectedTask ? (pendingPushByTask[selectedTask.id] ?? IDLE_PENDING_PUSH) : IDLE_PENDING_PUSH}
        openEdit={(task) => setFormTarget({ task })}
        onArchive={(task) => void onArchive(task)}
        onDelete={(task) => setDeleteTarget(task)}
        openTask={openTask}
        onClose={closeTask}
        nestedOpen={!!(formTarget && (formTarget.task ? canEditTask(formTarget.task) : canCreate)) || (!!deleteTarget && canDelete)}
      />

      {/* Create / edit modal */}
      {formTarget && (formTarget.task ? canEditTask(formTarget.task) : canCreate) && (
        <TaskFormModal
          key={formTarget.task?.id ?? 'new'}
          task={formTarget.task}
          projectId={projectId}
          allTasks={all}
          defaultMilestoneId={formTarget.defaultMilestoneId ?? null}
          milestones={milestoneList}
          pendingPushState={
            formTarget.task && externallyOwned
              ? (pendingPushByTask[formTarget.task.id] ?? IDLE_PENDING_PUSH)
              : IDLE_PENDING_PUSH
          }
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast(t('projectDetail.tasks.toast.created', 'Task created'), input.name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, patch, deps) => {
            await update.mutateAsync({ id, patch });
            // Reconcile dependency edges (add new, remove dropped).
            for (const d of deps.add) await addDependency.mutateAsync({ taskId: id, dependsOnId: d });
            for (const d of deps.remove)
              await removeDependency.mutateAsync({ taskId: id, dependsOnId: d });
            toast(
              t('projectDetail.tasks.toast.updated', 'Task updated'),
              patch.name ?? t('projectDetail.tasks.fallbackName', 'Task'),
              'success',
            );
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyWriteError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Delete confirm (destructive tone) */}
      <ConfirmDialog
        open={!!deleteTarget && canDelete}
        tone="destructive"
        title={
          deleteTarget
            ? `${t('projectDetail.tasks.action.delete', 'Delete')} ${deleteTarget.name}?`
            : t('projectDetail.tasks.deleteConfirm.titleFallback', 'Delete task?')
        }
        description={t(
          'projectDetail.tasks.deleteConfirm.body',
          "This permanently removes the task and any dependency links to it. This can't be undone.",
        )}
        confirmLabel={t('projectDetail.tasks.deleteConfirm.confirm', 'Delete task')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default TasksTab;
