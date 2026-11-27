import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listOverdueInvoiceFacts: vi.fn(),
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
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: {
      listOverdueInvoiceFacts: h.listOverdueInvoiceFacts,
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
import { useOverdueInvoiceFacts, useAssignInvoiceProject, useRevenueMutations } from './useRevenue';

const facts = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i), status: 'Unpaid', invoice_date: '2026-01-01', erp_due_date: '2026-11-01', received_date: null, erp_outstanding_amount: 10, retention_held: 0, erp_payment_terms_days: 30, currency: 'USD' }));

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
  const dashboard = useOverdueInvoiceFacts();
  return { count, mutations, dashboard };
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

  it('rail and dashboard observers share one facts transport and one cache entry', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue(facts(3));
    const client = makeClient();
    const { result } = renderHook(() => { const badge = useOverdueInvoiceCount(); useOverdueInvoiceFacts(); return badge; }, { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.data).toBe(3));

    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledWith();
    const query = client.getQueryCache().find({ queryKey: ['salesInvoices', 'org-1', 'overdue-facts'] });
    const options = query?.options as { staleTime?: number; refetchOnWindowFocus?: boolean } | undefined;
    expect(options?.staleTime).toBe(10_000);
    expect(options?.refetchOnWindowFocus).toBe(false);
  });

  it('one invalidation refreshes both observers and the badge counts only overdue facts', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue([...facts(2), { ...facts(1)[0], id: 'future', erp_due_date: '2026-12-01' }]);
    const client = makeClient();
    const { result } = renderHook(() => ({ badge: useOverdueInvoiceCount(), dashboard: useOverdueInvoiceFacts() }), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.badge.data).toBe(2));
    expect(result.current.dashboard.data).toHaveLength(3);
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(1);
    h.listOverdueInvoiceFacts.mockResolvedValue(facts(1));
    await act(async () => { await client.invalidateQueries({ queryKey: ['salesInvoices', 'org-1'] }); });
    await waitFor(() => expect(result.current.badge.data).toBe(1));
    expect(result.current.dashboard.data).toHaveLength(1);
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(2);
  });

  it('does not read while disabled and starts the existing count query when enabled', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue(facts(3));
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useOverdueInvoiceCount(enabled),
      { initialProps: { enabled: false }, wrapper: makeWrapper(makeClient()) },
    );

    expect(h.listOverdueInvoiceFacts).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toBe(3));

    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(1);
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledWith();
  });

  it('returns a cached count while disabled without starting another read', () => {
    const client = makeClient();
    client.setQueryData(['salesInvoices', 'org-1', 'overdue-facts'], facts(4));
    const { result } = renderHook(() => useOverdueInvoiceCount(false), { wrapper: makeWrapper(client) });

    expect(result.current.data).toBe(4);
    expect(result.current.isPending).toBe(false);
    expect(h.listOverdueInvoiceFacts).not.toHaveBeenCalled();
  });

  // The shared facts invalidation must refresh both observers after a money write.
  it('refreshes a mounted rail after an invoice is submitted', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue(facts(3));
    h.submitInvoice.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRailAndMutations(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.count.data).toBe(3));

    h.listOverdueInvoiceFacts.mockResolvedValue(facts(4));
    await act(async () => {
      await result.current.mutations.submitInvoice.mutateAsync({ siId: 'si-1' });
    });

    await waitFor(() => expect(result.current.count.data).toBe(4));
    expect(result.current.dashboard.data).toHaveLength(4);
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(2);
  });

  it('refreshes a mounted rail after a payment is recorded or cancelled', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue(facts(2));
    h.createPayment.mockResolvedValue(undefined);
    h.cancelPayment.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRailAndMutations(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.count.data).toBe(2));

    h.listOverdueInvoiceFacts.mockResolvedValue(facts(1));
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

    h.listOverdueInvoiceFacts.mockResolvedValue(facts(2));
    await act(async () => {
      await result.current.mutations.cancelPayment.mutateAsync({ ipId: 'ip-1' });
    });
    await waitFor(() => expect(result.current.count.data).toBe(2));
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(3);
  });

  it('refreshes a mounted rail after an invoice is paired or re-attributed to a project', async () => {
    h.listOverdueInvoiceFacts.mockResolvedValue(facts(5));
    h.setProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRailAndPairing(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.count.data).toBe(5));

    h.listOverdueInvoiceFacts.mockResolvedValue(facts(4));
    await act(async () => {
      await result.current.assign.mutateAsync({ siId: 'si-1', projectId: 'p-1', oldProjectId: null });
    });

    await waitFor(() => expect(result.current.count.data).toBe(4));
    expect(h.listOverdueInvoiceFacts).toHaveBeenCalledTimes(2);
  });
});
