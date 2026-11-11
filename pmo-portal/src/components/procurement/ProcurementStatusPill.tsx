import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';

/**
 * A procurement's stored state, named and coloured by the shared status map. A stored `Rejected` can be
 * resubmitted, so it is a send-back and reads "Returned" on every procurement screen (display only: the
 * stored value and the transition call are unchanged).
 */
export const ProcurementStatusPill: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation('procurementRecord');
  return (
    <StatusPill record="procurement" state={status}>
      {status === 'Rejected' ? t('status.returned', 'Returned') : undefined}
    </StatusPill>
  );
};
