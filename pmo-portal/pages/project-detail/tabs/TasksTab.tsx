import React, { useCallback, useDeferredValue, useMemo, useState, useEffect, useRef } from 'react';
import {
  ListState,
  Card,
  ConfirmDialog,
  useToast,
  type RowMenuItem,
  type DataTableSelection,
} from '@/src/components/ui';
import { ProjectIntegrationsCard } from '@/src/components/projects/ProjectIntegrationsCard';
import { StackedBar } from '@/src/components/projects/StackedBar';
import { statusLabel } from '@/src/lib/status/statusMap';
import { useLocation, useSearchParams } from 'react-router';
import { scrollBehavior } from '@/src/lib/motion';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useTasks, useTaskMutations, useAssignableProfiles } from '@/src/hooks/useTasks';
import { useTaskSourceIssues } from '@/src/hooks/useTaskSourceIssues';
import { useMilestones } from '@/src/hooks/useMilestones';
import { useTaskGroups } from '@/src/hooks/useTaskGroups';
import { buildRollups, collectDescendants, countedTasks } from '@/src/lib/tasks/taskTree';
import type { SubtaskDraft, TaskInput } from '@/src/lib/db/tasks';
import { MoveTaskDialog, NewGroupingDialog } from './TaskOutlineDialogs';
import { placePatch } from './taskViewModel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { classifyExternalError } from '@/src/lib/adapterSeam/pendingPush';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useTaskRouteState } from '@/src/hooks/useOwnershipCacheSync';
import { IDLE_PENDING_PUSH, type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { recordLinkOf, type TaskWithRefs, type TaskStatus, type TaskPatch } from '@/src/lib/db/tasks';
import ProjectGantt from '../ProjectGantt';

// The ReUI calendar is ~100 KB; only the Calendar view pays for it.
const TaskCalendarView = React.lazy(() => import('./TaskCalendarView').then((m) => ({ default: m.TaskCalendarView })));
import TaskBoard from './TaskBoard';
import TaskFormModal from './TaskFormModal';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import MilestoneGroupedList from './MilestoneGroupedList';
import TaskGroupsPanel from './TaskGroupsPanel';
import { useProjectTaskColumns } from './TaskList';
import TaskRecordDrawer from './TaskRecordDrawer';
import TasksToolbar from './TasksToolbar';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import type { ViewMode, TaskScope, BulkAction } from './taskViewModel';

/** #2104: hoisted once. A fresh `{}` per render handed the memoised task tables a new prop identity
 *  on every render even when nothing was pending. */
const EMPTY_PENDING_PUSH: Record<string, PendingPushState> = {};

export interface TasksTabProps {
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
  // Load the refusal catalogue before a task write can need it.
  useTranslation('refusals');
  const { t: tStatus } = useTranslation('status');
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const organizationDay = useFxOrgDay(true).day;
  // #2088: the fallback for a missing fx org-day read is still an ORGANIZATION-day read
  // (useOrgToday), never the viewer device's local day.
  const orgToday = useOrgToday();
  const today = organizationDay ?? orgToday;
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useTasks(projectId);
  useEffect(() => {
    onCountChange?.(isPending || isError || data == null ? null : data.length);
  }, [data, isError, isPending, onCountChange]);
  const { data: assignableProfiles } = useAssignableProfiles();
  const { create, createTree, update, updateStatus, remove, archive, addDependency, removeDependency, pendingPushByTask = EMPTY_PENDING_PUSH } =
    useTaskMutations(projectId);
  // #2104: the mutation objects are re-created every render but `mutateAsync` is not, so the write
  // callbacks below depend on the function and keep their identity.
  const updateStatusAsync = updateStatus.mutateAsync;
  const updateAsync = update.mutateAsync;
  const archiveAsync = archive.mutateAsync;
  const { data: milestones } = useMilestones(projectId);
  const { data: taskGroupRows } = useTaskGroups(projectId);
  // #2679: the group manager stays out of the tab until the project has a group or a manager asks for it from the menu.
  const [groupsRequested, setGroupsRequested] = useState(false);
  const activeTaskGroups = useMemo(() => (taskGroupRows ?? []).filter((g) => !g.archived_at), [taskGroupRows]);
  const { data: workOrders } = useProjectWorkOrders(projectId);
  // #2531: the work-order link and proof flag are structure edits (migration 0991 refuses any other writer).
  const canStructure = realRole === 'Admin' || realRole === 'Executive' || realRole === 'Project Manager';
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
  /** #2104: clear the row selection only when there IS one. Re-seating an empty `Set` on every
   *  keystroke gave `taskSelection` (and the grouped table) a new identity with nothing selected. */
  const clearSelection = useCallback(() => {
    setSelectedTaskIds((current) => (current.size === 0 ? current : new Set()));
    setBulkAction(null);
  }, []);
  const setTaskView = useCallback((nextView: ViewMode) => {
    clearSelection();
    const next = new URLSearchParams(searchParams);
    next.set('scope', scope);
    next.set('view', nextView);
    setSearchParams(next, { replace: true });
  }, [clearSelection, scope, searchParams, setSearchParams]);
  const setTaskScope = useCallback((nextScope: TaskScope) => {
    clearSelection();
    const next = new URLSearchParams(searchParams);
    next.set('scope', nextScope);
    next.set('view', view);
    setSearchParams(next, { replace: true });
  }, [clearSelection, view, searchParams, setSearchParams]);
  // Project task links promise a scroll target. A saved view in the URL should not
  // strand a hash deep link on a board or timeline where the list anchor is absent.
  useEffect(() => {
    if (!hashTaskId || view === 'list') return;
    const next = new URLSearchParams(searchParams);
    next.set('view', 'list');
    setSearchParams(next, { replace: true });
  }, [hashTaskId, searchParams, setSearchParams, view]);
  // #2905: opening the drawer writes ?open=, so `searchParams` — and with it react-router's
  // `setSearchParams` — changes identity on every drawer toggle. `onOpenTask` sits among the
  // columns' deps (#2104: stable callbacks so the memoised tables bail out), so the callback
  // reads the router through a latest ref and keeps ONE identity for the page's life; the
  // updater form still sees the fresh params at call time.
  const setSearchParamsRef = useRef(setSearchParams);
  useEffect(() => { setSearchParamsRef.current = setSearchParams; }, [setSearchParams]);
  const openTask = useCallback((task: TaskWithRefs) => {
    setSearchParamsRef.current((current) => {
      const next = new URLSearchParams(current);
      next.set('open', task.id);
      return next;
    });
  }, []);
  const closeTask = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  // defaultMilestoneId / defaultTaskGroupId — pre-populated when clicking "Add task" within a section;
  // addSubtask opens the task's form with one subtask row ready (#2807).
  const [formTarget, setFormTarget] = useState<{ task: TaskWithRefs | null; defaultMilestoneId?: string | null; defaultTaskGroupId?: string | null; addSubtask?: boolean } | null>(null);
  const [moveTarget, setMoveTarget] = useState<TaskWithRefs | null>(null);
  const [newGrouping, setNewGrouping] = useState<'group' | 'phase' | null>(null);
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
  const [workOrderFilter, setWorkOrderFilter] = useState('all');
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
  const canEditTask = useCallback((task: TaskWithRefs): boolean =>
    routeKnown && may('edit', 'task', {
      currentUserId,
      record: { created_by: task.created_by, assignee_id: task.assignee_id, externallyOwned },
    }), [currentUserId, externallyOwned, may, routeKnown]);
  const canDelete = routeKnown && may('delete', 'task');
  // #2587 FR-RLT-004: clearing a record link follows the same per-row scope the database enforces.
  const canLinkTask = useCallback((task: TaskWithRefs): boolean =>
    routeKnown && may('link', 'task', {
      currentUserId,
      record: { created_by: task.created_by, assignee_id: task.assignee_id, externallyOwned },
    }), [currentUserId, externallyOwned, may, routeKnown]);

  // ADR-0056: the per-task pending-push badge wires in ONLY when task writes route externally
  // (ClickUp-owned). PMO-owned orgs stay byte-for-byte — no badge chrome at all (AC-CUA-061).
  const canArchive = routeKnown && may('archive', 'task');

  // Review fix #5 — one headline for one event: an externally-routed write fails through the SAME
  // vocabulary the badge renders (classifyExternalError), so the toast and the badge never disagree.
  // PMO-owned writes keep the Postgres-code classifier (classifyMutationError).
  const classifyWriteError = useCallback((err: unknown) =>
    externallyOwned ? classifyExternalError(err) : classifyMutationError(err), [externallyOwned]);

  const all = useMemo(() => data ?? [], [data]);
  // #2807: a parent's figures come from its leaves, over the whole project (a filter never changes them).
  const rollups = useMemo(() => buildRollups(all), [all]);
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
  // #2104: the filter runs on the DEFERRED search text, so a keystroke commits the input at urgent
  // priority and the filtered set, tables and column builder recompute once in the deferred commit.
  const deferredSearchText = useDeferredValue(searchText);
  const filteredTasks = useMemo(() => {
    const query = deferredSearchText.trim().toLocaleLowerCase();
    return scopedTasks.filter((task) => {
      if (workOrderFilter === 'none' ? task.work_order_id != null : workOrderFilter !== 'all' && task.work_order_id !== workOrderFilter) return false;
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      if (assigneeFilter === 'unassigned' ? task.assignee_id != null : assigneeFilter !== 'all' && task.assignee_id !== assigneeFilter) return false;
      if (!query) return true;
      return task.name.toLocaleLowerCase().includes(query) || task.id.toLocaleLowerCase().includes(query);
    });
  }, [assigneeFilter, deferredSearchText, scopedTasks, statusFilter, workOrderFilter]);
  // Each piece of work counts once: a parent is a roll-up (countedTasks), so the status mix and the board read leaves.
  const countedIds = useMemo(() => new Set(countedTasks(all).map((x) => x.id)), [all]);
  const countedScoped = useMemo(() => scopedTasks.filter((x) => countedIds.has(x.id) || x.archived_at != null), [countedIds, scopedTasks]);
  const leafTasks = useMemo(() => filteredTasks.filter((x) => !rollups.has(x.id)), [filteredTasks, rollups]);
  const selectedTaskId = searchParams.get('open');
  const selectedTask = selectedTaskId ? all.find((task) => task.id === selectedTaskId) ?? null : null;

  /** May the current viewer set THIS task's status? Managers: any; Engineer: own only. */
  const canSetStatus = useCallback((t: TaskWithRefs): boolean =>
    routeKnown && may('edit', 'taskStatus', { currentUserId, record: { assignee_id: t.assignee_id } }),
  [currentUserId, may, routeKnown]);
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
  const taskSelection: DataTableSelection<TaskWithRefs> = useMemo(() => ({
    selectedIds: selectedTaskIds,
    onChange: (ids) => {
      setSelectedTaskIds(ids);
      if (ids.size === 0) setBulkAction(null);
    },
    rowLabel: (task) => t('projectDetail.tasks.selectTask', 'Select task {{name}}', { name: task.name }),
  }), [selectedTaskIds, t]);

  // When milestones exist, show the grouped layout even when there are no tasks yet
  // so users can see the "Add task" affordance within each group (AC-DEL-011).
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0 && milestoneList.length === 0 && activeTaskGroups.length === 0
        ? 'empty'
        : undefined;

  // ── Mutations ───────────────────────────────────────────────────────────
  // Resolves true when the write landed, false when it was skipped or failed (the board drop rolls back on false).
  const onStatusChange = useCallback(async (task: TaskWithRefs, status: TaskStatus): Promise<boolean> => {
    if (status === task.status || !canSetStatus(task)) return false;
    try {
      await updateStatusAsync({ id: task.id, status });
      toast(
        t('projectDetail.tasks.toast.statusUpdated', 'Status updated'),
        t('projectDetail.tasks.toast.statusDetail', '{{task}} is now {{status}}', {
          task: task.name,
          status: statusLabel('task', status, t),
        }),
        'success',
      );
      return true;
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
      return false;
    }
  }, [canSetStatus, classifyWriteError, t, toast, updateStatusAsync]);
  // The columns' write seam (#2104): a stable identity so the memoised tables keep theirs.
  const onRowStatusChange = useCallback(
    (row: TaskWithRefs, status: TaskStatus) => void onStatusChange(row, status),
    [onStatusChange],
  );

  // Timeline drag / edge-resize (#1980): same gate as editing the task, same classifier as every
  // other task write. Resolves false on failure so the bar snaps back.
  const onReschedule = useCallback(async (task: TaskWithRefs, patch: TaskPatch): Promise<boolean> => {
    if (!canEditTask(task)) return false;
    try {
      await updateAsync({ id: task.id, patch });
      return true;
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
      return false;
    }
  }, [canEditTask, classifyWriteError, toast, updateAsync]);

  const onUnlink = useCallback(async (task: TaskWithRefs) => {
    if (!canLinkTask(task)) return;
    try {
      await updateAsync({ id: task.id, patch: { procurement_id: null, expense_claim_id: null, material_request_id: null } });
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
    }
  }, [canLinkTask, classifyWriteError, toast, updateAsync]);

  const onArchive = useCallback(async (task: TaskWithRefs) => {
    if (!canArchive || externallyOwned) return;
    try {
      await archiveAsync({ id: task.id, archived: task.archived_at == null });
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
  }, [archiveAsync, canArchive, classifyWriteError, externallyOwned, t, toast]);

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
      clearSelection();
      setBulkStatus('');
      setBulkAssignee('');
      setBulkDueDate('');
      setBulkClearDueDate(false);
    } finally {
      setBulkPending(false);
    }
  };

  // The task row stays TaskWithRefs end to end; hierarchy is only reflected in the primary cell.
  // #2104: every entry is a stable callback or a primitive, so the column factory keeps its identity
  // across unrelated re-renders and the memoised tables bail out.
  // JOB-F17: the source-issue read is one per page; the Map itself is the read's cached result, so its
  // identity changes only when a refetch lands.
  const sourceIssues = useTaskSourceIssues(all.map((task) => task.id));
  const sourceIssueMap = useMemo(() => sourceIssues.data ?? new Map<string, string>(), [sourceIssues.data]);
  const taskColumnDeps = useMemo(() => ({
    today,
    highlightedTaskId,
    sourceIssues: sourceIssueMap,
    onOpenTask: openTask,
    canSetStatus,
    statusBusy: updateStatus.isPending,
    onStatusChange: onRowStatusChange,
    pendingPushByTask,
  }), [highlightedTaskId, sourceIssueMap, openTask, canSetStatus, onRowStatusChange, pendingPushByTask, today, updateStatus.isPending]);
  const buildColumns = useProjectTaskColumns(taskColumnDeps);

  const rowMenu = useCallback((task: TaskWithRefs): RowMenuItem[] => {
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
    if (canCreate && canEditTask(task) && task.archived_at == null)
      items.push({
        label: t('projectDetail.tasks.action.addSubtask', 'Add subtask'),
        onClick: () => setFormTarget({ task, addSubtask: true }),
      });
    if (canEditTask(task) && task.archived_at == null)
      items.push({
        label: t('projectDetail.tasks.action.move', 'Move…'),
        onClick: () => setMoveTarget(task),
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
  }, [canArchive, canCreate, canDelete, canEditTask, externallyOwned, onArchive, openTask, t]);

  // Stable per-group "Add task" seam (#2104): the grouped table's memo compares this prop.
  const onAddTaskInGroup = useCallback(
    ({ milestoneId, taskGroupId }: { milestoneId: string | null; taskGroupId: string | null }) =>
      setFormTarget({ task: null, defaultMilestoneId: milestoneId, defaultTaskGroupId: taskGroupId }),
    [],
  );

  /** Saves the subtask rows typed in the form under `parent` (a new or an existing task), in one request. */
  const saveSubtasks = useCallback(async (root: TaskInput | null, parent: TaskWithRefs | null, drafts: SubtaskDraft[]) => {
    const place = parent
      ? { project_id: projectId, milestone_id: parent.milestone_id ?? null, task_group_id: canStructure ? (parent as TaskWithRefs & { task_group_id?: string | null }).task_group_id ?? null : null }
      : { project_id: projectId, milestone_id: root?.milestone_id ?? null, task_group_id: canStructure ? root?.task_group_id ?? null : null };
    await createTree.mutateAsync([root, parent?.id ?? null, drafts, place]);
  }, [canStructure, createTree, projectId]);

  /** Move: the parent on the task; the new place on the task and every subtask, so a branch stays in one group. */
  const onMove = useCallback(async (task: TaskWithRefs, parentTaskId: string | null, place: string | null) => {
    const placed = place === null ? null : placePatch(place);
    if (placed && !canStructure) delete placed.task_group_id; // a group write is a structure edit (database-enforced)
    await update.mutateAsync({ id: task.id, patch: { ...(parentTaskId !== (task.parent_task_id ?? null) ? { parent_task_id: parentTaskId } : {}), ...(placed ?? {}) } });
    if (placed) {
      const results = await Promise.allSettled([...collectDescendants(task.id, all)].map((id) => update.mutateAsync({ id, patch: placed })));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    }
    toast(t('projectDetail.tasks.toast.moved', 'Task moved'), task.name, 'success');
    setMoveTarget(null);
  }, [all, canStructure, t, toast, update]);

  return (
    <div className="min-w-0 space-y-[var(--space-section)]">
      <Card variant={view === 'board' ? 'bare' : undefined} className="min-w-0 overflow-hidden">
      <TasksToolbar
        heading={t('projectDetail.tasks.heading', 'Tasks')}
        toolbarMenuOpen={toolbarMenuOpen}
        setToolbarMenuOpen={setToolbarMenuOpen}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        onClearSelection={clearSelection}
        integrationsRef={integrationsRef}
        onManageTaskGroups={may('edit', 'milestone') ? () => setGroupsRequested(true) : undefined}
        canCreate={canCreate}
        onNewTask={() => setFormTarget({ task: null })}
        onNewGroup={may('edit', 'milestone') ? () => setNewGrouping('group') : undefined}
        onNewPhase={may('create', 'milestone') ? () => setNewGrouping('phase') : undefined}
        scope={scope}
        setTaskScope={setTaskScope}
        workOrderFilter={workOrderFilter}
        onWorkOrderFilter={(value) => { setWorkOrderFilter(value); clearSelection(); }}
        workOrderOptions={(workOrders ?? []).map((w) => ({ value: w.id, label: w.wo_number ? `${w.wo_number} · ${w.title}` : w.title }))}
        statusFilter={statusFilter}
        onStatusFilter={(value) => { setStatusFilter(value); clearSelection(); }}
        assigneeFilter={assigneeFilter}
        onAssigneeFilter={(value) => { setAssigneeFilter(value); clearSelection(); }}
        searchText={searchText}
        onSearchText={(value) => { setSearchText(value); clearSelection(); }}
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

      {/* Parts of a whole: where the work stands. Blocked is the one accent. */}
      {state !== 'loading' && state !== 'error' && countedScoped.length >= 3 && (
        <div className="px-[var(--panel-inset)] pb-3">
          <StackedBar
            ariaLabel={t('projectDetail.tasks.statusMix', 'Tasks by status')}
            otherLabel={t('projectDetail.tasks.statusMixOther', 'Other')}
            segments={(['To Do', 'In Progress', 'Blocked', 'Done'] as const).map((status) => ({
              key: status,
              label: statusLabel('task', status, tStatus),
              value: countedScoped.filter((task) => task.status === status).length,
              display: String(countedScoped.filter((task) => task.status === status).length),
              accent: status === 'Blocked',
            }))}
          />
        </div>
      )}

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
        action={{ label: t('projectDetail.tasks.clearFilters', 'Clear filters'), onClick: () => { setStatusFilter('all'); setAssigneeFilter('all'); setWorkOrderFilter('all'); setSearchText(''); clearSelection(); } }}
      />}

      {state === undefined && groupsRequested && <TaskGroupsPanel projectId={projectId} tasks={all} milestones={milestoneList} requested={groupsRequested} />}

      {state === undefined && (filteredTasks.length > 0 || milestoneList.length > 0 || activeTaskGroups.length > 0) && view === 'list' && (
        <MilestoneGroupedList
          milestones={milestoneList}
          taskGroups={activeTaskGroups}
          rollups={rollups}
          tasks={filteredTasks}
          sourceTasks={scopedTasks}
          today={today}
          buildColumns={buildColumns}
          canCreate={canCreate}
          rowMenu={rowMenu}
          hashTaskId={hashTaskId}
          selection={taskSelection}
          onAddTask={onAddTaskInGroup}
          onActivate={openTask}
        />
      )}

      {state === undefined && view === 'board' && (
        <TaskBoard
          tasks={leafTasks}
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
          allTasks={all}
          taskGroups={activeTaskGroups}
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
          tasks={leafTasks}
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
        onUnlink={selectedTask && recordLinkOf(selectedTask) && canLinkTask(selectedTask) ? onUnlink : undefined}
        nestedOpen={!!(formTarget && (formTarget.task ? canEditTask(formTarget.task) : canCreate)) || (!!deleteTarget && canDelete)}
        proof={selectedTask ? {
          canAttach: !externallyOwned && (canStructure || (!!currentUserId && selectedTask.assignee_id === currentUserId)),
          canSetStatus: canSetStatus(selectedTask),
          onMarkDone: async (task) => { await onStatusChange(task, 'Done'); },
        } : undefined}
      />

      {/* Create / edit modal */}
      {formTarget && (formTarget.task ? canEditTask(formTarget.task) : canCreate) && (
        <TaskFormModal
          key={formTarget.task?.id ?? 'new'}
          task={formTarget.task}
          projectId={projectId}
          allTasks={all}
          defaultMilestoneId={formTarget.defaultMilestoneId ?? null}
          defaultTaskGroupId={formTarget.defaultTaskGroupId ?? null}
          startWithSubtask={!!formTarget.addSubtask}
          milestones={milestoneList}
          taskGroups={activeTaskGroups}
          workOrders={workOrders ?? []}
          canStructure={canStructure && !externallyOwned}
          pendingPushState={
            formTarget.task && externallyOwned
              ? (pendingPushByTask[formTarget.task.id] ?? IDLE_PENDING_PUSH)
              : IDLE_PENDING_PUSH
          }
          onClose={() => setFormTarget(null)}
          onCreate={async (input, subtasks) => {
            if (subtasks.length) await saveSubtasks(input, null, subtasks);
            else await create.mutateAsync(input);
            toast(t('projectDetail.tasks.toast.created', 'Task created'), input.name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, patch, deps, subtasks) => {
            await update.mutateAsync({ id, patch });
            if (subtasks.length && formTarget.task) await saveSubtasks(null, formTarget.task, subtasks);
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

      {moveTarget && canEditTask(moveTarget) && (
        <MoveTaskDialog
          task={moveTarget}
          allTasks={all}
          milestones={milestoneList}
          taskGroups={activeTaskGroups}
          canGroup={canStructure && !externallyOwned}
          onClose={() => setMoveTarget(null)}
          onMove={(parentTaskId, place) => onMove(moveTarget, parentTaskId, place)}
          onError={(err) => {
            const { headline, detail } = classifyWriteError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {newGrouping && (
        <NewGroupingDialog
          kind={newGrouping}
          projectId={projectId}
          milestones={milestoneList}
          onDone={() => setNewGrouping(null)}
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
