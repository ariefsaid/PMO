import React from 'react';
import { StatusPill } from '@/src/components/ui';

/**
 * A procurement's stored state, named and coloured by the shared status map — including `Rejected`, which
 * reads "Returned" on every procurement screen (it can be resubmitted; display only: the stored value and
 * the transition call are unchanged).
 */
export const ProcurementStatusPill: React.FC<{ status: string }> = ({ status }) => (
  <StatusPill record="procurement" state={status} />
);
