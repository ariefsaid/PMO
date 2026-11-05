/** Query freshness windows by the cost and change rate of the data. */
export const SESSION_STALE_TIME = Infinity;
export const LIST_STALE_TIME = 45_000;
export const MONEY_STALE_TIME = 10_000;

export const SESSION_QUERY_OPTIONS = { staleTime: SESSION_STALE_TIME, gcTime: Infinity } as const;
export const MONEY_QUERY_OPTIONS = {
  staleTime: MONEY_STALE_TIME,
  refetchOnWindowFocus: false,
} as const;
