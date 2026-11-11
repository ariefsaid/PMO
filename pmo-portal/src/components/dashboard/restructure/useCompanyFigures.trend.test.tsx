import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ pack: vi.fn(), data: undefined as unknown, orgDay: { day: '2026-10-27' } as { day?: string; isPending?: boolean } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: () => ({}), useSalesPipeline: () => ({}), useWinRate: () => ({}) }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: (range: unknown, enabled?: boolean) => { h.pack(range, enabled); return { data: h.data, isPending: false, isError: false, refetch: vi.fn() }; },
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useOverdueInvoiceFacts: () => ({}),
  usePaidPaymentFacts: () => ({}),
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({}) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({}) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR', useOrgCurrencyState: () => ({ isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => h.orgDay }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({}) }));
vi.mock('./useNeedsYou', () => ({ selectOverdueInvoices: () => undefined, selectSupplierInvoices: () => undefined }));
vi.mock('@/src/lib/procurement/procurementMoney', () => ({ withLinkedDocuments: () => undefined }));

import { useCompanyFigures } from './useCompanyFigures';

it('AC-DTR-001 the headline line is the pack of the twelve completed months, whatever period is picked', () => {
  h.data = { months: [], rows: [], totals: [{ currency: 'IDR', months: [100_00, 250_00, 400_00].map((invoiced, i) => ({ month: `2026-0${i + 7}-01`, invoiced })) }] };
  const { result } = renderHook(() => useCompanyFigures({ key: 'month', label: 'This month', from: '2026-10', to: '2026-10' }));
  expect(h.pack).toHaveBeenCalledWith({ from: '2025-10-01', to: '2026-09-01' }, true);
  expect(result.current.invoicedTrend).toMatchObject({ currency: 'IDR', total: 750, direction: 'up', hasLine: true });
});

it('the trend stays pending while the org day is unknown, so its card is reserved before the window exists', () => {
  h.data = { months: [], rows: [], totals: [] };
  h.orgDay = { day: undefined, isPending: true };
  const { result } = renderHook(() => useCompanyFigures({ key: 'month', label: 'This month', from: '2026-10', to: '2026-10' }));
  expect(result.current.trendPending).toBe(true);
  h.orgDay = { day: '2026-10-27' };
});
