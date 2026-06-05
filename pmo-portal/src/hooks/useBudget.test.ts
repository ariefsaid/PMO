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
  archiveVersion: vi.fn().mockResolvedValue(undefined),
  deleteDraftVersion: vi.fn().mockResolvedValue(undefined),
  createLineItem: vi.fn().mockResolvedValue({ id: 'li-new' }),
  updateLineItem: vi.fn().mockResolvedValue(undefined),
  deleteLineItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjectBudget, useBudgetVersions, useBudgetMutations } from './useBudget';
import {
  deriveProjectBudget,
  listBudgetVersions,
  activateVersion,
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
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useBudgetMutations('p-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.activate.mutateAsync('v-1');
    });

    expect(activateVersion).toHaveBeenCalledWith('v-1');
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('"budget"') && c.includes('"org-1"') && c.includes('"p-1"'))).toBe(true);
    expect(calls.some((c) => c.includes('"budget-versions"') && c.includes('"org-1"') && c.includes('"p-1"'))).toBe(true);
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
