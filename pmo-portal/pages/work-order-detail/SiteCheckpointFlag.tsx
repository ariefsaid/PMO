import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import { useWorkOrderCheckpointFlag } from '@/src/hooks/useSiteCheckpoints';

/**
 * #2594 FR-STC-031: a work order is flagged while any of today's checkpoints is late. The flag is derived by the database,
 * never stored, and the component renders nothing while it loads, fails, or the work order is not flagged.
 */
export const SiteCheckpointFlag: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('siteReport');
  const flag = useWorkOrderCheckpointFlag(workOrderId);
  if (flag.data !== true) return null;
  return (
    <p className="flex flex-wrap items-center gap-2" data-testid="wo-checkpoint-flag">
      <StatusPill variant="overdue">{t('checkpoints.flag', 'Checkpoint late today')}</StatusPill>
      <Link className="text-control text-primary-text underline" to="/site-reports/crews">{t('checkpoints.flagLink', 'See crews')}</Link>
    </p>
  );
};
