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
  getDistribution: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
import { useProjectBudget, useBudgetActivationMode, useBudgetActivationPrecheck, useBudgetArchiveTargets, useBudgetVersions, useBudgetMutations, useBudgetDistribution } from './useBudget';

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

describe('useBudgetDistribution read contract', () => {
  it('reads one version through the repository seam with org/project/version cache scope', async () => {
    budget.getDistribution.mockClear();
    const plan = {
      method: 'by_days' as const,
      inputs: {},
      categoryOverrides: {},
      basis: { projectStart: '2027-01-01', projectEnd: null, years: [{ name: 'FY27', start: '2027-01-01', end: '2027-12-31' }] },
      rows: [{ category: 'Labor' as const, fiscal_year: 'FY27', ordinal: 0, amount: '0.00', method: 'by_days' as const, is_override: false }],
    };
    budget.getDistribution.mockResolvedValueOnce(plan);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBudgetDistribution('project-1', 'version-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(plan));
    expect(budget.getDistribution).toHaveBeenCalledWith('version-1');
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toContainEqual(['budget-distribution', 'org', 'project-1', 'version-1']);
  });

  it('stays disabled without a version and never reads an unresolved project scope', () => {
    budget.getDistribution.mockReset().mockResolvedValue(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBudgetDistribution('project-1', undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(budget.getDistribution).not.toHaveBeenCalled();
  });
});
