import { QueryClient } from '@tanstack/react-query';

/** A fresh test query client: no retries, no cache carry-over between renders. */
export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}
