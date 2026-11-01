import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ setProject: vi.fn(), setBillingKind: vi.fn(), createInvoice: vi.fn(), submitInvoice: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { revenue: { setProject: h.setProject, setBillingKind: h.setBillingKind, createInvoice: h.createInvoice, submitInvoice: h.submitInvoice } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-A', org_id: 'org-A' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));

import { useAssignInvoiceProject } from './useRevenue';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, Wrapper };
}

const keys = {
  financeA: ['project-finances', 'org-A', 'project-A'] as const,
  financeNew: ['project-finances', 'org-A', 'project-new'] as const,
  financeOtherOrg: ['project-finances', 'org-B', 'project-A'] as const,
  list: ['salesInvoices', 'org-A'] as const,
  detail: ['salesInvoice', 'org-A', 'invoice-A'] as const,
  byProject: ['revenueByProject', 'org-A'] as const,
  invoiceHistory: ['record-history', 'org-A', 'sales_invoice', 'invoice-A'] as const,
  projectHistory: ['record-history', 'org-A', 'project', 'project-A'] as const,
};

describe('useAssignInvoiceProject billing kinds (#1471)', () => {
  beforeEach(() => {
    for (const fn of [h.setProject, h.setBillingKind, h.createInvoice, h.submitInvoice]) fn.mockReset();
  });

  it('AC-009 a same-project kind correction uses the narrow write and refreshes the invoice, revenue, history and that project', async () => {
    const { client, Wrapper } = makeWrapper();
    for (const key of Object.values(keys)) client.setQueryData(key, { seeded: true });
    h.setBillingKind.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-A', oldProjectId: 'project-A', billingKind: 'other' });
    });
    expect(h.setBillingKind).toHaveBeenCalledExactlyOnceWith('invoice-A', 'other');
    expect(h.setProject).not.toHaveBeenCalled();
    for (const key of [keys.financeA, keys.list, keys.detail, keys.byProject, keys.invoiceHistory, keys.projectHistory]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(keys.financeOtherOrg)?.isInvalidated).toBe(false);
  });

  it('AC-009 a project change with a kind sends both in one write and refreshes the old and new project finances', async () => {
    const { client, Wrapper } = makeWrapper();
    client.setQueryData(keys.financeA, { seeded: true });
    client.setQueryData(keys.financeNew, { seeded: true });
    h.setProject.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-new', oldProjectId: 'project-A', billingKind: 'other' });
    });
    expect(h.setProject).toHaveBeenCalledExactlyOnceWith('invoice-A', 'project-new', 'other');
    expect(h.setBillingKind).not.toHaveBeenCalled();
    expect(client.getQueryState(keys.financeA)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.financeNew)?.isInvalidated).toBe(true);
  });

  it('AC-009 a project change without a kind keeps the two-argument write older callers rely on', async () => {
    const { Wrapper } = makeWrapper();
    h.setProject.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-new', oldProjectId: 'project-A' });
    });
    expect(h.setProject).toHaveBeenCalledExactlyOnceWith('invoice-A', 'project-new');
  });

  it('AC-009 a rejected kind correction invalidates nothing', async () => {
    const { client, Wrapper } = makeWrapper();
    client.setQueryData(keys.financeA, { seeded: true });
    h.setBillingKind.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-A', oldProjectId: 'project-A', billingKind: 'other' }))
        .rejects.toThrow('refused');
    });
    expect(client.getQueryState(keys.financeA)?.isInvalidated).toBe(false);
  });

  it('AC-009 neither write path dispatches an ERP command', async () => {
    const { Wrapper } = makeWrapper();
    h.setBillingKind.mockResolvedValue(undefined);
    h.setProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAssignInvoiceProject(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-A', oldProjectId: 'project-A', billingKind: 'other' });
      await result.current.mutateAsync({ siId: 'invoice-A', projectId: 'project-new', oldProjectId: 'project-A', billingKind: 'contract' });
    });
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(h.submitInvoice).not.toHaveBeenCalled();
  });
});
