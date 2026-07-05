import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/operators', () => ({ isOperator: vi.fn() }));

import { useIsOperator } from '../useIsOperator';
import { isOperator } from '@/src/lib/db/operators';

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('useIsOperator (AC-OPR-003 — clarity projection ONLY, ADR-0049)', () => {
  it('returns true when the RPC reports the caller is an Operator', async () => {
    vi.mocked(isOperator).mockResolvedValue(true);
    const { result } = renderHook(() => useIsOperator(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
    expect(isOperator).toHaveBeenCalledTimes(1);
  });

  it('returns false when the RPC reports the caller is not an Operator', async () => {
    vi.mocked(isOperator).mockResolvedValue(false);
    const { result } = renderHook(() => useIsOperator(), { wrapper: makeWrapper() });
    await waitFor(() => expect(isOperator).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });

  it('defaults to false while loading (fail-closed for the affordance gate)', () => {
    vi.mocked(isOperator).mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useIsOperator(), { wrapper: makeWrapper() });
    expect(result.current).toBe(false);
  });

  it('re-rendering the SAME hook instance does not re-call the RPC (query-key stability)', async () => {
    vi.mocked(isOperator).mockResolvedValue(true);
    const { result, rerender } = renderHook(() => useIsOperator(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
    rerender();
    rerender();
    expect(isOperator).toHaveBeenCalledTimes(1);
  });
});
