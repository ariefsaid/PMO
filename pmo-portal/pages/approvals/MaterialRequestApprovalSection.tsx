import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, ListState } from '@/src/components/ui';
import { useMaterialRequest, useWaitingForMe } from '@/src/hooks/useMaterialRequests';
import type { WaitingStep } from '@/src/lib/repositories/materialRequests';
import { formatDay } from '@/src/lib/format';
import { RequestWorkOrder } from '../materialRequests/shared';

const Row: React.FC<{ step: WaitingStep }> = ({ step }) => {
  const { t } = useTranslation('materialRequests');
  const request = useMaterialRequest(step.requestId).data;
  // One link per row (the request number). The work order is its own link, so no anchor sits inside another.
  return (
    <li className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="min-w-0">
        <Link to={`/material-requests/${step.requestId}`} className="block font-semibold text-primary-text hover:underline">{request?.number ?? '—'}</Link>
        <span className="block text-control text-muted-foreground">
          {t('inbox.step', 'Step {{n}}: {{label}}', { n: step.stepPosition, label: step.label })}
          {step.actingFor && <span className="ml-2">{t('inbox.standingIn', 'standing in')}</span>}
        </span>
        {request && <span className="block text-control text-muted-foreground"><RequestWorkOrder workOrderId={request.workOrderId} projectId={request.projectId} /></span>}
      </span>
      <span className="text-control text-muted-foreground">
        {request && <span className="block">{t('inbox.neededBy', 'Needed by {{date}}', { date: formatDay(request.neededBy) })}</span>}
        <span className="block">{t('inbox.sent', 'Sent {{date}}', { date: formatDay(step.submittedAt) })}</span>
      </span>
    </li>
  );
};

/**
 * "Material requests awaiting you" on /approvals (#2685 FR-MRI-009): the open steps the viewer may decide now, from the same
 * queue the material-requests screen uses (the server applies role, pin, stand-in window and earlier decisions). Mounted
 * only while the organisation's setting is on. Each row opens the request, where the decision is made. Hidden when none.
 */
export const MaterialRequestApprovalSection: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { data, isPending, isError, refetch } = useWaitingForMe();
  if (isPending) return <div className="mb-4"><ListState variant="loading" rows={3} /></div>;
  if (isError) {
    return (
      <div className="mb-4">
        <ListState variant="error" title={t('inbox.errorTitle', "Couldn't load material requests awaiting you")}
          sub={t('inbox.errorSub', 'Other approvals are unaffected.')} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!data || data.length === 0) return null;
  return (
    <section aria-label={t('inbox.label', 'Material requests awaiting you')} className="mb-4">
      <h2 className="mb-2 text-control font-semibold text-muted-foreground">{t('inbox.heading', 'Material requests awaiting you ({{count}})', { count: data.length })}</h2>
      <Card>
        <ul className="divide-y divide-border">{data.map((step) => <Row key={`${step.requestId}:${step.stepPosition}`} step={step} />)}</ul>
      </Card>
    </section>
  );
};
