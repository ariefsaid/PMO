import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock the repository seam (ADR-0017) — the hooks consume `repositories.procurement`.
const repo = vi.hoisted(() => ({
  create: vi.fn(),
  createWithItems: vi.fn(),
  updateHeader: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  selectQuote: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement: repo } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import {
  useCreateProcurement,
  useCreateProcurementWithItems,
  useProcurementCrudMutations,
} from './useProcurementCrud';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.create.mockResolvedValue({ id: 'pr-new' });
  repo.updateHeader.mockResolvedValue(undefined);
  repo.createItem.mockResolvedValue({ id: 'it1' });
  repo.updateItem.mockResolvedValue(undefined);
  repo.deleteItem.mockResolvedValue(undefined);
  repo.selectQuote.mockResolvedValue(undefined);
  repo.createDocument.mockResolvedValue({ id: 'd1' });
  repo.deleteDocument.mockResolvedValue(undefined);
});

describe('AC-PROC-001 useCreateProcurement', () => {
  it('AC-PROC-001: stamps the requester from the auth context (currentUser.id) and invalidates the list', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: Wrapper });

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ title: 'T', projectId: 'p1', vendorId: null });
    });

    // The hook supplies the requester id from the auth context — the form never sends it.
    expect(repo.create).toHaveBeenCalledWith({ title: 'T', projectId: 'p1', vendorId: null }, 'u1');
    expect(created?.id).toBe('pr-new');
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('"procurements"'))).toBe(true);
  });
});

describe('atomic procurement creation hook', () => {
  it('returns the saved draft and invalidates the list', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const input = { id: 'pr', header: { title: 'T', projectId: null, vendorId: null }, lines: [] };
    repo.createWithItems.mockResolvedValue({ id: 'pr' });
    const { result } = renderHook(() => useCreateProcurementWithItems(), { wrapper: Wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).resolves.toEqual({ id: 'pr' }); });
    expect(repo.createWithItems).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['procurements'] });
  });
});

describe('AC-PROC-002..005 useProcurementCrudMutations (detail-scoped, invalidates the detail key)', () => {
  it('AC-PROC-002: updateHeader delegates and invalidates the detail key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementCrudMutations('pr1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.updateHeader.mutateAsync({ title: 'T2', projectId: null, vendorId: 'v9' });
    });
    expect(repo.updateHeader).toHaveBeenCalledWith('pr1', { title: 'T2', projectId: null, vendorId: 'v9' });
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some((c) => c.includes('"procurement"') && c.includes('"org-1"') && c.includes('"pr1"')),
    ).toBe(true);
  });

  it('AC-PROC-003: createItem / updateItem / deleteItem delegate + invalidate the detail key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementCrudMutations('pr1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createItem.mutateAsync({ name: 'Wire', quantity: 2, rate: 5 });
    });
    expect(repo.createItem).toHaveBeenCalledWith('pr1', { name: 'Wire', quantity: 2, rate: 5 });

    await act(async () => {
      await result.current.updateItem.mutateAsync({ id: 'it1', patch: { rate: 6 } });
    });
    expect(repo.updateItem).toHaveBeenCalledWith('it1', { rate: 6 });

    await act(async () => {
      await result.current.deleteItem.mutateAsync('it1');
    });
    expect(repo.deleteItem).toHaveBeenCalledWith('it1');

    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.filter((c) => c.includes('"pr1"')).length).toBeGreaterThanOrEqual(3);
  });

  it('AC-PROC-004: selectQuote delegates + invalidates the detail key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementCrudMutations('pr1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.selectQuote.mutateAsync('q1');
    });
    expect(repo.selectQuote).toHaveBeenCalledWith('q1');
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('"pr1"'))).toBe(true);
  });

  it('AC-PROC-005: createDocument / deleteDocument delegate + invalidate the detail key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementCrudMutations('pr1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createDocument.mutateAsync({
        type: 'PO',
        referenceNumber: 'PO-1',
        status: 'Draft',
      });
    });
    expect(repo.createDocument).toHaveBeenCalledWith('pr1', {
      type: 'PO',
      referenceNumber: 'PO-1',
      status: 'Draft',
    });

    await act(async () => {
      await result.current.deleteDocument.mutateAsync('d1');
    });
    expect(repo.deleteDocument).toHaveBeenCalledWith('d1');

    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('"pr1"'))).toBe(true);
  });
});

describe('T-11 detail mutations refresh list and spend', () => {
  it('updateHeader with a project change refreshes old and new project spend and the list family', async () => {
    const { qc, Wrapper } = makeWrapper();
    qc.setQueryData(['procurement', 'org-1', 'pr1', 'u1', 'r'], { project_id: 'pOld' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementCrudMutations('pr1'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.updateHeader.mutateAsync({ title: 'T', projectId: 'pNew', vendorId: null });
    });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['procurements', 'org-1']);
    for (const p of ['pOld', 'pNew']) {
      expect(keys).toContainEqual(['project-committed-spend', 'org-1', p]);
      expect(keys).toContainEqual(['project-reserved-spend', 'org-1', p]);
    }
  });

  it('selectQuote refreshes the list family', async () => {
    const { qc, Wrapper } = makeWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementCrudMutations('pr1'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.selectQuote.mutateAsync('q1');
    });
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(['procurements', 'org-1']);
  });
});
