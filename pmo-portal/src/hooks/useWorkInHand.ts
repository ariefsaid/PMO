import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { deriveWorkInHand, type WipRow } from '@/src/lib/workInHand';
import type { WorkInHand } from '@/src/lib/db/workInHand';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

export const WORK_IN_HAND_KEY = 'work-in-hand';
export const WORK_IN_HAND_CAPACITY_KEY = 'work-in-hand-capacity';

/** Work in hand (#2575): the database inputs, with the one derivation applied. Keys carry org_id (ADR-0017). */
export function useWorkInHand(enabled = true) {
  const query = useOrgQuery([WORK_IN_HAND_KEY], () => repositories.workInHand.get(), { enabled, staleness: 'live' });
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

export function useWorkInHandCapacity() {
  return useOrgQuery([WORK_IN_HAND_CAPACITY_KEY], () => repositories.workInHand.getCapacity(), { staleness: 'session' });
}

export function useSetWorkInHandCapacity() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: number | null) => repositories.workInHand.setCapacity(value),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [WORK_IN_HAND_CAPACITY_KEY, orgId] }),
        qc.invalidateQueries({ queryKey: [WORK_IN_HAND_KEY, orgId] }),
      ]);
    },
  });
}
