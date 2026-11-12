/**
 * The on-hand "Owed by clients" figure reads open client invoices only (`listOverdueInvoiceFacts`),
 * so a loaded-and-empty read means nothing is owed — a known zero, which the shared money formatter
 * no longer invents (80f05c77f). Without an explicit zero the tile disappears and the page reports it
 * as hidden for "balances are not synced", which is false. Mirrors the collected-tile regression pin
 * one file over, and the Receivables page's own `receivablesCount === 0` handling.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ invoices: [] as Array<Record<string, unknown>> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: () => ({}), useSalesPipeline: () => ({}), useWinRate: () => ({}) }));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => ({ data: { months: [], rows: [], totals: [] } }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useOverdueInvoiceFacts: () => ({ data: state.invoices }),
  usePaidPaymentFacts: () => ({ data: [] }),
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({}) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({}) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({}) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({}) }));
vi.mock('./useNeedsYou', () => ({ selectOverdueInvoices: () => undefined, selectSupplierInvoices: () => undefined }));
vi.mock('@/src/lib/procurement/procurementMoney', () => ({ withLinkedDocuments: () => undefined }));

import { useCompanyFigures } from './useCompanyFigures';

const owedFigure = (result: { current: ReturnType<typeof useCompanyFigures> }) =>
  result.current.today.find((figure) => figure.id === 'owed-clients');

beforeEach(() => { state.invoices = []; });

it('provides an explicit home-currency zero when no client invoice is open', () => {
  const { result } = renderHook(() => useCompanyFigures({ key: 'custom', label: 'January', from: '2026-01', to: '2026-01' }));
  expect(owedFigure(result)?.amounts).toEqual([{ currency: 'USD', amount: 0 }]);
});

it('keeps an unknown balance unknown, never a zero', () => {
  state.invoices = [{ id: 'inv-1', status: 'Unpaid', currency: 'USD', invoice_date: '2026-01-05', erp_due_date: '2026-02-05', received_date: null, erp_outstanding_amount: null, erp_payment_terms_days: null }];
  const { result } = renderHook(() => useCompanyFigures({ key: 'custom', label: 'January', from: '2026-01', to: '2026-01' }));
  expect(owedFigure(result)?.amounts).toBeNull();
});
