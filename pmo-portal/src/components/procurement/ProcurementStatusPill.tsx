import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';

/**
 * A procurement's stored state, named and coloured by the shared status map — including `Rejected`, which
 * reads "Returned" on every procurement screen (it can be resubmitted; display only: the stored value and
 * the transition call are unchanged).
 *
 * One state keeps the record's own words: `Vendor Invoiced` says **Invoiced, not paid**, because the
 * invoice is a state the money flow still has to clear. The shared map's neutral "Supplier invoice" names
 * the document, not the state, so a satisfied pill would hide money still owed.
 */
export const ProcurementStatusPill: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation('procurementRecord');
  return (
    <StatusPill record="procurement" state={status}>
      {status === 'Vendor Invoiced' ? t('status.invoicedNotPaid', 'Invoiced, not paid') : undefined}
    </StatusPill>
  );
};
