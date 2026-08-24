import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  getOrgDefaultCurrency: vi.fn(),
  currentUser: undefined as { id: string; org_id: string } | null | undefined,
}));
vi.mock('@/src/lib/db/orgs', () => ({ getOrgDefaultCurrency: h.getOrgDefaultCurrency }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.currentUser }),
}));

import { useOrgCurrency } from './useOrgCurrency';

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  vi.clearAllMocks();
  h.currentUser = { id: 'u1', org_id: 'org-1' };
});

describe('useOrgCurrency — org currency for rowless figures (FR-L10N-020)', () => {
  it("returns the DAL's org default currency once resolved", async () => {
    h.getOrgDefaultCurrency.mockResolvedValue('IDR');
    const { result } = renderHook(() => useOrgCurrency(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current).toBe('IDR'));
    expect(h.getOrgDefaultCurrency).toHaveBeenCalledTimes(1);
  });

  it("keys by org_id and returns 'USD' (0187 column default posture) while pending", async () => {
    let resolve!: (v: string) => void;
    h.getOrgDefaultCurrency.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const { result } = renderHook(() => useOrgCurrency(), { wrapper: wrap(freshClient()) });
    // pending → the placeholder default, never undefined
    expect(result.current).toBe('USD');
    resolve('IDR');
    await waitFor(() => expect(result.current).toBe('IDR'));
  });

  it("is disabled without a current user — returns 'USD' and never calls the DAL", () => {
    h.currentUser = null;
    const { result } = renderHook(() => useOrgCurrency(), { wrapper: wrap(freshClient()) });
    expect(result.current).toBe('USD');
    expect(h.getOrgDefaultCurrency).not.toHaveBeenCalled();
  });
});
