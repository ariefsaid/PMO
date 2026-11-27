/**
 * The PM's "Waits on you" when the projects read fails: the task counts depend on that read and never start,
 * so the card must end in its error state (with Retry), never wait on a read that cannot begin.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  list: vi.fn(() => Promise.resolve([])),
  listDueRows: vi.fn((_ids: readonly string[]) => Promise.resolve([
    { project_id: 'p1', status: 'In Progress', end_date: '2026-10-01' },
    { project_id: 'p1', status: 'Done', end_date: '2026-10-01' },
    { project_id: 'p1', status: 'To Do', end_date: '2026-12-01' },
    { project_id: 'p2', status: 'To Do', end_date: '2026-10-26' },
    { project_id: 'p2', status: 'To Do', end_date: null },
  ])),
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useProcurements', async () => (await import('@/src/test/supplierTotalsFromRows')).withSupplierTotals({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
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
  getPMDashboardProjects: () => Promise.reject(new Error('projects read refused')),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({ listTimesheetsAwaitingApproval: () => Promise.resolve([]) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    fxRates: { context: () => Promise.resolve({ currency: 'USD', timezone: 'UTC' }) },
    revenue: { listInvoices: () => Promise.resolve([]), listOverdueInvoiceFacts: () => Promise.resolve([]) },
    expenseClaim: { list: () => Promise.resolve({ rows: [] }), routes: () => Promise.resolve([]) },
    task: { list: h.list, listDueRows: h.listDueRows },
  },
}));

import { useNeedsYou } from './useNeedsYou';

describe('PM waits when the projects read fails', () => {
  it('ends the wait and reports the failure instead of holding a skeleton forever', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useNeedsYou('Project Manager'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPending).toBe(false);
    expect(h.listDueRows).not.toHaveBeenCalled();
  });
});
