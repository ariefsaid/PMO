import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Toolbar,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  Combobox,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type ComboboxOption,
} from '@/src/components/ui';
import { ProjectIntegrationsCard } from '@/src/components/projects/ProjectIntegrationsCard';
import { useLocation } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useTasks, useTaskMutations, useAssignableProfiles } from '@/src/hooks/useTasks';
import { useMilestones } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { classifyExternalError } from '@/src/lib/adapterSeam/pendingPush';
import { formatDate } from '@/src/lib/format';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import type { TaskWithRefs, TaskStatus, TaskPriority, TaskInput, TaskPatch } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { MilestonePhaseHeader } from '@/src/components/milestones/MilestonePhaseHeader';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { buildTaskRenderOrder, collectDescendants } from '@/src/lib/tasks/taskTree';
import ProjectGantt from '../ProjectGantt';

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
const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s }));

// OD-INT-9 — the four task_priority enum values, for the Priority select. The first option is the
// explicit unset (value="" → null): the column is nullable, so "no priority" must stay expressible
// AND clearable (a disabled placeholder couldn't be re-selected after a value was set).
const PRIORITIES: TaskPriority[] = ['Urgent', 'High', 'Normal', 'Low'];
const PRIORITY_OPTIONS = [{ value: '', label: 'No priority' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))];

type ViewMode = 'list' | 'board' | 'timeline';

interface FormValues {
  name: string;
  status: TaskStatus;
  assignee_id: string;
  start_date: string;
  end_date: string;
  description: string;
  priority: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) errors.name = 'Task name is required.';
  return errors;
};

export interface TasksTabProps {
  projectId: string;
}

/**
 * Project Tasks tab — the per-project task register (crud-components §9.7,
 * rbac-visibility §F). Create / edit / assign / status / delete + dependency
 * add/remove, all gated via `can()` on the REAL JWT role. The single carefully
 * gated split: an Engineer may change the status of their OWN assigned task
 * only (the status control is the one editable affordance; everything else is
 * static), enforced by the column-pinned RLS (migration 0016) — the FE is the
 * clarity projection, RLS is the authority.
 */
