import { QueryClient } from '@tanstack/react-query';

// Shared singleton (ADR-0005, target-arch §9): lists are fresh ~30s, kept 5m, retry once.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 300_000, retry: 1, refetchOnWindowFocus: false },
  },
});
