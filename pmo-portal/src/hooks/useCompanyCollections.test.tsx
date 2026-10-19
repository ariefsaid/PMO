import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  allowed: true,
  orgId: 'org-1' as string | null,
  snapshot: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  snapshotOptions: [] as Array<{ enabled?: boolean } | undefined>,
  listForCompanies: vi.fn(),
  listForErpCustomerIds: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    companyCollections: {
      listForCompanies: h.listForCompanies,
      listForErpCustomerIds: h.listForErpCustomerIds,
    },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: h.orgId } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.allowed }));
vi.mock('./useErpSnapshots', () => ({
  useArAgingSnapshot: (options?: { enabled?: boolean }) => {
    h.snapshotOptions.push(options);
    return h.snapshot;
  },
}));

import { useCompanyCollections } from './useCompanyCollections';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const zeroRow: ErpAgingSnapshotRow = {
  party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 0,
  current: 0, bucket0to30: 0, bucket31to60: 0, bucket61to90: 0, bucketOver90: 0,
  rangeLabels: { b_0_30: '0-30 days' }, reportDate: '2026-10-18', ageingBasedOn: 'Due Date',
  asOf: '2026-10-18T00:00:00Z', sourceReport: 'Accounts Receivable', reportVersion: '1', snapshotId: 's1',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.allowed = true;
  h.orgId = 'org-1';
  h.snapshot = { data: [], isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.snapshotOptions.length = 0;
  h.listForCompanies.mockResolvedValue([]);
  h.listForErpCustomerIds.mockResolvedValue([]);
});

describe('useCompanyCollections', () => {
  it('reuses the AR snapshot hook and batches only exact snapshot-party refs with a stable scoped query key', async () => {
    h.snapshot.data = [zeroRow];
    h.listForCompanies.mockResolvedValue([{ companyId: 'company-1', erpCustomerId: 'Customer:C-0001' }]);
    h.listForErpCustomerIds.mockResolvedValue([{ companyId: 'company-1', erpCustomerId: 'Customer:C-0001' }]);
    const client = freshClient();

    const { result } = renderHook(() => useCompanyCollections(['company-2', 'company-1', 'company-1']), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(h.snapshotOptions.at(-1)).toEqual({ enabled: true });
    expect(h.listForCompanies).not.toHaveBeenCalled();
    expect(h.listForErpCustomerIds).toHaveBeenCalledTimes(1);
    expect(h.listForErpCustomerIds).toHaveBeenCalledWith(['Customer:C-0001']);
    expect(result.current.byCompany.get('company-1')).toEqual({ state: 'known', positions: [zeroRow] });
    expect(result.current.customerLinks).toEqual(new Map([['Customer:C-0001', 'company-1']]));
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toContainEqual(
      ['uxs36', 'company-customer-ref-parties', 'org-1', ['Customer:C-0001']],
    );
  });

  it('keeps an absent reference or snapshot position unavailable rather than converting it to zero', async () => {
    h.snapshot.data = [zeroRow];
    h.listForCompanies.mockResolvedValue([]);
    h.listForErpCustomerIds.mockResolvedValue([]);
    const { result } = renderHook(() => useCompanyCollections(['company-1']), { wrapper: wrap(freshClient()) });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.byCompany.get('company-1')).toEqual({ state: 'unavailable', positions: [] });
  });

  it('surfaces a failed reference read as an error distinct from an empty reference result', async () => {
    h.snapshot.data = [zeroRow];
    h.listForErpCustomerIds.mockRejectedValue(new Error('reference read failed'));
    const { result } = renderHook(() => useCompanyCollections(['company-1']), { wrapper: wrap(freshClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'reference read failed' });
  });

  it('disables the shared snapshot and reference reads when permission, org, or caller option denies access', async () => {
    const client = freshClient();
    h.allowed = false;
    const { result, rerender } = renderHook(({ enabled }) => useCompanyCollections(['company-1'], { enabled }), {
      initialProps: { enabled: true }, wrapper: wrap(client),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(h.snapshotOptions.at(-1)).toEqual({ enabled: false });
    expect(h.listForCompanies).not.toHaveBeenCalled();
    expect(h.listForErpCustomerIds).not.toHaveBeenCalled();

    h.allowed = true;
    h.orgId = null;
    rerender({ enabled: true });
    await waitFor(() => expect(h.snapshotOptions.at(-1)).toEqual({ enabled: false }));

    h.orgId = 'org-1';
    rerender({ enabled: false });
    await waitFor(() => expect(h.snapshotOptions.at(-1)).toEqual({ enabled: false }));
    expect(h.listForCompanies).not.toHaveBeenCalled();
    expect(h.listForErpCustomerIds).not.toHaveBeenCalled();
  });
});
