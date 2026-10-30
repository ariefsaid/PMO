import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const actor = vi.hoisted(() => ({ id: 'pm', org_id: 'org', role: 'Project Manager' }));
const precheck = vi.hoisted(() => vi.fn());
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: actor }) }));
vi.mock('@/src/lib/db/budgets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/budgets')>()),
  precheckBudgetActivation: precheck,
}));
import { useBudgetActivationPrecheck } from './useBudget';

beforeEach(() => {
  Object.assign(actor, { id: 'pm', org_id: 'org', role: 'Project Manager' });
  precheck.mockReset();
});

describe('budget readiness across an actor change', () => {
  it('starts a fresh query after the auth cache is cleared for a new actor', async () => {
    const starts: string[] = [];
    const pending: Array<(value: unknown) => void> = [];
    precheck.mockImplementation(() => {
      starts.push(actor.id);
      return new Promise((resolve) => pending.push(resolve));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(() => useBudgetActivationPrecheck('version'), { wrapper });
    await waitFor(() => expect(starts).toEqual(['pm']));
    expect(result.current.fetchStatus).toBe('fetching');
    client.clear();
    Object.assign(actor, { id: 'finance', role: 'Finance' });
    rerender();
    await waitFor(() => expect(starts).toEqual(['pm', 'finance']));
    expect(result.current.fetchStatus).toBe('fetching');
    pending[1]({ status: 'ready', erpCheck: 'available', issues: [] });
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    pending[0]({ status: 'blocked', erpCheck: 'available', issues: [] });
  });
});
