import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { deriveWorkInHand, type WipRow } from '@/src/lib/workInHand';
import type { WorkInHand } from '@/src/lib/db/workInHand';

/** Work in hand (#2575): the database inputs, with the one derivation applied. Keys carry org_id (ADR-0017). */
export function useWorkInHand(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  const query = useQuery({
    queryKey: ['work-in-hand', orgId],
    queryFn: () => repositories.workInHand.get(),
    enabled: enabled && Boolean(orgId),
    staleTime: 60_000,
  });
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
