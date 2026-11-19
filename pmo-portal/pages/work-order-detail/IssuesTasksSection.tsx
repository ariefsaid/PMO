import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecordSection } from '@/src/components/ui';

/**
 * Issues (#2521) and open tasks (#2531) that name this work order (FR-WORP-025). Neither feature has a
 * work-order column yet, so both read as empty until those columns exist in the generated types.
 */
export const IssuesTasksSection: React.FC = () => {
  const { t } = useTranslation('workOrders');
  return (
    <RecordSection title={t('issuesTasks.title', 'Issues and open tasks')}>
      <div className="flex flex-col gap-2 text-control text-muted-foreground">
        <p data-testid="wo-issues-empty">{t('issuesTasks.issuesEmpty', 'No issues name this work order.')}</p>
        <p data-testid="wo-tasks-empty">{t('issuesTasks.tasksEmpty', 'No open tasks name this work order.')}</p>
      </div>
    </RecordSection>
  );
};
