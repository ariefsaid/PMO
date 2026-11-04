import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useNeedsYou } from './useNeedsYou';

const dal = vi.hoisted(() => ({
  listInvoices: vi.fn(async () => []),
  listProcurements: vi.fn(async () => []),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-test' }, role: 'Executive' }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: { listInvoices: dal.listInvoices },
    procurement: { list: dal.listProcurements },
    task: { listDueRows: vi.fn(async () => []) },
    expenseClaim: { list: vi.fn(async () => ({ rows: [] })), routes: vi.fn(async () => []) },
    fxRates: { context: vi.fn(async () => ({ timezone: 'UTC', base_currency: 'IDR' })) },
  },
}));

vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: vi.fn(async () => ({})),
  getPMDashboardProjects: vi.fn(async () => []),
  getFinanceBudgetReview: vi.fn(async () => []),
}));

vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isPending: false, isError: false }),
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useNeedsYou — options (enabled and deferred)', () => {
  it('respects enabled: false and does not fire global queries', async () => {
    const { result } = renderHook(() => useNeedsYou('Executive', { enabled: false }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(dal.listInvoices).not.toHaveBeenCalled();
    expect(dal.listProcurements).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
  });

  it('respects deferred: true by scheduling idle work and cancelling on unmount', () => {
    let cancelledId: number | null = null;
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;

    window.requestIdleCallback = vi.fn(() => 99 as unknown as number);
    window.cancelIdleCallback = vi.fn((id: number) => {
      cancelledId = id;
    });

    try {
      const { result, unmount } = renderHook(() => useNeedsYou('Executive', { enabled: true, deferred: true }), {
        wrapper: createWrapper(),
      });

      expect(window.requestIdleCallback).toHaveBeenCalled();
      expect(result.current.isPending).toBe(true);

      unmount();

      expect(window.cancelIdleCallback).toHaveBeenCalledWith(99);
      expect(cancelledId).toBe(99);
    } finally {
      window.requestIdleCallback = originalRequestIdleCallback;
      window.cancelIdleCallback = originalCancelIdleCallback;
    }
  });
});
