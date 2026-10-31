import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', code: 'PR-1', title: 'Inverters', status: 'Vendor Invoiced', total_value: 62_000, approved_total_value: null, currency: 'USD',
  project_id: 'proj-1', budget_category: 'Materials', requested_by_id: 'u-requester', approved_by_id: 'u-approver', vendor_id: 'v-1',
  created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: { name: 'Acme Supply' }, requested_by: { full_name: 'Rina Requester' },
  purchase_requests: [], purchase_orders: [], receipts: [],
  procurement_invoices: [{ amount: 62_000, erp_outstanding_amount: 62_000, invoice_date: '2026-10-20' }],
  payments: [],
  ...over,
});

const detailFor = (r: ReturnType<typeof row>) => ({
  ...r,
  items: [{ id: 'i-1', name: 'Inverter', description: null, quantity: 2 }],
  quotations: [],
  invoices: r.procurement_invoices,
});

const procState = { data: [row()] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const authState = { userId: 'u-finance', role: 'Finance' };
const budgetState = { rows: [] as unknown[], hasBudget: false, isPending: false, actualsPending: false };

const transitionSpy = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const trackSpy = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/analytics')>()),
  trackPurchaseApproved: trackSpy,
}));
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, procurement: { ...actual.repositories.procurement, transition: transitionSpy } } };
});
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { id: 'proj-1', currency: 'USD' } }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: (id?: string) => {
    const found = (procState.data as Array<ReturnType<typeof row>>).find((candidate) => candidate.id === id);
    return { data: found ? detailFor(found) : undefined, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => budgetState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: authState.role, effectiveRole: authState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' }, role: authState.role }) }));

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-probe" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</output>;
};

const renderBlock = (path = '/procurement?open=p-1') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/procurement" element={<ProcurementBlock />} />
          <Route path="/procurement/:procurementId" element={<RouteProbe />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

describe('AC-PHO-040/041 purchase_approved (list and drawer)', () => {
  beforeEach(() => {
    transitionSpy.mockReset();
    transitionSpy.mockResolvedValue(undefined);
    trackSpy.mockReset();
    procState.data = [row({ status: 'Requested', procurement_invoices: [], approved_by_id: null })];
    authState.userId = 'u-finance';
    authState.role = 'Finance';
  });

  const approveFromDrawer = async () => {
    renderBlock();
    fireEvent.click(within(screen.getByRole('dialog', { name: /Inverters/ })).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this procurement?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
  };

  it('AC-PHO-040 fires once with the real role after the approval is saved', async () => {
    await approveFromDrawer();
    await waitFor(() => expect(trackSpy).toHaveBeenCalledTimes(1));
    expect(trackSpy).toHaveBeenCalledWith('Finance');
  });

  it('AC-PHO-041 fires nothing when the approval is refused', async () => {
    transitionSpy.mockRejectedValue(new Error('refused'));
    await approveFromDrawer();
    await waitFor(() => expect(transitionSpy).toHaveBeenCalledWith('p-1', 'Approved'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trackSpy).not.toHaveBeenCalled();
  });
});
