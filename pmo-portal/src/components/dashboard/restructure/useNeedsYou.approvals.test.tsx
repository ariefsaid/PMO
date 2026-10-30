/**
 * Ported from the deleted ExecutiveDashboard.approvalError.test.tsx (AC-W2-4-06 / AC-SL-A-001):
 * the approvals count is never a fabricated 0 when one of its sources failed. The real hook runs
 * against mocked data sources; only the network seams are stubbed.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  procurements: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: () => Promise.resolve() },
  timesheetsAwaiting: [] as unknown[],
  timesheetsAwaitingFails: false,
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'exec-1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => h.procurements }));
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
  getPMDashboardProjects: () => Promise.resolve([]),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({
  listTimesheetsAwaitingApproval: () => h.timesheetsAwaitingFails
    ? Promise.reject(new Error('timesheets unavailable'))
    : Promise.resolve(h.timesheetsAwaiting),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: { listInvoices: () => Promise.resolve([]) },
    expenseClaim: { list: () => Promise.resolve({ rows: [] }), routes: () => Promise.resolve([]) },
    task: { list: () => Promise.resolve([]) },
  },
}));

import { useNeedsYou } from './useNeedsYou';

function renderNeeds() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useNeedsYou('Executive'), { wrapper });
}

const approvals = (items: Array<{ id: string; count: number }>) => items.find((item) => item.id === 'approvals');

beforeEach(() => {
  h.procurements = { data: [], isPending: false, isError: false, refetch: () => Promise.resolve() };
  h.timesheetsAwaiting = [];
  h.timesheetsAwaitingFails = false;
});

describe('Executive approvals count on a failed source (AC-W2-4-06)', () => {
  it('AC-W2-4-06: a failed procurements read reports the error and no approvals count, never 0', async () => {
    h.procurements = { data: undefined, isPending: false, isError: true, refetch: () => Promise.resolve() };
    const { result } = renderNeeds();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(approvals(result.current.items)).toBeUndefined();
    expect(result.current.items.some((item) => item.count === 0)).toBe(false);
  });

  it('AC-W2-4-06: a failed timesheet-approval read reports the error and no approvals count, never 0', async () => {
    h.timesheetsAwaitingFails = true;
    const { result } = renderNeeds();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(approvals(result.current.items)).toBeUndefined();
  });

  it('AC-SL-A-001: with every source read and nothing waiting, no approvals item is shown and nothing is in error', async () => {
    const { result } = renderNeeds();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(approvals(result.current.items)).toBeUndefined();
  });

  it('shows the numeric count, linked to approvals, when an item waits and no source failed', async () => {
    h.timesheetsAwaiting = [{ id: 't1' }];
    const { result } = renderNeeds();

    await waitFor(() => expect(approvals(result.current.items)).toBeDefined());
    expect(result.current.isError).toBe(false);
    expect(approvals(result.current.items)).toMatchObject({ count: 1, href: '/approvals' });
  });
});
