import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { useFeature } from '@/src/auth/useFeature';
import { usePermission } from '@/src/auth/usePermission';
import { trackComingSoonClicked } from '@/src/lib/analytics';

/**
 * The dashboard doorway opens the canonical Project revenue section in Earned view when the viewer is eligible.
 */
export const BoardPackAction: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const revenueOn = useFeature('revenue');

  const earnedAvailable = revenueOn && may('view', 'managementPack');
  const billingAvailable = may('view', 'salesInvoice');

  if (earnedAvailable || billingAvailable) {
    const targetView = earnedAvailable ? 'earned' : 'billing';
    return (
      <Button variant="outline" className="min-h-11" onClick={() => navigate(`/financial-statements?section=project-revenue&view=${targetView}`)}>
        <Icon name="export" />
        {t('uxs42.projectRevenue', 'Project revenue')}
      </Button>
    );
  }

  return (
    <Tooltip content={t('uxs42.projectRevenueUnavailableRecovery', 'Project revenue is not available to your role.')}>
      {/* coming_soon_clicked (2026-07-13 wiring plan — demand signal): the Button itself stays genuinely
          disabled; the wrapping span's click still reports intent, since a `disabled` button cannot dispatch one. */}
      <span className="inline-flex" onClick={() => trackComingSoonClicked('board-pack-export', 'dashboard')}>
        <Button variant="outline" disabled className="min-h-11" aria-label={t('uxs42.projectRevenueDisabled', 'Project revenue (unavailable)')}>
          <Icon name="export" />
          {t('uxs42.projectRevenue', 'Project revenue')}
        </Button>
      </span>
    </Tooltip>
  );
};
