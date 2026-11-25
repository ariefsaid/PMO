import React from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkOrderChecks } from '@/src/hooks/useWorkOrderChecks';

/** Names a work order's checks still open, inside its Issue confirm (#2898). Never blocks Issue; nothing when all are done. */
export const OpenChecksWarning: React.FC<{ projectId: string; workOrderId: string }> = ({ projectId, workOrderId }) => {
  const { t } = useTranslation('workOrders');
  const open = (useWorkOrderChecks(projectId, workOrderId).data ?? []).filter((task) => task.status !== 'Done').map((task) => task.name);
  if (open.length === 0) return null;
  return <p data-testid="wo-issue-open-checks" className="font-medium text-warning-foreground">{t('checks.openWarning', 'Still open: {{names}}', { names: open.join(', ') })}</p>;
};
