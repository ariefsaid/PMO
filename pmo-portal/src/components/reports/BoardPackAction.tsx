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
 * #765: the dashboard's "Board pack" control. When the management pack is available (Revenue module on and the
 * viewer may see it) it opens /reports; otherwise it stays the OD-UX-3 disabled "coming soon" affordance.
 */
export const BoardPackAction: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const revenueOn = useFeature('revenue');

  if (revenueOn && may('view', 'managementPack')) {
    return (
      <Button variant="outline" onClick={() => navigate('/reports')}>
        <Icon name="export" />
        {t('dashboard.boardPack.label', 'Board pack')}
      </Button>
    );
  }

  return (
    <Tooltip content={t('dashboard.boardPack.tooltip', 'Board pack export arrives with Reports')}>
      {/* coming_soon_clicked (2026-07-13 wiring plan — demand signal): the Button itself stays genuinely
          disabled; the wrapping span's click still reports intent, since a `disabled` button cannot dispatch one. */}
      <span className="inline-flex" onClick={() => trackComingSoonClicked('board-pack-export', 'dashboard')}>
        <Button variant="outline" disabled aria-label={t('dashboard.boardPack.ariaLabel', 'Board pack (coming soon)')}>
          <Icon name="export" />
          {t('dashboard.boardPack.label', 'Board pack')}
        </Button>
      </span>
    </Tooltip>
  );
};
