import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  read: vi.fn(), finances: vi.fn(), milestones: vi.fn(), committed: vi.fn(), ledger: vi.fn(), boq: vi.fn(), billing: vi.fn(),
  can: true as boolean, role: 'Finance' as string,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.can }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role }) }));
vi.mock('@/src/lib/repositories/admin', () => ({
  externalDomainOwnershipRepository: { listOwn: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/src/lib/repositories/procurement', () => ({
  procurementRepository: { getProjectCommittedSpend: h.committed },
}));
vi.mock('@/src/lib/repositories/projectOverview', () => ({
  projectOverviewRepository: { read: h.read },
}));
vi.mock('@/src/lib/repositories/revenue', () => ({
  revenueRepository: { getProjectFinances: h.finances, getOrgReadsErpLedger: h.ledger },
}));
vi.mock('@/src/lib/repositories/workOrders', () => ({
  milestoneRepository: { list: h.milestones },
  progressBillingRepository: { listBoq: h.boq, summary: h.billing },
}));
import { LIST_STALE_TIME } from '@/src/lib/queryPolicies';
import { useProjectOverviewRead } from './useProjectOverviewRead';
import { useProjectFinances } from './useProjectFinances';
import { useMilestones } from './useMilestones';
import { useBoqItems, useProjectBilling } from './useProgressBilling';
import { useProjectCommittedSpend } from './useProcurements';

const FINANCES = { project_id: 'p1', marker: 'from-overview' };
const OVERVIEW = {
  finances: FINANCES, billing: null, boqItems: [{ id: 'b1' }],
  committedSpend: { amount: 7, otherCurrencies: [] }, externalDomainOwnership: [], readsErpLedger: false,
  milestones: [{ id: 'm1' }], commentCount: 3, fxContext: { currency: 'IDR', timezone: 'UTC' },
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: LIST_STALE_TIME } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const overview = renderHook(() => useProjectOverviewRead('p1', true), { wrapper });
  // The page mounts the leaf hooks only after the overview read settles (ProjectDetail), so the test does the same.
  const mountLeaves = () => renderHook(() => ({
    finances: useProjectFinances('p1'),
    milestones: useMilestones('p1'),
    boq: useBoqItems('p1'),
    billing: useProjectBilling('p1'),
    committed: useProjectCommittedSpend('p1', true),
  }), { wrapper });
  return { client, overview, mountLeaves };
}

beforeEach(() => { vi.clearAllMocks(); h.can = true; h.role = 'Finance'; });

describe('useProjectOverviewRead', () => {
  it('AC-PERF-007 a successful read seeds the leaf keys so mounted leaf hooks issue no request', async () => {
    h.read.mockResolvedValue(OVERVIEW);
    const { client, overview, mountLeaves } = setup();
    await waitFor(() => expect(overview.result.current.isSuccess).toBe(true));
    const result = mountLeaves().result;
    expect(h.read).toHaveBeenCalledWith('p1', { money: true, commitments: true, budget: true });
    expect(client.getQueryData(['project-finances', 'org-1', 'p1'])).toBe(FINANCES);
    expect(client.getQueryData(['milestones', 'org-1', 'p1'])).toEqual([{ id: 'm1' }]);
    expect(client.getQueryData(['project-comment-count', 'org-1', 'p1'])).toBe(3);
    expect(client.getQueryData(['fx-context', 'org-1'])).toEqual({ currency: 'IDR', timezone: 'UTC' });
    expect(client.getQueryData(['org-reads-erp-ledger', 'org-1'])).toBe(false);
    await waitFor(() => expect(result.current.committed.data).toBe(7));
    expect(result.current.milestones.data).toEqual([{ id: 'm1' }]);
    expect(h.finances).not.toHaveBeenCalled();
    expect(h.milestones).not.toHaveBeenCalled();
    expect(h.committed).not.toHaveBeenCalled();
    expect(h.boq).not.toHaveBeenCalled();
    expect(h.billing).not.toHaveBeenCalled();
    expect(h.ledger).not.toHaveBeenCalled();
  });

  it('AC-PERF-007 the delivery lens asks only for what it shows and seeds no money section', async () => {
    h.can = false;
    h.role = 'Engineer';
    h.read.mockResolvedValue({ milestones: [], commentCount: 0, fxContext: null });
    const { client, overview } = setup();
    await waitFor(() => expect(overview.result.current.isSuccess).toBe(true));
    expect(h.read).toHaveBeenCalledWith('p1', { money: false, commitments: false, budget: false });
    expect(client.getQueryData(['project-finances', 'org-1', 'p1'])).toBeUndefined();
    expect(client.getQueryData(['fx-context', 'org-1'])).toBeUndefined();
  });

  it('AC-PERF-007 a budget the server says is too big to aggregate is not seeded (the leaf reads it itself)', async () => {
    h.read.mockResolvedValue({ ...OVERVIEW, budgetVersions: null });
    const { client, overview } = setup();
    await waitFor(() => expect(overview.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['budget-versions', 'org-1', 'p1'])).toBeUndefined();
  });

  it('AC-PERF-008 when the read fails the leaf hooks fetch for themselves and still load', async () => {
    h.read.mockRejectedValue(new Error('function missing'));
    h.finances.mockResolvedValue({ project_id: 'p1', marker: 'from-leaf' });
    h.milestones.mockResolvedValue([{ id: 'm9' }]);
    h.committed.mockResolvedValue({ amount: 9, otherCurrencies: [] });
    h.boq.mockResolvedValue([]);
    h.billing.mockResolvedValue(null);
    h.ledger.mockResolvedValue(true);
    const { overview, mountLeaves } = setup();
    await waitFor(() => expect(overview.result.current.isError).toBe(true));
    const { result } = mountLeaves();
    await waitFor(() => expect(result.current.finances.data).toEqual({ project_id: 'p1', marker: 'from-leaf' }));
    await waitFor(() => expect(result.current.milestones.data).toEqual([{ id: 'm9' }]));
    expect(h.read).toHaveBeenCalledTimes(1);
  });
});
