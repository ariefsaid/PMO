import { describe, expect, it } from 'vitest';
import { queryClient } from './queryClient';
import { LIST_STALE_TIME, MONEY_STALE_TIME, SESSION_QUERY_OPTIONS, SESSION_STALE_TIME } from './queryPolicies';

describe('shared query freshness defaults', () => {
  it('keeps list reads fresh for 45 seconds and avoids focus refetch fan-out', () => {
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      staleTime: LIST_STALE_TIME,
      refetchOnWindowFocus: false,
    });
  });

  it('defines separate freshness windows for session settings and money figures', () => {
    expect(SESSION_STALE_TIME).toBe(Infinity);
    expect(SESSION_QUERY_OPTIONS).toMatchObject({ staleTime: Infinity, gcTime: Infinity });
    expect(MONEY_STALE_TIME).toBe(10_000);
  });
});
