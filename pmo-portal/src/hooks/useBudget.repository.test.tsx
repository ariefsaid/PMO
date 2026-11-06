import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { BudgetDistributionPlan } from '@/src/lib/db/budgets';

const budget = vi.hoisted(() => ({
  deriveProjectBudget: vi.fn().mockResolvedValue(123),
  getActivationMode: vi.fn().mockResolvedValue('allowed'),
  precheckActivation: vi.fn().mockResolvedValue({ status: 'ready' }),
  listVersions: vi.fn().mockResolvedValue([]),
  listArchiveLiveTargets: vi.fn().mockResolvedValue([]),
  listLegacyArchiveLiveTargets: vi.fn().mockResolvedValue([]),
  listArchiveTargets: vi.fn().mockResolvedValue([]),
  createVersion: vi.fn().mockResolvedValue({ id: 'new' }),
  activateVersion: vi.fn().mockResolvedValue({}),
  getDistribution: vi.fn(),
  saveDistribution: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
import { useProjectBudget, useBudgetActivationMode, useBudgetActivationPrecheck, useBudgetArchiveTargets, useBudgetVersions, useBudgetMutations, useBudgetDistribution, invalidateBudgetQueries } from './useBudget';

const savedPlan: BudgetDistributionPlan = {
  method: 'amount_by_year',
  inputs: { '2026': '40', '2027': '60' },
  categoryOverrides: {},
  basis: {
    projectStart: '2026-01-01',
    projectEnd: '2027-12-31',
    years: [
      { name: '2026', start: '2026-01-01', end: '2026-12-31' },
      { name: '2027', start: '2027-01-01', end: '2027-12-31' },
    ],
  },
  rows: [
    { category: 'Labor', fiscal_year: '2026', ordinal: 0, amount: '40000', method: 'amount_by_year', is_override: false },
    { category: 'Labor', fiscal_year: '2027', ordinal: 1, amount: '60000', method: 'amount_by_year', is_override: false },
  ],
};

const makeWrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('budget repository boundary', () => {
  beforeEach(() => {
    budget.deriveProjectBudget.mockResolvedValue(123);
    budget.getActivationMode.mockResolvedValue('allowed');
    budget.precheckActivation.mockResolvedValue({ status: 'ready' });
    budget.listVersions.mockResolvedValue([]);
    budget.listArchiveLiveTargets.mockResolvedValue([]);
    budget.createVersion.mockResolvedValue({ id: 'new' });
    budget.getDistribution.mockReset();
    budget.saveDistribution.mockReset().mockResolvedValue(undefined);
  });

  it('reads and writes through the injected budget adapter', async () => {
    const client = newClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => ({ amount: useProjectBudget('p'), mode: useBudgetActivationMode('v'), precheck: useBudgetActivationPrecheck('v'), targets: useBudgetArchiveTargets(['v']), versions: useBudgetVersions('p'), mutations: useBudgetMutations('p') }), { wrapper });
    await waitFor(() => expect(result.current.amount.data).toBe(123));
    await waitFor(() => expect(result.current.mode.data).toBe('allowed'));
    await waitFor(() => expect(result.current.precheck.data?.status).toBe('ready'));
    await waitFor(() => expect(result.current.targets.data).toEqual([]));
    await waitFor(() => expect(result.current.versions.data).toEqual([]));
    await act(async () => { await result.current.mutations.createVersion.mutateAsync({ projectId: 'p', name: 'Draft' }); });
    expect(budget.createVersion).toHaveBeenCalledWith('p', 'Draft', undefined, undefined);
  });

  it('a UI-created version names whole_project mode at the repository boundary (#1472 AC-001)', async () => {
    const client = newClient();
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper: makeWrapper(client) });
    await act(async () => { await result.current.createVersion.mutateAsync({ projectId: 'p', name: 'Draft', budgetMode: 'whole_project' }); });
    expect(budget.createVersion).toHaveBeenCalledWith('p', 'Draft', undefined, 'whole_project');
  });

  describe('useBudgetDistribution (#1472 S6A)', () => {
    it('reads the saved plan for the identity + version through the seam', async () => {
      budget.getDistribution.mockResolvedValue(savedPlan);
      const { result } = renderHook(() => useBudgetDistribution('p', 'v'), { wrapper: makeWrapper(newClient()) });
      await waitFor(() => expect(result.current.data).toEqual(savedPlan));
      expect(budget.getDistribution).toHaveBeenCalledWith('v');
    });

    it('is disabled without org identity or version and never fetches', async () => {
      const { result } = renderHook(() => useBudgetDistribution('p', undefined), { wrapper: makeWrapper(newClient()) });
      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.data).toBeUndefined();
      expect(budget.getDistribution).not.toHaveBeenCalled();
    });

    it('a save success invalidates the distribution, version list, precheck and project finances — an active distribution query refetches', async () => {
      budget.getDistribution.mockResolvedValue(savedPlan);
      const client = newClient();
      const { result } = renderHook(() => ({
        distribution: useBudgetDistribution('p', 'v'),
        versions: useBudgetVersions('p'),
        mutations: useBudgetMutations('p'),
      }), { wrapper: makeWrapper(client) });
      await waitFor(() => expect(result.current.distribution.data).toEqual(savedPlan));
      expect(budget.getDistribution).toHaveBeenCalledTimes(1);
      await act(async () => { await result.current.mutations.saveDistribution.mutateAsync({ versionId: 'v', plan: savedPlan }); });
      await waitFor(() => expect(budget.getDistribution).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(budget.listVersions).toHaveBeenCalledTimes(2));
    });

    it('a failed save does not optimistically claim success — prior state is kept and nothing is invalidated', async () => {
      budget.getDistribution.mockResolvedValue(savedPlan);
      const client = newClient();
      const { result } = renderHook(() => ({
        distribution: useBudgetDistribution('p', 'v'),
        mutations: useBudgetMutations('p'),
      }), { wrapper: makeWrapper(client) });
      await waitFor(() => expect(result.current.distribution.data).toEqual(savedPlan));
      budget.saveDistribution.mockRejectedValueOnce(new Error('budget distribution for Labor must reconcile to its source lines'));
      await act(async () => {
        await expect(result.current.mutations.saveDistribution.mutateAsync({ versionId: 'v', plan: savedPlan })).rejects.toThrow(/reconcile/);
      });
      expect(budget.getDistribution).toHaveBeenCalledTimes(1);
      expect(result.current.distribution.data).toEqual(savedPlan);
    });

    it('the shared invalidation helper re-evaluates the distribution after a paste-style direct create', async () => {
      budget.getDistribution.mockResolvedValue(savedPlan);
      const client = newClient();
      const { result } = renderHook(() => useBudgetDistribution('p', 'v'), { wrapper: makeWrapper(client) });
      await waitFor(() => expect(result.current.data).toEqual(savedPlan));
      expect(budget.getDistribution).toHaveBeenCalledTimes(1);
      // #1473 paste path: the writer calls the SAME shared helper — no bespoke invalidation.
      act(() => { invalidateBudgetQueries(client, 'org', 'p'); });
      await waitFor(() => expect(budget.getDistribution).toHaveBeenCalledTimes(2));
    });
  });

  it('invalidates comparison, yearly projection, phasing and fiscal-year reads only for the owning organization after activation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const forecastKeys = [
      ['budget-comparison', 'org', 'p', 'active-version', '{"kind":"all"}'],
      ['budget-projection', 'org', 'p', 'active-version', 'FY-2026'],
      ['active-budget-category-phasing', 'org', 'p', 'active-version'],
      ['budget-fiscal-years', 'org', 'p', 'active-version'],
    ];
    const otherOrganizationKeys = [
      ['budget-comparison', 'org-two', 'p', 'active-version', '{"kind":"all"}'],
      ['budget-projection', 'org-two', 'p', 'active-version', 'FY-2026'],
      ['active-budget-category-phasing', 'org-two', 'p', 'active-version'],
      ['budget-fiscal-years', 'org-two', 'p', 'active-version'],
    ];
    forecastKeys.forEach((key) => client.setQueryData(key, []));
    otherOrganizationKeys.forEach((key) => client.setQueryData(key, []));
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper });

    await act(async () => { await result.current.activate.mutateAsync('successor'); });

    for (const key of forecastKeys) {
      expect(client.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated).toBe(true);
    }
    for (const key of otherOrganizationKeys) {
      expect(client.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated).toBe(false);
    }
  });

  it('returns the successor budget through an active comparison read within 30 seconds after activation', async () => {
    let successorIsActive = false;
    budget.activateVersion.mockImplementation(async () => {
      successorIsActive = true;
      return {};
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const readActiveBudget = vi.fn(async () => successorIsActive ? 'successor' : 'predecessor');
    const queryKey = ['budget-comparison', 'org', 'p', 'active-version', '{"kind":"all"}'];
    const { result: comparison } = renderHook(() => useQuery({ queryKey, queryFn: readActiveBudget }), { wrapper });
    const { result: mutations } = renderHook(() => useBudgetMutations('p'), { wrapper });
    await waitFor(() => expect(comparison.current.data).toBe('predecessor'));

    const activatedAt = Date.now();
    await act(async () => { await mutations.current.activate.mutateAsync('successor'); });
    await waitFor(() => expect(comparison.current.data).toBe('successor'));

    expect(Date.now() - activatedAt).toBeLessThan(30_000);
    expect(readActiveBudget).toHaveBeenCalledTimes(2);
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
