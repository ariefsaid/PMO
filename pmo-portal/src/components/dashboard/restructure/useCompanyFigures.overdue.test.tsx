/**
 * #2132: "Owed by clients · overdue" sits in a row of money figures, so its value is the overdue AMOUNT;
 * how many invoices and how late they are is the detail line. An unknown overdue balance keeps the figure
 * unknown, never a count or a zero.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ invoices: [] as Array<Record<string, unknown>> }));
const interpolate = (text: string, options?: Record<string, unknown>) => text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      if (typeof fallback === 'string') return interpolate(fallback, options);
      const plural = fallback.count === 1 ? fallback.defaultValue_one : fallback.defaultValue_other;
      return interpolate(String(plural ?? fallback.defaultValue ?? ''), fallback);
    },
  }),
}));
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
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-06-01', isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({}) }));

import { useCompanyFigures } from './useCompanyFigures';

const invoice = (id: string, dueDate: string, outstanding: number | null) => ({
  id, status: 'Unpaid', currency: 'USD', invoice_date: '2026-01-01', erp_due_date: dueDate, received_date: null,
  erp_outstanding_amount: outstanding, erp_payment_terms_days: null,
});
const overdueFigure = () => {
  const { result } = renderHook(() => useCompanyFigures({ key: 'custom', label: 'May', from: '2026-05', to: '2026-05' }));
  return result.current.today.find((figure) => figure.id === 'client-overdue');
};

beforeEach(() => { state.invoices = []; });

it('AC-2132-OVERDUE: the value is the overdue amount; the invoice count and age are the detail line', () => {
  // Due 2026-02-04, so 117 days overdue on 2026-06-01; the second invoice is not yet due.
  state.invoices = [invoice('inv-1', '2026-02-04', 12_500), invoice('inv-2', '2026-07-01', 4_000)];
  const figure = overdueFigure();
  expect(figure?.value).toBe('$12.5K');
  expect(figure?.amounts).toEqual([{ currency: 'USD', amount: 12_500 }]);
  expect(figure?.subline).toBe('1 invoice · 117 days');
});

it('several overdue invoices name the count and the oldest age', () => {
  state.invoices = [invoice('inv-1', '2026-02-04', 12_500), invoice('inv-2', '2026-05-22', 500)];
  expect(overdueFigure()?.subline).toBe('2 invoices · oldest 117 days');
});

it('nothing overdue is a known zero with its own words', () => {
  state.invoices = [invoice('inv-2', '2026-07-01', 4_000)];
  const figure = overdueFigure();
  expect(figure?.amounts).toEqual([{ currency: 'USD', amount: 0 }]);
  expect(figure?.subline).toBe('No overdue client invoices');
});

it('an unknown overdue balance keeps the figure unknown, never a count or a partial sum', () => {
  state.invoices = [invoice('inv-1', '2026-02-04', 12_500), invoice('inv-3', '2026-03-01', null)];
  const figure = overdueFigure();
  expect(figure?.value).toBeNull();
  expect(figure?.amounts).toBeNull();
  expect(figure?.unavailableReason).toBe('some client invoice balances are not synced');
});
