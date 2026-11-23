/**
 * Task create/edit modal (XG03-005 / T-44) — extracted from TasksTab. Owns the form's
 * local state and validation: the field validator, the priority options, the OD-INT-9
 * parent-cycle guard and the dependency-add/remove delta. TasksTab remains the owner of
 * permissions and the actual mutations (create/update/dependency writes) which arrive as
 * callbacks; the modal keeps its persistent save-error evidence and the sequential
 * dependency mutations contract on the update path.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  EntityFormModal,
  type SubmitError,
  TextField,
  TextArea,
  SelectField,
  Combobox,
  FormSection,
  FormGrid,
  useEntityForm,
  Button,
  Checkbox,
  Icon,
  type ComboboxOption,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { IDLE_PENDING_PUSH, type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { PartialTreeError, type TaskWithRefs, type TaskStatus, type TaskPriority, type TaskInput, type TaskPatch, type SubtaskDraft } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { WithTaskGroup } from '@/src/lib/db/taskGroups';
import { SubtaskDraftsEditor, countDrafts, namedDrafts, newDraft } from './SubtaskDrafts';
import { STATUS_OPTIONS } from './taskViewModel';
import { DateField } from '@/src/components/ui/DateField';

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

export interface FormValues {
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

export interface DepDelta {
  add: string[];
  remove: string[];
}

interface TaskFormModalProps {
  task: TaskWithRefs | null;
  projectId: string;
  allTasks: TaskWithRefs[];
  /** Pre-populated milestone id when clicking "Add task" inside a milestone group (AC-DEL-011). */
  defaultMilestoneId?: string | null;
  /** #2807: pre-populated task group when clicking "Add task" inside a group section. */
  defaultTaskGroupId?: string | null;
  /** #2807: open with one empty subtask row focused ("Add subtask" on a row). */
  startWithSubtask?: boolean;
  /** Available milestones for the milestone select field. */
  milestones?: MilestoneWithProgress[];
  /** #2679: active task groups of the project; the select shows only when there are some and the caller manages. */
  taskGroups?: { id: string; name: string }[];
  /** #2531: the project's work orders for the link picker (structure editors only). */
  workOrders?: { id: string; title: string; wo_number: string | null; status: string }[];
  /** #2531: may the viewer set the work-order link and the proof flag (Admin/Executive/Project Manager). */
  canStructure?: boolean;
  /** FR-CUA-070 breadth (review fix #4): the edit-modal save is an external write origin — its
   *  pending-push state surfaces in the modal (pushing while saving / push-failed when the save is
   *  rejected and the modal stays open). Idle for create + PMO-owned. */
  pendingPushState?: PendingPushState;
  onClose: () => void;
  /** `subtasks`: the named subtask rows typed in the form, saved with the task in one request (#2807). */
  onCreate: (input: TaskInput, subtasks: SubtaskDraft[]) => Promise<void>;
  onUpdate: (id: string, patch: TaskPatch, deps: DepDelta, subtasks: SubtaskDraft[]) => Promise<void>;
  onError: (err: unknown) => void;
}

