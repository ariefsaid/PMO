import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { threeWayMatchRepository } from '@/src/lib/repositories/threeWayMatch';

/** Whether the organisation has the three-way match on (#2622). Keys carry org_id. */
export function useThreeWayMatchOn(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  const query = useQuery({
    queryKey: ['three-way-match-settings', orgId],
    queryFn: () => threeWayMatchRepository.settings(),
    enabled: enabled && Boolean(orgId),
    staleTime: 5 * 60 * 1000,
  });
  return { on: query.data?.enabled === true, query };
}

/** Each bill's match, read only while the match is on (the database reports `not_applicable` otherwise). */
export function useBillMatches(invoiceIds: readonly string[], enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQueries({
    queries: invoiceIds.map((id) => ({
      queryKey: ['bill-match', orgId, id],
      queryFn: () => threeWayMatchRepository.billMatch(id),
      enabled: enabled && Boolean(orgId),
    })),
  });
}

/** Approve a held bill's exception; the bill's match (and the purchase's payment gate) refresh. */
export function useApproveBillMatchException() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason: string }) => threeWayMatchRepository.approveException(invoiceId, reason),
    onSuccess: (match, { invoiceId }) => {
      qc.setQueryData(['bill-match', orgId, invoiceId], match);
      void qc.invalidateQueries({ queryKey: ['bill-match', orgId, invoiceId] });
    },
  });
}
