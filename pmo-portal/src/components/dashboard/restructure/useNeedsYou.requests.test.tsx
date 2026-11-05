/**
 * PERF-DASH-1: the Needs-you hook reads only what its role renders. Engineer-only sources (own timesheets,
 * own tasks) must not be requested for a company role; the real hooks run, only the repositories are counted.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  role: 'Executive' as string,
  timesheetList: vi.fn(() => Promise.resolve([])),
  listByAssignee: vi.fn(() => Promise.resolve([])),
  procurementsOpts: [] as unknown[],
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: (opts: unknown) => { h.procurementsOpts.push(opts); return { data: [], isPending: false, isError: false, refetch: vi.fn() }; },
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: () => Promise.resolve({ projects_at_risk: 0 }),
  getFinanceBudgetReview: () => Promise.resolve([]),
  getPMDashboardProjects: () => Promise.resolve([]),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({ listTimesheetsAwaitingApproval: () => Promise.resolve([]) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: { listInvoices: () => Promise.resolve([]) },
    expenseClaim: { list: () => Promise.resolve({ rows: [] }), routes: () => Promise.resolve([]) },
    task: { listByAssignee: h.listByAssignee, listDueRows: () => Promise.resolve([]) },
    timesheet: { list: h.timesheetList },
  },
}));

import { useNeedsYou } from './useNeedsYou';

function render(role: 'Executive' | 'Engineer') {
  h.role = role;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useNeedsYou(role), { wrapper });
}

beforeEach(() => { h.timesheetList.mockClear(); h.listByAssignee.mockClear(); h.procurementsOpts = []; });

describe('useNeedsYou reads only what the role renders (PERF-DASH-1)', () => {
  it('a company role does not request the Engineer-only own timesheets and own tasks', async () => {
    const { result } = render('Executive');
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(h.timesheetList).not.toHaveBeenCalled();
    expect(h.listByAssignee).not.toHaveBeenCalled();
  });

  it('an Engineer still reads its own timesheets and tasks', async () => {
    const { result } = render('Engineer');
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(h.timesheetList).toHaveBeenCalledTimes(1);
    expect(h.listByAssignee).toHaveBeenCalledTimes(1);
  });

  it('the procurement list the hook reads is the lean one', () => {
    render('Executive');
    expect(h.procurementsOpts.every((o) => (o as { lean?: boolean }).lean === true)).toBe(true);
  });
});
