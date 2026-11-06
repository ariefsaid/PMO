// Issue 1973 (review round 2, M2): the narrow facts reads see only open invoices / Paid receipts.
// An org whose records are all closed (a drafted invoice, a Scheduled payment run) has activity,
// so it must see the dashboard with zero open items — never "No company activity yet".
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  invoices: [] as unknown[],
  payments: [] as unknown[],
  anyInvoice: false as boolean | undefined,
  anyPayment: false as boolean | undefined,
  anyInvoicePending: false,
  anyPaymentPending: false,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: { projects_by_status: [], procurements_by_status: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({}),
  useWinRate: () => ({}),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => ({}) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useOverdueInvoiceFacts: () => ({ data: state.invoices }),
  usePaidPaymentFacts: () => ({ data: state.payments }),
  useHasAnySalesInvoice: () => ({ data: state.anyInvoice, isPending: state.anyInvoicePending, isLoading: state.anyInvoicePending, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: state.anyPayment, isPending: state.anyPaymentPending, isLoading: state.anyPaymentPending, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({}) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({}) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({}) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({}) }));
vi.mock('./useNeedsYou', () => ({ selectOverdueInvoices: () => undefined, selectSupplierInvoices: () => undefined }));
vi.mock('@/pages/procurement/blocks/procurementMoney', () => ({ withLinkedDocuments: () => undefined }));

import { useCompanyFigures } from './useCompanyFigures';

const render = () => renderHook(() => useCompanyFigures({ key: 'month', label: 'October', from: '2026-10', to: '2026-10' }));

it('an org whose invoices are all closed still sees the dashboard, not the empty state', () => {
  state.invoices = []; state.payments = [];
  state.anyInvoice = true; state.anyInvoicePending = false; state.anyPayment = false; state.anyPaymentPending = false;
  expect(render().result.current.isEmpty).toBe(false);
});

it('an org whose payments are all Scheduled still sees the dashboard too', () => {
  state.invoices = []; state.payments = [];
  state.anyInvoice = false; state.anyInvoicePending = false; state.anyPayment = true; state.anyPaymentPending = false;
  expect(render().result.current.isEmpty).toBe(false);
});

it('an org with no records at all keeps the empty state', () => {
  state.invoices = []; state.payments = [];
  state.anyInvoice = false; state.anyInvoicePending = false; state.anyPayment = false; state.anyPaymentPending = false;
  expect(render().result.current.isEmpty).toBe(true);
});

it('while the existence evidence is still loading the empty state waits (no zero-then-empty flash)', () => {
  state.invoices = []; state.payments = [];
  state.anyInvoice = undefined; state.anyInvoicePending = true; state.anyPayment = false; state.anyPaymentPending = false;
  const rendered = render();
  expect(rendered.result.current.isEmpty).toBe(false);
  // Review finding 2: a pending probe must hold the KPI tiles too (todayPending), not just the empty state.
  expect(rendered.result.current.todayPending).toBe(true);
});
