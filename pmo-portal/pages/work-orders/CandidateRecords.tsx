import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';
import { formatDay } from '@/src/lib/format';
import type { CandidateCheckStatus, CandidateRecordStatus } from '@/src/lib/db/workOrderCandidateRecords';

/**
 * Earlier candidate work orders of one project, read-only (#2898). The candidate assessment was retired in favour of
 * capturing a Draft work order with its checks as tasks; records already made stay readable here. Renders nothing for a
 * project that has none.
 */
export const CandidateRecords: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('workOrders');
  const query = useOrgQuery(['workOrderCandidateRecords', projectId], () => repositories.workOrder.listCandidateRecords(projectId));
  const title = t('candidateRecords.title', 'Earlier candidate work orders');
  if (query.isError) return <RecordSection title={title}><ListState variant="error" title={t('candidateRecords.error', "Couldn't load the earlier candidates")} onRetry={() => void query.refetch()} /></RecordSection>;
  if (!query.data || query.data.length === 0) return null;
  const statusText: Record<CandidateRecordStatus, string> = {
    assessing: t('candidateRecords.status.assessing', 'Not decided'),
    accepted: t('candidateRecords.status.accepted', 'Accepted'),
    rejected: t('candidateRecords.status.rejected', 'Rejected'),
  };
  const checkText: Record<CandidateCheckStatus, string> = {
    open: t('candidateRecords.check.open', 'Open'),
    passed: t('candidateRecords.check.passed', 'Passed'),
    failed: t('candidateRecords.check.failed', 'Failed'),
    not_applicable: t('candidateRecords.check.notApplicable', 'Not applicable'),
  };
  return (
    <RecordSection title={title} data-testid="candidate-records">
      <ul className="divide-y divide-border">
        {query.data.map((c) => (
          <li key={c.id} className="py-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">{c.title}</span>
              {c.client_reference && <span className="text-muted-foreground">{c.client_reference}</span>}
              <span className="text-muted-foreground">{formatDay(c.offered_on)}</span>
              <span className="text-foreground">{statusText[c.status]}</span>
              {c.work_order_id && <Link className="text-primary underline-offset-2 hover:underline" to={`/work-orders/${c.work_order_id}`}>{t('candidateRecords.openWorkOrder', 'Open the work order')}</Link>}
            </div>
            {c.decision_reason && <p className="text-muted-foreground">{c.decision_reason}</p>}
            {c.items.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-muted-foreground">{t('candidateRecords.checks', '{{count}} checks', { count: c.items.length })}</summary>
                <ul className="mt-1 space-y-1">
                  {c.items.map((i, n) => <li key={n} className="flex flex-wrap gap-x-3"><span>{i.label}</span><span className="text-muted-foreground">{checkText[i.status]}</span>{i.note && <span className="text-muted-foreground">{i.note}</span>}</li>)}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </RecordSection>
  );
};
