import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AccessDenied, Button, Icon } from '@/src/components/ui';

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
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">
            {t('managementPack.noAccessTitle', "You don't have access to Reports")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('managementPack.noAccessSub', 'Finance reports are available to Finance, Executive and Admin roles.')}
          </p>
          <Button variant="outline" onClick={back} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', 'Back to dashboard')}
          </Button>
        </div>
      </div>
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
