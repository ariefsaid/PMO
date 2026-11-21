/**
 * Task groups (#2679): per-project groups of tasks. A group linked to a phase rolls its tasks up to that phase
 * (the phase percentage comes from get_project_milestones, migration 1396). Managers (the milestone writers) add,
 * rename-by-recreate is out of scope, link, archive and delete; everyone else only sees groups that exist.
 * The panel is invisible to a non-manager while the project has no group.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ProgressBar, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useTaskGroups, useTaskGroupMutations } from '@/src/hooks/useTaskGroups';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { groupProgress, type RollupTask } from '@/src/lib/delivery/milestoneRollup';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { TaskGroupRow, WithTaskGroup } from '@/src/lib/db/taskGroups';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

interface TaskGroupsPanelProps {
  projectId: string;
  tasks: TaskWithRefs[];
  milestones: MilestoneWithProgress[];
}

const toRollup = (t: TaskWithRefs & WithTaskGroup): RollupTask => ({
  id: t.id,
  status: t.status,
  milestone_id: t.milestone_id ?? null,
  task_group_id: t.task_group_id ?? null,
  parent_task_id: t.parent_task_id ?? null,
  archived_at: t.archived_at ?? null,
});

const TaskGroupsPanel: React.FC<TaskGroupsPanelProps> = ({ projectId, tasks, milestones }) => {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const may = usePermission();
  const canManage = may('edit', 'milestone');
  const { data } = useTaskGroups(projectId);
  const { create, update, remove } = useTaskGroupMutations(projectId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TaskGroupRow | null>(null);

  const groups = useMemo(() => data ?? [], [data]);
  const rollupTasks = useMemo(() => tasks.map(toRollup), [tasks]);
  const phaseOptions = useMemo(
    () => milestones.map((m) => ({ value: m.id, label: m.name })),
    [milestones],
  );

  if (!canManage && groups.length === 0) return null;

  const fail = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed });
      toast(t('projectDetail.tasks.taskGroups.toast.created', 'Task group created'), trimmed, 'success');
      setName('');
    } catch (err) {
      fail(err);
    }
  };

  const onLink = async (group: TaskGroupRow, milestoneId: string) => {
    try {
      await update.mutateAsync({ id: group.id, patch: { milestone_id: milestoneId || null } });
    } catch (err) {
      fail(err);
    }
  };

  const onArchive = async (group: TaskGroupRow) => {
    try {
      await update.mutateAsync({ id: group.id, patch: { archived_at: group.archived_at ? null : new Date().toISOString() } });
    } catch (err) {
      fail(err);
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await remove.mutateAsync(target.id);
      toast(t('projectDetail.tasks.taskGroups.toast.deleted', 'Task group deleted'), target.name, 'success');
    } catch (err) {
      fail(err);
    }
  };

  const title = t('projectDetail.tasks.taskGroups.title', 'Task groups');

  return (
    <section
      aria-label={title}
      className="mx-[var(--panel-inset)] mb-3 rounded-lg border border-border bg-surface"
      data-testid="task-groups-panel"
    >
      <Button
        variant="ghost"
        className="min-h-11 w-full justify-between gap-2 rounded-none px-3 text-left text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <span className="text-xs font-normal text-text-muted">
          {t('projectDetail.tasks.taskGroups.count', '{{count}} groups', { count: groups.length })}
        </span>
      </Button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {groups.length === 0 && (
            <p className="text-sm text-text-muted">
              {t('projectDetail.tasks.taskGroups.empty', 'No task groups yet. A group linked to a phase moves that phase\'s progress with its tasks.')}
            </p>
          )}
          <ul className="space-y-3">
            {groups.map((group) => {
              const p = groupProgress(group.id, rollupTasks);
              return (
                <li key={group.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] md:items-end">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">
                      {group.name}
                      {group.archived_at && (
                        <span className="ml-2 text-xs font-normal text-text-muted">{t('projectDetail.tasks.taskGroups.archived', 'Archived')}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <ProgressBar
                        value={p.calculatedPct ?? 0}
                        compact
                        aria-label={t('projectDetail.tasks.taskGroups.progressAria', '{{name}} progress', { name: group.name })}
                      />
                      <span>
                        {t('projectDetail.tasks.taskGroups.done', '{{done}} of {{total}} done', { done: p.doneCount, total: p.taskCount })}
                      </span>
                    </div>
                  </div>
                  {canManage ? (
                    <SelectField
                      label={t('projectDetail.tasks.taskGroups.phase', 'Phase')}
                      value={group.milestone_id ?? ''}
                      onChange={(v) => void onLink(group, v)}
                      options={phaseOptions}
                      placeholder={t('projectDetail.tasks.taskGroups.noPhase', 'Not linked')}
                      compact
                    />
                  ) : (
                    <span className="text-xs text-text-muted">
                      {phaseOptions.find((o) => o.value === group.milestone_id)?.label ?? t('projectDetail.tasks.taskGroups.noPhase', 'Not linked')}
                    </span>
                  )}
                  {canManage && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => void onArchive(group)}>
                        {group.archived_at
                          ? t('projectDetail.tasks.taskGroups.restore', 'Restore')
                          : t('projectDetail.tasks.taskGroups.archive', 'Archive')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteTarget(group)}>
                        {t('projectDetail.tasks.taskGroups.delete', 'Delete')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {canManage && (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => { e.preventDefault(); void onAdd(); }}
            >
              <TextField
                label={t('projectDetail.tasks.taskGroups.name', 'New group name')}
                value={name}
                onChange={setName}
                maxLength={120}
                wrapperClassName="sm:w-72"
              />
              <Button type="submit" variant="outline" size="sm" loading={create.isPending} disabled={!name.trim()}>
                {t('projectDetail.tasks.taskGroups.add', 'Add group')}
              </Button>
            </form>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={t('projectDetail.tasks.taskGroups.deleteTitle', 'Delete task group?')}
        description={t('projectDetail.tasks.taskGroups.deleteBody', 'The tasks stay in the project; they just leave this group.')}
        confirmLabel={t('projectDetail.tasks.taskGroups.delete', 'Delete')}
        onConfirm={() => void onDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
};

export default TaskGroupsPanel;
