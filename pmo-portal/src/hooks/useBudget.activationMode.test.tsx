import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { getBudgetActivationMode } = vi.hoisted(() => ({
  getBudgetActivationMode: vi.fn(),
}));

vi.mock('@/src/lib/db/budgets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/budgets')>()),
  getBudgetActivationMode,
}));

import { useBudgetActivationMode } from './useBudget';

const makeClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
const wrapperFor = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  cleanup();
  getBudgetActivationMode.mockReset();
  getBudgetActivationMode.mockResolvedValue('allowed');
});

describe('useBudgetActivationMode', () => {
  it('uses a version-scoped query key and fetches the activation mode', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useBudgetActivationMode('version-1'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.data).toBe('allowed'));
    expect(client.getQueryCache().find({ queryKey: ['budget-activation-mode', 'version-1'] })).toBeDefined();
    expect(getBudgetActivationMode).toHaveBeenCalledTimes(1);
    expect(getBudgetActivationMode).toHaveBeenCalledWith('version-1');
  });

  it('keeps the query disabled until a version id is present', async () => {
    const client = makeClient();
    const { rerender } = renderHook(
      ({ versionId }: { versionId: string | undefined }) => useBudgetActivationMode(versionId),
      { initialProps: { versionId: undefined as string | undefined }, wrapper: wrapperFor(client) },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getBudgetActivationMode).not.toHaveBeenCalled();

    rerender({ versionId: 'version-2' });
    await waitFor(() => expect(getBudgetActivationMode).toHaveBeenCalledWith('version-2'));
  });
});
