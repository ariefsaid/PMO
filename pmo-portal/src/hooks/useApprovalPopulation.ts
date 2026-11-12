import { useMemo } from 'react';
import {
  approvalPopulation,
  type ApprovalPopulationEntry,
  type ApprovalScope,
} from '@/src/lib/selectors/approvals';

/** One ordered, de-duplicated count source shared by the inbox, home and rail. */
export function useApprovalPopulation<T>(
  entries: readonly ApprovalPopulationEntry<T>[],
  scope: ApprovalScope = 'all',
): ApprovalPopulationEntry<T>[] {
  return useMemo(() => approvalPopulation(entries, scope), [entries, scope]);
}
