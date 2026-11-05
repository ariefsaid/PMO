import { QueryClient } from '@tanstack/react-query';
import { LIST_STALE_TIME } from './queryPolicies';

// Shared singleton (ADR-0005, target-arch §9): lists are fresh 45s, kept 5m, retry once.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: LIST_STALE_TIME, gcTime: 300_000, retry: 1, refetchOnWindowFocus: false },
  },
});
