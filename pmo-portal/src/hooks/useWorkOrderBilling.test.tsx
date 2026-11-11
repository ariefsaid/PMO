import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  billing: vi.fn(async () => []),
  acceptanceAge: vi.fn(async () => []),
  unbilled: vi.fn(async () => ({ totals: [], incompleteCount: 0, rows: [] })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { billing: h.billing, unbilled: h.unbilled, acceptanceAge: h.acceptanceAge } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useUnbilledWorkOrders, useWorkOrderAcceptanceAge, useWorkOrderBilling } from './useWorkOrderBilling';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { h.billing.mockClear(); h.unbilled.mockClear(); h.acceptanceAge.mockClear(); });

describe('work-order billing hooks (OD-BILL-1)', () => {
  it("AC-BWO-004 reads the project's billing", async () => {
    const { result } = renderHook(() => useWorkOrderBilling('p1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.billing).toHaveBeenCalledWith('p1');
  });
  it('AC-BWO-004 does not read when the caller may not see billing', async () => {
    renderHook(() => useWorkOrderBilling('p1', false), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('AC-UNB-005 asks for the 8 work orders with the most left', async () => {
    const { result } = renderHook(() => useUnbilledWorkOrders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.unbilled).toHaveBeenCalledWith(8);
  });
});

describe('work-order acceptance age hook (#1640)', () => {
  it('AC-WOMS-011 useWorkOrderAcceptanceAge is keyed under the work-order billing prefix so billing invalidations refresh it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useWorkOrderAcceptanceAge('p1'), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.acceptanceAge).toHaveBeenCalledTimes(1);
    expect(h.acceptanceAge).toHaveBeenCalledWith('p1');
    await client.invalidateQueries({ queryKey: ['work-order-billing', 'org-1', 'p1'] });
    await waitFor(() => expect(h.acceptanceAge).toHaveBeenCalledTimes(2));
  });
});
