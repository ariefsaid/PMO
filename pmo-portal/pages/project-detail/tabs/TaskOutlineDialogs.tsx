/**
 * #2807 in-place outline dialogs for the task view: add a task group, and move a task to another group or under
 * another task. Both write through the existing repositories (task groups #2679, tasks); the database refuses a
 * move under the task's own subtask (TASK_TREE_CYCLE, migration 1970) and these dialogs never offer one.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, SelectField, TextField, type ComboboxOption } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { TaskGroupRow, WithTaskGroup } from '@/src/lib/db/taskGroups';
import type { TaskPatch, TaskWithRefs } from '@/src/lib/db/tasks';
import { collectDescendants } from '@/src/lib/tasks/taskTree';

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
  return <EntityFormModal
    open
    title={t('projectDetail.tasks.groupForm.title', 'New task group')}
    submitLabel={t('projectDetail.tasks.groupForm.create', 'Create group')}
    onClose={onClose}
    loading={busy}
    dirty={!!name.trim() || !!phase}
    submitDisabled={!name.trim()}
    onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim()) return;
      setBusy(true);
      onCreate({ name: name.trim(), milestone_id: phase || null }).catch(onError).finally(() => setBusy(false));
    }}
  >
    <TextField label={t('projectDetail.tasks.groupForm.name', 'Group name')} value={name} onChange={setName} maxLength={120} required autoFocus />
    {milestones.length > 0 && <SelectField
      label={t('projectDetail.tasks.groupForm.phase', 'In phase')}
      value={phase}
      onChange={setPhase}
      options={milestones.map((m) => ({ value: m.id, label: m.name }))}
      placeholder={t('projectDetail.tasks.groupForm.noPhase', 'No phase')}
    />}
  </EntityFormModal>;
}

const groupOf = (task: TaskWithRefs) => (task as TaskWithRefs & WithTaskGroup).task_group_id ?? null;

/** One place value for the group picker: `m:<phase>`, `g:<group>` or '' (ungrouped). */
const placeOf = (task: TaskWithRefs) => groupOf(task) ? `g:${groupOf(task)}` : task.milestone_id ? `m:${task.milestone_id}` : '';

/**
 * The patch that puts a task in a place. A group carries its own phase link (#2679), so a task in a group has no
 * phase of its own (it would otherwise count toward two phases); a task in a phase leaves its group.
 */
export function placePatch(place: string): TaskPatch {
  if (place.startsWith('g:')) return { task_group_id: place.slice(2), milestone_id: null };
  if (place.startsWith('m:')) return { task_group_id: null, milestone_id: place.slice(2) };
  return { task_group_id: null, milestone_id: null };
}

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
  return <EntityFormModal
    open
    title={t('projectDetail.tasks.move.title', 'Move {{name}}', { name: task.name })}
    submitLabel={t('projectDetail.tasks.move.submit', 'Move')}
    onClose={onClose}
    loading={busy}
    dirty={dirty}
    submitDisabled={!dirty}
    onSubmit={(e) => {
      e.preventDefault();
      setBusy(true);
      onMove(parent, shownPlace !== placeOf(task) ? shownPlace : null).catch(onError).finally(() => setBusy(false));
    }}
  >
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
  </EntityFormModal>;
}
