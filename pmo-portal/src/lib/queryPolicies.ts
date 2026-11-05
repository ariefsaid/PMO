/** Query freshness windows by the cost and change rate of the data. */
export const SESSION_STALE_TIME = Infinity;
export const LIST_STALE_TIME = 45_000;
export const MONEY_STALE_TIME = 10_000;

export const SESSION_QUERY_OPTIONS = { staleTime: SESSION_STALE_TIME, gcTime: Infinity } as const;
export const MONEY_QUERY_OPTIONS = {
  staleTime: MONEY_STALE_TIME,
  refetchOnWindowFocus: false,
} as const;

/**
 * Server-arbitrated session facts: org entitlements, plans (own + catalogue + assigned),
 * demo-org eligibility and platform-Operator membership.
 *
 * These must NOT be session-stable. A local `invalidateFeatureState` only touches the writer's own
 * QueryClient, so when an operator grants a module, assigns a plan or changes membership, an
 * already signed-in member in another tab or device never hears about it. A bounded window plus
 * focus/interval revalidation makes that change land within minutes. The key is still shared, so
 * every mounted component costs ONE read per window — the dedupe win is kept, the permanence is not.
 */
export const SERVER_SESSION_STALE_TIME = 5 * 60_000;
export const SERVER_SESSION_QUERY_OPTIONS = {
  staleTime: SERVER_SESSION_STALE_TIME,
  gcTime: Infinity,
  refetchOnWindowFocus: true,
  refetchInterval: SERVER_SESSION_STALE_TIME,
} as const;
