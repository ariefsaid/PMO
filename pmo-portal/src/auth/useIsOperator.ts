import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';

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
export function useIsOperator(): boolean {
  const { data } = useQuery({
    queryKey: ['operator', 'isOperator'],
    queryFn: () => repositories.operator.isOperator(),
  });
  return data === true;
}
