import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ setProject: vi.fn(), createInvoice: vi.fn(), orgId: 'org-A' }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { setProject: h.setProject, createInvoice: h.createInvoice } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-A', org_id: h.orgId } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));

import { useAssignInvoiceProject, useRevenueMutations } from './useRevenue';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, Wrapper };
}

describe('useAssignInvoiceProject', () => {
  beforeEach(() => {
    h.setProject.mockReset();
    h.createInvoice.mockReset();
    h.orgId = 'org-A';
  });

  it('AC-PFIN-010 invalidates the affected org-scoped invoice, finance, and history reads', async () => {
    const { client, Wrapper } = makeWrapper();
    const oldFinance = ['project-finances', 'org-A', 'project-old'] as const;
    const newFinance = ['project-finances', 'org-A', 'project-new'] as const;
    const otherOrgFinance = ['project-finances', 'org-B', 'project-new'] as const;
    const invoiceList = ['salesInvoices', 'org-A', 'all'] as const;
    const invoiceDetail = ['salesInvoice', 'org-A', 'invoice-A'] as const;
    const invoiceHistory = ['record-history', 'org-A', 'sales_invoice', 'invoice-A'] as const;
    for (const [key, data] of [
      [oldFinance, { total: '20.00' }], [newFinance, { total: '30.00' }],
      [otherOrgFinance, { total: '40.00' }], [invoiceList, ['old']],
      [invoiceDetail, { project_id: 'project-old' }], [invoiceHistory, ['history']],
    ] as const) client.setQueryData(key, data);
    h.setProject.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-new', oldProjectId: 'project-old' });
    });

    for (const key of [oldFinance, newFinance, invoiceList, invoiceDetail, invoiceHistory]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(otherOrgFinance)?.isInvalidated).toBe(false);
    expect(client.getQueryData(oldFinance)).toEqual({ total: '20.00' });
    expect(h.setProject).toHaveBeenCalledWith('invoice-A', 'project-new');
  });

  it('AC-PFIN-013 ordinary invoice creation invalidates only the current org finance family', async () => {
    const { client, Wrapper } = makeWrapper();
    const current = ['project-finances', 'org-A', 'project-A'] as const;
    const other = ['project-finances', 'org-B', 'project-B'] as const;
    client.setQueryData(current, { total: '1.00' });
    client.setQueryData(other, { total: '2.00' });
    h.createInvoice.mockResolvedValueOnce({ id: 'invoice-A' });
    const { result } = renderHook(() => useRevenueMutations(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.create.mutateAsync({ customerId: 'customer-A', items: [] });
    });
    expect(client.getQueryState(current)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it('AC-PFIN-010 rejection leaves cached finance untouched and does not invalidate it optimistically', async () => {
    const { client, Wrapper } = makeWrapper();
    const key = ['project-finances', 'org-A', 'project-new'] as const;
    client.setQueryData(key, { total: '30.00' });
    h.setProject.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-new', oldProjectId: null }))
        .rejects.toThrow('refused');
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData(key)).toEqual({ total: '30.00' });
  });
});
