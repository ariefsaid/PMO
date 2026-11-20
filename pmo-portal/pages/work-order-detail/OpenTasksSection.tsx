import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

interface Props { tasks: TaskWithRefs[]; isPending: boolean; isError: boolean; onRetry: () => void }

/** FR-WORP-025: the tasks (#2531) that name this work order and are not Done, with assignee and due date. */
export const OpenTasksSection: React.FC<Props> = ({ tasks, isPending, isError, onRetry }) => {
  const { t } = useTranslation('workOrders');
  const title = t('openTasks.title', 'Open tasks');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={1} /></RecordSection>;
  if (isError) return <RecordSection title={title}><ListState variant="error" title={t('openTasks.error', "Couldn't load the open tasks")} onRetry={onRetry} /></RecordSection>;
  return (
    <RecordSection title={title}>
      {tasks.length === 0
        ? <p className="text-control text-muted-foreground">{t('openTasks.empty', 'No open tasks name this work order.')}</p>
        : <ul className="divide-y divide-border" data-testid="wo-open-tasks">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <Link className="min-w-0 flex-1 underline" to={`/projects/${task.project_id}/tasks?open=${encodeURIComponent(task.id)}`}>{task.name}</Link>
                <span className="text-muted-foreground">{task.assignee?.full_name ?? t('openTasks.unassigned', 'Unassigned')}</span>
                <span className="text-muted-foreground">{task.end_date ? formatDay(task.end_date) : t('openTasks.noDue', 'No due date')}</span>
              </li>
            ))}
          </ul>}
    </RecordSection>
  );
};
