import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  TextField,
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
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useTasks, useTaskMutations, useAssignableProfiles } from '@/src/hooks/useTasks';
import { useMilestones } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { TaskWithRefs, TaskStatus, TaskInput, TaskPatch } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { MilestonePhaseHeader } from '@/src/components/milestones/MilestonePhaseHeader';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import ProjectGantt from '../ProjectGantt';

// ── Status vocabulary ───────────────────────────────────────────────────────
// The four task_status enum values. The pill variant comes from the single status
// registry (`workflowVariant`): To Do = quiet neutral, In Progress = neutral grey
// `progress` (NOT the action-blue, per the Freed-Blue Status Rule), Done = green
// `won`, Blocked = red `lost`. The distinct LABEL always rides alongside (never
// colour-only — DESIGN.md Tinted-Status / color-not-only).
const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s }));

type ViewMode = 'list' | 'board' | 'timeline';

interface FormValues {
  name: string;
  status: TaskStatus;
  assignee_id: string;
  start_date: string;
  end_date: string;
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
  const { create, update, updateStatus, remove, addDependency, removeDependency } =
    useTaskMutations(projectId);
  const { data: milestones } = useMilestones(projectId);

  const [view, setView] = useState<ViewMode>('list');
  // defaultMilestoneId — pre-populated when clicking "Add task" within a group.
  const [formTarget, setFormTarget] = useState<{ task: TaskWithRefs | null; defaultMilestoneId?: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskWithRefs | null>(null);

  // Structure write (title / assignee / dates / delete) = Admin·Exec·PM.
  const canCreate = may('create', 'task');
  const canEdit = may('edit', 'task');
  const canDelete = may('delete', 'task');
  const canRowWrite = canEdit || canDelete;

  const all = useMemo(() => data ?? [], [data]);
  const milestoneList = useMemo(() => milestones ?? [], [milestones]);

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
      const { headline, detail } = classifyMutationError(err);
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
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  // ── Status control: editable <select> for those who may set it, static pill otherwise. ──
  const StatusCell: React.FC<{ task: TaskWithRefs }> = ({ task }) => {
    if (canSetStatus(task)) {
      return (
        <SelectField
          hideLabel
          label={`Status for ${task.name}`}
          value={task.status}
          disabled={updateStatus.isPending}
          onChange={(v) => onStatusChange(task, v as TaskStatus)}
          options={STATUS_OPTIONS}
          className="w-auto min-w-[120px]"
        />
      );
    }
    return <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>;
  };

  const columns: Column<TaskWithRefs>[] = [
    {
      key: 'name',
      header: 'Task',
      cell: (t) => (
        <span className="truncate font-semibold" title={t.name}>
          {t.name}
        </span>
      ),
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
          <span className="tabular text-muted-foreground">{t.end_date}</span>
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
        {canCreate && (
          <Button variant="primary" size="sm" onClick={() => setFormTarget({ task: null })}>
            <Icon name="plus" />
            New task
          </Button>
        )}
      </div>

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
          // No milestones: flat list (original behaviour)
          <DataTable<TaskWithRefs>
            rows={all}
            columns={columns}
            rowKey={(t) => t.id}
            rowMenu={canRowWrite ? rowMenu : undefined}
            onActivate={canEdit ? (t) => setFormTarget({ task: t }) : undefined}
            rowLabel={canEdit ? (t) => `Edit ${t.name}` : undefined}
          />
        ) : (
          // Milestones exist: group tasks by milestone
          <MilestoneGroupedList
            milestones={milestoneList}
            tasks={all}
            columns={columns}
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
          tasks={all}
          canSetStatus={canSetStatus}
          onStatusChange={onStatusChange}
          statusBusy={updateStatus.isPending}
        />
      )}

      {state === undefined && view === 'timeline' && (
        <ProjectGantt tasks={all} milestones={milestoneList} />
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
            const { headline, detail } = classifyMutationError(err);
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
}

/**
 * Status-column board. A keyboard-first alternative to drag (ui-ux-pro-max
 * gesture-alternative): each card carries a status `<select>` for those who may
 * move it (managers: any; Engineer: own task only), or a static pill otherwise.
 */
const TaskBoard: React.FC<TaskBoardProps> = ({ tasks, canSetStatus, onStatusChange, statusBusy }) => {
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
                    <div className="truncate text-[13px] font-semibold" title={t.name}>
                      {t.name}
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

  const form = useEntityForm<FormValues>({
    initialValues: {
      name: task?.name ?? '',
      status: task?.status ?? 'To Do',
      assignee_id: task?.assignee_id ?? '',
      start_date: task?.start_date ?? '',
      end_date: task?.end_date ?? '',
    },
    validate,
    idPrefix: 'task-form',
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
      };
      try {
        if (isEdit && task) {
          const delta: DepDelta = {
            add: deps.filter((d) => !initialDeps.includes(d)),
            remove: initialDeps.filter((d) => !deps.includes(d)),
          };
          await onUpdate(task.id, { ...base, milestone_id: milestoneId }, delta);
        } else {
          await onCreate({ project_id: projectId, ...base, milestone_id: milestoneId });
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
  columns: Column<TaskWithRefs>[];
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
  columns,
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
            rows={groupTasks}
            columns={columns}
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
