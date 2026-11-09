import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orgSettingsRepository } from '@/src/lib/repositories/admin';
import { useAuth } from '@/src/auth/useAuth';
import type { DemoEligibility } from '@/src/auth/impersonation';
import { SERVER_SESSION_STALE_TIME } from '@/src/lib/queryPolicies';

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
 * The value is rechecked on mount, on focus and at a bounded interval while an Admin is signed in,
 * so an org that changes lifecycle state in another session reaches this tab within minutes. Cached
 * demo data is withheld on initial mount and role/org transitions;
 * background checks keep the already verified selection until their result settles. The provider clears
 * any stale view-as selection when eligibility disappears (AC-AUTH-015).
 */
export function useDemoEligibility(): DemoEligibility {
  const { currentUser, role } = useAuth();
  const enabled = Boolean(currentUser) && role === 'Admin';
  const orgId = currentUser?.org_id;
  const settled = useRef({ orgId, enabled, hasVerified: false });
  if (settled.current.orgId !== orgId || settled.current.enabled !== enabled) {
    settled.current = { orgId, enabled, hasVerified: false };
  }
  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: ['org-lifecycle-state', orgId],
    queryFn: () => orgSettingsRepository.getLifecycleState(),
    enabled,
    // A GATE, not a display cache: AC-AUTH-015 requires the view-as control to re-verify on mount
    // and whenever the org/role context changes, so nothing is trusted while it re-reads. Still
    // bounded (never Infinity) and revalidated on focus and at a 5-minute interval, so an org that
    // changes lifecycle state in another session reaches this tab within minutes.
    staleTime: 0,
    gcTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: enabled ? SERVER_SESSION_STALE_TIME : false,
  });
  if (enabled && !isPending && !isError && !isFetching) settled.current.hasVerified = true;
  // Loading, errored, and signed-out all collapse to the same deny: unknown ≠ demo.
  // An initial/remount recheck hides cached data; an already verified mounted view keeps its
  // selection during background rechecks and changes only when the new result settles.
  if (!enabled || isPending || isError || (isFetching && !settled.current.hasVerified)) return 'pending';
  return data === 'demo' ? 'eligible' : 'ineligible';
}
