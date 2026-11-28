// #2201 — the dashboard Invoiced figure reads unavailable, never a known zero, while an invoice in the period has no amount.
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pack: undefined as unknown }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: () => ({}), useSalesPipeline: () => ({}), useWinRate: () => ({}) }));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => ({ data: state.pack }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useOverdueInvoiceFacts: () => ({}),
  usePaidPaymentFacts: () => ({ data: [] }),
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', async () => (await import('@/src/test/supplierTotalsFromRows')).withSupplierTotals({ useProcurements: () => ({}) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({}) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({}) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({}) }));
vi.mock('./useNeedsYou', () => ({ selectOverdueInvoices: () => undefined, supplierInvoicesFromTotals: () => undefined }));
vi.mock('@/src/lib/procurement/procurementMoney', () => ({ withLinkedDocuments: () => undefined }));

import { useCompanyFigures } from './useCompanyFigures';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const facts = (over: Partial<ManagementPackFacts>): ManagementPackFacts => ({
  from: '2026-01-01', to: '2026-01-01', timezone: 'UTC', org_currency: 'USD', undated_invoice_count: 0,
  projects: [], invoiced: [], invoiced_before: [], progress: [], ...over,
});
const invoicedFigure = () => renderHook(() => useCompanyFigures({ key: 'custom', label: 'January', from: '2026-01', to: '2026-01' }))
  .result.current.period.find((figure) => figure.id === 'invoiced');

it('AC-2201-02: a period whose only invoice has no amount reads unavailable, not $0', () => {
  state.pack = buildManagementPack(facts({ unpriced: [{ currency: 'USD', month: '2026-01-01', invoice_count: 1 }] }));
  expect(invoicedFigure()).toMatchObject({ value: null, amounts: null, unavailableReason: 'Invoiced totals are unavailable for this period.' });
});

it('AC-2201-03: a priced period keeps its figure', () => {
  state.pack = buildManagementPack(facts({ invoiced: [{ project_id: null, currency: 'USD', month: '2026-01-01', net: 250, invoice_count: 1 }] }));
  expect(invoicedFigure()).toMatchObject({ value: '$250', amounts: [{ currency: 'USD', amount: 250 }] });
});
