/**
 * #2807 in-place outline dialogs for the task view: add a task group, and move a task to another group or under
 * another task. Both write through the existing repositories (task groups #2679, tasks); the database refuses a
 * move under the task's own subtask (TASK_TREE_CYCLE, migration 1970) and these dialogs never offer one.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, FormGrid, SelectField, TextField, useToast, type ComboboxOption, type SubmitError } from '@/src/components/ui';
import { useTaskGroupMutations } from '@/src/hooks/useTaskGroups';
import { useMilestoneMutations } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import MilestoneFormModal from '../MilestoneFormModal';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { TaskGroupRow, WithTaskGroup } from '@/src/lib/db/taskGroups';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import { collectDescendants } from '@/src/lib/tasks/taskTree';

// The page's own `onError` toasts and owns the single save_failed event; this keeps the reason on screen too.
const keepError = (set: (e: SubmitError) => void, onError: (err: unknown) => void) => (err: unknown) => {
  const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
  set({ headline, detail });
  onError(err);
};

export function TaskGroupFormModal({ milestones, onClose, onCreate, onError }: {
  milestones: MilestoneWithProgress[];
  onClose: () => void;
  onCreate: (input: { name: string; milestone_id: string | null }) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation('project');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const fail = keepError(setSaveError, onError);
  return <EntityFormModal
    open
    title={t('projectDetail.tasks.groupForm.title', 'New task group')}
    submitLabel={t('projectDetail.tasks.groupForm.create', 'Create group')}
    onClose={onClose}
    loading={busy}
    submitError={saveError}
    dirty={!!name.trim() || !!phase}
    submitDisabled={!name.trim()}
    onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim()) return;
      setBusy(true);
      onCreate({ name: name.trim(), milestone_id: phase || null }).catch(fail).finally(() => setBusy(false));
    }}
  >
    <FormGrid>
    <TextField label={t('projectDetail.tasks.groupForm.name', 'Group name')} value={name} onChange={setName} maxLength={120} required autoFocus />
    {milestones.length > 0 && <SelectField
      label={t('projectDetail.tasks.groupForm.phase', 'In phase')}
      value={phase}
      onChange={setPhase}
      options={milestones.map((m) => ({ value: m.id, label: m.name }))}
      placeholder={t('projectDetail.tasks.groupForm.noPhase', 'No phase')}
    />}
    </FormGrid>
  </EntityFormModal>;
}

const groupOf = (task: TaskWithRefs) => (task as TaskWithRefs & WithTaskGroup).task_group_id ?? null;

/** One place value for the group picker: `m:<phase>`, `g:<group>` or '' (ungrouped). */
const placeOf = (task: TaskWithRefs) => groupOf(task) ? `g:${groupOf(task)}` : task.milestone_id ? `m:${task.milestone_id}` : '';

export function MoveTaskDialog({ task, allTasks, milestones, taskGroups, canGroup, onClose, onMove, onError }: {
  task: TaskWithRefs;
  allTasks: TaskWithRefs[];
  milestones: MilestoneWithProgress[];
  taskGroups: TaskGroupRow[];
  /** Groups are a structure edit (managers, database-enforced); others may only change the parent task. */
  canGroup: boolean;
  onClose: () => void;
  /** Moves `task` and carries the new place to its subtasks. */
  onMove: (parentTaskId: string | null, place: string | null) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation('project');
  const [parent, setParent] = useState<string | null>(task.parent_task_id ?? null);
  const [place, setPlace] = useState(placeOf(task));
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const blocked = useMemo(() => new Set([task.id, ...collectDescendants(task.id, allTasks)]), [allTasks, task.id]);
  const parentOptions: ComboboxOption[] = useMemo(() => allTasks
    .filter((x) => !blocked.has(x.id) && x.archived_at == null)
    .map((x) => ({ value: x.id, label: x.name })), [allTasks, blocked]);
  const byId = useMemo(() => new Map(allTasks.map((x) => [x.id, x])), [allTasks]);
  // Under a task, the place is the parent's: the whole branch lives in one group.
  const shownPlace = parent ? placeOf(byId.get(parent) ?? task) : place;
  const placeOptions = [
    ...milestones.map((m) => ({ value: `m:${m.id}`, label: m.name })),
    ...(canGroup ? taskGroups.map((g) => ({ value: `g:${g.id}`, label: g.name })) : []),
  ];
  const dirty = parent !== (task.parent_task_id ?? null) || shownPlace !== placeOf(task);
  const fail = keepError(setSaveError, onError);
  return <EntityFormModal
    open
    title={t('projectDetail.tasks.move.title', 'Move {{name}}', { name: task.name })}
    submitLabel={t('projectDetail.tasks.move.submit', 'Move')}
    onClose={onClose}
    loading={busy}
    submitError={saveError}
    dirty={dirty}
    submitDisabled={!dirty}
    onSubmit={(e) => {
      e.preventDefault();
      setBusy(true);
      onMove(parent, shownPlace !== placeOf(task) ? shownPlace : null).catch(fail).finally(() => setBusy(false));
    }}
  >
    <FormGrid>
    <Combobox
      label={t('projectDetail.tasks.move.parent', 'Under task')}
      value={parent}
      selectedOption={parentOptions.find((o) => o.value === parent) ?? null}
      loadOptions={async () => parentOptions}
      onChange={(v) => setParent(v || null)}
      placeholder={t('projectDetail.tasks.move.noParent', 'None (a top task)')}
      searchPlaceholder={t('projectDetail.tasks.form.searchTasks', 'Search tasks…')}
      noun={t('projectDetail.tasks.move.taskNoun', 'task')}
    />
    <SelectField
      label={t('projectDetail.tasks.move.place', 'Group')}
      value={shownPlace}
      onChange={setPlace}
      disabled={!!parent || (!canGroup && milestones.length === 0)}
      options={placeOptions}
      placeholder={t('projectDetail.tasks.ungrouped', 'Ungrouped')}
      helper={parent ? t('projectDetail.tasks.move.followsParent', 'A subtask stays in its parent task\'s group.') : undefined}
    />
    </FormGrid>
  </EntityFormModal>;
}

/** "Add group" in the task view: a task group, or a phase (the existing phase form), saved without leaving the tab. */
export function NewGroupingDialog({ kind, projectId, milestones, onDone }: {
  kind: 'group' | 'phase';
  projectId: string;
  milestones: MilestoneWithProgress[];
  onDone: () => void;
}) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const groups = useTaskGroupMutations(projectId);
  const phases = useMilestoneMutations(projectId);
  const onError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };
  if (kind === 'phase') {
    return <MilestoneFormModal
      milestone={null}
      onClose={onDone}
      onCreate={async (input) => {
        await phases.create.mutateAsync({ input });
        toast(t('projectDetail.milestones.toast.created', 'Phase created'), input.name, 'success');
        onDone();
      }}
      onUpdate={async () => undefined}
      onError={onError}
    />;
  }
  return <TaskGroupFormModal
    milestones={milestones}
    onClose={onDone}
    onCreate={async (input) => {
      await groups.create.mutateAsync(input);
      toast(t('projectDetail.tasks.taskGroups.toast.created', 'Task group created'), input.name, 'success');
      onDone();
    }}
    onError={onError}
  />;
}