const TasksTab: React.FC<TasksTabProps> = ({ projectId }) => {
  const may = usePermission();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useTasks(projectId);
  const { create, update, updateStatus, remove, archive, addDependency, removeDependency, pendingPushByTask = {} } =
    useTaskMutations(projectId);
  const { data: milestones } = useMilestones(projectId);
  const location = useLocation();

  const [view, setView] = useState<ViewMode>('list');
  // defaultMilestoneId — pre-populated when clicking "Add task" within a group.
  const [formTarget, setFormTarget] = useState<{ task: TaskWithRefs | null; defaultMilestoneId?: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskWithRefs | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // T25 — hash-anchor scroll & transient highlight.
  // When the URL contains #task-<id>, scroll that row into view and apply a
  // brief highlight ring so the user immediately sees which task MyTasks linked to.
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const scrolledRef = useRef<string | null>(null);

  useEffect(() => {
    const hash = location.hash; // e.g. "#task-abc-123"
    if (!hash.startsWith('#task-')) return;
    const taskId = hash.slice('#task-'.length);
    // Only scroll once per hash (avoid infinite re-scroll on re-renders).
    if (scrolledRef.current === taskId) return;
    scrolledRef.current = taskId;

    // Attempt to scroll — the element may not yet be rendered (data still loading).
    // requestAnimationFrame gives the list one paint cycle.
    const doScroll = () => {
      const el = document.getElementById(`task-${taskId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedTaskId(taskId);
        // Remove highlight after 2 s so it is genuinely transient.
        setTimeout(() => setHighlightedTaskId(null), 2000);
      }
    };
    requestAnimationFrame(doScroll);
  // Re-run when data loads (in case the element wasn't mounted on initial render).
  }, [location.hash, data]);

  // Structure write (title / assignee / dates / delete) = Admin·Exec·PM.
  const canCreate = may('create', 'task');
  const canEdit = may('edit', 'task');
  const canDelete = may('delete', 'task');

  // ADR-0056: the per-task pending-push badge wires in ONLY when task writes route externally
  // (ClickUp-owned). PMO-owned orgs stay byte-for-byte — no badge chrome at all (AC-CUA-061).
  const externallyOwned = routeTaskWrite(projectId) === 'external';
  const canArchive = may('archive', 'task');
  const canRowWrite = canEdit || canDelete || (canArchive && !externallyOwned);

  // Review fix #5 — one headline for one event: an externally-routed write fails through the SAME
  // vocabulary the badge renders (classifyExternalError), so the toast and the badge never disagree.
  // PMO-owned writes keep the Postgres-code classifier (classifyMutationError).
  const classifyWriteError = (err: unknown) =>
    externallyOwned ? classifyExternalError(err) : classifyMutationError(err);

  const all = useMemo(() => data ?? [], [data]);
  const milestoneList = useMemo(() => milestones ?? [], [milestones]);

  // OD-INT-9 — the flat list view (no milestone grouping) renders ALL tasks in a single
  // depth-ordered slice: buildTaskRenderOrder gives parent-then-descendants order; the row
  // type never changes (still TaskWithRefs) — depth is a SEPARATE lookup consumed only by the
  // name cell renderer (buildColumns below). The milestone-grouped view computes its own
  // per-group order (see MilestoneGroupedList) since a subtask can land in a different
  // milestone group than its parent (AC-SUB-UI-004).
  const visibleTasks = useMemo(
    () => (showArchived ? all : all.filter((t) => t.archived_at == null)),
    [all, showArchived],
  );
  const flatOrder = useMemo(() => buildTaskRenderOrder(visibleTasks), [visibleTasks]);
  const flatRows = useMemo(() => flatOrder.map((n) => n.task), [flatOrder]);
  const flatDepths = useMemo(
    () => new Map(flatOrder.map((n) => [n.task.id, n.depth])),
    [flatOrder],
  );

  /** May the current viewer set THIS task's status? Managers: any; Engineer: own only. */
  const canSetStatus = (t: TaskWithRefs): boolean =>
    may('edit', 'taskStatus', { currentUserId, record: { assignee_id: t.assignee_id } });

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
  const onStatusChange = async (t: TaskWithRefs, status: TaskStatus) => {
    if (status === t.status) return;
    try {
      await updateStatus.mutateAsync({ id: t.id, status });
      toast('Status updated', `${t.name} is now ${status}`, 'success');
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onArchive = async (task: TaskWithRefs) => {
    try {
      await archive.mutateAsync({ id: task.id, archived: task.archived_at == null });
      toast(task.archived_at == null ? 'Task archived' : 'Task restored', task.name, 'success');
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast('Task deleted', target.name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyWriteError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  // ── Status control: editable <select> for those who may set it, static pill otherwise. ──
  const StatusCell: React.FC<{ task: TaskWithRefs }> = ({ task }) => (
    <div className="flex items-center gap-1.5">
      {canSetStatus(task) ? (
        <SelectField
          hideLabel
          label={`Status for ${task.name}`}
          value={task.status}
          disabled={updateStatus.isPending}
          onChange={(v) => onStatusChange(task, v as TaskStatus)}
          options={STATUS_OPTIONS}
          className="w-auto min-w-[120px]"
        />
      ) : (
        <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
      )}
      {/* FR-CUA-070 breadth (review fix #4): the List status cell ORIGINATES a status write, so the
          per-task pending-push badge surfaces here too (not just the Board). Idle renders nothing, so
          PMO-owned + non-pushing rows stay byte-for-byte (AC-CUA-061). */}
      <TaskPushBadge state={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH} />
    </div>
  );

  // OD-INT-9 — the table's row type stays TaskWithRefs end to end; the ONLY hierarchy-aware
  // piece is this name cell, which looks up the row's depth in a Map (never a parallel row
  // type, never a DataTable change). `depths` is per-slice: the flat list passes `flatDepths`
  // over ALL tasks; each milestone group passes its OWN depths computed over just that group's
  // tasks (so a subtask whose parent lives in another group renders as a root, depth 0 —
  // AC-SUB-UI-004 — instead of vanishing or grabbing an unrelated section's parent).
  const buildColumns = (depths: Map<string, number>): Column<TaskWithRefs>[] => [
    {
      key: 'name',
      header: 'Task',
      cell: (t) => {
        const depth = depths.get(t.id) ?? 0;
        return (
          <span
            id={`task-${t.id}`}
            /* `block`: `truncate` (overflow-hidden) is a no-op on an INLINE span, so a long
               task name ("CONST — Structural Load Calc & Racking Design") bled past 390px on
               the mobile card (AC-MOBILE-OVERFLOW-001, caught by CI on fresh seed). block +
               the card title wrapper's min-w-0 lets it clip with an ellipsis. */
            className={`block truncate font-semibold${highlightedTaskId === t.id ? ' ring-2 ring-primary ring-offset-1 rounded task-highlight' : ''}`}
            style={depth > 0 ? { paddingLeft: depth * SUBTASK_INDENT_PX } : undefined}
            title={t.name}
          >
            {depth > 0 && (
              <span className="sr-only">{`Subtask, level ${depth}. `}</span>
            )}
            {t.name}
          </span>
        );
      },
    },
    {
      key: 'assignee',
      header: 'Assignee',
      cell: (t) =>
        t.assignee ? (
          <span className="truncate text-muted-foreground" title={t.assignee.full_name}>
            {t.assignee.full_name}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
      colClassName: 'hidden sm:table-cell',
    },
    {
      key: 'due',
      header: 'Due',
      cell: (t) =>
        t.end_date ? (
          <span className="tabular text-muted-foreground">{formatDate(t.end_date)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      colClassName: 'hidden md:table-cell',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => <StatusCell task={t} />,
    },
  ];

  const rowMenu = (t: TaskWithRefs): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit) items.push({ label: 'Edit', onClick: () => setFormTarget({ task: t }) });
    if (canArchive && !externallyOwned) {
      items.push({ label: t.archived_at == null ? 'Archive' : 'Unarchive', onClick: () => void onArchive(t) });
    }
    if (canDelete) items.push({ label: 'Delete', onClick: () => setDeleteTarget(t), danger: true });
    return items;
  };

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">Tasks</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Plan, assign, and track the work for this project.
          </p>
        </div>
        {all.some((t) => t.archived_at != null) && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
        )}
        {canCreate && (
          <Button variant="outline" size="sm" onClick={() => setFormTarget({ task: null })}>
            <Icon name="plus" />
            New task
          </Button>
        )}
      </div>

      {/* Project Integrations Link/Unlink control */}
      <ProjectIntegrationsCard projectId={projectId} />

      {state !== 'loading' && state !== 'empty' && (
        <Toolbar standalone>
          <ViewToggle<ViewMode>
            options={[
              { value: 'list', label: 'List' },
              { value: 'board', label: 'Board' },
              { value: 'timeline', label: 'Timeline' },
            ]}
            value={view}
            onChange={setView}
            ariaLabel="Task view"
          />
        </Toolbar>
      )}

      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={5} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load tasks"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="check"
          title="No tasks yet"
          sub="Break the project into tasks, assign them to the team, and track each through to Done."
          action={
            canCreate ? { label: 'New task', onClick: () => setFormTarget({ task: null }) } : undefined
          }
        />
      )}

      {state === undefined && view === 'list' && (
        milestoneList.length === 0 ? (
          // No milestones: flat list, in depth-ordered (parent-then-descendants) order.
          <DataTable<TaskWithRefs>
            rows={flatRows}
            columns={buildColumns(flatDepths)}
            rowKey={(t) => t.id}
            rowMenu={canRowWrite ? rowMenu : undefined}
            onActivate={canEdit ? (t) => setFormTarget({ task: t }) : undefined}
            rowLabel={canEdit ? (t) => `Edit ${t.name}` : undefined}
          />
        ) : (
          // Milestones exist: group tasks by milestone
          <MilestoneGroupedList
            milestones={milestoneList}
            tasks={visibleTasks}
            buildColumns={buildColumns}
            canCreate={canCreate}
            canRowWrite={canRowWrite}
            rowMenu={rowMenu}
            onAddTask={(milestoneId) => setFormTarget({ task: null, defaultMilestoneId: milestoneId })}
            onActivate={canEdit ? (t) => setFormTarget({ task: t }) : undefined}
          />
        )
      )}

      {state === undefined && view === 'board' && (
        <TaskBoard
          tasks={visibleTasks}
          canSetStatus={canSetStatus}
          onStatusChange={onStatusChange}
          statusBusy={updateStatus.isPending}
          externallyOwned={externallyOwned}
          pendingPushByTask={pendingPushByTask}
        />
      )}

      {state === undefined && view === 'timeline' && (
        <ProjectGantt
          tasks={visibleTasks}
          milestones={milestoneList}
          onSwitchView={setView}
          onActivateTask={
            canEdit
              ? (task) => setFormTarget({ task })
              : undefined
          }
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
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
            toast('Task created', input.name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, patch, deps) => {
            await update.mutateAsync({ id, patch });
            // Reconcile dependency edges (add new, remove dropped).
            for (const d of deps.add) await addDependency.mutateAsync({ taskId: id, dependsOnId: d });
            for (const d of deps.remove)
              await removeDependency.mutateAsync({ taskId: id, dependsOnId: d });
            toast('Task updated', patch.name ?? 'Task', 'success');
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
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete task?'}
        description="This permanently removes the task and any dependency links to it. This can't be undone."
        confirmLabel="Delete task"
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
  statusBusy,
  externallyOwned,
  pendingPushByTask,
}) => {
  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STATUSES.map((s) => {
        const col = byStatus(s);
        return (
          <section
            key={s}
            aria-label={`${s} (${col.length})`}
            className="flex min-w-0 flex-col rounded-lg border border-border bg-secondary/50"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 pb-2.5 pt-[11px]">
              <span className="text-[13px] font-bold tracking-[-0.01em]">{s}</span>
              <span className="ml-auto grid h-5 min-w-[22px] place-items-center rounded-full border border-border bg-background px-[7px] text-[11.5px] font-bold text-muted-foreground tabular">
                {col.length}
              </span>
            </div>
            <div className="flex min-h-[60px] flex-col gap-2 p-[9px]">
              {col.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No tasks</div>
              ) : (
                col.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-md border border-border bg-card px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold" title={t.name}>
                        {t.name}
                      </span>
                      {externallyOwned && (
                        <TaskPushBadge state={pendingPushByTask[t.id] ?? IDLE_PENDING_PUSH} />
                      )}
                    </div>
                    <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
                      {t.assignee ? t.assignee.full_name : 'Unassigned'}
                    </div>
                    <div className="mt-2">
                      {canSetStatus(t) ? (
                        <SelectField
                          hideLabel
                          label={`Status for ${t.name}`}
                          value={t.status}
                          disabled={statusBusy}
                          onChange={(v) => onStatusChange(t, v as TaskStatus)}
                          options={STATUS_OPTIONS}
                          fullWidth
                        />
                      ) : (
                        <StatusPill variant={workflowVariant(t.status)}>{t.status}</StatusPill>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
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
  const isEdit = !!task;
  const { data: profiles, isPending: profilesPending, isError: profilesError } =
    useAssignableProfiles();

  // milestone_id is tracked separately (not part of useEntityForm, since it's a string | null
  // but not a text field). Default: pre-populated group id for create, or the task's current value.
  const [milestoneId, setMilestoneId] = useState<string | null>(
    task?.milestone_id ?? defaultMilestoneId,
  );

  // OD-INT-9 — parent_task_id is tracked the same way (string | null, not a text field).
  // Default: the task's current parent when editing, or none (top-level) when creating.
  const [parentTaskId, setParentTaskId] = useState<string | null>(task?.parent_task_id ?? null);

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
    validate,
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
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit task' : 'New task'}
      subtitle={isEdit ? 'Update this task' : 'Add a task to this project'}
      submitLabel={isEdit ? 'Save task' : 'Create task'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty || depsDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      {/* FR-CUA-070 breadth (review fix #4): the edit-modal save routes externally — surface its
          pending-push state here (pushing while saving, push-failed when the save is rejected and the
          modal stays open). Idle renders nothing (create + PMO-owned). */}
      {isEdit && <TaskPushBadge state={pendingPushState} />}
      <FormSection legend="Details">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Task name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Survey the site"
            fullWidth
          />
          <Combobox
            label="Assignee"
            value={assigneeField.value || null}
            selectedOption={selectedAssignee}
            loadOptions={async () => assigneeOptions}
            onChange={(v) => assigneeField.onChange(v)}
            placeholder={profilesPending ? 'Loading people…' : 'Unassigned'}
            searchPlaceholder="Search people…"
            noun="person"
          />
          <SelectField
            id={statusField.id}
            label="Status"
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
            label="Priority"
            value={priorityField.value}
            onChange={(v) => priorityField.onChange(v)}
            onBlur={priorityField.onBlur}
            options={PRIORITY_OPTIONS}
          />
          <TextField
            id={startField.id}
            label="Start date"
            type="date"
            value={startField.value}
            onChange={startField.onChange}
            onBlur={startField.onBlur}
          />
          <TextField
            id={endField.id}
            label="Due date"
            type="date"
            value={endField.value}
            onChange={endField.onChange}
            onBlur={endField.onBlur}
          />
          {milestones.length > 0 && (
            <Combobox
              label="Milestone"
              value={milestoneId}
              selectedOption={selectedMilestone}
              loadOptions={async () => milestoneOptions}
              onChange={(v) => setMilestoneId(v || null)}
              placeholder="Ungrouped"
              searchPlaceholder="Search milestones…"
              noun="milestone"
            />
          )}
          {/* OD-INT-9 — the parent-task picker. Options already exclude the task itself and
              all of its descendants (the cycle guard), so an invalid choice can't be selected
              at all. Hidden when there's nothing eligible to pick (e.g. the project's only
              task), mirroring the Milestone field's gating above. */}
          {parentOptions.length > 0 && (
            <Combobox
              label="Parent task"
              value={parentTaskId}
              selectedOption={selectedParent}
              loadOptions={async () => parentOptions}
              onChange={(v) => setParentTaskId(v || null)}
              placeholder="No parent (top-level)"
              searchPlaceholder="Search tasks…"
              noun="task"
            />
          )}
          {/* OD-INT-9 — Description. Multi-line (the shared TextArea primitive), full-width so the
              textarea gets the room a scope/notes field needs. Uses the existing FieldShell a11y
              (visible label + aria wiring) — no ad-hoc styling. */}
          <TextArea
            id={descriptionField.id}
            label="Description"
            value={descriptionField.value}
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
            placeholder="Add scope, notes, or acceptance criteria…"
            fullWidth
          />
        </FormGrid>
        {profilesError && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            People could not be loaded; you can still save and assign later.
          </p>
        )}
      </FormSection>

      {/* Dependencies — only when editing an existing task (need its id + the sibling list). */}
      {isEdit && (
        <FormSection legend="Depends on">
          {deps.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No dependencies. Add a task that must finish first.
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
                    aria-label={`Remove dependency ${taskName(d)}`}
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
                label="Add a dependency"
                value={depPick}
                loadOptions={async () => depCandidates}
                onChange={(v) => {
                  setDeps((prev) => (prev.includes(v) ? prev : [...prev, v]));
                  setDepPick(null);
                }}
                placeholder="Select a task…"
                searchPlaceholder="Search tasks…"
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
  /** OD-INT-9 — a factory, not a static array: each milestone group needs columns bound to
   *  ITS OWN depth map (a subtask can land in a different group than its parent). */
  buildColumns: (depths: Map<string, number>) => Column<TaskWithRefs>[];
  canCreate: boolean;
  canRowWrite: boolean;
  rowMenu: (t: TaskWithRefs) => RowMenuItem[];
  onAddTask: (milestoneId: string | null) => void;
  onActivate?: (t: TaskWithRefs) => void;
}

/**
 * Renders tasks grouped under their milestone headings (AC-DEL-010, FR-DEL-015).
 * Milestone sections ordered by sort_order; ungrouped tasks trail at the end.
 * Each milestone heading shows name + target date only (FR-DEL-015).
 */
const MilestoneGroupedList: React.FC<MilestoneGroupedListProps> = ({
  milestones,
  tasks,
  buildColumns,
  canCreate,
  canRowWrite,
  rowMenu,
  onAddTask,
  onActivate,
}) => {
  // Group tasks by milestone_id
  const tasksByMilestone = useMemo(() => {
    const map = new Map<string | null, TaskWithRefs[]>();
    for (const t of tasks) {
      const key = t.milestone_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [milestones],
  );

  const ungrouped = tasksByMilestone.get(null) ?? [];

  const renderGroup = (ms: MilestoneWithProgress | null, groupTasks: TaskWithRefs[]) => {
    const sectionLabel = ms ? ms.name : 'Ungrouped';
    const isUngrouped = ms === null;
    // OD-INT-9 (AC-SUB-UI-004) — order + depth are computed PER GROUP. A subtask whose parent
    // sits in a different milestone group is not present in `groupTasks`, so
    // buildTaskRenderOrder treats it as an orphan root (depth 0): it still renders in its OWN
    // group — never silently dropped — just without indentation (its parent isn't in view here).
    const order = buildTaskRenderOrder(groupTasks);
    const rows = order.map((n) => n.task);
    const depths = new Map(order.map((n) => [n.task.id, n.depth]));
    return (
      <section
        key={ms?.id ?? 'ungrouped'}
        aria-label={sectionLabel}
        className="mb-4"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2">
          {isUngrouped ? (
            <span className="text-[12px] text-muted-foreground">No milestone</span>
          ) : (
            <MilestonePhaseHeader
              variant="compact"
              name={ms.name}
              targetDate={ms.target_date}
              effectivePct={ms.effective_pct}
            />
          )}
          {canCreate && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onAddTask(ms?.id ?? null)}
            >
              <Icon name="plus" />
              Add task
            </Button>
          )}
        </div>
        {groupTasks.length > 0 ? (
          <DataTable<TaskWithRefs>
            rows={rows}
            columns={buildColumns(depths)}
            rowKey={(t) => t.id}
            rowMenu={canRowWrite ? rowMenu : undefined}
            onActivate={onActivate}
          />
        ) : (
          <p className="py-2 text-center text-[12px] text-muted-foreground">No tasks in this group.</p>
        )}
      </section>
    );
  };

  return (
    <div>
      {sortedMilestones.map((ms) =>
        renderGroup(ms, tasksByMilestone.get(ms.id) ?? []),
      )}
      {ungrouped.length > 0 && renderGroup(null, ungrouped)}
    </div>
  );
};

export default TasksTab;
