import { useMemo } from 'react';
import { repositories } from '@/src/lib/repositories';
import { deriveWorkInHand, type WipRow } from '@/src/lib/workInHand';
import type { WorkInHand } from '@/src/lib/db/workInHand';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Work in hand (#2575): the database inputs, with the one derivation applied. Keys carry org_id (ADR-0017). */
export function useWorkInHand(enabled = true) {
  const query = useOrgQuery(['work-in-hand'], () => repositories.workInHand.get(), { enabled, staleness: 'live' });
  const rows: WipRow[] = useMemo(
    () => (query.data ? deriveWorkInHand(query.data.rows, query.data.asOf) : []),
    [query.data],
  );
  // Named fields, not a spread of the query result: spreading reads `promise`, which rejects unhandled on a refused read.
  return {
    rows,
    facts: query.data as WorkInHand | undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
    error: query.error,
    refetch: query.refetch,
  };
}
