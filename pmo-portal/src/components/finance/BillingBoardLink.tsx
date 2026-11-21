import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useBillingBoard } from '@/src/hooks/useBillingBoard';

/**
 * #2681 — the entry to the billing board, shown on Receivables only when the board has open claims with billing steps, so an
 * organisation without steps sees nothing new. It is optional chrome: if its read cannot run it renders nothing (a failed read
 * never blocks the page it sits on), which is why it carries its own silent boundary.
 */
class Silent extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const Inner: React.FC = () => {
  const { t } = useTranslation('finance');
  const rows = useBillingBoard(null).data?.rows.length ?? 0;
  if (rows === 0) return null;
  return (
    <Link to="/finance/billing-board" data-testid="receivables-billing-board-link" className="inline-flex min-h-8 items-center text-control font-medium underline underline-offset-2">
      {t('billingBoard.entryLink', 'Billing board')}
    </Link>
  );
};

export const BillingBoardLink: React.FC = () => <Silent><Inner /></Silent>;
