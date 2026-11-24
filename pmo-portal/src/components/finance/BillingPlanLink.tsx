import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useBillingPlanCandidates, useBillingPlanSettings } from '@/src/hooks/useBillingPlan';

/**
 * #2682 — the entry to the billing plan, shown only when the organisation has set a plan or has at least one candidate,
 * so an organisation with neither sees nothing new. Optional chrome: a failed read renders nothing (own silent boundary).
 */
class Silent extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const Inner: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation('finance');
  const candidates = useBillingPlanCandidates(null).data?.rows.length ?? 0;
  const configured = useBillingPlanSettings().data;
  const hasSettings = Boolean(configured && (configured.monthlyTarget !== null || configured.monthTargets.length > 0 || configured.reminderOn));
  if (candidates === 0 && !hasSettings) return null;
  return (
    <Link to="/finance/billing-plan" data-testid="receivables-billing-plan-link" className={className ?? 'inline-flex min-h-8 items-center text-control font-medium underline underline-offset-2'}>
      {t('billingPlan.entryLink', 'Billing plan')}
    </Link>
  );
};

/** Walk BQ6: also on the Finance hub and the billing board, beside the board link, not only on Receivables. */
export const BillingPlanLink: React.FC<{ className?: string }> = ({ className }) => <Silent><Inner className={className} /></Silent>;
