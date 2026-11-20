/** The open tasks of one work order (#2531, FR-TWOP-003): assignee and due date. Exported for the work-order page. */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

export const WorkOrderOpenTasks: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('tasks');
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const { data, isPending, isError } = useQuery({
    queryKey: ['tasks', orgId, 'work-order', workOrderId],
    queryFn: () => repositories.task.listOpenByWorkOrder(workOrderId),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
  if (isPending) return <p className="text-sm text-muted-foreground">{t('workOrderTasks.loading')}</p>;
  if (isError) return <p role="alert" className="text-sm text-destructive">{t('workOrderTasks.loadFailed')}</p>;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">{t('workOrderTasks.empty')}</p>;
  return (
    <section aria-label={t('workOrderTasks.title')}>
      <h3 className="text-sm font-semibold">{t('workOrderTasks.title')}</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {data.map((task) => (
          <li key={task.id} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{task.name}</span>
            <span className="text-muted-foreground">{task.assignee?.full_name ?? t('workOrderTasks.unassigned')}</span>
            <span className="text-muted-foreground">{task.end_date ?? t('workOrderTasks.noDue')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
