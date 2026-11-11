import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ submitInvoice: vi.fn(), createPayment: vi.fn(), createInvoice: vi.fn(), invoice: vi.fn(), payment: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { revenue: { submitInvoice: h.submitInvoice, createPayment: h.createPayment, createInvoice: h.createInvoice } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useOptionalRealRole: () => 'Finance' }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/analytics')>()),
  trackInvoiceIssued: h.invoice,
  trackPaymentRecorded: h.payment,
}));
import { useRevenueMutations } from './useRevenue';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const payment = { customerId: 'c', paidAmount: 1, receivedAmount: 1, date: '2026-10-31' };

describe('AC-PHO-040/041 invoice_issued and payment_recorded', () => {
  beforeEach(() => { Object.values(h).forEach((fn) => fn.mockReset()); });

  it('AC-PHO-040 invoice_issued fires once with the real role when submit succeeds', async () => {
    h.submitInvoice.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    await act(async () => { await result.current.submitInvoice.mutateAsync({ siId: 'si' }); });
    expect(h.invoice).toHaveBeenCalledTimes(1);
    expect(h.invoice).toHaveBeenCalledWith('Finance');
    expect(h.payment).not.toHaveBeenCalled();
  });

  it('AC-PHO-041 invoice_issued fires nothing when submit fails', async () => {
    h.submitInvoice.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    await act(async () => { await result.current.submitInvoice.mutateAsync({ siId: 'si' }).catch(() => {}); });
    expect(h.invoice).not.toHaveBeenCalled();
  });

  it('a draft invoice is not counted as issued', async () => {
    h.createInvoice.mockResolvedValueOnce({ id: 'si' });
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    await act(async () => { await result.current.create.mutateAsync({ customerId: 'c', items: [] }); });
    expect(h.invoice).not.toHaveBeenCalled();
  });

  it('AC-PHO-040 payment_recorded fires once with the real role when the payment is saved', async () => {
    h.createPayment.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    await act(async () => { await result.current.createPayment.mutateAsync(payment); });
    expect(h.payment).toHaveBeenCalledTimes(1);
    expect(h.payment).toHaveBeenCalledWith('Finance');
    expect(h.invoice).not.toHaveBeenCalled();
  });

  it('AC-PHO-041 payment_recorded fires nothing when the payment fails', async () => {
    h.createPayment.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    await act(async () => { await result.current.createPayment.mutateAsync(payment).catch(() => {}); });
    expect(h.payment).not.toHaveBeenCalled();
  });
});
