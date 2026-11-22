import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFeature } from '@/src/auth/useFeature';
import { useFinanceAccess } from './useFinanceAccess';

/**
 * One tap to the claims board (by step and age) from a page that has no other way there. Drawn only where the board's own route is
 * open to the person (finance access, revenue module on); optional chrome, so a failed read renders nothing rather than the page.
 */
class Silent extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const Inner: React.FC<{ className: string; label?: string; chevron?: React.ReactNode }> = ({ className, label, chevron }) => {
  const { t } = useTranslation('dashboard');
  const hasRevenue = useFeature('revenue');
  const { canView } = useFinanceAccess();
  if (!hasRevenue || !canView) return null;
  return (
    <Link to="/finance/billing-board" data-testid="claims-board-link" className={className}>
      <span>{label ?? t('dashboard:hub.company.claimsBoard', 'Claims board')}</span>{chevron}
    </Link>
  );
};

export const ClaimsBoardLink: React.FC<{ className: string; label?: string; chevron?: React.ReactNode }> = (props) => <Silent><Inner {...props} /></Silent>;
