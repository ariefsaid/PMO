import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  Drawer,
  Tooltip,
  ProgressBar,
  Kanban,
  KanbanColumn,
  ConfirmDialog,
  EntityFormModal,
  type SubmitError,
  TextField,
  TextArea,
  SelectField,
  Combobox,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
  Button,
  buttonClasses,
  Card,
  MenuButton,
  Checkbox,
  Icon,
  type Column,
  type RowMenuItem,
  type DataTableSelection,
  type ComboboxOption,
} from '@/src/components/ui';
import { ProjectIntegrationsCard } from '@/src/components/projects/ProjectIntegrationsCard';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useTasks, useTaskMutations, useAssignableProfiles } from '@/src/hooks/useTasks';
import { useMilestones } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { classifyExternalError } from '@/src/lib/adapterSeam/pendingPush';
import { completionPct, formatDateOnly } from '@/src/lib/format';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useTaskRouteState } from '@/src/hooks/useOwnershipCacheSync';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import type { TaskWithRefs, TaskStatus, TaskPriority, TaskInput, TaskPatch } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { buildTaskRenderOrder, collectDescendants } from '@/src/lib/tasks/taskTree';
import ProjectGantt from '../ProjectGantt';
import { CommentsSection } from '@/src/components/comments/CommentsSection';
import { RecordHistory } from '@/src/components/history/RecordHistory';

/**
 * OD-INT-9 subtask nesting — the horizontal indent applied per depth level in the Task-name
 * cell. A multiple of the DESIGN.md `spacing.base` token (4px), NOT an ad-hoc pixel value.
 */
const SUBTASK_INDENT_PX = 16;

// ── Status vocabulary ───────────────────────────────────────────────────────
// The four task_status enum values. The pill variant comes from the single status
// registry (`workflowVariant`): To Do = quiet neutral, In Progress = neutral grey
// `progress` (NOT the action-blue, per the Freed-Blue Status Rule), Done = green
// `won`, Blocked = red `lost`. The distinct LABEL always rides alongside (never
// colour-only — DESIGN.md Tinted-Status / color-not-only).
// ⛔ NOT TRANSLATED, deliberately: these ARE the task_status enum values, and they are used
// as both the option value and its label. They also render raw next to this control via
// <StatusPill>{task.status}</StatusPill>, so translating one side alone would show the same
// status in two languages side by side. Status vocabulary is one cross-cutting decision
// (it also covers doc status, procurement stages and pipeline stages) -- not this file's.
const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
const BOARD_STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Blocked', 'Done'];
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s }));

// OD-INT-9 — the four task_priority enum values, for the Priority select. The first option is the
// explicit unset (value="" → null): the column is nullable, so "no priority" must stay expressible
// AND clearable (a disabled placeholder couldn't be re-selected after a value was set).
const PRIORITIES: TaskPriority[] = ['Urgent', 'High', 'Normal', 'Low'];
/** ⚑ The four priority labels are the DB enum values themselves (untranslated -- see
 *  the status-vocabulary note in the handover); only the leading unset option is UI copy. */
const priorityOptions = (t: TFunction) => [
  { value: '', label: t('projectDetail.tasks.noPriority', 'No priority') },
  ...PRIORITIES.map((p) => ({ value: p, label: p })),
];

type ViewMode = 'list' | 'board' | 'timeline';
type TaskScope = 'mine' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysLate(dueDate: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

function compareTaskUrgency(a: TaskWithRefs, b: TaskWithRefs): number {
  const aDone = a.status === 'Done';
  const bDone = b.status === 'Done';
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (a.end_date && b.end_date) return a.end_date.localeCompare(b.end_date);
  if (a.end_date) return -1;
  if (b.end_date) return 1;
  return 0;
}

function orderedTasks(tasks: TaskWithRefs[]): TaskWithRefs[] {
  return buildTaskRenderOrder(tasks)
    .map((entry, index) => ({ task: entry.task, index }))
    .sort((a, b) => compareTaskUrgency(a.task, b.task) || a.index - b.index)
    .map(({ task }) => task);
}

interface FormValues {
  name: string;
  status: TaskStatus;
  assignee_id: string;
  start_date: string;
  end_date: string;
  description: string;
  priority: string;
}

const validate = (v: FormValues, t: TFunction): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim())
    errors.name = t('projectDetail.tasks.form.errors.nameRequired', 'Task name is required.');
  return errors;
};

interface EditableTaskStatusProps {
  task: TaskWithRefs;
  editable: boolean;
  disabled: boolean;
  pendingPush: import('@/src/lib/adapterSeam/pendingPush').PendingPushState;
  onChange: (task: TaskWithRefs, status: TaskStatus) => void;
}

const EditableTaskStatus: React.FC<EditableTaskStatusProps> = ({ task, editable, disabled, pendingPush, onChange }) => {
  const { t } = useTranslation('project');
  const [editing, setEditing] = useState(false);
  const selectContainerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = `${t('projectDetail.tasks.statusFor', 'Status for')} ${task.name}`;

  useEffect(() => {
    if (editing) selectContainerRef.current?.querySelector('select')?.focus();
  }, [editing]);

  const status = editable ? (
    editing ? (
      <div ref={selectContainerRef}>
        <SelectField
          hideLabel
          label={label}
          value={task.status}
          disabled={disabled}
          onChange={(value) => {
            setEditing(false);
            onChange(task, value as TaskStatus);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
              buttonRef.current?.focus();
            }
          }}
          onBlur={() => setEditing(false)}
          options={STATUS_OPTIONS}
          className="w-auto min-w-[108px]"
        />
      </div>
    ) : (
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="touch-target inline-flex min-h-8 items-center rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
      </button>
    )
  ) : (
    <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
  );

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {status}
      <TaskPushBadge state={pendingPush} />
    </div>
  );
};

