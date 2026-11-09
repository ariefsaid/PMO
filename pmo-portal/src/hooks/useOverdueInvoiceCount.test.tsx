import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  countOverdueInvoices: vi.fn(),
  submitInvoice: vi.fn(),
  createPayment: vi.fn(),
  createInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  cancelPayment: vi.fn(),
  setReceivedDate: vi.fn(),
  setEfaktur: vi.fn(),
  setProject: vi.fn(),
  setBillingKind: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { org_id: 'org-1' } }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-11-05', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/lib/repositories/revenue', () => ({
  revenueRepository: {
      countOverdueInvoices: h.countOverdueInvoices,
      submitInvoice: h.submitInvoice,
      createPayment: h.createPayment,
      createInvoice: h.createInvoice,
      cancelInvoice: h.cancelInvoice,
      cancelPayment: h.cancelPayment,
      setReceivedDate: h.setReceivedDate,
      setEfaktur: h.setEfaktur,
      setProject: h.setProject,
      setBillingKind: h.setBillingKind,
    },
}));
vi.mock('@/src/auth/impersonation', () => ({
  useOptionalRealRole: () => 'Finance',
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  routeDomainWrite: vi.fn(() => 'pmo'),
}));
vi.mock('@/src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/analytics')>()),
  trackInvoiceIssued: vi.fn(),
  trackPaymentRecorded: vi.fn(),
}));

import { useOverdueInvoiceCount } from './useOverdueInvoiceCount';
import { useAssignInvoiceProject, useRevenueMutations } from './useRevenue';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function useRailAndMutations() {
  const count = useOverdueInvoiceCount();
  const mutations = useRevenueMutations();
  return { count, mutations };
}

function useRailAndPairing() {
  const count = useOverdueInvoiceCount();
  const assign = useAssignInvoiceProject();
  return { count, assign };
}

describe('useOverdueInvoiceCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares a short-lived count query instead of mounting finance tables', async () => {
    h.countOverdueInvoices.mockResolvedValue(3);
    const client = makeClient();
    const { result } = renderHook(() => useOverdueInvoiceCount(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.data).toBe(3));

    expect(h.countOverdueInvoices).toHaveBeenCalledTimes(1);
    expect(h.countOverdueInvoices).toHaveBeenCalledWith('2026-11-05');
    const query = client.getQueryCache().find({ queryKey: ['overdue-invoice-count', 'org-1', '2026-11-05'] });
    const options = query?.options as { staleTime?: number; refetchOnWindowFocus?: boolean } | undefined;
    expect(options?.staleTime).toBe(10_000);
    expect(options?.refetchOnWindowFocus).toBe(false);
  });

  // Review finding 4: `staleTime` only marks a query stale — it schedules nothing, and focus
  // refetch is off for money reads. An invoice/payment write MUST invalidate the rail's key, or a
  // mounted rail keeps yesterday's overdue badge for the rest of the session.
  it('refreshes a mounted rail after an invoice is submitted', async () => {
    h.countOverdueInvoices.mockResolvedValue(3);
    h.submitInvoice.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRailAndMutations(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.count.data).toBe(3));

    h.countOverdueInvoices.mockResolvedValue(4);
    await act(async () => {
      await result.current.mutations.submitInvoice.mutateAsync({ siId: 'si-1' });
    });

    await waitFor(() => expect(result.current.count.data).toBe(4));
    expect(h.countOverdueInvoices).toHaveBeenCalledTimes(2);
  });

  it('refreshes a mounted rail after a payment is recorded or cancelled', async () => {
    h.countOverdueInvoices.mockResolvedValue(2);
    h.createPayment.mockResolvedValue(undefined);
    h.cancelPayment.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRailAndMutations(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.count.data).toBe(2));

    h.countOverdueInvoices.mockResolvedValue(1);
    await act(async () => {
      await result.current.mutations.createPayment.mutateAsync({
        customerId: 'c-1',
        salesInvoiceId: 'si-1',
        paidAmount: 100,
        receivedAmount: 100,
        date: '2026-11-05',
      });
    });
    await waitFor(() => expect(result.current.count.data).toBe(1));

    h.countOverdueInvoices.mockResolvedValue(2);
    await act(async () => {
      await result.current.mutations.cancelPayment.mutateAsync({ ipId: 'ip-1' });
    });
    await waitFor(() => expect(result.current.count.data).toBe(2));
    expect(h.countOverdueInvoices).toHaveBeenCalledTimes(3);
  });

  it('refreshes a mounted rail after an invoice is paired or re-attributed to a project', async () => {
    h.countOverdueInvoices.mockResolvedValue(5);
    h.setProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRailAndPairing(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.count.data).toBe(5));

    h.countOverdueInvoices.mockResolvedValue(4);
    await act(async () => {
      await result.current.assign.mutateAsync({ siId: 'si-1', projectId: 'p-1', oldProjectId: null });
    });

    await waitFor(() => expect(result.current.count.data).toBe(4));
    expect(h.countOverdueInvoices).toHaveBeenCalledTimes(2);
  });
});
