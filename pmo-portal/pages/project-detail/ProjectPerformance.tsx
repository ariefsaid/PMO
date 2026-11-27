import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, RecordSection } from '@/src/components/ui';
import { PerformanceGate } from '@/src/components/performance/PerformanceGate';
import { formatIsoDay } from '@/src/lib/format';
import { useProjectPerformance } from '@/src/hooks/useWorkOrderPerformance';
import { deriveProjectPerformance, deriveWorkOrderPerformance } from '@/src/lib/workOrderPerformance';
import { Link } from 'react-router';
import { PerformanceFigures } from '../work-order-detail/PerformanceIndices';
import { PvaTable } from './PvaTable';
import { ProjectMoneyScopeContext } from '@/src/hooks/useProjectMoneyScope';

/**
 * The project's cost and schedule indices beside the S-curve (#2597, FR-CSP-010). The project figure is the ratio of
 * sums over its issued and closed work orders, never an average of their indices. Renders nothing at all, and issues
 * no request, until the organisation turns the panels on (AC-CSP-018).
 */
export const ProjectPerformance: React.FC<{ projectId: string }> = ({ projectId }) => {
  const inScope = React.useContext(ProjectMoneyScopeContext);
  if (!inScope) return null;
  return <PerformanceGate><ProjectPerformancePanel projectId={projectId} /></PerformanceGate>;
};

const ProjectPerformancePanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('workOrderPva');
  const query = useProjectPerformance(projectId, true);
  const title = t('performance.title', 'Cost and schedule performance');
  if (query.isPending) return <RecordSection title={title} className="mt-[var(--space-section)]" data-testid="project-performance"><ListState variant="loading" rows={2} /></RecordSection>;
  if (query.isError || !query.data) {
    return (
      <RecordSection title={title} className="mt-[var(--space-section)]" data-testid="project-performance">
        <ListState variant="error" title={t('performance.loadError', "Couldn't load cost and schedule performance")} retryLabel={t('performance.retry', 'Try again')} onRetry={() => void query.refetch()} />
      </RecordSection>
    );
  }
  const { rows, bands, asOf, truncated, omitted } = query.data;
  if (rows.length === 0) return null;
  const project = deriveProjectPerformance(rows, bands);
  const currency = rows.find((r) => r.status === 'Issued' || r.status === 'Closed')?.currency ?? rows[0].currency;
  const workOrders = rows.filter((row) => row.status === 'Issued' || row.status === 'Closed');
  return (
    <Card className="mt-[var(--space-section)] min-w-0" data-testid="project-performance">
      <CardHead level={2}>{title}</CardHead>
      <CardPad className="space-y-4 pt-0">
        <PerformanceFigures performance={project} currency={currency} bands={bands} idPrefix="project-performance" />
        <div className="text-control text-muted-foreground">
          {asOf && <p data-testid="project-performance-asof">{t('performance.asOf', 'As of {{date}}', { date: formatIsoDay(asOf) })}</p>}
          <p>{t('performance.projectBasis', 'Work orders issued or closed, summed together. Earned value is validated progress at contract rate; the plan is calendar-linear.')}</p>
          <p data-testid="project-performance-counted">
            {t('performance.counted', '{{included}} work orders counted, {{excluded}} left out because their figures are incomplete or they are not issued or closed', { included: project.includedCount, excluded: project.excludedCount })}
          </p>
          {truncated && <p data-testid="project-performance-truncated">{t('performance.truncated', 'The first 500 work orders are shown; {{count}} more are left out.', { count: omitted })}</p>}
        </div>
        {workOrders.length > 0 && (
          <PvaTable
            dense
            caption={t('performance.workOrders', 'By work order')}
            firstColumn={t('col.workOrder', 'Work order')}
            columns={[
              { key: 'cpi', label: t('performance.cpi', 'Cost performance index') },
              { key: 'spi', label: t('performance.spi', 'Schedule performance index') },
            ]}
            rows={workOrders.map((row) => {
              const { cpi, spi } = deriveWorkOrderPerformance(row, bands);
              return {
                key: row.workOrderId,
                testId: `project-performance-row-${row.workOrderId}`,
                head: <Link to={`/work-orders/${row.workOrderId}`} className="break-words font-medium hover:underline">{row.woNumber ?? row.title}</Link>,
                cells: [
                  { text: cpi.state === 'value' ? cpi.value : '–' },
                  { text: spi.state === 'value' ? spi.value : '–' },
                ],
              };
            })}
          />
        )}
      </CardPad>
    </Card>
  );
};
