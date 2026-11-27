/** Speed: the PM home reads no purchase list (only the company roles' supplier-invoice need uses it). */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  useProcurements: vi.fn((_opts?: { enabled?: boolean; lean?: boolean }) => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() })),
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useProcurements', async () => (await import('@/src/test/supplierTotalsFromRows')).withSupplierTotals({ useProcurements: h.useProcurements }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: (ids: string[]) => ({ data: {}, isPending: ids.length === 0, isError: false, fetchStatus: 'idle', refetch: vi.fn() }),
}));
vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: () => Promise.resolve({ projects_at_risk: 0 }),
  getFinanceBudgetReview: () => Promise.resolve([]),
  getPMDashboardProjects: () => Promise.resolve([{ id: 'p1', status: 'In Progress' }]),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({ listTimesheetsAwaitingApproval: () => Promise.resolve([]) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    fxRates: { context: () => Promise.resolve({ currency: 'USD', timezone: 'UTC' }) },
    revenue: { listInvoices: () => Promise.resolve([]), listOverdueInvoiceFacts: () => Promise.resolve([]) },
    expenseClaim: { list: () => Promise.resolve({ rows: [] }), routes: () => Promise.resolve([]) },
    task: { list: () => Promise.resolve([]), listDueRows: () => Promise.resolve([]) },
  },
}));

import { useNeedsYou } from './useNeedsYou';

describe('PM home purchase read', () => {
  it('does not enable the purchase-list read for a Project Manager', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useNeedsYou('Project Manager'), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    const leanReads = h.useProcurements.mock.calls.filter(([opts]) => opts?.lean === true);
    expect(leanReads.length).toBeGreaterThan(0);
    expect(leanReads.every(([opts]) => opts?.enabled === false)).toBe(true);
  });
});
