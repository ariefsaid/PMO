import { useQuery } from '@tanstack/react-query';
import { getOrgLifecycleState } from '@/src/lib/db/orgs';
import { useAuth } from '@/src/auth/useAuth';
import type { DemoEligibility } from '@/src/auth/impersonation';

/**
 * useDemoEligibility — is the signed-in org a DEMO org? The gate behind the Admin
 * "view as role" control (FR-AUTH-036/037, AC-AUTH-013/014): the control exists only for
 * Admins whose own org (RLS-scoped `organizations` read, `org_id` never sent — ADR-0017)
 * resolves `lifecycle_state = 'demo'` (migration 0191). Live and test orgs — RIS included —
 * get `'ineligible'`.
 *
 * ⛔ FAIL CLOSED: while the read is loading OR has errored (and when no user is signed in)
 * this returns `'pending'` — never `'eligible'`. Only an org row that explicitly says
 * `'demo'` unlocks the control; NULL/unknown states map to `'ineligible'` in the DAL.
 *
 * The value is rechecked on remount, focus, and at a short interval while an Admin is
 * signed in. A cached demo result is withheld during each recheck. The provider clears
 * any stale view-as selection when eligibility disappears (AC-AUTH-015).
 */
export function useDemoEligibility(): DemoEligibility {
  const { currentUser, role } = useAuth();
  const enabled = Boolean(currentUser) && role === 'Admin';
  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: ['org-lifecycle-state', currentUser?.org_id],
    queryFn: () => getOrgLifecycleState(),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: enabled ? 30_000 : false,
  });
  // Loading, errored, and signed-out all collapse to the same deny: unknown ≠ demo.
  if (!enabled || isPending || isError || isFetching) return 'pending';
  return data === 'demo' ? 'eligible' : 'ineligible';
}
