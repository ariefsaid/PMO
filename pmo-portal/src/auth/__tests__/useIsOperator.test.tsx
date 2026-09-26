import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/operators', () => ({ isOperator: vi.fn() }));

import { useIsOperator, useOperatorMembership } from '../useIsOperator';
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

  it('exposes pending membership separately so a route guard can avoid a transient denial', () => {
    vi.mocked(isOperator).mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useOperatorMembership(), { wrapper: makeWrapper() });
    expect(result.current).toMatchObject({ isOperator: false, isPending: true, isError: false });
    expect(result.current.retry).toEqual(expect.any(Function));
  });

  it('keeps a settled Operator route available during a background membership refresh', async () => {
    vi.mocked(isOperator)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useOperatorMembership(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ isOperator: true, isPending: false, isError: false }));

    await act(async () => {
      void qc.invalidateQueries({ queryKey: ['operator', 'isOperator'] });
    });
    await waitFor(() => expect(isOperator).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ isOperator: true, isPending: false, isError: false });
  });

  it('does not keep an Operator projection after its membership recheck fails', async () => {
    vi.mocked(isOperator)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('membership unavailable'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useOperatorMembership(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isOperator).toBe(true));

    await act(async () => {
      void qc.invalidateQueries({ queryKey: ['operator', 'isOperator'] });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isOperator).toBe(false);
    expect(result.current.isPending).toBe(false);
  });

  it('retries an unavailable membership check and restores access after a positive response', async () => {
    vi.mocked(isOperator)
      .mockRejectedValueOnce(new Error('membership unavailable'))
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() => useOperatorMembership(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isOperator).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isOperator).toBe(true));
    expect(isOperator).toHaveBeenCalledTimes(2);
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
