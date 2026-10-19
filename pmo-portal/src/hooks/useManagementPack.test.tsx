import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.unmock('@/src/hooks/useProjectsMoneyCollection');

const h = vi.hoisted(() => ({
  managementPack: vi.fn(), recordProgress: vi.fn(), projectMoney: vi.fn(), getProject: vi.fn(),
  projectFinances: vi.fn(), arAging: vi.fn(), customerRefs: vi.fn(),
  auth: {
    session: { user: { id: 'u1' } },
    currentUser: { id: 'u1', org_id: 'org-1', role: 'Finance' },
    loading: false,
    profileError: null,
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: {
  reports: { managementPack: h.managementPack, recordProgress: h.recordProgress },
  revenue: { getProjectFinances: h.projectFinances },
  erpSnapshots: { arAging: h.arAging },
  companyCollections: { listForErpCustomerIds: h.customerRefs },
} }));
vi.mock('@/src/lib/repositories/projectMoney', () => ({ projectMoneyRepository: { collection: h.projectMoney } }));
vi.mock('@/src/lib/db/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/projects')>()),
  getProject: h.getProject,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.auth.currentUser?.role ?? null }) }));

import { useManagementPack, useRecordProjectProgress } from './useManagementPack';

const facts = {
  from: '2026-01-01', to: '2026-01-01', timezone: 'UTC', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{ id: 'p1', name: 'Alpha', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR',
    contract_net: 10, start_date: null, end_date: null, project_manager_id: null, client_name: null }],
  invoiced: [], invoiced_before: [], progress: [],
};

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.managementPack.mockReset().mockResolvedValue(facts);
  h.recordProgress.mockReset().mockResolvedValue(undefined);
  h.projectMoney.mockReset().mockImplementation(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, {
    ledgerBasis: 'pmo',
    actuals: { currency: 'USD', total: '0.00', asOf: null, excludesRestrictedRows: false, complete: true, categories: [] },
    activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false,
  }])));
  h.getProject.mockReset().mockImplementation(async (id: string) => ({ id, client_id: null, currency: 'USD' }));
  h.projectFinances.mockReset().mockImplementation(async (id: string) => ({
    project_id: id, contract_invoiced: null, remaining_to_invoice: null, invoices: [], budget: null,
    actuals: { currency: 'USD', as_of: null, total: null, excludes_restricted_rows: false, categories: [] },
  }));
  h.arAging.mockReset().mockResolvedValue([]);
  h.customerRefs.mockReset().mockResolvedValue([]);
  h.auth = {
    session: { user: { id: 'u1' } },
    currentUser: { id: 'u1', org_id: 'org-1', role: 'Finance' },
    loading: false,
    profileError: null,
  };
});

function positionPack(count: number) {
  return {
    from: '2026-01-01', to: '2026-01-01', timezone: 'UTC', months: ['2026-01'], totals: [], undatedInvoiceCount: 0,
    rows: Array.from({ length: count }, (_, index) => ({
      key: `p${index}`, kind: 'contract' as const, projectId: `p${index}`, projectName: `Project ${index}`,
      projectNumber: null, clientName: null, projectManagerId: null, projectStatus: 'Ongoing Project', currency: 'USD',
      contractNet: null, latestProgress: null, months: [],
    })),
  };
}

