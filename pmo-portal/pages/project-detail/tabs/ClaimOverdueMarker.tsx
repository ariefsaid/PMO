import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useOverdueClaimSteps } from '@/src/hooks/useBillingSteps';

/**
 * The claim list marker for an overdue billing step (#2680, closes the marker deferred from #2592 FR-BSX-011): words as well as
 * colour, naming the step and the days over its target. Nothing renders for a claim with no overdue step, while the read is
 * pending or when it fails (the claim's own step list still shows the state).
 */
const Marker: React.FC<{ claimId: string; projectId: string }> = ({ claimId, projectId }) => {
  const { t } = useTranslation('project');
  const query = useOverdueClaimSteps(projectId);
  const hit = query.data?.find((r) => r.claimId === claimId);
  if (!hit) return null;
  return <StatusPill variant="overdue" wrap={false}>
    {t('projectDetail.billing.steps.overdueMarker', '{{step}} overdue by {{count}} days', { step: hit.stepName, count: hit.daysOver })}
  </StatusPill>;
};

export const ClaimOverdueMarker: React.FC<{ claimId: string; projectId: string }> = (props) => <Marker {...props} />;

export default ClaimOverdueMarker;
