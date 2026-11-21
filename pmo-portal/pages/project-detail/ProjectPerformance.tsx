import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatIsoDay } from '@/src/lib/format';
import { useProjectPerformance, usePerformanceSettings } from '@/src/hooks/useWorkOrderPerformance';
import { deriveProjectPerformance, deriveWorkOrderPerformance } from '@/src/lib/workOrderPerformance';
import { Link } from 'react-router';
import { PerformanceFigures } from '../work-order-detail/PerformanceIndices';

/**
 * The project's cost and schedule indices beside the S-curve (#2597, FR-CSP-010). The project figure is the ratio of
 * sums over its issued and closed work orders, never an average of their indices. Renders nothing at all, and issues
 * no request, until the organisation turns the panels on (AC-CSP-018).
 */
export const ProjectPerformance: React.FC<{ projectId: string }> = ({ projectId }) => {
  const may = usePermission();
  const settings = usePerformanceSettings();
  if (!may('view', 'workOrderPerformance') || settings.data?.enabled !== true) return null;
  return <ProjectPerformancePanel projectId={projectId} />;
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
  return (
    <RecordSection
      title={title}
      subline={<>{asOf ? <span data-testid="project-performance-asof">{t('performance.asOf', 'As of {{date}}', { date: formatIsoDay(asOf) })}</span> : null}{' '}{t('performance.projectBasis', 'Work orders issued or closed, summed together. Earned value is validated progress at contract rate; the plan is calendar-linear.')}</>}
      data-testid="project-performance"
      className="mt-[var(--space-section)]"
    >
      <PerformanceFigures performance={project} currency={currency} bands={bands} idPrefix="project-performance" />
      <p className="mt-2 text-control text-muted-foreground" data-testid="project-performance-counted">
        {t('performance.counted', '{{included}} work orders counted, {{excluded}} left out because their figures are incomplete or they are not issued or closed', { included: project.includedCount, excluded: project.excludedCount })}
      </p>
      {truncated && <p className="text-control text-muted-foreground" data-testid="project-performance-truncated">{t('performance.truncated', 'The first 500 work orders are shown; {{count}} more are left out.', { count: omitted })}</p>}
      <ul className="mt-3 divide-y divide-border text-control" aria-label={t('performance.workOrders', 'By work order')}>
        {rows.filter((r) => r.status === 'Issued' || r.status === 'Closed').map((r) => {
          const d = deriveWorkOrderPerformance(r, bands);
          return (
            <li key={r.workOrderId} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5" data-testid={`project-performance-row-${r.workOrderId}`}>
              <Link to={`/work-orders/${r.workOrderId}`} className="font-medium hover:underline">{r.woNumber ?? r.title}</Link>
              <span className="tabular-nums text-muted-foreground">
                {t('performance.cpi', 'Cost performance index')} {d.cpi.state === 'value' ? d.cpi.value : '–'} · {t('performance.spi', 'Schedule performance index')} {d.spi.state === 'value' ? d.spi.value : '–'}
              </span>
            </li>
          );
        })}
      </ul>
    </RecordSection>
  );
};
