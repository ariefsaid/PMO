import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** #2805: the dashboard reads billing and cost only for a role the work-order page shows them to; never a read per row. */
const h = vi.hoisted(() => ({
  allowed: new Set<string>(),
  projectIds: ['p1'],
  batch: vi.fn(async (_ids: readonly string[]) => [{ workOrderId: 'w1', currency: 'USD', direct: '3.00', plan: '5.00' }]),
  billing: vi.fn(async () => [{ workOrderId: 'w1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 10, invoiced: 4, pending: 0, paid: 0, remaining: 6, figuresComplete: true, lineCount: 1, unpaidCount: 0 }]),
  plan: vi.fn(),
  lines: vi.fn(async () => []), items: vi.fn(async () => []), acceptances: vi.fn(async () => []),
  idle: () => ({ data: undefined, isPending: false, isError: false, refetch: () => undefined }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: 'Engineer' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => h.allowed.has(`${action}:${entity}`) }));
vi.mock('@/src/lib/repositories/workOrderDashboard', () => ({ workOrderDashboardRepository: { lines: h.lines, items: h.items, acceptances: h.acceptances, billing: h.billing } }));
vi.mock('@/src/lib/repositories/workOrderFinance', () => ({ workOrderFinanceRepository: { projectPlanVsActual: h.plan, dashboardCosts: h.batch } }));
vi.mock('./useWorkOrders', () => ({
  useAllWorkOrders: () => ({ data: h.projectIds.map((id, i) => ({ id: `w${i + 1}`, wo_number: `WO-${i + 1}`, title: 'Order', status: 'Issued', project_id: id, project_name: 'Project', start_date: null, end_date: null })), isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrders: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('./useProgressBilling', () => ({ useBoqItems: h.idle }));
vi.mock('./useWorkOrderAcceptances', () => ({ useProjectWorkOrderLines: h.idle, useWorkOrderAcceptances: h.idle }));
vi.mock('./useWorkOrderBilling', () => ({ useWorkOrderBilling: h.idle }));
vi.mock('./useBillingSteps', () => ({ useBoardWorkOrderSteps: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('./useCloseoutChecklist', () => ({ useOpenCloseoutDue: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('./useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [] }) }));

import { useWorkOrderDashboard } from './useWorkOrderDashboard';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { h.allowed = new Set(); h.projectIds = ['p1']; vi.clearAllMocks(); });

describe('useWorkOrderDashboard', () => {
  it('AC-WOD-006 a role without the invoice and plan rights gets no billed or cost figure and no billing or cost read', async () => {
    const { result } = renderHook(() => useWorkOrderDashboard(), { wrapper });
    await waitFor(() => expect(h.lines).toHaveBeenCalledTimes(1));
    expect(h.billing).not.toHaveBeenCalled();
    expect(h.plan).not.toHaveBeenCalled();
    expect(h.batch).not.toHaveBeenCalled();
    expect(result.current.canBilling).toBe(false);
    expect(result.current.costState).toBe('hidden');
    expect(result.current.rows[0].billing).toBeNull();
    expect(result.current.rows[0].cost).toBeNull();
  });

  it('AC-2826-001 reads direct cost against budget in one request above six projects', async () => {
    h.allowed.add('view:workOrderPlan');
    const ids = Array.from({ length: 7 }, (_, i) => `p${i + 1}`);
    h.projectIds = ids;
    const { result } = renderHook(() => useWorkOrderDashboard(), { wrapper });
    await waitFor(() => expect(result.current.rows[0].cost).toMatchObject({ direct: '3.00', plan: '5.00' }));
    expect(h.batch).toHaveBeenCalledExactlyOnceWith(ids);
    expect(h.plan).not.toHaveBeenCalled();
  });

  it('AC-WOD-007 with both rights, billing and cost are one read each, whatever the row count', async () => {
    h.allowed = new Set(['view:salesInvoice', 'view:workOrderPlan']);
    const { result } = renderHook(() => useWorkOrderDashboard(), { wrapper });
    await waitFor(() => expect(result.current.rows[0].cost).not.toBeNull());
    expect(result.current.rows[0].billing).toMatchObject({ invoiced: 4, orderNet: 10 });
    expect(result.current.rows[0].cost).toMatchObject({ direct: '3.00', plan: '5.00' });
    expect(h.billing).toHaveBeenCalledTimes(1);
    expect(h.batch).toHaveBeenCalledExactlyOnceWith(['p1']);
  });
});