const TaskFormModal: React.FC<TaskFormModalProps> = ({
  task,
  projectId,
  allTasks,
  defaultMilestoneId = null,
  defaultTaskGroupId = null,
  startWithSubtask = false,
  milestones = [],
  taskGroups = [],
  workOrders = [],
  canStructure = false,
  pendingPushState = IDLE_PENDING_PUSH,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation('project');
  const isEdit = !!task;
  const { data: profiles, isPending: profilesPending, isError: profilesError, refetch: refetchProfiles } =
    useAssignableProfiles();
  // Memoised on `t` so the validator identity is stable between renders.
  const validateWithT = useCallback((v: FormValues) => validate(v, t), [t]);

  // milestone_id is tracked separately (not part of useEntityForm, since it's a string | null
  // but not a text field). Default: pre-populated group id for create, or the task's current value.
  const initialMilestoneId = task?.milestone_id ?? defaultMilestoneId;
  const [milestoneId, setMilestoneId] = useState<string | null>(initialMilestoneId);

  // #2807: a subtask is made in the Subtasks section below (or moved with the row's Move action), never by
  // picking a parent here; a new task from this form is a top task.
  const [drafts, setDrafts] = useState<SubtaskDraft[]>(() => (startWithSubtask ? [newDraft()] : []));
  const existingSubtasks = useMemo(
    () => (task ? allTasks.filter((x) => x.parent_task_id === task.id && x.archived_at == null).map((x) => x.name) : []),
    [allTasks, task],
  );
  // A task with subtasks takes its status and dates from them (the counting rule, migration 1970).
  const isParent = existingSubtasks.length > 0 || namedDrafts(drafts).length > 0;

  // #2531 — work-order link and proof-of-completion flag, tracked like milestone_id.
  const initialWorkOrderId = task?.work_order_id ?? null;
  const [workOrderId, setWorkOrderId] = useState<string | null>(initialWorkOrderId);
  const initialProofRequired = task?.proof_required ?? false;
  const [proofRequired, setProofRequired] = useState<boolean>(initialProofRequired);
  const woDirty = workOrderId !== initialWorkOrderId || proofRequired !== initialProofRequired;
  const { t: tTasks } = useTranslation('tasks');
  const workOrderOptions: ComboboxOption[] = workOrders
    // A Cancelled work order takes no new tasks; an existing link to one stays visible.
    .filter((w) => w.status !== 'Cancelled' || w.id === initialWorkOrderId)
    .map((w) => ({ value: w.id, label: w.wo_number ? `${w.wo_number} · ${w.title}` : w.title }));
  const selectedWorkOrder = workOrderOptions.find((o) => o.value === workOrderId) ?? null;

  // PGB-025: Track phase and parent changes as part of form dirty state
  const initialTaskGroupId = task ? (task as TaskWithRefs & WithTaskGroup).task_group_id ?? null : defaultTaskGroupId;
  const [taskGroupId, setTaskGroupId] = useState<string | null>(initialTaskGroupId);
  const phaseDirty = milestoneId !== initialMilestoneId;
  const draftsDirty = countDrafts(drafts) > (startWithSubtask ? 1 : 0) || drafts.some((d) => d.name.trim());

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
            // The parent is sent only when the user changed it: on an externally-owned project it
            // becomes a write to the connected system, so an untouched parent must not be re-asserted.
            {
              ...base,
              milestone_id: milestoneId,
              ...(canStructure && taskGroupId !== initialTaskGroupId ? { task_group_id: taskGroupId } : {}),
              ...(canStructure && workOrderId !== initialWorkOrderId ? { work_order_id: workOrderId } : {}),
              ...(canStructure && proofRequired !== initialProofRequired ? { proof_required: proofRequired } : {}),
            },
            delta,
            namedDrafts(drafts),
          );
        } else {
          await onCreate({
            project_id: projectId,
            ...base,
            milestone_id: milestoneId,
            parent_task_id: null,
            ...(canStructure && workOrderId ? { work_order_id: workOrderId } : {}),
            ...(canStructure && proofRequired ? { proof_required: true } : {}),
            ...(canStructure && taskGroupId ? { task_group_id: taskGroupId } : {}),
          }, namedDrafts(drafts));
        }
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
        const { headline, detail } = err instanceof PartialTreeError
          ? {
              headline: t('projectDetail.tasks.subtasks.partialTitle', 'Only part of the task was saved'),
              detail: t('projectDetail.tasks.subtasks.partialDetail', '{{saved}} of {{total}} tasks were saved. Close this form and add the missing subtasks from the task\'s menu.', { saved: err.saved, total: err.total }),
            }
          : classifyMutationError(err, undefined, { suppressCapture: true });
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
      submitLabel={
        isEdit
          ? t('projectDetail.tasks.form.save', 'Save task')
          : t('projectDetail.tasks.form.create', 'Create task')
      }
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty || depsDirty || phaseDirty || draftsDirty || woDirty || taskGroupId !== initialTaskGroupId}
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
            statusOverride={profilesPending ? 'loading' : profilesError ? 'error' : undefined}
            onRetry={() => void refetchProfiles()}
            onChange={(v) => assigneeField.onChange(v)}
            placeholder={
              profilesPending
                ? t('projectDetail.tasks.form.loadingPeople', 'Loading people…')
                : t('projectDetail.tasks.unassigned', 'Unassigned')
            }
            searchPlaceholder={t('projectDetail.tasks.form.searchPeople', 'Search people…')}
            noun="person"
            emptyMessage={(query) => query ? undefined : t('projectDetail.tasks.form.noAssignees', 'No assignable people are available. Add or activate a user in Administration.')}
          />
          {!isParent && <>
          <SelectField
              id={statusField.id}
              label={t('projectDetail.tasks.form.status', 'Status')}
              required
              value={statusField.value}
              onChange={(v) => statusField.onChange(v as TaskStatus)}
              onBlur={statusField.onBlur}
              options={STATUS_OPTIONS}
            />
  </>}
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
          {isParent ? (
            <p className="col-span-full text-sm text-muted-foreground" data-testid="task-form-rollup-note">
              {t('projectDetail.tasks.subtasks.rollupNote', 'Status and dates come from its subtasks.')}
            </p>
          ) : <>
          <DateField
            id={startField.id}
            label={t('projectDetail.tasks.form.startDate', 'Start date')}
            value={startField.value}
            onChange={startField.onChange}
            onBlur={startField.onBlur}
          />
          <DateField
            id={endField.id}
            label={t('projectDetail.tasks.form.dueDate', 'Due date')}
            value={endField.value}
            onChange={endField.onChange}
            onBlur={endField.onBlur}
          />
          </>}
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
          {canStructure && taskGroups.length > 0 && (
            <Combobox
              label={t('projectDetail.tasks.form.taskGroup', 'Task group')}
              value={taskGroupId}
              selectedOption={taskGroups.map((g) => ({ value: g.id, label: g.name })).find((o) => o.value === taskGroupId) ?? null}
              loadOptions={async () => taskGroups.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(v) => setTaskGroupId(v || null)}
              placeholder={t('projectDetail.tasks.form.noTaskGroup', 'No group')}
              searchPlaceholder={t('projectDetail.tasks.form.searchTaskGroups', 'Search groups…')}
              noun={t('projectDetail.tasks.form.taskGroupNoun', 'group')}
            />
          )}
          {canStructure && (
            <Combobox
              label={tTasks('proof.workOrder')}
              value={workOrderId}
              selectedOption={selectedWorkOrder}
              loadOptions={async () => workOrderOptions}
              onChange={(v) => setWorkOrderId(v || null)}
              placeholder={tTasks('proof.noWorkOrder')}
              noun="work order"
            />
          )}
          {canStructure && (
            <Checkbox
              checked={proofRequired}
              onChange={setProofRequired}
              label={tTasks('proof.required')}
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
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              'projectDetail.tasks.form.peopleLoadFailed',
              'People could not be loaded; you can still save and assign later.',
            )}
          </p>
        )}
      </FormSection>

      <FormSection legend={t('projectDetail.tasks.subtasks.legend', 'Subtasks')}>
        <SubtaskDraftsEditor
          drafts={drafts}
          onChange={setDrafts}
          people={assigneeOptions.map((o) => ({ value: o.value, label: o.label }))}
          existing={existingSubtasks}
          autoFocusFirst={startWithSubtask}
        />
      </FormSection>

      {/* Dependencies — only when editing an existing task (need its id + the sibling list). */}
      {isEdit && (
        <FormSection legend={t('projectDetail.tasks.form.dependsOnLegend', 'Depends on')}>
          {deps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
                  className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-sm"
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

export default TaskFormModal;
