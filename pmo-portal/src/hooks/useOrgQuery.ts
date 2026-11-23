import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/**
 * One org-scoped read, so a hook states its data instead of re-making the wiring: key by org,
 * enable when the org is known, choose a staleness.
 *
 * `key` is the query key WITHOUT the org slot — `[root, ...tail]`. The signed-in org id is
 * spliced in after the root, so the effective key stays `[root, orgId, ...tail]`: the shape
 * every invalidation in the app prefixes on. The read also waits for the org to be known —
 * `enabled` is only the caller's own extra gate (ids loaded, a switch on).
 *
 * `staleness` names the freshness window instead of a per-hook number:
 * - `'session'` — the org's own structure and switches, cached for the session
 *   (`SESSION_QUERY_OPTIONS`); the Admin write that changes them invalidates.
 * - `'live'` — operational data that may change underneath the screen, refreshed on the shared
 *   live window (`LIVE_STALE_TIME`).
 * Omit it for reads that must always be fresh (react-query's own default).
 */
const LIVE_STALE_TIME = 60_000;

export type OrgQueryStaleness = 'session' | 'live';

export interface OrgQueryOptions {
  /** The caller's own gate on top of the org gate; the read runs only when both hold. */
  enabled?: boolean;
  /** Named freshness window; omit for react-query's always-fresh default. */
  staleness?: OrgQueryStaleness;
}

export function useOrgQuery<T>(
  key: readonly unknown[],
  queryFn: () => Promise<T>,
  opts: OrgQueryOptions = {},
): UseQueryResult<T> {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: [key[0], orgId, ...key.slice(1)],
    queryFn,
    enabled: (opts.enabled ?? true) && Boolean(orgId),
    ...(opts.staleness === 'session' ? SESSION_QUERY_OPTIONS : opts.staleness === 'live' ? { staleTime: LIVE_STALE_TIME } : {}),
  });
}
