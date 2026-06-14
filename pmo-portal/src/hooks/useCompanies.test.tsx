import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { company } = vi.hoisted(() => ({
  company: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { company } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useCompanies, useCompany, useCompanyMutations } from './useCompanies';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = [
  { id: 'c1', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  company.list.mockResolvedValue(seed);
  company.get.mockResolvedValue(seed[0]);
  company.create.mockResolvedValue({ ...seed[0], id: 'c2', name: 'New Co' });
  company.update.mockResolvedValue(undefined);
  company.archive.mockResolvedValue(undefined);
  company.delete.mockResolvedValue(undefined);
});

describe('useCompanies', () => {
  it("AC-CO-001: keys by ['companies', orgId] and returns company rows", async () => {
    const { result } = renderHook(() => useCompanies(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('Cascade Port Authority');
    expect(company.list).toHaveBeenCalledWith(undefined);
  });

  it('AC-CO-001: passes a type filter through to the repository', async () => {
    const { result } = renderHook(() => useCompanies('Vendor'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(company.list).toHaveBeenCalledWith({ type: 'Vendor' });
  });
});

describe('useCompany (single record — CW-4b /companies/:id)', () => {
  it("CW-4b: keys by ['company', orgId, id] and returns the single company via repository.get", async () => {
    const { result } = renderHook(() => useCompany('c1'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('Cascade Port Authority');
    expect(company.get).toHaveBeenCalledWith('c1');
  });

  it('CW-4b: stays disabled (no fetch) when the id is undefined', () => {
    company.get.mockClear();
    const { result } = renderHook(() => useCompany(undefined), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(company.get).not.toHaveBeenCalled();
  });
});

describe('useCompanyMutations', () => {
  it('AC-CO-003: create invokes the repository and invalidates the companies query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCompanyMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.create.mutateAsync({ name: 'New Co', type: 'Client' });
    });
    expect(company.create).toHaveBeenCalledWith({ name: 'New Co', type: 'Client' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['companies'] });
  });

  it('AC-W3-INTEG-002 (F2): create also invalidates the vendor + client FK pickers (so combobox forms do not serve a stale company list for ~5 min)', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCompanyMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.create.mutateAsync({ name: 'New Co', type: 'Client' });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fk-options', 'vendor'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fk-options', 'client'] });
  });

  it('AC-W3-INTEG-002 (F2): archive also invalidates the vendor + client FK pickers (an archived company must drop out)', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCompanyMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.archive.mutateAsync('c1');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fk-options', 'vendor'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fk-options', 'client'] });
  });

  it('AC-CO-004: update invokes the repository with id + input', async () => {
    const { result } = renderHook(() => useCompanyMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.update.mutateAsync({ id: 'c1', input: { name: 'X', type: 'Vendor' } });
    });
    expect(company.update).toHaveBeenCalledWith('c1', { name: 'X', type: 'Vendor' });
  });

  it('AC-CO-005: archive invokes the repository with the id', async () => {
    const { result } = renderHook(() => useCompanyMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.archive.mutateAsync('c1');
    });
    expect(company.archive).toHaveBeenCalledWith('c1');
  });

  it('AC-CO-006: delete invokes the repository with the id', async () => {
    const { result } = renderHook(() => useCompanyMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.remove.mutateAsync('c1');
    });
    expect(company.delete).toHaveBeenCalledWith('c1');
  });
});
