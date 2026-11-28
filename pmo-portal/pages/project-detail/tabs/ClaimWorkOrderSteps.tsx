import React, { useContext } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { useWorkOrderSteps } from '@/src/hooks/useBillingSteps';
import { stepStatus } from '@/src/lib/workOrderBillingSteps';
import { ListState } from '@/src/components/ui';

/**
 * The claim's link to its work order's billing steps (billing-steps.spec.md FR-WBS-009): the list lives on the work order and is not
 * copied here, so the claim shows where the chain stands and opens it. Shows only the steps the viewer may see; nothing when the work
 * order has none. Advisory: the claim's own steps above are what gate its invoice.
 */
const Body: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('billingSteps');
  const query = useWorkOrderSteps(workOrderId);
  if (query.isError) return <ListState variant="error" title={t('loadError', "Couldn't load the billing steps")} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <ListState variant="loading" rows={2} />;
  const steps = query.data ?? [];
  if (steps.length === 0) return null;
  const done = steps.filter((s) => stepStatus(s) === 'done' || stepStatus(s) === 'skipped').length;
  const current = steps.find((s) => stepStatus(s) === 'current');
  return <section className="border-t border-border p-4 text-sm" data-testid="claim-wo-steps" aria-label={t('title', 'Billing steps')}>
    <h3 className="font-semibold">{t('claimTitle', 'Work order billing steps')}</h3>
    <p className="mt-1 text-muted-foreground">
      {t('claimProgress', '{{done}} of {{total}} steps finished', { done, total: steps.length })}
      {current && ` · ${t('claimCurrent', 'now: {{name}}', { name: current.name })}`}
    </p>
    <Link to={`/work-orders/${encodeURIComponent(workOrderId)}#wo-billing`} className="mt-1 inline-flex min-h-11 items-center font-medium text-primary-text hover:underline">
      {t('claimOpen', 'Open the work order\'s billing steps')}
    </Link>
  </section>;
};

export const ClaimWorkOrderSteps: React.FC<{ workOrderId: string | null | undefined }> = ({ workOrderId }) => {
  const auth = useContext(AuthContext);
  if (!auth || !workOrderId) return null;
  return <Body workOrderId={workOrderId} />;
};

export default ClaimWorkOrderSteps;
