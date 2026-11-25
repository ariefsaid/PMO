import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, FieldError, ListState, RecordSection, StatusPill, TextField, type ComboboxOption } from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';
import { usePermission } from '@/src/auth/usePermission';
import { useAssignableProfiles, useTaskMutations } from '@/src/hooks/useTasks';
import { useWorkOrderChecks } from '@/src/hooks/useWorkOrderChecks';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';

interface Props { workOrderId: string; projectId: string }

/**
 * A Draft work order's checks (#2898): each check is a task on the work order with an owner and a due date, so it reaches
 * the owner's My tasks and notices. New Drafts start with the organisation's standard checks (migration 2680). Open checks
 * never block Issue: this section counts the open ones and the Issue confirm names them.
 * `can('create', 'workOrderCheck')` gates adding (UX); check_task_work_order decides.
 */
export const WorkOrderChecksSection: React.FC<Props> = ({ workOrderId, projectId }) => {
  const { t } = useTranslation('workOrders');
  const may = usePermission();
  const checks = useWorkOrderChecks(projectId, workOrderId);
  const canAdd = may('create', 'workOrderCheck');
  const people = useAssignableProfiles({ enabled: canAdd });
  const { create, update } = useTaskMutations(projectId);
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();
  const title = t('checks.title', 'Checks before issue');

  if (checks.isPending) return <RecordSection title={title}><ListState variant="loading" rows={2} /></RecordSection>;
  if (checks.isError) return <RecordSection title={title}><ListState variant="error" title={t('checks.error', "Couldn't load the checks")} onRetry={() => void checks.refetch()} /></RecordSection>;

  const rows = checks.data ?? [];
  const open = rows.filter((task) => task.status !== 'Done');
  const options: ComboboxOption[] = (people.data ?? []).map((p) => ({ value: p.id, label: p.full_name, sub: p.role }));
  const fail = (err: unknown) => { const { headline, detail } = classifyMutationError(err); setError(detail || headline); };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    create.mutate(
      { project_id: projectId, work_order_id: workOrderId, name: name.trim(), status: 'To Do', assignee_id: ownerId, end_date: due || null },
      { onSuccess: () => { setName(''); setOwnerId(null); setDue(''); }, onError: fail },
    );
  };

  return (
    <RecordSection title={title} data-testid="wo-checks"
      subline={rows.length === 0 ? undefined : open.length === 0
        ? t('checks.allDone', 'All {{count}} done', { count: rows.length })
        // Waiting on someone = amber; the Issue confirm names the open ones (they never block it).
        : <span data-testid="wo-checks-open" className="font-medium text-warning-foreground">{t('checks.openCount', '{{open}} of {{count}} open', { open: open.length, count: rows.length })}</span>}>
      {rows.length === 0
        ? <p className="text-control text-muted-foreground">{t('checks.empty', 'No checks yet.')}</p>
        : (
          <ul className="divide-y divide-border" aria-label={title}>
            {rows.map((task) => (
              <li key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_12rem_7rem_6rem]">
                <span className="min-w-0 text-foreground">{task.name}</span>
                <span className="justify-self-end sm:order-last"><StatusPill record="task" state={task.status} /></span>
                {canAdd && !task.assignee_id && task.status !== 'Done' ? (
                  <Combobox label={<span className="sr-only">{t('checks.ownerFor', 'Owner of {{name}}', { name: task.name })}</span>} value={null} selectedOption={null}
                    loadOptions={async () => options} placeholder={t('checks.chooseOwner', 'Choose owner')}
                    onChange={(v) => { if (v) update.mutate({ id: task.id, patch: { assignee_id: v } }, { onError: fail }); }} />
                ) : <span className="text-muted-foreground">{task.assignee?.full_name ?? t('openTasks.unassigned', 'Unassigned')}</span>}
                <span className="text-muted-foreground tabular-nums">{task.end_date ? formatDay(task.end_date) : t('openTasks.noDue', 'No due date')}</span>
              </li>
            ))}
          </ul>
        )}
      {error && <FieldError id="wo-checks-error">{error}</FieldError>}
      {canAdd && (
        <form className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_11rem_auto] sm:items-end" onSubmit={add}>
          <TextField label={t('checks.name', 'Check')} value={name} onChange={setName} maxLength={200} />
          <Combobox label={t('checks.owner', 'Owner')} value={ownerId} selectedOption={options.find((o) => o.value === ownerId) ?? null}
            loadOptions={async () => options} placeholder={t('openTasks.unassigned', 'Unassigned')} onChange={(v) => setOwnerId(v || null)} />
          <DateField label={t('checks.due', 'Due')} value={due} onChange={setDue} />
          <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>{t('checks.add', 'Add check')}</Button>
        </form>
      )}
    </RecordSection>
  );
};
