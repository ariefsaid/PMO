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
  type StatusVariant,
  type ComboboxOption,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useTasks, useTaskMutations, useAssignableProfiles } from '@/src/hooks/useTasks';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { TaskWithRefs, TaskStatus, TaskInput, TaskPatch } from '@/src/lib/db/tasks';

// ── Status vocabulary ───────────────────────────────────────────────────────
// The four task_status enum values. Each maps to a distinct StatusPill variant
// (tint + label + dot — never colour-only) from the sanctioned palette: To Do =
// quiet neutral, In Progress = the single blue `open`, Done = `won` green,
// Blocked = `lost` red. The label always rides alongside, so it is never
// colour-only (DESIGN.md Tinted-Status / color-not-only).
const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
const STATUS_PILL: Record<TaskStatus, StatusVariant> = {
  'To Do': 'neutral',
  'In Progress': 'open',
  Done: 'won',
  Blocked: 'lost',
};
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s }));

type ViewMode = 'list' | 'board';

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

  const [view, setView] = useState<ViewMode>('list');
  const [formTarget, setFormTarget] = useState<{ task: TaskWithRefs | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskWithRefs | null>(null);

  // Structure write (title / assignee / dates / delete) = Admin·Exec·PM.
  const canCreate = may('create', 'task');
  const canEdit = may('edit', 'task');
  const canDelete = may('delete', 'task');
  const canRowWrite = canEdit || canDelete;

  const all = useMemo(() => data ?? [], [data]);

  /** May the current viewer set THIS task's status? Managers: any; Engineer: own only. */
  const canSetStatus = (t: TaskWithRefs): boolean =>
    may('edit', 'taskStatus', { currentUserId, record: { assignee_id: t.assignee_id } });

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
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
        <select
          aria-label={`Status for ${task.name}`}
          value={task.status}
          disabled={updateStatus.isPending}
          onChange={(e) => onStatusChange(task, e.target.value as TaskStatus)}
          className="h-7 rounded-md border border-input bg-background px-2 text-[12.5px] text-foreground disabled:cursor-not-allowed disabled:bg-secondary"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }
    return <StatusPill variant={STATUS_PILL[task.status]}>{task.status}</StatusPill>;
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
        <DataTable<TaskWithRefs>
          rows={all}
          columns={columns}
          rowKey={(t) => t.id}
          rowMenu={canRowWrite ? rowMenu : undefined}
        />
      )}

      {state === undefined && view === 'board' && (
        <TaskBoard
          tasks={all}
          canSetStatus={canSetStatus}
          onStatusChange={onStatusChange}
          statusBusy={updateStatus.isPending}
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <TaskFormModal
          task={formTarget.task}
          projectId={projectId}
          allTasks={all}
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
                        <select
                          aria-label={`Status for ${t.name}`}
                          value={t.status}
                          disabled={statusBusy}
                          onChange={(e) => onStatusChange(t, e.target.value as TaskStatus)}
                          className="h-7 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground disabled:cursor-not-allowed disabled:bg-secondary"
                        >
                          {STATUSES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusPill variant={STATUS_PILL[t.status]}>{t.status}</StatusPill>
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
  onClose: () => void;
  onCreate: (input: TaskInput) => Promise<void>;
  onUpdate: (id: string, patch: TaskPatch, deps: DepDelta) => Promise<void>;
  onError: (err: unknown) => void;
}

const TaskFormModal: React.FC<TaskFormModalProps> = ({
  task,
  projectId,
  allTasks,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const isEdit = !!task;
  const { data: profiles, isPending: profilesPending, isError: profilesError } =
    useAssignableProfiles();

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
          await onUpdate(task.id, base, delta);
        } else {
          await onCreate({ project_id: projectId, ...base });
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

export default TasksTab;
