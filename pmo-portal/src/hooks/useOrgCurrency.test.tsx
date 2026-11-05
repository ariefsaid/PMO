import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  getOrgDefaultCurrency: vi.fn(),
  getFxContext: vi.fn(),
  currentUser: undefined as { id: string; org_id: string } | null | undefined,
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgSettings: { getDefaultCurrency: h.getOrgDefaultCurrency },
    fxRates: { context: h.getFxContext },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.currentUser }),
}));

import { useOrgCurrency, useOrgCurrencyState } from './useOrgCurrency';
import { useFxOrgDay } from './useFxOrgDay';

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
    h.getFxContext.mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
    const { result } = renderHook(() => useOrgCurrency(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current).toBe('IDR'));
    expect(h.getFxContext).toHaveBeenCalledTimes(1);
  });

  it('shares one session-fresh query between currency consumers', async () => {
    h.getFxContext.mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
    const client = freshClient();
    const { result } = renderHook(() => [useOrgCurrency(), useOrgCurrencyState()] as const, { wrapper: wrap(client) });
    await waitFor(() => expect(result.current[0]).toBe('IDR'));
    expect(h.getFxContext).toHaveBeenCalledTimes(1);
    const queryOptions = client.getQueryCache().find({ queryKey: ['fx-context', 'org-1'] })?.options as { staleTime?: number; gcTime?: number } | undefined;
    expect(queryOptions?.staleTime).toBe(Infinity);
    expect(queryOptions?.gcTime).toBe(Infinity);
  });

  it('shares the org settings read with FX-day consumers', async () => {
    h.getFxContext.mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
    const { result } = renderHook(() => [useOrgCurrency(), useFxOrgDay(true)] as const, { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current[0]).toBe('IDR'));
    await waitFor(() => expect(result.current[1].day).not.toBeNull());
    expect(h.getFxContext).toHaveBeenCalledTimes(1);
    expect(h.getOrgDefaultCurrency).not.toHaveBeenCalled();
  });

  it("keys by org_id and returns 'USD' (0187 column default posture) while pending", async () => {
    let resolve!: (v: { currency: string; timezone: string }) => void;
    h.getFxContext.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useOrgCurrency(), { wrapper: wrap(freshClient()) });
    // pending → the placeholder default, never undefined
    expect(result.current).toBe('USD');
    resolve({ currency: 'IDR', timezone: 'Asia/Jakarta' });
    await waitFor(() => expect(result.current).toBe('IDR'));
  });

  it('AC-802-001: exposes that the USD placeholder is unresolved until the org currency is loaded', async () => {
    let resolve!: (v: { currency: string; timezone: string }) => void;
    h.getFxContext.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useOrgCurrencyState(), { wrapper: wrap(freshClient()) });

    expect(result.current).toEqual({ currency: 'USD', isResolved: false, isError: false });
    resolve({ currency: 'IDR', timezone: 'Asia/Jakarta' });
    await waitFor(() => expect(result.current).toEqual({ currency: 'IDR', isResolved: true, isError: false }));
  });

  it('AC-802-001: does not mark a failed currency lookup as resolved', async () => {
    h.getFxContext.mockRejectedValue(new Error('temporary failure'));
    const { result } = renderHook(() => useOrgCurrencyState(), { wrapper: wrap(freshClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isResolved).toBe(false);
  });

  it("is disabled without a current user — returns 'USD' and never calls the DAL", () => {
    h.currentUser = null;
    const { result } = renderHook(() => useOrgCurrency(), { wrapper: wrap(freshClient()) });
    expect(result.current).toBe('USD');
    expect(h.getFxContext).not.toHaveBeenCalled();
  });
});
