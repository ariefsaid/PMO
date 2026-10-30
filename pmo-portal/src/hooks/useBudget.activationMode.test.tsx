import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { getBudgetActivationMode } = vi.hoisted(() => ({
  getBudgetActivationMode: vi.fn(),
}));
const actor = vi.hoisted(() => ({ id: 'user-1', org_id: 'org-1', role: 'Finance' }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: actor }) }));

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
  Object.assign(actor, { id: 'user-1', org_id: 'org-1', role: 'Finance' });
  getBudgetActivationMode.mockReset();
  getBudgetActivationMode.mockResolvedValue('allowed');
});

describe('useBudgetActivationMode', () => {
  it('refreshes the activation decision when the actor role changes', async () => {
    getBudgetActivationMode.mockResolvedValueOnce('sole_operator').mockResolvedValueOnce('blocked_no_drafter');
    const { result, rerender } = renderHook(() => useBudgetActivationMode('version-1'), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.data).toBe('sole_operator'));
    actor.role = 'PM';
    rerender();
    await waitFor(() => expect(result.current.data).toBe('blocked_no_drafter'));
    expect(getBudgetActivationMode).toHaveBeenCalledTimes(2);
  });

  it('refreshes the activation decision when the actor changes', async () => {
    getBudgetActivationMode.mockResolvedValueOnce('sole_operator').mockResolvedValueOnce('blocked_no_drafter');
    const { result, rerender } = renderHook(() => useBudgetActivationMode('version-1'), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.data).toBe('sole_operator'));
    actor.id = 'user-2';
    rerender();
    await waitFor(() => expect(result.current.data).toBe('blocked_no_drafter'));
    expect(getBudgetActivationMode).toHaveBeenCalledTimes(2);
  });
  it('uses a version and actor-scoped query key and fetches the activation mode', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useBudgetActivationMode('version-1'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.data).toBe('allowed'));
    expect(client.getQueryCache().find({ queryKey: ['budget-activation-mode', 'version-1', 'org-1', 'user-1', 'Finance'] })).toBeDefined();
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