const TaskActionsDisclosure: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const { t } = useTranslation('project');
  const [open, setOpen] = useState(false);
  const closeOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const details = event.currentTarget.closest('details');
    details?.removeAttribute('open');
    setOpen(false);
    details?.querySelector('summary')?.focus();
  };
  return <details className="relative shrink-0" onToggle={(event) => setOpen(event.currentTarget.open)} onClick={(event) => event.stopPropagation()} onKeyDown={closeOnEscape}>
    <summary role="button" aria-label={t('table.rowActions', 'Row actions')} aria-haspopup="menu" aria-expanded={open} className="touch-target grid size-8 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <span aria-hidden="true" className="text-base leading-none">⋯</span>
    </summary>
    <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
      {items.map((item) => <button key={item.label} role="menuitem" type="button" disabled={item.disabled} className={`block min-h-8 w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-accent disabled:opacity-50${item.danger ? ' text-destructive-text' : ''}`} onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.closest('details')?.removeAttribute('open');
        item.onClick();
      }}>{item.label}</button>)}
    </div>
  </details>;
};

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
  const view: ViewMode = requestedView === 'board' || requestedView === 'timeline' ? requestedView : 'list';
  const hashTaskId = location.hash.startsWith('#task-') ? location.hash.slice('#task-'.length) : null;
  const requestedScope = searchParams.get('scope');
  const scope: TaskScope = requestedScope === 'mine' || requestedScope === 'all'
    ? requestedScope
    : realRole === 'Engineer' ? 'mine' : 'all';
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
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<'status' | 'assignee' | 'due' | 'archive' | null>(null);
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkDueDate, setBulkDueDate] = useState('');
  const [bulkClearDueDate, setBulkClearDueDate] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
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
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  const onStatusChange = async (task: TaskWithRefs, status: TaskStatus) => {
    if (status === task.status || !canSetStatus(task)) return;
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
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
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
  const buildColumns = (depths: Map<string, number>): Column<TaskWithRefs>[] => [
    {
      key: 'name',
      header: t('projectDetail.tasks.column.task', 'Task'),
      kind: 'primary',
      primaryTitle: (task) => task.name,
      cell: (task) => {
        const depth = depths.get(task.id) ?? 0;
        return <span
          id={`task-${task.id}`}
          className={`block whitespace-normal break-words font-semibold${highlightedTaskId === task.id ? ' ring-2 ring-primary ring-offset-1 rounded task-highlight' : ''}`}
          style={depth > 0 ? { paddingLeft: depth * SUBTASK_INDENT_PX } : undefined}
          title={task.name}
        >
          {depth > 0 && <span className="sr-only">{`${t('projectDetail.tasks.subtaskLevel', 'Subtask, level')} ${depth}. `}</span>}
          {task.name}
        </span>;
      },
      secondaryCell: (task) => task.priority ? (
        <span className="text-xs font-normal text-muted-foreground" title={t('projectDetail.tasks.prioritySource', 'Source: task priority field')}>{task.priority}</span>
      ) : null,
    },
    {
      key: 'assignee',
      header: t('projectDetail.tasks.column.assignee', 'Assignee'),
      cell: (task) => {
        if (!task.assignee) return <span className="text-muted-foreground">{t('projectDetail.tasks.unassigned', 'Unassigned')}</span>;
        const initials = task.assignee.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
        return <span className="inline-flex min-w-0 items-center gap-2" title={task.assignee.full_name}>
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{initials}</span>
          <span className="truncate text-muted-foreground">{task.assignee.full_name}</span>
        </span>;
      },
      colClassName: 'hidden sm:table-cell',
    },
    {
      key: 'due',
      header: t('projectDetail.tasks.column.due', 'Due'),
      kind: 'date',
      size: 260,
      cell: (task) => task.end_date ? <Tooltip content={t(
        'projectDetail.tasks.dueTooltip',
        'Due date from the task record. Late days compare the due date with today in the organization timezone.',
      )}>
        <span tabIndex={0} className={`block whitespace-normal break-words tabular ${task.status !== 'Done' && task.end_date < today ? 'text-destructive-text' : 'text-muted-foreground'}`}>
          {formatDateOnly(task.end_date)}
          {task.status !== 'Done' && task.end_date < today && (
            <span> · {daysLate(task.end_date, today)} {daysLate(task.end_date, today) === 1 ? t('projectDetail.tasks.dayLate', 'day late') : t('projectDetail.tasks.daysLate', 'days late')}</span>
          )}
        </span>
      </Tooltip> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      header: t('projectDetail.tasks.column.status', 'Status'),
      cell: (task) => (
        <EditableTaskStatus
          task={task}
          editable={canSetStatus(task)}
          disabled={updateStatus.isPending}
          onChange={(row, status) => void onStatusChange(row, status)}
          pendingPush={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH}
        />
      ),
    },
  ];

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
      <Card className="min-w-0 overflow-hidden">
      <div className="mb-3.5 flex flex-col gap-3 p-[var(--panel-inset)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-page font-bold tracking-[-0.02em]">{t('projectDetail.tasks.heading', 'Tasks')}</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                aria-label={t('projectDetail.tasks.moreOptions', 'More task options')}
                aria-haspopup="menu"
                aria-expanded={toolbarMenuOpen}
                onClick={() => setToolbarMenuOpen((open) => !open)}
              >
                <span aria-hidden="true">⋯</span>
              </Button>
              {toolbarMenuOpen && <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[190px] rounded-md border border-border bg-popover p-1 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
                <button role="menuitemcheckbox" aria-checked={showArchived} type="button" className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setShowArchived((value) => !value); setSelectedTaskIds(new Set()); setBulkAction(null); setToolbarMenuOpen(false); }}>
                  {showArchived ? t('projectDetail.tasks.hideArchived', 'Hide archived') : t('projectDetail.tasks.showArchived', 'Show archived')}
                </button>
                <button role="menuitem" type="button" className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setToolbarMenuOpen(false); integrationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                  {t('projectDetail.tasks.clickUpSettings', 'ClickUp list and sync')}
                </button>
              </div>}
            </div>
            {canCreate && <Button variant="outline" size="sm" onClick={() => setFormTarget({ task: null })}>
              <Icon name="plus" />{t('projectDetail.tasks.newTask', 'New task')}
            </Button>}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ViewToggle<TaskScope>
            options={[
              { value: 'mine', label: t('projectDetail.tasks.scope.mine', 'Mine') },
              { value: 'all', label: t('projectDetail.tasks.scope.all', 'All') },
            ]}
            value={scope}
            onChange={setTaskScope}
            ariaLabel={t('projectDetail.tasks.scopeAriaLabel', 'Task scope')}
            semantics="toggle"
          />
          <label className="min-w-[128px] flex-1 sm:flex-none">
            <span className="sr-only">{t('projectDetail.tasks.filter.status', 'Filter by status')}</span>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as TaskStatus | 'all'); setSelectedTaskIds(new Set()); setBulkAction(null); }} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <option value="all">{t('projectDetail.tasks.filter.allStatuses', 'All statuses')}</option>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="min-w-[144px] flex-1 sm:flex-none">
            <span className="sr-only">{t('projectDetail.tasks.filter.assignee', 'Filter by assignee')}</span>
            <select value={assigneeFilter} onChange={(event) => { setAssigneeFilter(event.target.value); setSelectedTaskIds(new Set()); setBulkAction(null); }} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <option value="all">{t('projectDetail.tasks.filter.allAssignees', 'All assignees')}</option>
              <option value="unassigned">{t('projectDetail.tasks.filter.unassigned', 'Unassigned')}</option>
              {(assignableProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
            </select>
          </label>
          <label className="relative min-w-[160px] flex-1">
            <span className="sr-only">{t('projectDetail.tasks.search', 'Search tasks')}</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={searchText} onChange={(event) => { setSearchText(event.target.value); setSelectedTaskIds(new Set()); setBulkAction(null); }} placeholder={t('projectDetail.tasks.searchPlaceholder', 'Search tasks…')} className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
          </label>
          {state !== 'loading' && state !== 'error' && state !== 'empty' && <ViewToggle<ViewMode>
            options={[
              { value: 'list', label: t('projectDetail.tasks.view.list', 'List') },
              { value: 'board', label: t('projectDetail.tasks.view.board', 'Board') },
              { value: 'timeline', label: t('projectDetail.tasks.view.timeline', 'Timeline') },
            ]}
            value={view}
            onChange={setTaskView}
            ariaLabel={t('projectDetail.tasks.viewAriaLabel', 'Task view')}
          />}
        </div>
        {view === 'list' && selectedTasks.length > 0 && <div role="group" aria-label={t('projectDetail.tasks.bulk.actions', 'Bulk task actions')} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2">
          <span aria-live="polite" className="mr-1 text-sm font-medium text-foreground">{t('projectDetail.tasks.bulk.selected', '{{count}} selected', { count: selectedTasks.length })}</span>
          {canBulkStatus && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'status'} onClick={() => { setBulkStatus(''); setBulkAction((current) => current === 'status' ? null : 'status'); }}>{t('projectDetail.tasks.bulk.changeStatus', 'Change status')}</Button>}
          {canBulkEdit && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'assignee'} onClick={() => { setBulkAssignee(''); setBulkAction((current) => current === 'assignee' ? null : 'assignee'); }}>{t('projectDetail.tasks.bulk.reassign', 'Reassign')}</Button>}
          {canBulkEdit && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'due'} onClick={() => { setBulkDueDate(''); setBulkClearDueDate(false); setBulkAction((current) => current === 'due' ? null : 'due'); }}>{t('projectDetail.tasks.bulk.changeDueDate', 'Change due date')}</Button>}
          {canBulkArchive && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'archive'} onClick={() => setBulkAction((current) => current === 'archive' ? null : 'archive')}>{t('projectDetail.tasks.bulk.archive', 'Archive')}</Button>}
          <Button variant="ghost" size="sm" onClick={() => { setSelectedTaskIds(new Set()); setBulkAction(null); }}>{t('projectDetail.tasks.bulk.clearSelection', 'Clear selection')}</Button>
        </div>}
        {view === 'list' && bulkAction && canApplyBulk && selectedTasks.length > 0 && <div className="flex min-w-0 flex-wrap items-end gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          {bulkAction === 'status' && <SelectField
            hideLabel
            label={t('projectDetail.tasks.bulk.statusLabel', 'New status for selected tasks')}
            value={bulkStatus}
            onChange={(value) => setBulkStatus(value as TaskStatus | '')}
            options={[{ value: '', label: t('projectDetail.tasks.bulk.chooseStatus', 'Choose a status') }, ...STATUS_OPTIONS]}
          />}
          {bulkAction === 'assignee' && <SelectField
            hideLabel
            label={t('projectDetail.tasks.bulk.assigneeLabel', 'Assignee for selected tasks')}
            value={bulkAssignee}
            onChange={setBulkAssignee}
            options={[{ value: '', label: t('projectDetail.tasks.bulk.chooseAssignee', 'Choose an assignee') }, { value: '__unassigned__', label: t('projectDetail.tasks.unassigned', 'Unassigned') }, ...(assignableProfiles ?? []).map((profile) => ({ value: profile.id, label: profile.full_name }))]}
          />}
          {bulkAction === 'due' && <>
            <TextField
              label={t('projectDetail.tasks.bulk.dueDateLabel', 'Due date for selected tasks')}
              type="date"
              value={bulkDueDate}
              onChange={(value) => { setBulkDueDate(value); setBulkClearDueDate(false); }}
              disabled={bulkClearDueDate}
            />
            <label className="inline-flex items-center gap-2 pb-2 text-sm text-muted-foreground">
              <Checkbox checked={bulkClearDueDate} onChange={(checked) => { setBulkClearDueDate(checked); if (checked) setBulkDueDate(''); }} label={t('projectDetail.tasks.bulk.clearDueDate', 'Clear due date')} />
            </label>
          </>}
          {bulkAction === 'archive' && <p className="mr-auto text-sm text-muted-foreground">{t('projectDetail.tasks.bulk.archiveHelp', 'Archive {{count}} active selected tasks.', { count: selectedTasks.filter((task) => task.archived_at == null).length })}</p>}
          <Button variant="primary" size="sm" disabled={bulkPending || (bulkAction === 'status' && !bulkStatus) || (bulkAction === 'assignee' && !bulkAssignee) || (bulkAction === 'due' && !bulkDueDate && !bulkClearDueDate)} onClick={() => void applyBulkAction()}>
            {bulkPending ? t('projectDetail.tasks.bulk.applying', 'Applying…') : t('projectDetail.tasks.bulk.apply', 'Apply')}
          </Button>
          <Button variant="ghost" size="sm" disabled={bulkPending} onClick={() => setBulkAction(null)}>{t('projectDetail.tasks.bulk.cancel', 'Cancel')}</Button>
        </div>}
      </div>

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
        />
      )}

      {state === undefined && view === 'timeline' && (
        <ProjectGantt
          tasks={filteredTasks}
          milestones={milestoneList}
          onSwitchView={setTaskView}
          onActivateTask={openTask}
          rowMenu={rowMenu}
        />
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

// ── Board view ───────────────────────────────────────────────────────────────

interface TaskBoardProps {
  tasks: TaskWithRefs[];
  canSetStatus: (t: TaskWithRefs) => boolean;
  onStatusChange: (t: TaskWithRefs, status: TaskStatus) => void;
  onActivate: (t: TaskWithRefs) => void;
  rowMenu: (task: TaskWithRefs) => RowMenuItem[];
  today: string;
  statusBusy: boolean;
  externallyOwned: boolean;
  pendingPushByTask: Record<string, import('@/src/lib/adapterSeam/pendingPush').PendingPushState>;
}

/**
 * Status-column board. A keyboard-first alternative to drag (ui-ux-pro-max
 * gesture-alternative): each card carries a status `<select>` for those who may
 * move it (managers: any; Engineer: own task only), or a static pill otherwise.
 */
const TaskBoard: React.FC<TaskBoardProps> = ({
  tasks,
  canSetStatus,
  onStatusChange,
  onActivate,
  rowMenu,
  today,
  statusBusy,
  externallyOwned,
  pendingPushByTask,
}) => {
  const { t } = useTranslation('project');
  const byStatus = (s: TaskStatus) => tasks.filter((task) => task.status === s);
  return (
    <Kanban className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {BOARD_STATUSES.map((s) => {
        const col = byStatus(s);
        return (
          <KanbanColumn
            key={s}
            title={s}
            count={col.length}
            emptyMessage={t('projectDetail.tasks.board.noTasks', 'No tasks')}
            totals={<Tooltip content={t('projectDetail.tasks.board.countTooltip', 'Count of current filtered project tasks in this status. Source: the current task list and filters.')}>
              <button type="button" aria-label={t('projectDetail.tasks.board.countHelp', 'Explain status count')} className="inline-flex rounded-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="info" className="size-3.5" /></button>
            </Tooltip>}
          >
            {col.map((task) => <div key={task.id} onClick={() => onActivate(task)} className="min-w-0 cursor-pointer rounded-md border border-border bg-card px-3 py-2.5 hover:border-muted-foreground/35 hover:bg-accent/40">
              <div className="flex items-start justify-between gap-2">
                <button type="button" aria-label={t('projectDetail.tasks.openTask', 'Open task {{name}}', { name: task.name })} onClick={(event) => { event.stopPropagation(); onActivate(task); }} className="min-w-0 text-left text-[13px] font-semibold leading-snug hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span className="block whitespace-normal break-words">{task.name}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {externallyOwned && <TaskPushBadge state={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH} />}
                  <TaskActionsDisclosure items={rowMenu(task)} />
                </div>
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {task.assignee ? <>
                  <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{task.assignee.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                  <span className="truncate">{task.assignee.full_name}</span>
                </> : t('projectDetail.tasks.unassigned', 'Unassigned')}
                {task.end_date && <Tooltip content={t('projectDetail.tasks.dueTooltip', 'Due date from the task record. Late days compare the due date with today in the organization timezone.')}>
                  <span tabIndex={0} className={`ml-auto shrink-0 tabular ${task.status !== 'Done' && task.end_date < today ? 'text-destructive-text' : ''}`}>
                    {task.status !== 'Done' && task.end_date < today ? t('projectDetail.tasks.daysLateCount', '{{count}}d late', { count: daysLate(task.end_date, today) }) : formatDateOnly(task.end_date)}
                  </span>
                </Tooltip>}
              </div>
              <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                {canSetStatus(task) ? <SelectField
                  hideLabel
                  label={`${t('projectDetail.tasks.statusFor', 'Status for')} ${task.name}`}
                  value={task.status}
                  disabled={statusBusy}
                  onChange={(value) => onStatusChange(task, value as TaskStatus)}
                  options={STATUS_OPTIONS}
                  fullWidth
                /> : <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>}
              </div>
            </div>)}
          </KanbanColumn>
        );
      })}
    </Kanban>
  );
};

// ── Create / edit form modal ───────────────────────────────────────────────────

interface DepDelta {
  add: string[];
  remove: string[];
}

interface TaskFormModalProps {
  task: TaskWithRefs | null;
  projectId: string;
  allTasks: TaskWithRefs[];
  /** Pre-populated milestone id when clicking "Add task" inside a milestone group (AC-DEL-011). */
  defaultMilestoneId?: string | null;
  /** Available milestones for the milestone select field. */
  milestones?: MilestoneWithProgress[];
  /** FR-CUA-070 breadth (review fix #4): the edit-modal save is an external write origin — its
   *  pending-push state surfaces in the modal (pushing while saving / push-failed when the save is
   *  rejected and the modal stays open). Idle for create + PMO-owned. */
  pendingPushState?: import('@/src/lib/adapterSeam/pendingPush').PendingPushState;
  onClose: () => void;
  onCreate: (input: TaskInput) => Promise<void>;
  onUpdate: (id: string, patch: TaskPatch, deps: DepDelta) => Promise<void>;
  onError: (err: unknown) => void;
}

const TaskFormModal: React.FC<TaskFormModalProps> = ({
  task,
  projectId,
  allTasks,
  defaultMilestoneId = null,
  milestones = [],
  pendingPushState = IDLE_PENDING_PUSH,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation('project');
  const isEdit = !!task;
  const { data: profiles, isPending: profilesPending, isError: profilesError } =
    useAssignableProfiles();
  // Memoised on `t` so the validator identity is stable between renders.
  const validateWithT = useCallback((v: FormValues) => validate(v, t), [t]);

  // milestone_id is tracked separately (not part of useEntityForm, since it's a string | null
  // but not a text field). Default: pre-populated group id for create, or the task's current value.
  const initialMilestoneId = task?.milestone_id ?? defaultMilestoneId;
  const [milestoneId, setMilestoneId] = useState<string | null>(initialMilestoneId);

  // OD-INT-9 — parent_task_id is tracked the same way (string | null, not a text field).
  // Default: the task's current parent when editing, or none (top-level) when creating.
  const initialParentTaskId = task?.parent_task_id ?? null;
  const [parentTaskId, setParentTaskId] = useState<string | null>(initialParentTaskId);

  // PGB-025: Track phase and parent changes as part of form dirty state
  const phaseDirty = milestoneId !== initialMilestoneId;
  const parentDirty = parentTaskId !== initialParentTaskId;

  const form = useEntityForm<FormValues>({
    initialValues: {
      name: task?.name ?? '',
      status: task?.status ?? 'To Do',
      assignee_id: task?.assignee_id ?? '',
      start_date: task?.start_date ?? '',
      end_date: task?.end_date ?? '',
      description: task?.description ?? '',
      priority: task?.priority ?? '',
    },
    validate: validateWithT,
    idPrefix: 'task-form',
    module: 'projects',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required task name is present.
    requiredFields: ['name'],
  });

  // Dependency editing (single-FK add per the plan; the existing edges + a picker).
  const initialDeps = useMemo(() => task?.dependencies.map((d) => d.depends_on_id) ?? [], [task]);
  const [deps, setDeps] = useState<string[]>(initialDeps);
  const [depPick, setDepPick] = useState<string | null>(null);

  const nameField = form.fieldProps('name');
  const statusField = form.fieldProps('status');
  const assigneeField = form.fieldProps('assignee_id');
  const startField = form.fieldProps('start_date');
  const endField = form.fieldProps('end_date');
  const descriptionField = form.fieldProps('description');
  const priorityField = form.fieldProps('priority');

  const assigneeOptions: ComboboxOption[] = (profiles ?? []).map((p) => ({
    value: p.id,
    label: p.full_name,
    sub: p.role,
  }));
  const selectedAssignee = assigneeOptions.find((o) => o.value === assigneeField.value) ?? null;

  // Milestone select options
  const milestoneOptions: ComboboxOption[] = milestones.map((m) => ({
    value: m.id,
    label: m.name,
  }));
  const selectedMilestone = milestoneOptions.find((o) => o.value === milestoneId) ?? null;

  // OD-INT-9 — the parent-task cycle guard: a task must never become its own parent OR the
  // parent of any of its own descendants (that would create a cycle). `collectDescendants`
  // (the existing, unit-tested tree helper) walks the FULL descendant set; we exclude the task
  // itself too, so both are simply unselectable — never presented as options at all.
  const invalidParentIds = useMemo(() => {
    if (!task) return new Set<string>(); // creating: nothing exists yet to cycle against
    const s = collectDescendants(task.id, allTasks);
    s.add(task.id);
    return s;
  }, [task, allTasks]);
  const parentOptions: ComboboxOption[] = allTasks
    .filter((t) => !invalidParentIds.has(t.id))
    .map((t) => ({ value: t.id, label: t.name }));
  const selectedParent = parentOptions.find((o) => o.value === parentTaskId) ?? null;

  // Dependency candidates: other tasks on this project, not already a dependency, not self.
  const depCandidates: ComboboxOption[] = allTasks
    .filter((t) => t.id !== task?.id && !deps.includes(t.id))
    .map((t) => ({ value: t.id, label: t.name }));
  const taskName = (id: string) => allTasks.find((t) => t.id === id)?.name ?? id;

  const errorSummary = form.errors.name
    ? [{ fieldId: nameField.id, message: form.errors.name }]
    : undefined;

  const depsDirty = useMemo(() => {
    const a = [...deps].sort().join(',');
    const b = [...initialDeps].sort().join(',');
    return a !== b;
  }, [deps, initialDeps]);

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const base = {
        name: values.name.trim(),
        status: values.status,
        assignee_id: values.assignee_id || null,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
        // OD-INT-9: description (blank → null) + priority (unset → null) round-trip on save.
        description: values.description.trim() || null,
        priority: values.priority ? (values.priority as TaskPriority) : null,
      };
      try {
        if (isEdit && task) {
          const delta: DepDelta = {
            add: deps.filter((d) => !initialDeps.includes(d)),
            remove: initialDeps.filter((d) => !deps.includes(d)),
          };
          await onUpdate(
            task.id,
            { ...base, milestone_id: milestoneId, parent_task_id: parentTaskId },
            delta,
          );
        } else {
          await onCreate({
            project_id: projectId,
            ...base,
            milestone_id: milestoneId,
            parent_task_id: parentTaskId,
          });
        }
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={
        isEdit
          ? t('projectDetail.tasks.form.editTitle', 'Edit task')
          : t('projectDetail.tasks.newTask', 'New task')
      }
      subtitle={
        isEdit
          ? t('projectDetail.tasks.form.editSubtitle', 'Update this task')
          : t('projectDetail.tasks.form.newSubtitle', 'Add a task to this project')
      }
      submitLabel={
        isEdit
          ? t('projectDetail.tasks.form.save', 'Save task')
          : t('projectDetail.tasks.form.create', 'Create task')
      }
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty || depsDirty || phaseDirty || parentDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      {/* FR-CUA-070 breadth (review fix #4): the edit-modal save routes externally — surface its
          pending-push state here (pushing while saving, push-failed when the save is rejected and the
          modal stays open). Idle renders nothing (create + PMO-owned). */}
      {isEdit && <TaskPushBadge state={pendingPushState} />}
      <FormSection legend={t('projectDetail.tasks.form.detailsLegend', 'Details')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('projectDetail.tasks.form.name', 'Task name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('projectDetail.tasks.form.namePlaceholder', 'e.g. Survey the site')}
            fullWidth
          />
          <Combobox
            label={t('projectDetail.tasks.form.assignee', 'Assignee')}
            value={assigneeField.value || null}
            selectedOption={selectedAssignee}
            loadOptions={async () => assigneeOptions}
            onChange={(v) => assigneeField.onChange(v)}
            placeholder={
              profilesPending
                ? t('projectDetail.tasks.form.loadingPeople', 'Loading people…')
                : t('projectDetail.tasks.unassigned', 'Unassigned')
            }
            searchPlaceholder={t('projectDetail.tasks.form.searchPeople', 'Search people…')}
            noun="person"
          />
          <SelectField
            id={statusField.id}
            label={t('projectDetail.tasks.form.status', 'Status')}
            required
            value={statusField.value}
            onChange={(v) => statusField.onChange(v as TaskStatus)}
            onBlur={statusField.onBlur}
            options={STATUS_OPTIONS}
          />
          {/* OD-INT-9 — Priority. Nullable column: the leading "No priority" option (value="")
              maps to null and stays selectable so an existing priority can be cleared. */}
          <SelectField
            id={priorityField.id}
            label={t('projectDetail.tasks.form.priority', 'Priority')}
            value={priorityField.value}
            onChange={(v) => priorityField.onChange(v)}
            onBlur={priorityField.onBlur}
            options={priorityOptions(t)}
          />
          <TextField
            id={startField.id}
            label={t('projectDetail.tasks.form.startDate', 'Start date')}
            type="date"
            value={startField.value}
            onChange={startField.onChange}
            onBlur={startField.onBlur}
          />
          <TextField
            id={endField.id}
            label={t('projectDetail.tasks.form.dueDate', 'Due date')}
            type="date"
            value={endField.value}
            onChange={endField.onChange}
            onBlur={endField.onBlur}
          />
          {milestones.length > 0 && (
            <Combobox
              label={t('projectDetail.tasks.form.milestone', 'Phase')}
              value={milestoneId}
              selectedOption={selectedMilestone}
              loadOptions={async () => milestoneOptions}
              onChange={(v) => setMilestoneId(v || null)}
              placeholder={t('projectDetail.tasks.noMilestone', 'No phase')}
              searchPlaceholder={t('projectDetail.tasks.form.searchMilestones', 'Search phases…')}
              noun={t('projectDetail.tasks.phaseNoun', 'phase')}
            />
          )}
          {/* OD-INT-9 — the parent-task picker. Options already exclude the task itself and
              all of its descendants (the cycle guard), so an invalid choice can't be selected
              at all. Hidden when there's nothing eligible to pick (e.g. the project's only
              task), mirroring the Milestone field's gating above. */}
          {parentOptions.length > 0 && (
            <Combobox
              label={t('projectDetail.tasks.form.parentTask', 'Parent task')}
              value={parentTaskId}
              selectedOption={selectedParent}
              loadOptions={async () => parentOptions}
              onChange={(v) => setParentTaskId(v || null)}
              placeholder={t('projectDetail.tasks.form.noParent', 'No parent (top-level)')}
              searchPlaceholder={t('projectDetail.tasks.form.searchTasks', 'Search tasks…')}
              noun="task"
            />
          )}
          {/* OD-INT-9 — Description. Multi-line (the shared TextArea primitive), full-width so the
              textarea gets the room a scope/notes field needs. Uses the existing FieldShell a11y
              (visible label + aria wiring) — no ad-hoc styling. */}
          <TextArea
            id={descriptionField.id}
            label={t('projectDetail.tasks.form.description', 'Description')}
            value={descriptionField.value}
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
            placeholder={t(
              'projectDetail.tasks.form.descriptionPlaceholder',
              'Add scope, notes, or acceptance criteria…',
            )}
            fullWidth
          />
        </FormGrid>
        {profilesError && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t(
              'projectDetail.tasks.form.peopleLoadFailed',
              'People could not be loaded; you can still save and assign later.',
            )}
          </p>
        )}
      </FormSection>

      {/* Dependencies — only when editing an existing task (need its id + the sibling list). */}
      {isEdit && (
        <FormSection legend={t('projectDetail.tasks.form.dependsOnLegend', 'Depends on')}>
          {deps.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              {t(
                'projectDetail.tasks.form.noDependencies',
                'No dependencies. Add a task that must finish first.',
              )}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {deps.map((d) => (
                <li
                  key={d}
                  className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate">{taskName(d)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={`${t(
                      'projectDetail.tasks.form.removeDependency',
                      'Remove dependency',
                    )} ${taskName(d)}`}
                    onClick={() => setDeps((prev) => prev.filter((x) => x !== d))}
                  >
                    <Icon name="x" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {depCandidates.length > 0 && (
            <div className="mt-2.5">
              <Combobox
                label={t('projectDetail.tasks.form.addDependency', 'Add a dependency')}
                value={depPick}
                loadOptions={async () => depCandidates}
                onChange={(v) => {
                  setDeps((prev) => (prev.includes(v) ? prev : [...prev, v]));
                  setDepPick(null);
                }}
                placeholder={t('projectDetail.tasks.form.selectTask', 'Select a task…')}
                searchPlaceholder={t('projectDetail.tasks.form.searchTasks', 'Search tasks…')}
                noun="task"
              />
            </div>
          )}
        </FormSection>
      )}
    </EntityFormModal>
  );
};

// ── Milestone-grouped list view ──────────────────────────────────────────────

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
      ? `${starts.length ? formatDateOnly(starts[0]) : '—'} – ${ends.length ? formatDateOnly(ends[ends.length - 1]) : '—'}`
      : null;
    const lateDays = group.milestone?.target_date && group.milestone.target_date < today && group.milestone.effective_pct < 100
      ? daysLate(group.milestone.target_date, today)
      : null;
    const note = hasTasksOutsideFilters
      ? t('projectDetail.tasks.noFilteredTasksInGroup', 'No tasks in this phase match the current filters.')
      : !group.completed && group.tasks.length === 0 ? t('projectDetail.tasks.noTasksInGroup', 'No tasks in this phase yet.') : null;
    return <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 font-normal">
      {dateRange && <Tooltip content={t('projectDetail.tasks.phaseDatesTooltip', 'Range from the earliest task start date to the latest task due date in the current task scope. Source: phase task records.')}>
        <span tabIndex={0} className="text-xs tabular text-muted-foreground">{dateRange}</span>
      </Tooltip>}
      {group.milestone?.target_date && <Tooltip content={t('projectDetail.tasks.phaseTargetTooltip', 'Target date from the project phase record.')}>
        <span tabIndex={0} className="text-xs tabular text-muted-foreground">{t('projectDetail.tasks.phaseTargetDate', 'Target {{date}}', { date: formatDateOnly(group.milestone.target_date) })}</span>
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
        <span tabIndex={0} className="text-xs font-medium text-destructive-text">{t('projectDetail.tasks.daysLateCount', '{{count}}d late', { count: lateDays })}</span>
      </Tooltip>}
      <Tooltip content={t('projectDetail.tasks.openCountTooltip', 'Count of visible tasks in this phase whose status is not Done. Source: current project task list and filters.')}>
        <span tabIndex={0} className="text-xs text-muted-foreground">{t('projectDetail.tasks.openCount', '{{count}} open', { count: group.openTasks.length })}</span>
      </Tooltip>
      {group.doneTasks.length > 0 && <button
        type="button"
        aria-expanded={expanded}
        onClick={() => toggleDone(group.id)}
        className="touch-target inline-flex min-h-9 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="chev" className={`size-3.5 transition-transform${expanded ? ' rotate-90' : ''}`} />
        {t('projectDetail.tasks.doneCount', '{{count}} done', { count: group.doneTasks.length })}
      </button>}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
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
    groupLabel={(groupId) => <span className="break-words text-[13px] font-semibold text-foreground">{groupById.get(groupId)?.label ?? groupId}</span>}
    groupHeader={(groupId) => groupMeta(groupId)}
    groupHeaderSpan
  />;
};

interface TaskRecordDrawerProps {
  task: TaskWithRefs | null;
  allTasks: TaskWithRefs[];
  projectId: string;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  externallyOwned: boolean;
  pendingPush: import('@/src/lib/adapterSeam/pendingPush').PendingPushState;
  openEdit: (task: TaskWithRefs) => void;
  onArchive: (task: TaskWithRefs) => void;
  onDelete: (task: TaskWithRefs) => void;
  openTask: (task: TaskWithRefs) => void;
  onClose: () => void;
  nestedOpen: boolean;
}

const TaskRecordDrawer: React.FC<TaskRecordDrawerProps> = ({
  task,
  allTasks,
  projectId,
  canEdit,
  canArchive,
  canDelete,
  externallyOwned,
  pendingPush,
  openEdit,
  onArchive,
  onDelete,
  openTask,
  onClose,
  nestedOpen,
}) => {
  const { t } = useTranslation('project');
  if (!task) return null;
  const subtasks = allTasks.filter((candidate) => candidate.parent_task_id === task.id && candidate.tombstoned_at == null);
  return <Drawer
    open
    width="lg"
    title={task.name}
    status={<StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>}
    onClose={onClose}
    nestedOpen={nestedOpen}
    // Same header as every record drawer: main action · Open full page · ⋯ for the rare ones.
    headerActions={<>
      {canEdit && <Button size="sm" onClick={() => openEdit(task)}>{t('projectDetail.tasks.action.edit', 'Edit')}</Button>}
      <Link to={`/projects/${projectId}/tasks#task-${task.id}`} className={buttonClasses('outline', 'sm')}>{t('projectDetail.tasks.openFullRecord', 'Open full page')}</Link>
      {(canArchive || canDelete) && <MenuButton
        ariaLabel={t('projectDetail.tasks.drawerMoreActions', 'More task actions')}
        items={[
          ...(canArchive ? [{ label: task.archived_at == null ? t('projectDetail.tasks.action.archive', 'Archive') : t('projectDetail.tasks.action.unarchive', 'Unarchive'), onClick: () => onArchive(task) }] : []),
          ...(canDelete ? [{ label: t('projectDetail.tasks.action.delete', 'Delete'), onClick: () => onDelete(task), danger: true }] : []),
        ]}
      />}
    </>}
  >
    <div className="space-y-5">
      {externallyOwned && <TaskPushBadge state={pendingPush} />}
      <section aria-labelledby="task-drawer-description" className="space-y-2">
        <h2 id="task-drawer-description" className="text-[13px] font-semibold">{t('projectDetail.tasks.form.description', 'Description')}</h2>
        {task.description ? <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.description}</p> : <p className="text-sm text-muted-foreground">{t('projectDetail.tasks.drawer.noDescription', 'No description provided.')}</p>}
      </section>
      <section aria-labelledby="task-drawer-details" className="space-y-2">
        <h2 id="task-drawer-details" className="text-[13px] font-semibold">{t('projectDetail.tasks.drawer.details', 'Details')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('projectDetail.tasks.column.assignee', 'Assignee')}</dt><dd className="min-w-0 break-words">{task.assignee?.full_name ?? t('projectDetail.tasks.unassigned', 'Unassigned')}</dd>
          <dt className="text-muted-foreground">{t('projectDetail.tasks.column.due', 'Due')}</dt><dd>{task.end_date ? formatDateOnly(task.end_date) : '—'}</dd>
          <dt className="text-muted-foreground">{t('projectDetail.tasks.form.priority', 'Priority')}</dt><dd>{task.priority ?? t('projectDetail.tasks.noPriority', 'No priority')}</dd>
          <dt className="text-muted-foreground">{t('projectDetail.tasks.form.dependsOnLegend', 'Depends on')}</dt><dd className="min-w-0 break-words">{task.dependencies.length ? task.dependencies.map((dependency) => allTasks.find((candidate) => candidate.id === dependency.depends_on_id)?.name ?? dependency.depends_on_id).join(', ') : t('projectDetail.tasks.drawer.noDependencies', 'No dependencies are linked.')}</dd>
        </dl>
      </section>
      <section aria-labelledby="task-drawer-subtasks" className="space-y-2">
        <h2 id="task-drawer-subtasks" className="text-[13px] font-semibold">{t('projectDetail.tasks.drawer.subtasks', 'Subtasks')}</h2>
        {subtasks.length ? <ul className="divide-y divide-border rounded-md border border-border">
          {orderedTasks(subtasks).map((subtask) => <li key={subtask.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openTask(subtask)}>{subtask.name}</button>
            <StatusPill variant={workflowVariant(subtask.status)}>{subtask.status}</StatusPill>
          </li>)}
        </ul> : <p className="text-sm text-muted-foreground">{t('projectDetail.tasks.drawer.noSubtasks', 'No subtasks.')}</p>}
      </section>
      <div className="space-y-2">
        <h2 className="text-[13px] font-semibold">{t('common:comments.title', 'Comments')}</h2>
        <CommentsSection entityType="task" entityId={task.id} hideTitle />
      </div>
      <section aria-labelledby="task-drawer-history" className="space-y-2">
        <h2 id="task-drawer-history" className="text-[13px] font-semibold">{t('projectDetail.tasks.drawer.history', 'History')}</h2>
        <RecordHistory entityType="task" entityId={task.id} />
      </section>
    </div>
  </Drawer>;
};
export default TasksTab;