describe('useManagementPack', () => {
  it('AC-MMP-013 support: returns the BUILT pack for the requested window', async () => {
    const { result } = renderHook(() => useManagementPack({ from: '2026-01-01', to: '2026-01-01' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.managementPack).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-01' });
    expect(result.current.data?.rows[0].contractNet).toBe(1000);
  });

  it('AC-MMP-014 support: recording progress refreshes every cached pack', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordProjectProgress(), { wrapper });
    await act(() => result.current.mutateAsync({ projectId: 'p1', month: '2026-01-01', pctComplete: 10, note: null }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['managementPack'] });
  });

  it('AC-S35-004: visible page is limited to ten IDs and detail reads wait for expansion', async () => {
    const module = await import('./useManagementPack');
    expect(module.useManagementPosition).toBeTypeOf('function');
    const usePosition = module.useManagementPosition;
    const pack = positionPack(20);
    const { result, rerender } = renderHook(
      ({ page, expanded }: { page: number; expanded: string | null }) => usePosition(pack, page, expanded),
      { initialProps: { page: 0, expanded: null as string | null }, wrapper },
    );

    await waitFor(() => expect(h.projectMoney).toHaveBeenCalledWith(Array.from({ length: 10 }, (_, i) => `p${i}`)));
    await waitFor(() => expect(result.current.actualState).toBe('known'));
    expect(result.current.rows).toHaveLength(10);
    expect(h.getProject).not.toHaveBeenCalled();
    expect(h.projectFinances).not.toHaveBeenCalled();
    expect(h.arAging).not.toHaveBeenCalled();
    expect(h.customerRefs).not.toHaveBeenCalled();

    rerender({ page: 1, expanded: 'p0' });
    await waitFor(() => expect(h.projectMoney).toHaveBeenCalledWith(Array.from({ length: 10 }, (_, i) => `p${i + 10}`)));
    expect(result.current.pageIndex).toBe(1);
    expect(result.current.expandedProjectId).toBeNull();
    expect(h.getProject).not.toHaveBeenCalled();
    expect(h.projectFinances).not.toHaveBeenCalled();
  });

  it('AC-S35-004: one expanded project loads one project, finance and customer graph', async () => {
    const module = await import('./useManagementPack');
    expect(module.useManagementPosition).toBeTypeOf('function');
    const usePosition = module.useManagementPosition;
    const aging = {
      party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 10,
      current: null, bucket0to30: null, bucket31to60: null, bucket61to90: null, bucketOver90: null,
      rangeLabels: {}, reportDate: '2026-10-18', ageingBasedOn: 'Due Date', asOf: '2026-10-18T00:00:00Z',
      sourceReport: 'Accounts Receivable', reportVersion: '1', snapshotId: 'snap-1',
    };
    h.getProject.mockResolvedValue({ id: 'p0', client_id: 'c1', currency: 'USD' });
    h.arAging.mockResolvedValue([aging]);
    h.customerRefs.mockResolvedValue([{ companyId: 'c1', erpCustomerId: 'Customer:C-0001' }]);

    const { result } = renderHook(() => usePosition(positionPack(20), 0, 'p0'), { wrapper });

    await waitFor(() => expect(h.customerRefs).toHaveBeenCalledWith(['Customer:C-0001']));
    expect(h.projectMoney).toHaveBeenCalledWith(Array.from({ length: 10 }, (_, i) => `p${i}`));
    expect(h.getProject).toHaveBeenCalledTimes(1);
    expect(h.getProject).toHaveBeenCalledWith('p0');
    expect(h.projectFinances).toHaveBeenCalledTimes(1);
    expect(h.projectFinances).toHaveBeenCalledWith('p0');
    expect(h.arAging).toHaveBeenCalledTimes(1);
    expect(h.customerRefs).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.collectionsState).toBe('known'));
    expect(result.current.detail?.customerId).toBe('c1');
  });

  it('AC-S35-004: same-org role changes mask old data until the current observer refetches', async () => {
    const module = await import('./useManagementPack');
    expect(module.useManagementPosition).toBeTypeOf('function');
    const usePosition = module.useManagementPosition;
    const oldRead = deferred<Record<string, unknown>>();
    const currentRead = deferred<Record<string, unknown>>();
    h.projectMoney.mockReset()
      .mockImplementationOnce(() => oldRead.promise)
      .mockImplementationOnce(() => currentRead.promise);
    const pack = positionPack(2);
    const { result, rerender } = renderHook(() => usePosition(pack, 0, null), { wrapper });

    await waitFor(() => expect(h.projectMoney).toHaveBeenCalledTimes(1));
    h.auth = { ...h.auth, currentUser: { ...h.auth.currentUser, role: 'Project Manager' } };
    rerender();
    await waitFor(() => expect(h.projectMoney).toHaveBeenCalledTimes(2));
    expect(result.current.rows).toEqual([]);
    expect(result.current.actualState).toBe('loading');

    oldRead.resolve(Object.fromEntries(['p0', 'p1'].map((id) => [id, {
      ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '999.00', asOf: null,
        excludesRestrictedRows: false, complete: true, categories: [] },
      activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false,
    }])));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.rows).toEqual([]);

    currentRead.resolve(Object.fromEntries(['p0', 'p1'].map((id) => [id, {
      ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '50.00', asOf: null,
        excludesRestrictedRows: false, complete: true, categories: [] },
      activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false,
    }])));
    await waitFor(() => expect(result.current.rows[0]?.actual.amount).toBe('50.00'));
  });

  it('AC-S35-004: withdrawn role or mismatched active profile exposes no current position and starts no source reads', async () => {
    const module = await import('./useManagementPack');
    const usePosition = module.useManagementPosition;
    h.auth = { ...h.auth, currentUser: { ...h.auth.currentUser, role: 'Engineer' } };
    const { result, rerender } = renderHook(
      ({ expanded }: { expanded: string | null }) => usePosition(positionPack(2), 0, expanded),
      { initialProps: { expanded: 'p0' }, wrapper },
    );

    expect(result.current.identityReady).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.expandedProjectId).toBeNull();
    expect(h.projectMoney).not.toHaveBeenCalled();
    expect(h.getProject).not.toHaveBeenCalled();
    expect(h.projectFinances).not.toHaveBeenCalled();
    expect(h.arAging).not.toHaveBeenCalled();
    expect(h.customerRefs).not.toHaveBeenCalled();

    h.auth = { ...h.auth, currentUser: { ...h.auth.currentUser, role: 'Finance', id: 'different-user' } };
    rerender({ expanded: 'p0' });
    expect(result.current.identityReady).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(h.projectMoney).not.toHaveBeenCalled();
  });
});
