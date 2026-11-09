import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { operatorRepository } from '@/src/lib/repositories/admin';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/**
 * useIsOperator — AC-OPR-003 (ops-admin-surface S4, ADR-0049). A CLARITY PROJECTION ONLY: it
 * gates which Operator-only affordances render (the "Invite user" cross-org picker, Grant credits,
 * Feature toggles). Every Operator power is re-asserted server-side by its own RPC
 * (`admin_set_user_status`, `operator_grant_credits`, `operator_toggle_feature`, …) — this hook
 * is UX only, never an authorization boundary (mirrors `usePermission`/`can()`, ADR-0016).
 *
 * Defaults to `false` while loading/absent (fail-closed for the affordance gate — an Operator
 * briefly sees the non-Operator variant on first paint, never the reverse).
 */
export interface OperatorMembershipState {
  /** The settled platform-Operator membership projection. */
  isOperator: boolean;
  /** True until the membership query has settled; callers must not render a denial before then. */
  isPending: boolean;
  /** The membership query failed; callers still fail closed after the pending state. */
  isError: boolean;
  /** Recheck after an unavailable membership response. */
  retry: () => void;
}

/**
 * Exposes the full membership query state for route guards that must distinguish an unresolved
 * Operator from a settled non-Operator. The boolean `useIsOperator` API below remains the
 * affordance projection used by existing panels.
 */
export function useOperatorMembership(): OperatorMembershipState {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['operator', 'isOperator'],
    queryFn: () => operatorRepository.isOperator(),
    // One shared membership read for the shell and route gates — but bounded (5 min + focus +
    // interval), because a membership change made in another session must reach this tab without a
    // reload. Server RPCs remain the authority; explicit retries and invalidation stay immediate.
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
  useEffect(() => {
    if (isPending || (!isError && data !== false)) return;
    // A settled negative or unavailable check clears previously loaded platform aggregates.
    // Their query keys encode the Operator projection at index 2; preserve all other caches.
    qc.removeQueries({
      predicate: (query) =>
        (query.queryKey[0] === 'usage' || query.queryKey[0] === 'agent-run-stats') &&
        query.queryKey[2] === true,
    });
  }, [qc, data, isPending, isError]);
  return {
    isOperator: data === true && !isError,
    isPending,
    isError,
    retry: () => { void refetch(); },
  };
}

export function useIsOperator(): boolean {
  return useOperatorMembership().isOperator;
}
