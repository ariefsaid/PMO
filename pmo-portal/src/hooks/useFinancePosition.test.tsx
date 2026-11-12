import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinancePosition } from './useFinancePosition';

const state = vi.hoisted(() => ({
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  orgDay: { day: '2026-11-12' as string | null, isPending: false, isError: false, retry: vi.fn() },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'finance-1', org_id: 'org-1' } }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => state.orgDay }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => state.payments,
  useSalesInvoices: () => state.invoices,
}));

describe('useFinancePosition source states', () => {
  beforeEach(() => {
    state.invoices.isPending = false;
    state.invoices.isError = false;
    state.payments.isPending = false;
    state.payments.isError = false;
    state.procurements.isPending = false;
    state.procurements.isError = false;
    state.orgDay.isPending = false;
    state.orgDay.isError = false;
  });

  it('exposes source-specific pending and error flags alongside the legacy unions', () => {
    state.invoices.isPending = true;
    state.payments.isError = true;
    state.procurements.isPending = true;
    state.orgDay.isError = true;

    const { result } = renderHook(() => useFinancePosition());

    expect(result.current).toMatchObject({
      invoicesPending: true,
      invoicesError: false,
      paymentsPending: false,
      paymentsError: true,
      procurementsPending: true,
      procurementsError: false,
      orgDayPending: false,
      orgDayError: true,
      isPending: true,
      isError: true,
    });
  });
});
