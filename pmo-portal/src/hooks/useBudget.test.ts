import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the DAL
// ---------------------------------------------------------------------------
vi.mock('@/src/lib/db/budgets', () => ({
  deriveProjectBudget: vi.fn().mockResolvedValue(4700000),
  listBudgetVersions: vi.fn().mockResolvedValue([]),
  createBudgetVersion: vi.fn().mockResolvedValue({ id: 'v-new' }),
  cloneVersion: vi.fn().mockResolvedValue('v-clone'),
  activateVersion: vi.fn().mockResolvedValue(undefined),
  archiveVersion: vi.fn().mockResolvedValue({ cancelErp: false, liveTargetCount: 0, queuedCount: 0 }),
  listBudgetArchiveLiveTargets: vi.fn().mockResolvedValue([]),
  listLegacyBudgetArchiveLiveTargets: vi.fn().mockResolvedValue([]),
  deleteDraftVersion: vi.fn().mockResolvedValue(undefined),
  createLineItem: vi.fn().mockResolvedValue({ id: 'li-new' }),
  updateLineItem: vi.fn().mockResolvedValue(undefined),
  deleteLineItem: vi.fn().mockResolvedValue(undefined),
  getBudgetDistribution: vi.fn(),
  saveBudgetDistribution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjectBudget, useBudgetVersions, useBudgetMutations } from './useBudget';
import {
  deriveProjectBudget,
  listBudgetVersions,
  createBudgetVersion,
  cloneVersion,
  activateVersion,
  archiveVersion,
  deleteDraftVersion,
  createLineItem,
  updateLineItem,
  deleteLineItem,
} from '@/src/lib/db/budgets';

// ---------------------------------------------------------------------------
// Wrapper factory — each test gets a fresh QueryClient
// ---------------------------------------------------------------------------
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

function seedBudgetReadQueries(qc: QueryClient) {
  const keys = [
    ['budget', 'org-1', 'p-1'],
    ['budget-versions', 'org-1', 'p-1'],
  ] as const;
  keys.forEach((key) => qc.setQueryData(key, 'old'));
  return keys;
}

function expectBothKeysInvalidated(qc: QueryClient) {
  expect(qc.getQueryState(['budget', 'org-1', 'p-1'])?.isInvalidated).toBe(true);
  expect(qc.getQueryState(['budget-versions', 'org-1', 'p-1'])?.isInvalidated).toBe(true);
}

// ---------------------------------------------------------------------------
// T12 — read hooks: org-scoped queryKeys + enabled
// ---------------------------------------------------------------------------
describe('useProjectBudget', () => {
  it("keys on ['budget', orgId, projectId] and is enabled on auth (T12)", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectBudget('p-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(4700000);
    expect(deriveProjectBudget).toHaveBeenCalledWith('p-1');
  });

  it('is disabled when projectId is empty string', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectBudget(''), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useBudgetVersions', () => {
  it("keys on ['budget-versions', orgId, projectId] and is enabled on auth (T12)", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetVersions('p-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listBudgetVersions).toHaveBeenCalledWith('p-1');
  });

  it('is disabled when projectId is empty string', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetVersions(''), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// T13 — mutation hook: invalidates both read keys on success
// ---------------------------------------------------------------------------
describe('useBudgetMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activate invalidates budget + budget-versions on success (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);

    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.activate.mutateAsync('v-1');
    });

    expect(activateVersion).toHaveBeenCalledWith('v-1');
    expectBothKeysInvalidated(qc);
  });

  it('createVersion calls createBudgetVersion(projectId, name) and invalidates both keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createVersion.mutateAsync({ projectId: 'p-1', name: 'V3' });
    });

    expect(createBudgetVersion).toHaveBeenCalledWith('p-1', 'V3', undefined, undefined);
    expectBothKeysInvalidated(qc);
  });

  it('cloneVersion calls cloneVersion(versionId) and invalidates both keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.cloneVersion.mutateAsync('v-active');
    });

    expect(cloneVersion).toHaveBeenCalledWith('v-active');
    expectBothKeysInvalidated(qc);
  });

  it('archive calls archiveVersion(versionId, cancelErp) and invalidates budget read keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.archive.mutateAsync({ versionId: 'v-active', cancelErp: true });
    });

    expect(archiveVersion).toHaveBeenCalledWith('v-active', true);
    expectBothKeysInvalidated(qc);
  });

  it('deleteDraft calls deleteDraftVersion(versionId) and invalidates both keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.deleteDraft.mutateAsync('v-draft');
    });

    expect(deleteDraftVersion).toHaveBeenCalledWith('v-draft');
    expectBothKeysInvalidated(qc);
  });

  it('createLineItem calls createLineItem(versionId, item) in that arg order and invalidates both keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const projectFinanceKey = ['project-finances', 'org-1', 'p-1'] as const;
    qc.setQueryData(projectFinanceKey, 'old');
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    const item = { category: 'Labor' as const, description: 'Day labor', budgeted_amount: 200000 };
    await act(async () => {
      await result.current.createLineItem.mutateAsync({ versionId: 'v-draft', item });
    });

    // Order matters: catches a swapped/dropped arg like createLineItem(item, versionId).
    expect(createLineItem).toHaveBeenCalledWith('v-draft', item, undefined);
    expectBothKeysInvalidated(qc);
    expect(qc.getQueryState(projectFinanceKey)?.isInvalidated).toBe(true);
  });

  it('updateLineItem calls updateLineItem(id, patch) in that arg order and invalidates both keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    const patch = { budgeted_amount: 500 };
    await act(async () => {
      await result.current.updateLineItem.mutateAsync({ id: 'li-1', patch });
    });

    expect(updateLineItem).toHaveBeenCalledWith('li-1', patch);
    expectBothKeysInvalidated(qc);
  });

  // ── AC-BFY-016 (FR-BFY-060) — the fiscal year is part of the line item, on both write paths. ──
  it('AC-BFY-016 createLineItem carries the line\'s fiscal_year through to the DAL', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });
    const item = { category: 'Labor' as const, description: null, budgeted_amount: 1000, fiscal_year: '2026' };
    await act(async () => {
      await result.current.createLineItem.mutateAsync({ versionId: 'v-draft', item });
    });
    expect(createLineItem).toHaveBeenCalledWith('v-draft', item, undefined);
  });

  it('AC-BFY-016 updateLineItem can RE-PHASE a line, and can un-phase it back to NULL', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.updateLineItem.mutateAsync({ id: 'li-1', patch: { fiscal_year: '2027' } });
    });
    expect(updateLineItem).toHaveBeenCalledWith('li-1', { fiscal_year: '2027' });
    await act(async () => {
      await result.current.updateLineItem.mutateAsync({ id: 'li-1', patch: { fiscal_year: null } });
    });
    expect(updateLineItem).toHaveBeenCalledWith('li-1', { fiscal_year: null });
  });

  it('deleteLineItem calls deleteLineItem(id) and invalidates both keys (T13)', async () => {
    const { qc, Wrapper } = makeWrapper();
    seedBudgetReadQueries(qc);
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.deleteLineItem.mutateAsync('li-1');
    });

    expect(deleteLineItem).toHaveBeenCalledWith('li-1');
    expectBothKeysInvalidated(qc);
  });

  it('mutations are exposed: createVersion, cloneVersion, activate, archive, deleteDraft, createLineItem, updateLineItem, deleteLineItem', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });
    expect(typeof result.current.createVersion.mutateAsync).toBe('function');
    expect(typeof result.current.cloneVersion.mutateAsync).toBe('function');
    expect(typeof result.current.activate.mutateAsync).toBe('function');
    expect(typeof result.current.archive.mutateAsync).toBe('function');
    expect(typeof result.current.deleteDraft.mutateAsync).toBe('function');
    expect(typeof result.current.createLineItem.mutateAsync).toBe('function');
    expect(typeof result.current.updateLineItem.mutateAsync).toBe('function');
    expect(typeof result.current.deleteLineItem.mutateAsync).toBe('function');
  });
});

it.each(['activate', 'archive'] as const)('%s refreshes only this organization’s money collections', async (operation) => {
  const { qc, Wrapper } = makeWrapper();
  const keys = [
    ['projects-money', 'org-1', 'p-1,p-2'], ['projects-money', 'org-2', 'p-1'],
    ['finance-budget-review', 'org-1'], ['finance-budget-review', 'org-2'],
  ];
  keys.forEach(key => qc.setQueryData(key, 'old'));
  const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });
  await act(async () => {
    if (operation === 'activate') await result.current.activate.mutateAsync('v-1');
    else await result.current.archive.mutateAsync({ versionId: 'v-1', cancelErp: false });
  });
  expect(qc.getQueryState(keys[0])?.isInvalidated).toBe(true);
  expect(qc.getQueryState(keys[1])?.isInvalidated).toBe(false);
  expect(qc.getQueryState(keys[2])?.isInvalidated).toBe(true);
  expect(qc.getQueryState(keys[3])?.isInvalidated).toBe(false);
});
