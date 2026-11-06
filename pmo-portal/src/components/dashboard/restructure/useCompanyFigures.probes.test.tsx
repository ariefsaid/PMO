// Issue 1973 review fix: the existence probes (hasAnySalesInvoice / hasAnyIncomingPayment) fired on
// every Company Dashboard load, though their answer only matters once the dashboard is loaded and
// every other activity signal has already resolved empty. These tests run the REAL useRevenue hooks
// over a stubbed repository seam: a populated org must call neither probe DAL fn and must not block
// its tiles (todayPending) on them; an all-empty org must call both and hold the empty state until
// they land.
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listOverdueInvoiceFacts: vi.fn(),
  listPaidPaymentFacts: vi.fn(),
  hasAnySalesInvoice: vi.fn(),
  hasAnyIncomingPayment: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: { projects_by_status: [], procurements_by_status: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: { projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: { wins_count: 0, losses_count: 0, wins_value: 0, value_by_currency: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => ({ data: { totals: [] }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('./useNeedsYou', () => ({ selectOverdueInvoices: () => undefined, selectSupplierInvoices: () => undefined }));
vi.mock('@/pages/procurement/blocks/procurementMoney', () => ({ withLinkedDocuments: () => undefined }));
// Only the repository seam is stubbed; the real useRevenue query hooks run (issue 1973 probes).
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: {
      listOverdueInvoiceFacts: h.listOverdueInvoiceFacts,
      listPaidPaymentFacts: h.listPaidPaymentFacts,
      hasAnySalesInvoice: h.hasAnySalesInvoice,
      hasAnyIncomingPayment: h.hasAnyIncomingPayment,
    },
  },
}));

import { useCompanyFigures } from './useCompanyFigures';

const renderFigures = () => renderHook(() => useCompanyFigures({ key: 'month', label: 'October', from: '2026-10', to: '2026-10' }), {
  wrapper: ({ children }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  ),
});

beforeEach(() => {
  h.listOverdueInvoiceFacts.mockReset().mockResolvedValue([]);
  h.listPaidPaymentFacts.mockReset().mockResolvedValue([]);
  h.hasAnySalesInvoice.mockReset().mockResolvedValue(false);
  h.hasAnyIncomingPayment.mockReset().mockResolvedValue(false);
});

describe('issue 1973 review fix: existence probes gated on all-other-signals-empty', () => {
  it('a populated org calls neither probe DAL fn and its tiles do not wait on them', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue([{ id: 'inv-1', currency: 'USD', amount: 10, due_date: '2026-10-01', status: 'Issued' }]);
    const { result } = renderFigures();
    await waitFor(() => expect(result.current.todayPending).toBe(false));
    expect(h.hasAnySalesInvoice).not.toHaveBeenCalled();
    expect(h.hasAnyIncomingPayment).not.toHaveBeenCalled();
  });

  it('an all-empty org calls both probes, holds the tiles and the empty state until they land', async () => {
    let resolveInvoiceProbe: (value: boolean) => void = () => {};
    let resolvePaymentProbe: (value: boolean) => void = () => {};
    h.hasAnySalesInvoice.mockImplementation(() => new Promise<boolean>((resolve) => { resolveInvoiceProbe = resolve; }));
    h.hasAnyIncomingPayment.mockImplementation(() => new Promise<boolean>((resolve) => { resolvePaymentProbe = resolve; }));
    const { result } = renderFigures();
    await waitFor(() => {
      expect(h.hasAnySalesInvoice).toHaveBeenCalledOnce();
      expect(h.hasAnyIncomingPayment).toHaveBeenCalledOnce();
    });
    // Review finding 2 pin: while a probe is pending the KPI tiles keep their skeleton…
    expect(result.current.todayPending).toBe(true);
    // …and the empty state still waits instead of flashing "No company activity yet".
    expect(result.current.isEmpty).toBe(false);
    await act(async () => { resolveInvoiceProbe(false); resolvePaymentProbe(false); });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.todayPending).toBe(false);
  });
});
