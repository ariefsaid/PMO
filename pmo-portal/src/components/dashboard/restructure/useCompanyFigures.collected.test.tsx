import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ payments: [
  { status: 'Paid', date: '2026-01-10', currency: 'USD', amount: 0.4 },
  { status: 'Paid', date: '2026-01-11', currency: 'USD', amount: 0.2 },
] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: () => ({}), useSalesPipeline: () => ({}), useWinRate: () => ({}) }));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => ({}) }));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => ({}), useIncomingPayments: () => ({ data: state.payments }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({}) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({}) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({}) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({}) }));
vi.mock('./useNeedsYou', () => ({ selectOverdueInvoices: () => undefined, selectSupplierInvoices: () => undefined }));
vi.mock('@/pages/procurement/blocks/procurementMoney', () => ({ withLinkedDocuments: () => undefined }));

import { useCompanyFigures } from './useCompanyFigures';

it('shows the collected KPI for fractional receipts in the selected period', () => {
  const { result } = renderHook(() => useCompanyFigures({ key: 'custom', label: 'January', from: '2026-01', to: '2026-01' }));
  expect(result.current.period.find((figure) => figure.id === 'collected')).toMatchObject({ value: '$1', lines: ['$1'], href: '/incoming-payments' });
});
