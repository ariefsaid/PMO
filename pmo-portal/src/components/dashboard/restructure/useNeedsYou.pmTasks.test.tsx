/**
 * #1741 N+1: the PM dashboard counts overdue tasks with ONE batched read across the PM's projects,
 * not one task-list read per project. Counts per project stay identical.
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
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: () => Promise.resolve({ projects_at_risk: 0 }),
  getFinanceBudgetReview: () => Promise.resolve([]),
  getPMDashboardProjects: () => Promise.resolve([
    { id: 'p1', status: 'In Progress' }, { id: 'p2', status: 'In Progress' }, { id: 'p3', status: 'In Progress' },
  ]),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({ listTimesheetsAwaitingApproval: () => Promise.resolve([]) }));
vi.mock('@/src/lib/repositories/expenses', () => ({
  expenseClaimRepository: { list: () => Promise.resolve({ rows: [] }), routes: () => Promise.resolve([]) },
}));
vi.mock('@/src/lib/repositories/fxRates', () => ({
  fxRatesRepository: { context: () => Promise.resolve({ currency: 'USD', timezone: 'UTC' }) },
}));
vi.mock('@/src/lib/repositories/revenue', () => ({
  revenueRepository: { listInvoices: () => Promise.resolve([]), listOverdueInvoiceFacts: () => Promise.resolve([]) },
}));
vi.mock('@/src/lib/repositories/tasks', () => ({
  taskRepository: { list: h.list, listDueRows: h.listDueRows },
}));

import { useNeedsYou } from './useNeedsYou';

describe('PM overdue-task counts (#1741)', () => {
  it('reads every project\'s tasks in one batched call and keeps the per-project counts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useNeedsYou('Project Manager'), { wrapper });

    await waitFor(() => expect(result.current.pmOverdueTasksByProject).toEqual({ p1: 1, p2: 1, p3: 0 }));
    expect(h.list).not.toHaveBeenCalled();
    expect(h.listDueRows).toHaveBeenCalledTimes(1);
    expect(h.listDueRows.mock.calls[0][0]).toEqual(['p1', 'p2', 'p3']);
  });
});
