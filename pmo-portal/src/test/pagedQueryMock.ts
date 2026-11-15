/**
 * Test helper (#843): present a one-page `{ data: { rows, truncated } }` query mock in the shape a paged list hook
 * returns (`useExpenseClaimPages`, `useImprestFloatPages`), so page tests keep their fixtures. `total` is
 * whatever the fixture sets (undefined = the count is unknown).
 */
export interface OnePageQuery {
  /** `{ rows, truncated }` or nothing (pending / failed); typed loosely because fixtures mutate it per test. */
  data?: unknown;
  total?: number;
}

export function asPagedQuery<Q extends OnePageQuery>(query: Q) {
  const page = query.data as { rows: unknown[]; truncated: boolean } | null | undefined;
  return {
    ...query,
    data: page,
    total: query.total,
  };
}
