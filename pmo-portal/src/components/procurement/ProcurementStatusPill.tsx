import React from 'react';
import { StatusPill } from '@/src/components/ui';

/**
 * A procurement's stored state, named and coloured by the shared status map — including `Rejected`, which
 * reads "Returned" on every procurement screen (it can be resubmitted; display only: the stored value and
 * the transition call are unchanged).
 */
export const ProcurementStatusPill: React.FC<{ status: string; truncate?: boolean }> = ({ status, truncate = false }) => (
  // `truncate`: a narrow table cell shows one line ending in an ellipsis; the caller carries the full name in a title.
  <StatusPill record="procurement" state={status} className={truncate ? '[&>span]:truncate' : undefined} />
);
