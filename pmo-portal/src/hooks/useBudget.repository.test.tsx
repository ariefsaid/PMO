import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const budget = vi.hoisted(() => ({
  deriveProjectBudget: vi.fn().mockResolvedValue(123),
  getActivationMode: vi.fn().mockResolvedValue('allowed'),
  precheckActivation: vi.fn().mockResolvedValue({ status: 'ready' }),
  listVersions: vi.fn().mockResolvedValue([]),
  listArchiveLiveTargets: vi.fn().mockResolvedValue([]),
  createVersion: vi.fn().mockResolvedValue({ id: 'new' }),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
import { useProjectBudget, useBudgetActivationMode, useBudgetActivationPrecheck, useBudgetArchiveTargets, useBudgetVersions, useBudgetMutations } from './useBudget';

describe('budget repository boundary', () => {
  it('reads and writes through the injected budget adapter', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => ({ amount: useProjectBudget('p'), mode: useBudgetActivationMode('v'), precheck: useBudgetActivationPrecheck('v'), targets: useBudgetArchiveTargets(['v']), versions: useBudgetVersions('p'), mutations: useBudgetMutations('p') }), { wrapper });
    await waitFor(() => expect(result.current.amount.data).toBe(123));
    await waitFor(() => expect(result.current.mode.data).toBe('allowed'));
    await waitFor(() => expect(result.current.precheck.data?.status).toBe('ready'));
    await waitFor(() => expect(result.current.targets.data).toEqual([]));
    await waitFor(() => expect(result.current.versions.data).toEqual([]));
    await act(async () => { await result.current.mutations.createVersion.mutateAsync({ projectId: 'p', name: 'Draft' }); });
    expect(budget.createVersion).toHaveBeenCalledWith('p', 'Draft');
  });
});
