import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFeature } from '@/src/auth/useFeature';

/** Close-out group: opens the printable material completion of this work order (1124d). Shown only to organisations that have the stock module. */
export const MaterialCompletionLink: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('stock');
  const stockOn = useFeature('stock');
  if (!stockOn) return null;
  return (
    <p className="text-control">
      <Link to={`/work-orders/${encodeURIComponent(workOrderId)}/material-completion`} className="font-medium text-primary-text hover:underline" data-testid="material-completion-link">
        {t('materialCompletion.open')}
      </Link>
    </p>
  );
};
export default MaterialCompletionLink;
