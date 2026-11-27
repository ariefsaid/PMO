import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AccessDenied } from '@/src/components/ui';

/**
 * #1459 — the finance area's access-denied surface, written once. The gate itself is
 * `useFinanceAccess()` (./useFinanceAccess); this component owns only the copy, which was
 * edited in three places before (Finance hub, Payables, Reports).
 */

export interface FinanceAccessDeniedProps {
  /**
   * `area` (default): the finance area's page-level denied surface (Finance hub, Payables).
   * `reports`: the Reports surface's own heading and copy (the management pack).
   */
  surface?: 'area' | 'reports';
  /** Overrides the back action; defaults to the dashboard. */
  onBack?: () => void;
}

export const FinanceAccessDenied: React.FC<FinanceAccessDeniedProps> = ({ surface = 'area', onBack }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const back = onBack ?? (() => navigate('/'));

  if (surface === 'reports') {
    return (
      <AccessDenied
        title={t('managementPack.noAccessTitle', "You don't have access to Reports")}
        sub={t('managementPack.noAccessSub', 'Finance reports are available to Finance, Executive and Admin roles.')}
        backLabel={t('financeCopy.backToDashboard', 'Back to dashboard')}
        onBack={back}
      />
    );
  }

  return (
    <AccessDenied
      title={t('financeHub:hub.noAccessTitle', 'Finance')}
      sub={t('financeHub:hub.noAccessDescription', 'Finance is available to Finance, Executive and Admin roles.')}
      onBack={back}
    />
  );
};
